# Hermes Non-Profit Volunteer Board

A low-volume internal-testing volunteer board. Volunteers discover events on a public calendar and use ordinary SMS to opt in, sign up, join standby, accept an opening, or drop a specific event. SQLite and deterministic domain functions are the sole operational source of truth.

> Setup phase only: the Privacy Policy, SMS Terms, opt-in disclosure, and final A2P campaign copy are intentionally pending. Do not publish the placeholders as compliance documents or submit them to Twilio.

## Requirements

- Node.js 22 or newer
- npm

Twilio CLI, a public tunnel, and live Twilio credentials are not required for local tests.

## Local setup

```powershell
Copy-Item .env.example .env
npm install
npm run migrate
npm run dev
```

The default application URL is `http://localhost:8787`. Without a Twilio Auth Token, the health, public, and configured admin surfaces run, while the inbound webhook returns `503` instead of accepting unverifiable traffic. Without an admin token, admin routes return `503`.

Useful commands:

```powershell
npm test
npm run build
npm run smoke
npm start
```

## SMS commands

- `JOIN` records opt-in.
- A published event keyword such as `PANTRY` signs up an opted-in volunteer.
- `DROP PANTRY` cancels that event without globally opting out.
- `YES` or `NO` answers a single live standby offer.
- `HELP` returns bounded instructions.
- `STOP` records global opt-out when Twilio forwards the event.

All current SMS wording is marked test copy and is not approved campaign language. Full inbound message bodies are used transiently for routing and are not persisted.

## Twilio webhook

Twilio sends form-encoded inbound SMS requests to:

```text
<PUBLIC_BASE_URL>/webhooks/twilio/inbound
```

Set `PUBLIC_BASE_URL` to the exact externally visible HTTPS origin before configuring Twilio. Signature verification uses the official SDK, the request parameters, and this exact URL. Do not disable verification for local development; tests inject a synthetic token and valid synthetic signatures.

A future local live test may use a Cloudflare Quick Tunnel, but `cloudflared` is not a dependency and no tunnel or Twilio Console change is part of this setup. A Messaging Service SID is preferred when available; otherwise the verified number is supported by the adapter where Twilio registration permits it.

## Admin boundary for Hermes

Provide `Authorization: Bearer <ADMIN_API_TOKEN>` to:

```text
GET    /api/admin/events
GET    /api/admin/events/:id
POST   /api/admin/events
PATCH  /api/admin/events/:id
GET    /api/admin/events/:id/signups
POST   /api/admin/signups/:id/drop
POST   /api/admin/messages/send
```

The future Hermes integration must call this narrow API. It must not access SQLite directly or receive arbitrary public SMS content.

## Public site and future Pages deployment

The app serves `/`, `/calendar/`, `/privacy/`, and `/terms/`. The HTML is static-compatible, while the calendar requests `/api/public/events`; a future static deployment must configure a reachable API origin or supply a generated event feed. No GitHub remote, Pages URL, or live deployment is assumed.

## Real versus synthetic status

Passing unit, route, and smoke tests proves local behavior only. It does not prove carrier delivery, Twilio number configuration, A2P approval, or public HTTPS reachability. Those states must remain labeled untested until a separately authorized live canary verifies them.
