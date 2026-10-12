import { readConfig } from './config'
import { postgresDatabase } from './db'
import { createApp } from './app'
const config=readConfig()
const app=await createApp(postgresDatabase(config.databaseUrl),config)
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{void app.close().then(()=>process.exit(0))})
try {await app.listen({host:config.host,port:config.port})}
catch(error){app.log.error(error);await app.close();process.exitCode=1}
