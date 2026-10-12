import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import {randomUUID} from 'node:crypto'
import {readContract,resolveSchema} from '../src/contracts'
import {createApiClient} from '../../../packages/shared/src/client'
import {createEventCatalogAdapter} from '../../../packages/shared/src/event-catalog-adapter'
import {fixture} from './helpers'

test('actual responses conform to OpenAPI and the public adapter works without touching browser saves',async()=>{
  const f=await fixture();try{
    const spec=await readContract();const ajv=new Ajv({strict:false});addFormats(ajv)
    const validate=(path:string,method:string,body:unknown,status='200')=>{
      const response=resolveSchema(spec.paths[path][method].responses[status],spec)
      const check=ajv.compile(response.content['application/json'].schema)
      assert.equal(check(body),true,JSON.stringify(check.errors))
    }
    const fetcher:typeof fetch=async(input,init)=>{
      const url=new URL(String(input));const result=await f.app.inject({method:init?.method as any??'GET',url:url.pathname+url.search,payload:init?.body as string|undefined,headers:init?.headers as any})
      return new Response(result.body,{status:result.statusCode,headers:{'Content-Type':'application/json'}})
    }
    const adapter=createEventCatalogAdapter('http://127.0.0.1:4000',fetcher)
    const list=await adapter.list({category:'common',enabled:true,pageSize:5});validate('/v1/events','get',list)
    assert.equal(list.pagination.total,315)
    validate('/v1/events/{eventId}','get',await adapter.detail('COM-0001'))
    const client=createApiClient({baseUrl:'http://127.0.0.1:4000',fetch:fetcher,getSessionToken:()=>f.user.token})
    const id=randomUUID();const created=await client.createCareer({careerId:id,horseDefinitionId:'DEV_HORSE_SERENE_STEP'})
    validate('/v1/careers','post',created,'201')
    validate('/v1/careers/{careerId}','get',await client.getCareer(id))
    const action=await client.confirmAction(id,{actionId:randomUUID(),choice:'speed',expectedTurn:1})
    validate('/v1/careers/{careerId}/actions','post',action)
    validate('/v1/careers/{careerId}/actions','get',await client.listActions(id))
    const next=await client.advanceMonth(id,{commandId:randomUUID(),actionId:action.actionId,expectedTurn:1})
    validate('/v1/careers/{careerId}/months/advance','post',next)
  }finally{await f.close()}
})
