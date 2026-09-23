> Update September23,2026: operator accepts home deployment complete following unattended reboot recovery. Earlier pending acceptance statements below are historical; no further reboot gate blocks product work. See HERMES-INTEGRATION-PHASE.md.

# Hermes Non-Profit home operations

Authoritative inventory: [HOME DEPLOYMENT](HERMES-NONPROFIT-HOME-DEPLOYMENT.md). Laptop procedure: [migration](laptop-migration.md).

Twilio → https://falloutshelter.tail2ec319.ts.net:10000 → Tailscale Funnel → 127.0.0.1:8787 → Fastify → SQLite. GitHub Pages hosts the public site and policies. The current Windows PC is the authoritative writer. This is the production home service.

## Operator commands

Use elevated PowerShell. These commands never require printing credentials:

```powershell
$app='C:\Services\HermesVolunteerBoard\app'
$root='C:\ProgramData\HermesVolunteerBoard'
$manage="$app\scripts\windows\manage.ps1"
$ts='C:\Program Files\Tailscale\tailscale.exe'
$env:CONFIG_FILE="$root\config\board.env"
Set-Location $app
& $manage -Action status
& $manage -Action start
# Planned shutdown (disables automatic app restart):
& $manage -Action stop
# Restart: stop, then start; do not run during an unattended verification.
& $manage -Action start
& $ts status
& $ts serve status
& $ts funnel status
Get-Service Tailscale
Get-ScheduledTask -TaskName 'HermesVolunteerBoard-*' | Select TaskName,State
Get-ScheduledTask -TaskName 'HermesVolunteerBoard-*' | Get-ScheduledTaskInfo
```

Tailscale service is Automatic under LocalSystem. Run Unattended is enabled and device key expiry is disabled. Funnel persists with `--bg`; no separate connector task is needed. Only port 10000 is public. Preserve private Serve ports 443, 8443, 8444 and 8445. Never use global Serve/Funnel reset. If port 10000 alone lost its configuration, after diagnosis restore it with:

```powershell
& $ts funnel --bg --https=10000 http://127.0.0.1:8787
# Disable only this application's public ingress during migration:
& $ts funnel --https=10000 off
```

[Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel) and [Windows unattended](https://tailscale.com/docs/how-to/run-unattended) describe these connector controls. Do not alter other routes, authentication, DNS or exit-node settings.

## Health

```powershell
Invoke-WebRequest http://127.0.0.1:8787/health
Invoke-WebRequest http://127.0.0.1:8787/ready
Invoke-WebRequest https://falloutshelter.tail2ec319.ts.net:10000/health
Invoke-WebRequest https://falloutshelter.tail2ec319.ts.net:10000/ready
node scripts/host.mjs health
```

Health is liveness; readiness checks database access, schema migrations 1 and 2, expected domain tables and SMS metadata. Failures are generic 503 without private details. A request from a tailnet host can resolve privately: use an external network or the documented public-relay evidence to establish public internet reachability. Never infer Twilio delivery merely from HTTP checks.

## Configuration and installation

`CONFIG_FILE` explicitly selects the protected `config\board.env`. Process variables override file values. The sanitized template is [migration/board.env.example](migration/board.env.example). Required production secrets are TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and ADMIN_API_TOKEN; never place values in commands, docs or evidence. Preserve sender and Messaging Service settings. NODE_ENV=production requires absolute DATABASE_PATH, an HTTPS PUBLIC_BASE_URL and valid credentials. LOG_PATH, BACKUP_PATH, PID_FILE and STOP_FILE are OS-specific absolute paths. Bind remains 127.0.0.1:8787.

For a fresh Windows destination with machine-wide supported Node installed, run the tested checkout's installer with a securely transferred config file and full tested commit:

```powershell
& '<checkout>\scripts\windows\install.ps1' -SourceApp '<checkout>' -SourceEnv '<protected-config-file>' -Revision '<40-character-tested-commit>'
```

It does not overwrite existing config, migrate the database or start the app. Existing differing revisions are rejected. App code/config are readable by LOCAL SERVICE; runtime data/backups/logs are writable by that identity; Administrators/SYSTEM/operator retain control. Do not loosen ACLs or use the source developer database.

## Update and application rollback

Record current `git rev-parse HEAD`, backup path and schema first. Test the target commit in the development checkout. Production origin currently points to that local checkout; fetch using an explicit safe.directory exception only when Git reports the known ownership difference. Never configure a global wildcard exception.

```powershell
git fetch origin
& $manage -Action backup
& $manage -Action update -Revision '<full-tested-commit-present-locally>'
```

Update backs up, stops, checks out detached, installs fresh dependencies, builds, audits production dependencies, then starts. Any failure stops the operation; diagnose before intervention. For code-only rollback, use update with the saved previous full commit. If schema/data compatibility changed, stop the app, restore the matching verified database backup, install the compatible revision and then start. Do not use an older backup after newer volunteer writes without reconciling authoritative state. Never run two writers.

## Database and backup/restore

Live DB: `C:\ProgramData\HermesVolunteerBoard\data\volunteer-board.sqlite`. Backups: `C:\ProgramData\HermesVolunteerBoard\backups`.

```powershell
node scripts/host.mjs inspect
& $manage -Action backup
# Verify a selected backup with the same integrity/schema/FK checks:
node --input-type=module -e "import {inspectDatabase} from './dist/src/operations.js'; console.log(inspectDatabase(process.argv[1]));" '<backup.sqlite>'
# Restore requires a controlled outage; wrapper stops/disables app first:
& $manage -Action restore -BackupFile '<verified-backup.sqlite>'
```

Inspection prints aggregate table counts only. Schema versions are 1,2; domain tables: volunteers, consent_events, events, signups, standby_openings, standby_offers, sms_events. Online SQLite backup writes a staged `.partial`, validates integrity_check, foreign_key_check and schema, then promotes it. Successful six-hour snapshots retain seven days; daily snapshots retain 30 days (age-based pruning). Protect all backups as private data. Local backups do not protect against loss of the PC or disk.

A restore first validates/stages the input; prior DB and WAL/SHM files are preserved as `.before-restore-*`. If restore fails, keep the app stopped. Prefer restoring the verified pre-restore backup. If using the preserved original, treat its matching WAL/SHM as one set, make a verified snapshot from that set before restoration, and never mix sidecars from different versions. Test restore in a separate protected directory; never put fixtures into live data. Do not delete rollback files automatically.

## Logs, maintenance and Windows startup

Logs: `C:\ProgramData\HermesVolunteerBoard\logs\host-YYYY-MM-DD.log`; UTC daily files, 14-day pruning on health checks. Inspect only operational event/status fields; never print environment files or raw request data. Logs exclude SMS bodies, query strings, authorization headers, credentials and phone numbers.

```powershell
Get-ChildItem "$root\logs\host-*.log" | Select Name,LastWriteTime,Length
Get-Content "$root\logs\host-$(Get-Date -AsUTC -Format yyyy-MM-dd).log" -Tail 20 |
  ConvertFrom-Json | Select time,event,status,operation
```

App, Backup and Health tasks are `HermesVolunteerBoard-App`, `HermesVolunteerBoard-Backup`, `HermesVolunteerBoard-Health`, all LOCAL SERVICE without interactive login. App has startup plus one-minute recovery activation; IgnoreNew prevents overlapping task launches. Backup runs at boot/every six hours; health at boot/every five minutes. Unlimited task duration and one-minute failure retry. An already-running activation can yield a scheduler status without indicating app failure; check PID/listener/readiness and logs together. Reinstall tasks with `manage.ps1 -Action install` only when repairing definitions, not routinely.

## Failure recovery

| Symptom | Identify before intervention | Recovery |
|---|---|---|
| App down | task state, last result, port 8787 owner, sanitized host events | start through manage.ps1; never launch a second manual server |
| /ready fails | schema/integrity via host inspect, ACLs, disk space | keep public writes unavailable; correct diagnosed access issue or restore verified authoritative backup |
| DB does not open | path presence, permissions, disk and integrity | do not migrate/create an empty replacement; stop app and recover verified backup |
| Backup fails | task result, operation_failed, disk space, backup directory ACL | fix cause, rerun backup, validate before pruning anything manually |
| Tailscale offline | service state and tailscale status | diagnose connectivity; start service only if stopped; do not reauthenticate/reset settings blindly |
| Funnel unavailable | local ready then serve/funnel status; public DNS/TLS | repair only port 10000 after diagnosis; preserve unrelated routes |
| Webhook unreachable | public ready, exact origin including :10000, PUBLIC_BASE_URL, signature rejection | preserve signature validation; inspect sanitized statuses; user handles any Twilio field correction |

## Acceptance and laptop

Keep plugged-in sleep/hibernate disabled and screen locking enabled; never reboot automatically. BOOT_PERSISTENCE_VERIFICATION_PENDING. With explicit user authorization only, reboot, leave sign-in screen two minutes, verify from an independent path if available, then inspect pre-login start/log timestamps, single instance, ready, Funnel, backup and health tasks. Installation/crash recovery is not reboot evidence. New-Funnel real Twilio delivery remains untested; no SMS is required for this closeout. Follow [laptop migration](laptop-migration.md) later; laptop OS remains undecided.
