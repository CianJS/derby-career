import { randomUUID } from 'node:crypto'
import type { Database, Query } from '../db'
import { conflict, notFound, ApiError } from '../errors'
import { digest } from '../services/identity'
import { EventRepository } from './events'
import { conditionsMatch, planDraw, drawEvent } from '../modules/events/director'
import { applyImmediateEffects, applyActionModifiers, finalizeActionRecord } from '../modules/events/resolver'
import {
  startCareer, isHealthy, canRace,
  statKeys, createRaceRun, raceEligibility, simulateRace, summarizeRaceLog, raceLogDigest,
  type Career, type Choice, type RaceDefinitionSnapshot, type JockeySnapshot,
} from '../../../../packages/shared/src/domain'
import { startServerCareer,resolveServerAction,advanceServerMonth,completeServerRace,API_RACE_ENGINE_VERSION } from '../../../../packages/shared/src/server-domain'
import type { DirectorConfig, EventDefinition, EventTiming, EventEffect } from '../../../../packages/shared/src/events'

type Row = { id: string; stable_id: string; owner_id: string; horse_id: string; definition_id: string; turn: number; revision: number; status: string; state: Career; seed: string; event_misses: number }
type History = { id: string; career_id: string; turn: number; event_id: string; event_revision: string; choice_id: string|null; state: 'pending'|'selected'|'applied'|'expired'; definition_snapshot: EventDefinition; modifiers: EventEffect[]; result: unknown }
const historyDto = (h?: History) => h ? {id:h.id,turn:h.turn,eventId:h.event_id,revision:h.event_revision,choiceId:h.choice_id,state:h.state,definition:h.definition_snapshot,result:h.result} : null
export const raceHealthAllowed = (health: string) => ['정상','HEALTHY','경상','경미','MINOR','중등도','중등도 부상','MODERATE','중상','중증','SEVERE'].includes(health)&&canRace(health)
const resultTiming = (choice: Choice): EventTiming => choice==='rest'?'rest_result':choice==='treatment'?'treatment_result':'training_result'

export class CareerRepository {
  constructor(private db: Database, private director: DirectorConfig) {}
  private async row(tx: Query, owner: string, id: string, lock=false): Promise<Row> {
    const row=(await tx.query(`SELECT c.*, h.definition_id FROM careers c JOIN owned_horses h ON h.id=c.horse_id WHERE c.id=$1 AND c.owner_id=$2 ${lock?'FOR UPDATE OF c':''}`,[id,owner])).rows[0]
    if (!row) throw notFound()
    return row
  }
  private async history(tx: Query, row: Row): Promise<History|undefined> {
    return (await tx.query('SELECT * FROM career_event_history WHERE career_id=$1 AND turn=$2',[row.id,row.turn])).rows[0]
  }
  private async dto(tx: Query, row: Row) {
    const stable=(await tx.query('SELECT funds FROM stables WHERE id=$1',[row.stable_id])).rows[0]
    return {id:row.id,stableId:row.stable_id,ownedHorseId:row.horse_id,horseDefinitionId:row.definition_id,status:row.status,revision:row.revision,authority:'server' as const,funds:Number(stable.funds),state:row.state,event:historyDto(await this.history(tx,row))}
  }
  private async save(tx: Query, row: Row) {
    row.turn=row.state.careerTurnIndex; row.revision++
    await tx.query('UPDATE careers SET state=$2,turn=$3,revision=$4,event_misses=$5,updated_at=now() WHERE id=$1',[row.id,JSON.stringify(row.state),row.turn,row.revision,row.event_misses])
    await tx.query('UPDATE stables SET calendar_year=$2,calendar_month=$3 WHERE id=$1',[row.stable_id,row.state.calendarDate.year,row.state.calendarDate.month])
  }
  private async command<T>(owner: string, id: string, operation: string, body: unknown, careerId: string|null, fn: (tx: Query)=>Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      // All commands for an owner lock the same principal first: stable funds, month and replay are atomic.
      // This also makes retries with a different action ID serialize before checking the monthly unique key.
      if (!(await tx.query('SELECT id FROM principals WHERE id=$1 FOR UPDATE',[owner])).rows.length) throw new ApiError(401,'UNAUTHORIZED','유효한 세션이 필요합니다.')
      if (careerId) await this.row(tx,owner,careerId)
      const hash=digest({operation,careerId,body})
      const existing=(await tx.query('SELECT * FROM commands WHERE principal_id=$1 AND request_id=$2',[owner,id])).rows[0]
      if (existing) {
        if (existing.operation!==operation||existing.request_hash!==hash||existing.career_id!==careerId) throw conflict('동일한 요청 ID를 다른 요청에 사용할 수 없습니다.')
        return existing.response
      }
      const response=await fn(tx)
      await tx.query('INSERT INTO commands(principal_id,request_id,operation,career_id,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)',[owner,id,operation,careerId,hash,JSON.stringify(response)])
      return response
    })
  }
  private active(row: Row) { if (row.status!=='active') throw conflict('종료된 Career는 수정할 수 없습니다.') }
  private async selectHistory(tx: Query, row: Row, history: History, choiceId: string) {
    if (history.state!=='pending') {
      if (history.choice_id!==choiceId) throw conflict('이벤트 선택은 이미 확정되어 변경할 수 없습니다.')
      return
    }
    const choice=history.definition_snapshot.choices.find(x=>x.id===choiceId)
    if (!choice||!conditionsMatch(choice.conditions,{career:row.state})) throw new ApiError(422,'INVALID_CHOICE','실행할 수 없는 이벤트 선택입니다.')
    const resolved=applyImmediateEffects(row.state,choice.effects)
    row.state=resolved.career
    const state=resolved.modifiers.length?'selected':'applied'
    await tx.query("UPDATE career_event_history SET choice_id=$2,state=$3,modifiers=$4,result=$5,selected_at=now(),applied_at=CASE WHEN $3='applied' THEN now() ELSE NULL END WHERE id=$1",[history.id,choiceId,state,JSON.stringify(resolved.modifiers),JSON.stringify({changes:resolved.changes})])
  }
  private async emit(tx: Query, row: Row, event: EventDefinition, choice?: Choice, beforeAction?: Career) {
    const id=randomUUID()
    await tx.query("INSERT INTO career_event_history(id,career_id,turn,event_id,event_revision,state,definition_snapshot) VALUES($1,$2,$3,$4,$5,'pending',$6)",[id,row.id,row.turn,event.id,event.revision,JSON.stringify(event)])
    if (event.automatic) {
      const c=event.choices[0]
      if (!conditionsMatch(c.conditions,{career:row.state,choice,beforeAction})) throw conflict('자동 이벤트 조건이 변경되었습니다.')
      const resolved=applyImmediateEffects(row.state,c.effects)
      row.state=resolved.career
      const state=resolved.modifiers.length?'selected':'applied'
      await tx.query("UPDATE career_event_history SET choice_id=$2,state=$3,modifiers=$4,result=$5,selected_at=now(),applied_at=CASE WHEN $3='applied' THEN now() ELSE NULL END WHERE id=$1",[id,c.id,state,JSON.stringify(resolved.modifiers),JSON.stringify({changes:resolved.changes})])
    }
    await tx.query('UPDATE event_draws SET finished=true WHERE career_id=$1 AND turn=$2',[row.id,row.turn])
  }
  private async createMonth(tx: Query, row: Row) {
    const available=await EventRepository.pool(tx)
    const pool=available.filter(e=>{
      if (['before_race','after_race'].includes(e.timing)) return false // race-preparation remains deferred
      if (e.timing==='treatment_result'&&isHealthy(row.state.health)) return false
      if (e.timing==='training_result'&&!isHealthy(row.state.health)) return false
      return conditionsMatch(e.conditions.filter(c=>c.type!=='action_is'),{career:row.state})&&(e.timing!=='month_start'||e.choices.some(c=>conditionsMatch(c.conditions,{career:row.state})))
    })
    const seed=digest({seed:row.seed,turn:row.turn,version:this.director.version})
    const plan=planDraw(seed,row.event_misses,pool,this.director)
    await tx.query('INSERT INTO event_draws(career_id,turn,seed,system_version,config,pool,gate_passed,deferred_to_result,evaluated_timings,finished) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[row.id,row.turn,seed,this.director.version,JSON.stringify(this.director),JSON.stringify(pool),plan.gatePassed,plan.deferredToResult,JSON.stringify(['month_start']),!plan.gatePassed])
    if (plan.gatePassed&&!plan.deferredToResult) {
      const event=drawEvent(pool,'month_start',{career:row.state},seed,this.director.version)
      if (event) await this.emit(tx,row,event)
    }
  }
  private async finishResultEvent(tx: Query, row: Row, choice: Choice, before: Career) {
    if (await this.history(tx,row)) return
    const draw=(await tx.query('SELECT * FROM event_draws WHERE career_id=$1 AND turn=$2 FOR UPDATE',[row.id,row.turn])).rows[0]
    const timing=resultTiming(choice)
    if (draw.finished||draw.evaluated_timings.includes(timing)) return
    if (draw.gate_passed) {
      const event=drawEvent(draw.pool,timing,{career:row.state,choice,beforeAction:before},draw.seed,draw.system_version)
      if (event) await this.emit(tx,row,event,choice,before)
    }
    await tx.query('UPDATE event_draws SET finished=true,evaluated_timings=$3 WHERE career_id=$1 AND turn=$2',[row.id,row.turn,JSON.stringify([...draw.evaluated_timings,timing])])
  }
  private async consumeModifiers(tx: Query, row: Row, before: Career, choice?: Choice) {
    const history=await this.history(tx,row)
    if (history?.state==='pending') throw conflict('월간 이벤트 선택을 먼저 확정해 주세요.')
    if (history?.state==='selected') {
      const resolved=choice?applyActionModifiers(before,row.state,choice,history.modifiers):{career:row.state,changes:[]}
      row.state=resolved.career
      const matched=choice&&history.modifiers.some(e=>e.type==='action_modifier'&&e.action===(statKeys.includes(choice as any)?'training':choice)&&(!e.training||e.training===choice))
      await tx.query('UPDATE career_event_history SET state=$2,result=$3,applied_at=now() WHERE id=$1',[history.id,matched?'applied':'expired',JSON.stringify({...history.result as object,actionChanges:resolved.changes})])
    }
  }
  private async endMonth(tx: Query, row: Row) {
    const history=await this.history(tx,row)
    if (history?.state==='pending'||history?.state==='selected') throw conflict('이벤트 실행을 완료해 주세요.')
    row.event_misses=history?0:row.event_misses+1
    await tx.query('UPDATE event_draws SET finished=true WHERE career_id=$1 AND turn=$2',[row.id,row.turn])
  }

  async create(owner: string, body: {careerId:string;horseDefinitionId:string}) {
    return this.command(owner,body.careerId,'career.create',body,null,async tx=>{
      const definition=(await tx.query('SELECT * FROM horse_definitions WHERE id=$1',[body.horseDefinitionId])).rows[0]
      if (!definition) throw notFound()
      if (definition.source_kind!=='development_fixture') throw new ApiError(422,'UNSUPPORTED_CATALOG','정식 후보 생성 규칙은 아직 연결되지 않았습니다.')
      let stable=(await tx.query('SELECT * FROM stables WHERE owner_id=$1 FOR UPDATE',[owner])).rows[0]
      if (!stable) {
        stable=(await tx.query('INSERT INTO stables(id,owner_id) VALUES($1,$2) RETURNING *',[randomUUID(),owner])).rows[0]
        for (const id of startCareer(body.horseDefinitionId).contractedJockeyIds) await tx.query('INSERT INTO jockey_contracts(stable_id,jockey_id) VALUES($1,$2)',[stable.id,id])
      }
      if ((await tx.query("SELECT id FROM careers WHERE stable_id=$1 AND status='active'",[stable.id])).rows.length) throw conflict('마방에 이미 활성 Career가 있습니다.')
      const horseId=randomUUID()
      const state=startServerCareer(body.horseDefinitionId)
      state.horse={...state.horse,id:horseId}; state.calendarDate={year:stable.calendar_year,month:stable.calendar_month}
      state.contractedJockeyIds=(await tx.query('SELECT jockey_id FROM jockey_contracts WHERE stable_id=$1 ORDER BY jockey_id',[stable.id])).rows.map(x=>x.jockey_id)
      await tx.query('INSERT INTO owned_horses(id,stable_id,definition_id,definition_snapshot) VALUES($1,$2,$3,$4)',[horseId,stable.id,body.horseDefinitionId,JSON.stringify(definition.payload)])
      for (const id of state.contractedJockeyIds) await tx.query('INSERT INTO jockey_chemistry(horse_id,jockey_id) VALUES($1,$2)',[horseId,id])
      const row: Row={id:body.careerId,stable_id:stable.id,owner_id:owner,horse_id:horseId,definition_id:body.horseDefinitionId,turn:1,revision:1,status:'active',state,seed:randomUUID(),event_misses:0}
      await tx.query('INSERT INTO careers(id,stable_id,owner_id,horse_id,turn,state,seed) VALUES($1,$2,$3,$4,$5,$6,$7)',[row.id,row.stable_id,owner,horseId,1,JSON.stringify(state),row.seed])
      await this.createMonth(tx,row)
      await tx.query('UPDATE careers SET state=$2 WHERE id=$1',[row.id,JSON.stringify(row.state)])
      return {career:await this.dto(tx,row)}
    })
  }
  async get(owner: string, id: string) {
    return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      return {career:await this.dto(tx,await this.row(tx,owner,id))}
    })
  }
  async list(owner: string, page: number, pageSize: number) {
    const result=await this.db.query('SELECT id,status,turn,revision,created_at FROM careers WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',[owner,pageSize,(page-1)*pageSize])
    return {data:result.rows.map(x=>({id:x.id,status:x.status,turn:x.turn,revision:x.revision,createdAt:new Date(x.created_at).toISOString()})),page,pageSize}
  }
  async selectEvent(owner: string, id: string, eventId: string, body: {commandId:string;choiceId:string;expectedTurn:number}) {
    return this.command(owner,body.commandId,'event.choose',{eventId,...body},id,async tx=>{
      const row=await this.row(tx,owner,id,true); this.active(row)
      if (row.turn!==body.expectedTurn) throw conflict('육성 월이 변경되었습니다.')
      const history=await this.history(tx,row)
      if (!history||history.id!==eventId) throw notFound()
      await this.selectHistory(tx,row,history,body.choiceId); await this.save(tx,row)
      return {career:await this.dto(tx,row)}
    })
  }
  async act(owner: string, id: string, body: {actionId:string;choice:Choice;expectedTurn:number}) {
    return this.command(owner,body.actionId,'action.confirm',body,id,async tx=>{
      const row=await this.row(tx,owner,id,true); this.active(row)
      if (row.turn!==body.expectedTurn||row.state.action||row.state.raceRun) throw conflict('이번 월 행동이 이미 확정되었거나 월이 변경되었습니다.')
      if ((await this.history(tx,row))?.state==='pending') throw conflict('이벤트 선택을 먼저 확정해 주세요.')
      const before=structuredClone(row.state)
      try { row.state=resolveServerAction(row.state,body.choice) } catch (error) { throw new ApiError(422,'ACTION_RESTRICTED',(error as Error).message) }
      await this.consumeModifiers(tx,row,before,body.choice)
      await this.finishResultEvent(tx,row,body.choice,before)
      row.state=finalizeActionRecord(before,row.state)
      await tx.query('INSERT INTO monthly_actions(id,career_id,horse_id,turn,kind,domain_record,request_hash,result,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())',[body.actionId,row.id,row.horse_id,row.turn,row.state.action!.actionType,JSON.stringify(row.state.action),digest(body),JSON.stringify({changes:row.state.action!.result,statusChanges:row.state.action!.statusChanges})])
      await this.save(tx,row)
      return {actionId:body.actionId,career:await this.dto(tx,row)}
    })
  }
  async advance(owner: string, id: string, body: {commandId:string;actionId:string;expectedTurn:number}) {
    return this.command(owner,body.commandId,'month.advance',body,id,async tx=>{
      const row=await this.row(tx,owner,id,true); this.active(row)
      const action=(await tx.query('SELECT * FROM monthly_actions WHERE id=$1 AND career_id=$2 AND turn=$3',[body.actionId,id,body.expectedTurn])).rows[0]
      if (!action||row.turn!==body.expectedTurn||!row.state.action?.result||row.state.raceRun||action.domain_record?.actionId!==row.state.action.actionId) throw conflict('다음 월로 진행할 수 있는 확정 행동이 없습니다.')
      await this.endMonth(tx,row)
      row.state=advanceServerMonth(row.state,row.state.action.actionId); row.turn=row.state.careerTurnIndex
      await this.createMonth(tx,row); await this.save(tx,row)
      return {career:await this.dto(tx,row)}
    })
  }
  async enterRace(owner: string, id: string, body: {raceRunId:string;raceDefinitionId:string;jockeyId:string;tactic:'도주'|'선행'|'선입'|'추입';expectedTurn:number;engineVersion?:'race-sim-v1'|'race-sim-v2'}) {
    return this.command(owner,body.raceRunId,'race.enter',body,id,async tx=>{
      const row=await this.row(tx,owner,id,true); this.active(row)
      if (row.turn!==body.expectedTurn||row.state.action||row.state.raceRun) throw conflict('이번 월 행동이 이미 확정되었거나 월이 변경되었습니다.')
      if (!raceHealthAllowed(row.state.health)) throw new ApiError(422,'RACE_RESTRICTED','중상 또는 확인되지 않은 건강 상태에서는 출전할 수 없습니다.')
      if (!row.state.contractedJockeyIds.includes(body.jockeyId)) throw new ApiError(422,'RACE_RESTRICTED','계약 기수 중에서 선택해 주세요.')
      const race=(await tx.query('SELECT payload FROM race_definitions WHERE id=$1',[body.raceDefinitionId])).rows[0]?.payload as RaceDefinitionSnapshot|undefined
      if (!race||race.month!==row.turn) throw new ApiError(422,'RACE_RESTRICTED','현재 월에 출전할 수 있는 경주가 아닙니다.')
      const reason=raceEligibility(row.state,race)
      if (reason) throw new ApiError(422,'RACE_RESTRICTED',reason)
      const jockey=(await tx.query('SELECT payload FROM jockey_definitions WHERE id=$1',[body.jockeyId])).rows[0]?.payload as JockeySnapshot|undefined
      if (!jockey) throw notFound()
      const chemistry=(await tx.query('SELECT chemistry FROM jockey_chemistry WHERE horse_id=$1 AND jockey_id=$2',[row.horse_id,body.jockeyId])).rows[0]?.chemistry??0
      await this.consumeModifiers(tx,row,row.state)
      const seed=randomUUID(); let first=true
      const run=createRaceRun(row.state,race,{...jockey,chemistry},body.tactic,()=>{if(first){first=false;return body.raceRunId}return seed})
      const log=simulateRace(run,body.engineVersion??API_RACE_ENGINE_VERSION)
      run.simulation=summarizeRaceLog(log); row.state={...row.state,raceRun:run}
      await tx.query("INSERT INTO monthly_actions(id,career_id,horse_id,turn,kind,request_hash) VALUES($1,$2,$3,$4,'race',$5)",[body.raceRunId,id,row.horse_id,row.turn,digest(body)])
      await tx.query('INSERT INTO race_runs(id,career_id,turn,action_id,race_definition_id,jockey_id,seed,engine_version,input,health_at_entry) VALUES($1,$2,$3,$1,$4,$5,$6,$7,$8,$9)',[body.raceRunId,id,row.turn,race.id,jockey.id,seed,log.engineVersion,JSON.stringify(run),row.state.health])
      const logJson=JSON.stringify(log)
      await tx.query('INSERT INTO race_simulation_logs(race_run_id,engine_version,digest,duration_ms,byte_length,log,log_json) VALUES($1,$2,$3,$4,$5,$6,$7)',[body.raceRunId,log.engineVersion,raceLogDigest(log),log.durationMs,Buffer.byteLength(logJson),logJson,logJson])
      await this.save(tx,row)
      return {raceRunId:body.raceRunId,career:await this.dto(tx,row)}
    })
  }
  async finishRace(owner: string, id: string, runId: string, body: {commandId:string}) {
    return this.command(owner,body.commandId,'race.complete',{runId,...body},id,async tx=>{
      const row=await this.row(tx,owner,id,true); this.active(row)
      const run=(await tx.query('SELECT * FROM race_runs WHERE id=$1 AND career_id=$2',[runId,id])).rows[0]
      if (!run) throw notFound()
      const existing=(await tx.query('SELECT result FROM race_results WHERE race_run_id=$1',[runId])).rows[0]
      if (existing) return {raceRunId:runId,result:existing.result,career:await this.dto(tx,row)}
      if (row.state.raceRun?.raceRunId!==runId||row.turn!==run.turn) throw conflict('현재 확정 경주와 일치하지 않습니다.')
      const stored=(await tx.query('SELECT * FROM race_simulation_logs WHERE race_run_id=$1',[runId])).rows[0]
      const exactLog=stored?JSON.parse(stored.log_json):undefined
      if (!stored||stored.digest!==raceLogDigest(exactLog)||stored.engine_version!==run.engine_version) throw new ApiError(500,'CORRUPT_LOG','저장된 경주 로그를 확인할 수 없습니다.')
      const result=exactLog.result
      row.state=completeServerRace(row.state,runId,result.placing,result.prizeMoney)
      const record=row.state.raceRecords.find(x=>x.raceRunId===runId)!
      await tx.query('INSERT INTO race_results(race_run_id,career_id,finish_position,prize_money,result,career_record) VALUES($1,$2,$3,$4,$5,$6)',[runId,id,result.placing,result.prizeMoney,JSON.stringify(result),JSON.stringify(record)])
      await tx.query('INSERT INTO stable_ledger(id,stable_id,race_run_id,kind,amount) VALUES($1,$2,$3,\'prize\',$4)',[randomUUID(),row.stable_id,runId,result.prizeMoney])
      await tx.query('UPDATE stables SET funds=funds+$2 WHERE id=$1',[row.stable_id,result.prizeMoney])
      await tx.query('UPDATE jockey_chemistry SET starts=starts+1 WHERE horse_id=$1 AND jockey_id=$2',[row.horse_id,run.jockey_id])
      await tx.query('UPDATE monthly_actions SET resolved_at=now(),result=$2 WHERE id=$1',[run.action_id,JSON.stringify(result)])
      await this.endMonth(tx,row); row.turn=row.state.careerTurnIndex
      await this.createMonth(tx,row); await this.save(tx,row)
      return {raceRunId:runId,result,career:await this.dto(tx,row)}
    })
  }
  async actions(owner: string, id: string, page: number, pageSize: number) {
    await this.row(this.db,owner,id)
    const rows=(await this.db.query('SELECT id,turn,kind,domain_record,result,created_at,resolved_at FROM monthly_actions WHERE career_id=$1 ORDER BY turn DESC LIMIT $2 OFFSET $3',[id,pageSize,(page-1)*pageSize])).rows
    return {data:rows.map(x=>({id:x.id,turn:x.turn,kind:x.kind,record:x.domain_record,result:x.result,createdAt:new Date(x.created_at).toISOString(),resolvedAt:x.resolved_at?new Date(x.resolved_at).toISOString():null})),page,pageSize}
  }
  async records(owner: string, id: string, page: number, pageSize: number) {
    await this.row(this.db,owner,id)
    return {data:(await this.db.query('SELECT career_record FROM race_results WHERE career_id=$1 ORDER BY applied_at DESC,race_run_id DESC LIMIT $2 OFFSET $3',[id,pageSize,(page-1)*pageSize])).rows.map(x=>x.career_record),page,pageSize}
  }
  async events(owner: string, id: string, page: number, pageSize: number) {
    await this.row(this.db,owner,id)
    return {data:(await this.db.query('SELECT * FROM career_event_history WHERE career_id=$1 ORDER BY turn DESC LIMIT $2 OFFSET $3',[id,pageSize,(page-1)*pageSize])).rows.map(historyDto),page,pageSize}
  }
  async race(owner: string, id: string, runId: string, log=false) {
    await this.row(this.db,owner,id)
    const run=(await this.db.query('SELECT r.*,l.digest,l.duration_ms,l.byte_length,l.storage_version,l.log_json FROM race_runs r JOIN race_simulation_logs l ON l.race_run_id=r.id WHERE r.id=$1 AND r.career_id=$2',[runId,id])).rows[0]
    if (!run) throw notFound()
    return log ? {log:JSON.parse(run.log_json)} : {raceRun:run.input,healthAtEntry:run.health_at_entry,metadata:{engineVersion:run.engine_version,digest:run.digest,durationMs:run.duration_ms,byteLength:run.byte_length,storageVersion:run.storage_version}}
  }
}
