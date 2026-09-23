# Tailscale Funnel

The authoritative operating procedure is [home-hosting.md](home-hosting.md), inventory is [HERMES-NONPROFIT-HOME-DEPLOYMENT.md](HERMES-NONPROFIT-HOME-DEPLOYMENT.md), and portable migration package is [laptop-migration.md](laptop-migration.md).

Production origin: https://falloutshelter.tail2ec319.ts.net:10000

Twilio POST webhook: https://falloutshelter.tail2ec319.ts.net:10000/webhooks/twilio/inbound

User confirmed webhook configuration. No real SMS delivery through this origin has been verified. Public health/readiness and signed webhook behavior have been verified independently. Funnel uses --bg, Tailscale Run Unattended is enabled, key expiry disabled. BOOT_PERSISTENCE_VERIFICATION_PENDING.

Only port 10000 is public; preserve private 443→9119, 8443→18000, 8444→4312 and 8445→4317. Do not reset global Serve/Funnel state. Laptop hostname transfer is not guaranteed; see both migration cases.
