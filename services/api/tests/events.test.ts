import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {DEFAULT_DIRECTOR_CONFIG} from '../../../packages/shared/src/events'
import {startCareer,commitAction,resolveAction} from '../../../packages/shared/src/domain'
import {drawEvent,planDraw} from '../src/modules/events/director'
import {applyImmediateEffects} from '../src/modules/events/resolver'
import {convertNotionRows,importEvents} from '../src/modules/events/import'
import {digest} from '../src/services/identity'
import {fixture,catalogSource} from './helpers'
import {resolveServerAction,API_RACE_ENGINE_VERSION} from '../../../packages/shared/src/server-domain'

test('server authority never enrolls the browser fixture Director or inherits the frontend v3 default',()=>{
  const base=startCareer('DEV_HORSE_SERENE_STEP')
  const local={...base,event:{eventId:'COM-0001',month:1,seed:1,status:'offered' as const},eventLog:[],eventMisses:3}
  const server=resolveServerAction(local,'speed')
  const expected=resolveAction(commitAction(base,'speed'))
  assert.deepEqual(server.values,expected.values)
  assert.equal(server.event,undefined);assert.equal(server.action?.event,undefined)
  assert.equal(API_RACE_ENGINE_VERSION,'race-sim-v2')
})

test('director is deterministic under pool reorder, versioned seed and weighted filtering; unknown source grammar is disabled',async()=>{
  const source=await catalogSource();const catalog=convertNotionRows(source.rows)
  const career=startCareer('DEV_HORSE_SERENE_STEP');const context={career}
  const chosen=drawEvent(catalog.events,'month_start',context,'fixed-month-seed','event-director-v1')
  assert.ok(chosen);assert.deepEqual(drawEvent([...catalog.events].reverse(),'month_start',context,'fixed-month-seed','event-director-v1'),chosen)
  assert.equal(drawEvent(catalog.events,'before_race',context,'fixed-month-seed','event-director-v1'),undefined)
  assert.equal(planDraw('x',3,catalog.events,{...DEFAULT_DIRECTOR_CONFIG,monthlyProbability:0}).gatePassed,true)
  assert.equal(planDraw('x',2,catalog.events,{...DEFAULT_DIRECTOR_CONFIG,monthlyProbability:0}).gatePassed,false)
  const unknown=structuredClone(source.rows.find((x:any)=>x['이벤트 ID']==='COM-0001'))
  unknown['선택·효과']+=' 알 수 없는 추가 능력 +999'
  const staged=convertNotionRows([unknown]).events[0];assert.equal(staged.enabled,false);assert.equal(staged.status,'needs_mapping')
  unknown['선택·효과']=source.rows[0]['선택·효과'];unknown['등장조건']='모든 육성마, G1 3승 이상'
  assert.equal(convertNotionRows([unknown]).events[0].enabled,false)
  const nearCap={...career,values:{...career.values,speed:999,fatigue:1}}
  assert.deepEqual(applyImmediateEffects(nearCap,[{type:'value_delta',key:'speed',amount:10},{type:'value_delta',key:'fatigue',amount:-5}]).career.values,{...nearCap.values,speed:1000,fatigue:0})
})
test('saved monthly event/choice/pool cannot reroll or reapply; conditional modifier is applied once',async()=>{
  const f=await fixture({probability:1});try{
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0034'")
    const {id,response}=await f.create();const event=response.career.event
    assert.equal(event.eventId,'COM-0034');assert.equal(event.state,'pending')
    assert.equal((await f.call('POST',`/v1/careers/${id}/actions`,{actionId:randomUUID(),choice:'speed',expectedTurn:1})).statusCode,409)
    assert.deepEqual((await f.call('GET',`/v1/careers/${id}`)).json(),response)
    const selection={commandId:randomUUID(),choiceId:'B',expectedTurn:1}
    const selected=await f.call('POST',`/v1/careers/${id}/events/${event.id}/choice`,selection);assert.equal(selected.statusCode,200,selected.body)
    assert.equal(selected.json().career.event.state,'selected')
    assert.deepEqual((await f.call('POST',`/v1/careers/${id}/events/${event.id}/choice`,selection)).json(),selected.json())
    assert.equal((await f.call('POST',`/v1/careers/${id}/events/${event.id}/choice`,{...selection,commandId:randomUUID(),choiceId:'A'})).statusCode,409)
    const action={actionId:randomUUID(),choice:'speed',expectedTurn:1}
    const done=await f.call('POST',`/v1/careers/${id}/actions`,action);assert.equal(done.statusCode,200,done.body)
    const base=resolveAction(commitAction(response.career.state,'speed'))
    assert.equal(done.json().career.state.values.fatigue,base.values.fatigue-3)
    assert.equal(done.json().career.event.state,'applied')
    assert.deepEqual((await f.call('POST',`/v1/careers/${id}/actions`,action)).json(),done.json())
    assert.equal((await f.call('GET',`/v1/careers/${id}/events`)).json().data.length,1)
    await assert.rejects(f.db.query("UPDATE career_event_history SET choice_id='A' WHERE id=$1",[event.id]),/Immutable event selection/)
    await assert.rejects(f.db.query("UPDATE event_draws SET seed='reroll' WHERE career_id=$1",[id]),/Immutable monthly draw/)
  }finally{await f.close()}
})
test('catalog revision updates do not replace an already offered event or its effects',async()=>{
  const f=await fixture({probability:1});try{
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0034'")
    const {id,response}=await f.create();const history=response.career.event
    const event=convertNotionRows((await catalogSource()).rows).events.find(e=>e.id==='COM-0034')!
    const {revision,...next}=event;next.choices[0].effects=[{type:'value_delta',key:'fatigue',amount:-1}]
    await importEvents(f.db,{schemaVersion:1,events:[{...next,revision:digest(next)}]})
    assert.notEqual((await f.call('GET','/v1/events/COM-0034')).json().revision,history.revision)
    const applied=await f.call('POST',`/v1/careers/${id}/events/${history.id}/choice`,{commandId:randomUUID(),choiceId:'A',expectedTurn:1})
    assert.equal(applied.statusCode,200,applied.body)
    assert.equal(applied.json().career.state.values.fatigue,2)
    assert.equal(applied.json().career.event.revision,history.revision)
    const again=await f.call('POST',`/v1/careers/${id}/events/${history.id}/choice`,{commandId:randomUUID(),choiceId:'A',expectedTurn:1})
    assert.equal(again.json().career.state.values.fatigue,2)
  }finally{await f.close()}
})
test('result events automatically use locked growth; focused training bonus expires on another action',async()=>{
  for(const eventId of ['COM-0016','COM-0001']){
    const f=await fixture({probability:1,share:0});try{
      await f.db.query('UPDATE event_definitions SET enabled=false WHERE id<>$1',[eventId])
      const {id,response}=await f.create()
      const choice=eventId==='COM-0016'?'speed':'rest'
      const action=await f.call('POST',`/v1/careers/${id}/actions`,{actionId:randomUUID(),choice,expectedTurn:1});assert.equal(action.statusCode,200,action.body)
      const base=resolveAction(commitAction(response.career.state,choice))
      if(eventId==='COM-0016'){
        assert.equal(response.career.event,null)
        const growth=base.values.speed-response.career.state.values.speed
        assert.equal(action.json().career.state.values.speed,base.values.speed+Math.round(growth*.45))
        assert.equal(action.json().career.event.state,'applied')
      }else{
        assert.equal(response.career.event.state,'selected')
        assert.deepEqual(action.json().career.state.values,base.values)
        assert.equal(action.json().career.event.state,'expired')
      }
      assert.equal((await f.call('GET',`/v1/careers/${id}/events`)).json().data.length,1)
    }finally{await f.close()}
  }
})
test('three completed months without an event guarantee the next eligible month start event',async()=>{
  const f=await fixture({probability:0});try{
    await f.db.query("UPDATE event_definitions SET enabled=false WHERE id<>'COM-0034'")
    const {id}=await f.create()
    for(let turn=1;turn<=3;turn++){
      assert.equal((await f.call('GET',`/v1/careers/${id}`)).json().career.event,null)
      const actionId=randomUUID();assert.equal((await f.call('POST',`/v1/careers/${id}/actions`,{actionId,choice:'rest',expectedTurn:turn})).statusCode,200)
      const next=await f.call('POST',`/v1/careers/${id}/months/advance`,{commandId:randomUUID(),actionId,expectedTurn:turn});assert.equal(next.statusCode,200,next.body)
    }
    const fourth=await f.call('GET',`/v1/careers/${id}`)
    assert.equal(fourth.json().career.state.careerTurnIndex,4);assert.equal(fourth.json().career.event.eventId,'COM-0034')
    assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM career_event_history WHERE career_id=$1',[id])).rows[0].n),1)
  }finally{await f.close()}
})
