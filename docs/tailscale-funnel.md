# Tailscale Funnel production connector

Current public origin: https://falloutshelter.tail2ec319.ts.net:10000
Twilio inbound webhook: POST https://falloutshelter.tail2ec319.ts.net:10000/webhooks/twilio/inbound
Local application: http://127.0.0.1:8787
Configuration: C:\ProgramData\HermesVolunteerBoard\config\board.env

Tailscale 1.102.2 is installed machine-wide at C:\Program Files\Tailscale\tailscale.exe. The Windows Tailscale service is Automatic and Run Unattended is enabled. Persistent Funnel configuration uses --bg and resumes with Tailscale; there is no additional Funnel task. Existing LOCAL SERVICE application, health and backup tasks remain responsible for the board. The Cloudflare named-tunnel task remains disabled; do not enable both connectors accidentally.

## Status, stop and recovery

Run in elevated PowerShell:

```powershell
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
& $ts status
& $ts funnel status
# Restore the already-approved board mapping if it was removed:
& $ts funnel --bg --https=10000 http://127.0.0.1:8787
# Disable ONLY this public board port:
& $ts funnel --https=10000 off
```

Do not use funnel reset, serve reset, or change ports 443/8443/8444/8445: these carry existing private services. Do not blindly run funnel with its default 443 port. All traffic on 10000 is public; the board continues enforcing Twilio signatures and admin authentication. Do not place a login challenge on the SMS webhook.

PUBLIC_BASE_URL must be exactly https://falloutshelter.tail2ec319.ts.net:10000, including the port, with no path. Restart the app through scripts/windows/manage.ps1 after changing its config. Never disclose credentials.

## Acceptance and Twilio handoff

The 2026-09-23 cutover verified /health, /ready and / through PUBLIC Funnel relay addresses resolved using DNS-over-HTTPS, avoiding local MagicDNS shortcuts. Public-URL signatures, tampered signatures and duplicate MessageSids were tested on an in-memory database with a fake sender. A production-token signature with missing required fields reached the expected 400 payload validation; tampered signatures returned 403. No production records changed, and no real SMS was sent.

User must manually set the currently active Twilio incoming-message webhook to the URL above with POST. This deployment does not inspect or change Twilio Console. Do not alter A2P registration, campaign, sender, opt-out configuration or GitHub Pages policies. A human confirmation is required before claiming that Twilio now points at Funnel.

No-login reboot acceptance is still pending: reboot only when coordinated, leave the PC at sign-in for two minutes, check public /ready from outside the tailnet, then correlate app/Tailscale startup and readiness logs with boot/login times. Persistent configuration is not proof of successful unattended boot. Do not reset or restart the entire Tailscale service just to test this connector: it carries other private services.

At cutover, Tailscale reported no device key-expiry timestamp. The cutover did not change key-expiry policy or authentication. Recheck status periodically. Funnel remains a beta service subject to bandwidth limits. Do not claim an availability SLA.

## Laptop migration

Copy the same application and a verified final SQLite backup, adapting paths to the laptop OS after inspection. Stop the old board and its Funnel mapping before starting the new authoritative database.

This Funnel hostname belongs to the CURRENT PC's Tailscale device name and tailnet. A new laptop normally receives a different hostname. Do not promise that copying the database carries this URL with it. The simplest move is to configure Funnel on the laptop and have the user update Twilio's webhook once. Preserving the exact PC hostname instead needs a separately reviewed name handoff because renaming this PC also affects its existing private Serve services. Never clone Tailscale device state/keys or run independent writable databases behind a shared public endpoint.

If later using Cloudflare with a domain, keep that migration separate; do not reuse the obsolete Quick Tunnel origin. Neither a domain purchase nor Cloudflare activation is required for Funnel.

Sources: https://tailscale.com/docs/features/tailscale-funnel and https://tailscale.com/docs/reference/tailscale-cli/funnel
