> Update September23,2026: operator accepts home deployment complete following unattended reboot recovery. Earlier pending acceptance statements below are historical; no further reboot gate blocks product work. See HERMES-INTEGRATION-PHASE.md.

# Hermes Non-Profit Volunteer Board — home deployment inventory

Recorded 2026-09-23. Production home service; current Windows PC is authoritative. Laptop OS is UNDECIDED.

## Public architecture and addresses

Twilio → Tailscale Funnel → home PC → Fastify on 127.0.0.1:8787 → SQLite.

- Origin: https://falloutshelter.tail2ec319.ts.net:10000
- Twilio POST webhook: https://falloutshelter.tail2ec319.ts.net:10000/webhooks/twilio/inbound
- Site: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/
- Privacy: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/privacy/
- Terms: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/terms/

GitHub Pages remains the public site/policy host. User confirmed Twilio webhook change; actual SMS delivery through Funnel is UNTESTED, not inferred from HTTP checks.

## Production paths and software

| Item | Actual value |
|---|---|
| Checkout | C:\Services\HermesVolunteerBoard\app |
| Runtime root | C:\ProgramData\HermesVolunteerBoard |
| Config | C:\ProgramData\HermesVolunteerBoard\config\board.env |
| SQLite | C:\ProgramData\HermesVolunteerBoard\data\volunteer-board.sqlite |
| Backups | C:\ProgramData\HermesVolunteerBoard\backups |
| Logs | C:\ProgramData\HermesVolunteerBoard\logs |
| Tested application/operations revision | 607701883e5bdb3f6040036237c819ada0060ace |
| Original home runtime implementation | efff0a1fd1b586c534398c4071e05d31cca14df4 |
| START duplicate-reply repair | ec3767b513d22e515bc73b35735e8e7fd8647e19 |
| Node / npm | 24.14.0 / 11.9.0 |
| Tailscale | 1.102.2 at C:\Program Files\Tailscale\tailscale.exe |
| Schema migrations | 1, 2 |

Production is pinned detached; the inventory-only descendant revision is recorded in closeout evidence and `git rev-parse HEAD`. Development branch is feature/twilio-live-canary-prep-001. Public repository: https://github.com/falloutmule/hermes-nonprofit-volunteer-board. Production origin points to the local development checkout; its source origin is GitHub. No main-branch rewrite or force push.

## Windows runtime and connector

- HermesVolunteerBoard-App: LOCAL SERVICE, startup + one-minute activation, IgnoreNew, unlimited duration, restart-on-failure.
- HermesVolunteerBoard-Backup: LOCAL SERVICE, startup + six hours.
- HermesVolunteerBoard-Health: LOCAL SERVICE, startup + five minutes.
- Tailscale Windows service: LocalSystem, Automatic, Running.
- Machine/DNS: falloutshelter / falloutshelter.tail2ec319.ts.net.
- Run Unattended enabled; key expiry disabled (no expiry in local status).
- Funnel public port10000 → 127.0.0.1:8787; persistent --bg.
- Preserved private Serve routes: 443→127.0.0.1:9119; 8443→127.0.0.1:18000; 8444→127.0.0.1:4312; 8445→127.0.0.1:4317.
- Active Cloudflare dependency: NONE. Project-only legacy binary/task/config removed; historical evidence retained. User-profile binary preserved with UNKNOWN ownership and no active project reference.

## Database, maintenance and security

SQLite integrity, foreign keys and schema VERIFIED. Aggregate state: volunteers1, consent_events5, sms_events5; events/signups/standby_openings/standby_offers0. No private records included here.

Online backups every six hours; snapshots seven days and daily copies 30 days; integrity/schema/FK validation before success. Restore requires stopped app and disabled restart, stages verified input and preserves prior DB/sidecars. Fresh backup and disposable restore verified during closeout. Local backups do not protect against disk/PC loss.

UTC daily host logs, 14-day retention, health monitoring every five minutes. Configuration/backup ACLs restrict private data. Loopback-only binding. Twilio signatures required against configured HTTPS origin including port; MessageSid idempotency; global opt-out suppression; no primary-DB raw SMS body retention. Public pages/readiness/webhook are reachable through Funnel; administrative operations require the configured token. Never expose config, credentials, authorization headers, raw SMS or private phone numbers in logs/evidence. Other Serve routes stay tailnet-private.

Safe Twilio facts: sender +19704708839; A2P APPROVED (user-reported); Messaging Service MGb165306bfff817d4939ddb20604cde4a. No Twilio configuration changes or SMS sent by this closeout.

## Verification and acceptance

VERIFIED: 30/30 tests, build, production audit zero vulnerabilities; database and backup restore; local/public relay health/readiness; unchanged routes; active app; maintenance tasks; no active project Cloudflare dependency. Prior signature verification retained; no application behavior changed in closeout. Migration Linux examples are UNTESTED on actual laptop hardware.

Only remaining deployment acceptance item:

BOOT_PERSISTENCE_VERIFICATION_PENDING

No reboot performed. Installation, unattended mode and crash recovery are not boot evidence. When home, coordinate one reboot and leave sign-in screen at least two minutes before checking startup timestamps, one process, DB readiness, Funnel and maintenance recovery.

## Authoritative procedures and evidence

- [Operations](home-hosting.md)
- [Windows/Linux migration](laptop-migration.md)
- [Sanitized configuration structure](migration/board.env.example)
- Local sanitized closeout evidence: docs/evidence/remote-safe-closeout-20260923-1023/ (intentionally untracked, with SHA256SUMS.txt). Historical evidence remains unchanged and local.
