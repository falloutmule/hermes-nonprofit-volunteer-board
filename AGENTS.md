# Hermes Non-Profit Volunteer Board instructions

## Product rules

- Ordinary SMS is the primary volunteer interaction; volunteers must not need an app, account, or password.
- Low friction is more important than feature breadth. The web calendar is only a discovery surface.
- The board database and deterministic state transitions are authoritative.
- Do not add attendance, check-in, no-show, volunteer scoring, CRM, donation, inventory, or bulk-marketing behavior.
- Standby exists only to fill a capacity opening created by a confirmed cancellation.
- `STOP` is the global SMS opt-out. Event cancellation uses `DROP <event-keyword>` and never bare `CANCEL`.

## Engineering rules

- Inspect runtime and Git state before modifying the project, preserve unrelated changes, and maintain one source of truth.
- Validate Twilio webhook signatures and treat `MessageSid` as the inbound idempotency key.
- Normalize volunteer numbers to E.164. Do not infer consent merely because a phone number exists.
- Never store or log credentials. Do not persist full SMS bodies unless a separately approved requirement is added.
- Test all deterministic state transitions. Do not claim completion or live Twilio delivery without functional evidence.

## Scope rules

- Do not expand this system into a CRM without explicit authorization.
- Hermes may use the authenticated board API but must never directly mutate SQLite or receive arbitrary public SMS.
- Do not purchase resources, submit registrations, change external configuration, create remotes, publish, or push without authorization.
- The approved draft Privacy Policy, SMS Terms, consent wording, and A2P campaign answer sheet were integrated on August 23, 2026. Preserve their factual alignment and do not replace verified URL placeholders until publication is directly proven.
