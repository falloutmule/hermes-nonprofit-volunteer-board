import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {loadConfig} from '../dist/src/config.js';
import {operationalLog} from '../dist/src/operations.js';
const c=loadConfig();
const settings=JSON.parse(readFileSync(join(dirname(process.env.CONFIG_FILE),'tunnel.json'),'utf8'));
if(!settings.enabled || !existsSync(settings.tokenFile) || new URL(c.publicBaseUrl).hostname.endsWith('.trycloudflare.com')) {
  operationalLog(c.logPath,'named_tunnel_not_configured'); process.exit(1);
}
// No token in argv, and never persist cloudflared's raw stderr/settings dump.
const child=spawn(settings.executable,['tunnel','--no-autoupdate','run','--token-file',settings.tokenFile],{stdio:'ignore',windowsHide:true});
child.on('error',()=>{ operationalLog(c.logPath,'tunnel_launch_failed');process.exitCode=1; });
child.on('spawn',()=> operationalLog(c.logPath,'tunnel_started',{pid:child.pid}));
child.on('exit',code=>{operationalLog(c.logPath,'tunnel_exited',{code:code??1});process.exitCode=code??1;});
process.on('SIGTERM',()=>child.kill()); process.on('SIGINT',()=>child.kill());
