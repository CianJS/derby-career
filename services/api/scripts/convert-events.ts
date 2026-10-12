import { readFile, writeFile } from 'node:fs/promises'
import { readEventSource } from '../src/modules/events/import'
const input = process.argv[2] ?? 'seeds/events.import.json'
const output = process.argv[3] ?? 'seeds/events.catalog.json'
const result = readEventSource(await readFile(input,'utf8'),input.endsWith('.csv')?'csv':'json')
await writeFile(output,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({total:result.events.length,enabled:result.events.filter(x=>x.enabled).length,unmapped:result.events.filter(x=>x.status==='needs_mapping').map(x=>({id:x.id,notes:x.mappingNotes})),deferred:result.events.filter(x=>x.status==='deferred').length}))
