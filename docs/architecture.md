# Architecture

```text
Volunteer SMS → verified Twilio webhook → deterministic board service → SQLite
                                      ↘ TwiML reply
SQLite opening/offer state → SmsSender interface → Twilio or test fake
Public calendar → read-only published event API → SQLite
Future Hermes operator → bearer-protected admin API → same board service
```

SQLite is the only event, signup, standby, consent, and idempotency source of truth. Twilio is transport, the public site is discovery, and Hermes is a future operator. Incoming bodies are normalized transiently and are not stored. `MessageSid` prevents repeated inbound mutation.

Each confirmed cancellation creates one capacity-opening record. Openings are serviced in order, and the event can have at most one live offer at a time. Declining advances the same opening; accepting rechecks capacity and updates the offer, signup, and opening in one SQLite transaction.
