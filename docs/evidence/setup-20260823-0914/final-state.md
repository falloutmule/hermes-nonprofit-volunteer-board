# Setup final state

## Goal

Build the setup-phase Hermes Non-Profit Volunteer Board: deterministic SQLite state, secured Twilio boundary, public calendar/compliance shell, future authenticated Hermes API, tests, and evidence—without final legal copy, A2P submission, publication, or real-message claims.

## Exact state at evidence capture

- Project: `C:\Users\fallo\Documents\Codex\2026-08-23\files-mentioned-by-the-user-codex\outputs\hermes-nonprofit-volunteer-board`
- Branch: `main`
- Source/test HEAD: `a68ba8f44b743f0d21247e74908b4f11562cd6c9`
- Git status before adding evidence: clean
- Remote: none
- Node: `v24.14.0`
- Build: PASS
- Tests: PASS — 19/19
- Static/injection smoke: PASS — five required routes returned 200
- Compiled-server socket smoke: PASS — health true and Privacy placeholder returned 200
- Synthetic signed Twilio canary: PASS
- Real Twilio/carrier status: UNTESTED
- Public-site local status: VERIFIED
- GitHub Pages/live public status: UNTESTED

The final evidence-only commit SHA is reported in the operator response because a Git commit cannot contain its own final SHA.

## Failures encountered and resolved

1. Initial sandboxed `npm install` produced no output and was interrupted after repeated waits (exit 1). The approved network-enabled retry completed successfully.
2. Initial TypeScript build failed with `TS2375` because `description: string | null | undefined` was not assignable under `exactOptionalPropertyTypes`. The persisted event type was made explicitly nullable, and the final build passed.
3. Initial route-test collection failed with `.partial() cannot be used on object schemas containing refinements`. Base fields and create/patch refinements were separated, and all route tests passed.
4. Initial sandboxed `npm audit` failed with `audit request ... failed` and `audit endpoint returned an error`. The approved retry succeeded.
5. The first successful audit found `@fastify/static` advisories `GHSA-pr96-94w5-mx2h`, `GHSA-x428-ghpx-8j92`, `GHSA-8pvw-jcv7-9cmj`, and `GHSA-83w8-p2f5-377r`. The dependency was upgraded to 10.1.3; the final audit passed with zero known vulnerabilities.

No real Twilio canary failed because no real Twilio canary was attempted or authorized.

## Remaining blockers

- Final Privacy Policy, SMS Terms and Conditions, public opt-in disclosure, and final A2P consent/campaign copy are intentionally pending.
- No authorized remote or GitHub Pages deployment exists.
- No public HTTPS tunnel or verified Twilio webhook exists.
- The incomplete A2P/compliance state prevents any claim of outbound carrier readiness.

## Next actionable step

Insert the approved Privacy Policy, SMS Terms and Conditions, public opt-in disclosure, and final Twilio A2P campaign answers; publish/verify the public URLs; then submit the A2P Campaign.
