# Home hosting and recovery

Current connector: Tailscale Funnel. See [the Funnel operations guide](tailscale-funnel.md) for the active URL, preserved private routes, Twilio handoff, and laptop hostname limitations. The Cloudflare instructions below are an inactive alternative.

## Layout and configuration

Windows code: `C:\Services\HermesVolunteerBoard\app` (detached, tested commit).
Windows runtime root: `C:\ProgramData\HermesVolunteerBoard`, with `config`, `data`, `backups`, `logs`.
Machine cloudflared: `C:\Program Files\HermesVolunteerBoard\bin\cloudflared.exe`.
Node must also be installed machine-wide. Do not run production from a user profile.

`CONFIG_FILE` selects `config\board.env`; it is required in startup tasks. Local development can still use `.env`. Explicit configuration passed to tests loads no files. Process variables override file values. Configuration errors show field names, never values.

Production requires NODE_ENV=production, an absolute DATABASE_PATH, HTTPS PUBLIC_BASE_URL, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and a random ADMIN_API_TOKEN of at least 32 characters. Preserve the existing sender number and Messaging Service SID. LOG_PATH, BACKUP_PATH, PID_FILE and STOP_FILE are absolute runtime locations in the deployed environment. Do not put secrets in shell arguments, Git, logs or evidence. Protect backups as private volunteer data.

Paths are OS-specific values of the same configuration keys. For Linux, use `/etc/hermes-volunteer-board/board.env`, `/var/lib/hermes-volunteer-board/volunteer-board.sqlite`, `/var/backups/hermes-volunteer-board`, `/var/log/hermes-volunteer-board`, and `/run/hermes-volunteer-board` for PID/stop files. Choose the laptop OS only after hardware/OS inspection. PUBLIC_BASE_URL stays the same across hosts once a stable hostname exists.

## Installation and commands

Run these commands in elevated PowerShell. `install.ps1` accepts a source checkout, its ignored environment file, a full tested commit, and an official cloudflared binary plus its verified SHA256. It creates restricted directories, clones without hardlinks, builds dependencies, provisions configuration only when absent, and installs tasks. It does not migrate data or start the app automatically. Existing differing installations are rejected rather than overwritten.

```powershell
& '<source-checkout>\scripts\windows\install.ps1' -SourceApp '<source-checkout>' -SourceEnv '<source-checkout>\.env' -Revision '<full-tested-commit>' -CloudflaredSource '<official-binary>' -CloudflaredSHA256 '<official-digest>'
$manage = 'C:\Services\HermesVolunteerBoard\app\scripts\windows\manage.ps1'
& $manage -Action start
& $manage -Action status
& $manage -Action backup
& $manage -Action stop
& $manage -Action restore -BackupFile '<verified-snapshot.sqlite>'
& $manage -Action update -Revision '<full-tested-commit-already-present-in-checkout>'
```

Tasks are `HermesVolunteerBoard-App`, `-Tunnel`, `-Backup`, `-Health`, running as LOCAL SERVICE, independent of interactive login. App/tunnel use startup triggers plus one-minute recovery activation with IgnoreNew, so an already-running instance is not duplicated. Backup runs every six hours and at boot; health every five minutes and at boot. Single-instance tasks retry failures after one minute, with no execution time limit. Reinstall preserves task enabled/disabled state. Unrelated Hermes tasks are not modified.

Stop disables app automatic restart, requests shutdown through the protected stop file, and waits for the PID file to disappear. Do not force a restore if stop fails. START re-enrollment and its duplicate-reply repair are unchanged.

Updates require a previously tested commit made available locally with `git fetch` (the deployment clone initially points to the source checkout). They back up first, stop, check out the pinned revision, install/build/audit, then start. On a failure the app stays stopped for diagnosis. Save the old commit and pre-update backup. Never automatically downgrade a database after a migration; restore the matching backup with the app stopped. Reapply any intentional dependency privilege changes separately; no automatic npm or cloudflared update is installed.

## Database cutover, backups, and rollback

Before initial cutover, identify and stop any old app listener on 8787. Leave an existing Quick Tunnel running. Resolve the database path from the old environment; do not reuse synthetic databases.

From the production checkout, `node scripts/host.mjs snapshot <old-live-db> <new-backup-file>` uses SQLite online backup, verifies integrity/schema/foreign keys, and atomically promotes the output. Restore that snapshot to the production data path with the app stopped. Compare all domain table counts and records internally without printing phone numbers. Keep the original checkout/database untouched for rollback and mark it inactive; never start both hosts.

Backups are verified online snapshots: seven days of six-hour snapshots plus 30 daily snapshots. Incomplete `.partial` files are not successful backups. Only matching dated backup files are pruned after a new successful backup. Every restore stages/verifies a snapshot first and retains the prior database and WAL/SHM sidecars under `.before-restore-*`. Preserve and periodically review those rollback files manually. A corrupt input must leave the destination untouched.

Test restores to a disposable protected location; compare schema, consent status and MessageSid uniqueness. Never insert fixtures in production. Local-only backups do not survive loss of this disk/PC. Securely copy configuration separately when migrating; database backup does not contain `.env` or tunnel credentials.

## Health, logs, and boot acceptance

`/health` is process liveness. `/ready` verifies schema versions 1 and 2, expected tables and SMS metadata availability; generic HTTP 503 means not ready. Both return no private data. Fastify listens only on 127.0.0.1:8787. Production refuses to start with a missing database instead of silently creating an empty one.

Operational logs are `host-YYYY-MM-DD.log`, rotated by UTC day with 14-day cleanup. App records request method/status only, no bodies, query strings, headers, phone numbers or raw errors. Health failures and backup outcomes are logged. Task exit status also records failures. Tunnel wrapper discards raw connector output and records only lifecycle events; verify public readiness to establish tunnel connectivity.

Keep AC sleep/hibernate disabled, keep the screen lock enabled, and ensure the network is available at boot. Never disable security updates. Do not reboot automatically.

Boot acceptance requires the user to reboot and leave the PC at the sign-in screen. Check /ready from a separately available path (stable tunnel when provisioned), then after login inspect Task Scheduler start times and the host log timestamp for `started`/`ready_ok` before interactive login. Confirm backup task execution. Install/inspection or recovery of a killed process is NOT proof of reboot persistence. Record `LOCAL_BOOT_PENDING` until observed. Stable tunnel boot acceptance is separate and remains pending until a domain and connector exist.

## Cloudflare alternative: disabled, not the active connector

No domain purchase, DNS change, named tunnel, or Twilio change occurs during local setup. The named-tunnel task is installed disabled. `config\tunnel.json` holds nonsecret executable/token-file paths and `enabled:false`; token contents belong only in the protected token file. Do not create a dummy token.

When the user supplies a Cloudflare-managed hostname, create remotely managed tunnel `hermes-volunteer-board`, route the hostname to http://127.0.0.1:8787, securely provision the token locally, set PUBLIC_BASE_URL to the exact stable HTTPS origin, set tunnel.json enabled=true, and run `manage.ps1 -Action enable-tunnel`. The wrapper passes `--token-file`, never the token value. Do not apply browser-login challenges to the Twilio webhook.

Verify public /ready and signature validation/idempotency with a disposable app/database, not the live volunteer records. The user manually changes the active Twilio incoming webhook to POST `<stable-origin>/webhooks/twilio/inbound`. Leave campaign, sender, opt-out configuration and GitHub Pages policies unchanged. Retire any Quick Tunnel after successful cutover. If a Quick Tunnel has already exited, its previous URL cannot be promised or silently replaced. Complete stable public reachability after a no-login reboot before claiming complete boot persistence. No real SMS is sent by these tools.

## Laptop move

Inspect the laptop first; do not choose its OS in advance. On Windows repeat machine-level installation; on Linux create a dedicated nonlogin user and systemd app/tunnel units with `WorkingDirectory`, `Environment=CONFIG_FILE=...`, `Restart=on-failure`, protected paths, and network-online ordering. Use systemd timers for the same six-hour backup and five-minute health commands. Reuse `scripts/host.mjs` and `scripts/tunnel.mjs`, supplying Linux paths and installing the appropriate official cloudflared binary. Install Node dependencies fresh, never copy node_modules across OSes.

Stop PC app and connector; take the final verified snapshot. Restore the laptop, transfer configuration securely, preserve the exact tested commit, then enable only the laptop connector. With Funnel, follow the hostname migration rules in tailscale-funnel.md; only a Cloudflare named tunnel can reuse the named-tunnel instructions here. Never load-balance independent SQLite copies. Verify integrity, local/public readiness and signed webhook rejection/acceptance. No registration, policy or full phone canary repeat. Any real SMS sanity check needs separate authorization.

Rollback before new writes: stop laptop and restart original PC. After new writes: stop laptop, snapshot its authoritative database, restore that on the PC, then restart PC. Never discard newer consent/opt-out events by restoring a stale copy.
