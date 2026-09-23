# Laptop migration package

Status: PREPARED; destination execution UNTESTED. Laptop OS UNDECIDED. Inspect hardware, storage, architecture and installed OS before choosing Windows or Linux. Current PC stays authoritative until a controlled cutover. Use the exact tested Git revision recorded by the deployment inventory/evidence; install dependencies fresh with npm ci, build and production audit. Never copy node_modules.

## Package manifest

Move: repository at tested commit (including migrations, scripts, package-lock and operating documentation); sanitized configuration structure from migration/board.env.example; securely transferred real configuration outside Git; verified final SQLite online backup plus SHA256 and aggregate-count/schema report. CONFIG_FILE selects the real config. Retain all configuration keys; adapt path values to the OS and PUBLIC_BASE_URL to the destination hostname. Secrets and private DB/backups travel over a separately secured channel, never in Git or chat.

Do not move node_modules, transient logs, stale app.pid/app.stop, runtime caches, temporary connector state, Tailscale machine keys or Windows task definitions onto Linux. Generate destination-specific service definitions; do not clone machine identity. Keep screen locking and avoid sleep on AC power.

## Windows destination

Install supported machine-wide Node (current tested version 24.14.0), Git and official Tailscale. Clone repository, check out the tested commit detached. Run scripts/windows/install.ps1 with SourceApp, securely supplied SourceEnv and Revision as in the operating guide. It provisions C:\Services\HermesVolunteerBoard\app and protected C:\ProgramData\HermesVolunteerBoard\{config,data,backups,logs}. Keep app task disabled until restored DB and cutover gates are ready. Use the project's LOCAL SERVICE App/Backup/Health tasks; verify ACLs and fresh build. Restore via host.mjs while stopped; never seed development fixtures.

Connect Tailscale using the operator's authorized authentication procedure, enable Run Unattended with `tailscale up --unattended=true`, and explicitly review device key-expiry policy. Do not assume the PC policy transfers. Keep Funnel off until cutover. After hostname/signature checks, use `tailscale funnel --bg --https=10000 http://127.0.0.1:8787`. Verify other device routes before changing any. No Cloudflare component is needed.

## Linux destination (templates, not executed)

Install supported Node and build prerequisites for better-sqlite3 appropriate to the actual distribution/CPU; install Git and official Tailscale. Verify Node executable path (`command -v node`) before using units below. Create a dedicated nonlogin `hermes` account. Root owns code at /opt/hermes-volunteer-board and protected config at /etc/hermes-volunteer-board/board.env (root:hermes 0640; parent 0750). Grant hermes ownership and mode 0700 on /var/lib/hermes-volunteer-board, /var/backups/hermes-volunteer-board and /var/log/hermes-volunteer-board.

Set DATABASE_PATH=/var/lib/hermes-volunteer-board/volunteer-board.sqlite, BACKUP_PATH=/var/backups/hermes-volunteer-board, LOG_PATH=/var/log/hermes-volunteer-board, PID_FILE=/var/lib/hermes-volunteer-board/app.pid and STOP_FILE=/var/lib/hermes-volunteer-board/app.stop. Keep other keys unchanged except the actual public origin. Install npm dependencies fresh/build in the destination checkout; never install with Windows node_modules present.

Example /etc/systemd/system/hermes-board.service (validate with systemd-analyze verify on destination):

```ini
[Unit]
Description=Hermes Volunteer Board
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=hermes
Group=hermes
WorkingDirectory=/opt/hermes-volunteer-board
Environment=CONFIG_FILE=/etc/hermes-volunteer-board/board.env
ExecStart=/usr/bin/node dist/src/server.js
Restart=on-failure
RestartSec=60
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/hermes-volunteer-board /var/backups/hermes-volunteer-board /var/log/hermes-volunteer-board
[Install]
WantedBy=multi-user.target
```

Create hermes-backup.service and hermes-health.service as Type=oneshot, with the same User/Group, working directory, CONFIG_FILE, UMask and protected paths; ExecStart respectively `/usr/bin/node scripts/host.mjs backup` and `/usr/bin/node scripts/host.mjs health`. No Restart=always on oneshot jobs. Create matching timers:

```ini
# hermes-backup.timer
[Unit]
Description=Hermes six-hour backup
[Timer]
OnBootSec=2min
OnUnitActiveSec=6h
Unit=hermes-backup.service
[Install]
WantedBy=timers.target
```

Health timer uses OnBootSec=2min, OnUnitActiveSec=5min and Unit=hermes-health.service. Boot-triggered execution provides recovery after downtime. Review [systemd timer semantics](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml). After inspection: `systemctl daemon-reload`; enable app and timers only at the cutover gate. Confirm timers with systemctl list-timers and sanitized journal events. Disable/stop app and timers for restore; confirm process stopped before host.mjs restore. Signals permit graceful shutdown. Native `systemctl stop hermes-board` prevents Restart=on-failure from relaunching it.

Install/enable tailscaled through the actual distribution's official Tailscale procedure. Authenticate as authorized, review key-expiry policy and verify service starts without login. Use Funnel --bg on port 10000 only at activation; Windows unattended flag does not apply to Linux. Validate units and permissions on real hardware; these examples do not constitute Linux execution evidence.

## Controlled database handoff

1. PC remains authoritative writer while destination dependencies/config/tasks are prepared. Keep destination app/connector stopped.
2. Stop PC app with manage.ps1 -Action stop (disables recovery task). Do not allow new PC writes.
3. Create final backup with manage.ps1 -Action backup, validate integrity/schema/FKs via inspectDatabase, record table counts and SHA256. Securely copy this final snapshot.
4. Restore destination while app is stopped. Verify schema 1,2 and aggregate counts match. Do not migrate an old synthetic DB.
5. Disable only the PC port-10000 Funnel using `tailscale funnel --https=10000 off`; preserve its other services/routes. PC app remains disabled.
6. Verify signature behavior for the exact destination origin against an isolated disposable app/DB. No synthetic volunteers or real SMS in live data. Valid signature accepted, invalid403, duplicate SID no duplicate mutation. Preserve the :10000 port in PUBLIC_BASE_URL.
7. Start destination app locally with public ingress still off; inspect readiness and count preservation. Then enable destination Funnel and verify public health/readiness and a signed incomplete webhook payload (no From/Body) returning400 after authentication, invalid403, with unchanged live data. This ordering prevents ordinary public writes during checks as far as possible; if Twilio is already routed to that identity, public ingress activation marks the start of potential writes and the destination immediately becomes authoritative.
8. If hostname changed, user switches active Twilio webhook only after checks; preserve sender/A2P/opt-out. Allow ordinary traffic only after acceptance. Never run two independent writable databases for this service.
9. Coordinate a no-login reboot acceptance on the destination separately. Do not repeat registration, policy publication or the full real-phone canary.

## Hostname cases

A. A clean hostname/device-name handover may be possible only after inspection of tailnet naming, uniqueness and impact on the PC's OTHER routes. It is not guaranteed. Coordinate an explicit authorized identity/name change separately and verify actual DNS/TLS/public URL before reuse. Never copy machine keys or rename the PC blindly: its 443/8443 and other private services must remain usable.

B. If a new ts.net hostname is required, set destination PUBLIC_BASE_URL to its exact HTTPS origin including :10000, validate signatures, then user updates Twilio webhook once. Do not promise falloutshelter.tail2ec319.ts.net follows the database or laptop.

## Rollback

Before destination receives any writes: stop destination app/Funnel, restore PC Funnel port10000 and start its app; restore user webhook if changed. After ANY destination writes, stop destination ingress/app, create and validate its latest authoritative backup, copy/restore it to the stopped PC, check schema/counts and compatible code, then restart PC app/Funnel. Never restart PC with stale consent/STOP state. Preserve both source and destination rollback files securely until the migration is accepted.
