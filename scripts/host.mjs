import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig} from '../dist/src/config.js';
import {snapshotDatabase, restoreDatabase, inspectDatabase, operationalLog, pruneFiles} from '../dist/src/operations.js';

const action=process.argv[2];
let activeConfig;
try {
  if(action==='snapshot') {
    console.log(JSON.stringify({ok:true,counts:await snapshotDatabase(process.argv[3],process.argv[4])}));
  } else {
    const c=loadConfig(); activeConfig=c;
    if(action==='inspect') console.log(JSON.stringify({ok:true,counts:inspectDatabase(c.databasePath)}));
    else if(action==='backup') {
      if(!c.backupPath) throw Error('Missing backup directory');
      const now=new Date(); const day=now.toISOString().slice(0,10);
      const stamp=now.toISOString().replace(/[:.]/g,'-');
      mkdirSync(c.backupPath,{recursive:true});
      const hourly=join(c.backupPath,'snapshot-'+stamp+'.sqlite');
      await snapshotDatabase(c.databasePath,hourly);
      const daily=join(c.backupPath,'daily-'+day+'.sqlite');
      if(!existsSync(daily)) await snapshotDatabase(hourly,daily);
      pruneFiles(c.backupPath,/^snapshot-[\dTZ-]+\.sqlite$/,7);
      pruneFiles(c.backupPath,/^daily-\d{4}-\d{2}-\d{2}\.sqlite$/,30);
      operationalLog(c.logPath,'backup_ok'); console.log('Backup integrity verified');
    } else if(action==='restore') {
      // PowerShell command also checks/disables startup tasks before invoking this.
      if(c.pidFile && existsSync(c.pidFile)) throw Error('Stop app before restore');
      console.log(JSON.stringify({ok:true,...await restoreDatabase(process.argv[3],c.databasePath)}));
    } else if(action==='health') {
      if(c.logPath) pruneFiles(c.logPath,/^host-\d{4}-\d{2}-\d{2}\.log$/,14);
      const r=await fetch('http://127.0.0.1:'+c.port+'/ready',{signal:AbortSignal.timeout(10000)});
      if(r.status!==200 || !(await r.json()).ok) throw Error('Readiness failed');
      operationalLog(c.logPath,'ready_ok'); console.log('Readiness HTTP 200');
    } else if(action==='stop') {
      if(!c.stopFile) throw Error('STOP_FILE required');
      writeFileSync(c.stopFile,'stop'); console.log('Graceful stop requested');
    } else throw Error('Unknown operation');
  }
} catch {
  if(activeConfig?.logPath) operationalLog(activeConfig.logPath,'operation_failed',{operation:String(action)});
  // Do not expose SQLite values, environment contents, URLs with credentials or request data.
  console.error('Host operation failed: '+String(action)); process.exitCode=1;
}
