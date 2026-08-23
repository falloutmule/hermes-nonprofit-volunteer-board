# Twilio setup — future authorized action

Current setup does not change Twilio Console configuration.

When credentials, a public HTTPS endpoint, and authorization are available:

1. Expose the application with HTTPS and set `PUBLIC_BASE_URL` to the exact visible origin.
2. Configure inbound SMS for `+19704708839` or its Messaging Service to `POST <PUBLIC_BASE_URL>/webhooks/twilio/inbound`.
3. Keep request-signature validation enabled and perform an inbound canary.
4. Treat outbound carrier delivery as untested until A2P registration permits and a real message succeeds.

Do not submit placeholder Privacy or Terms URLs. Do not create another number or alter the approved Hermes Non-Profit Brand.
