import fs from 'node:fs';
import path from 'node:path';
const [source,destination,root]=process.argv.slice(2);
let content=fs.readFileSync(source,'utf8');
for(const [name,value] of Object.entries({NODE_ENV:'production',DATABASE_PATH:path.join(root,'data','volunteer-board.sqlite'),LOG_PATH:path.join(root,'logs'),BACKUP_PATH:path.join(root,'backups'),PID_FILE:path.join(root,'data','app.pid'),STOP_FILE:path.join(root,'data','app.stop')})) {
 const pattern=new RegExp('^'+name+'=[^\\r\\n]*','gm');
 const line=name+"='"+value+"'";
 content=pattern.test(content)?content.replace(pattern,()=>line):content+'\n'+line+'\n';
}
fs.writeFileSync(destination,content,{flag:'wx'});
