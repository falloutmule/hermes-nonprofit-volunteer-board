# Hermes Non-Profit — Twilio A2P Campaign Submission Answers

## Status

These answers are prepared for the **Hermes Non-Profit** internal volunteer SMS testing campaign.

Do not submit until:

1. the public opt-in page, Privacy Policy, and SMS Terms are deployed;
2. all three URLs open without login in an incognito/private browser;
3. the pages contain the final text in this package;
4. the application records JOIN/STOP consent and honors opt-outs;
5. placeholders below are replaced by the verified live URLs.

## Verified identity

```text
Brand name: Hermes Non-Profit
Brand SID: BUaa974072c99218e603ff8db997a91560
Twilio number: +1 (970) 470-8839
E.164 number: +19704708839
Public contact email: Falloutmule@gmail.com
Purpose: Low-volume internal volunteer SMS testing
```

## Public URLs

Replace these placeholders only after deployment:

```text
Business / opt-in page: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/
Privacy Policy: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/privacy/
SMS Terms and Conditions: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/terms/
```

Expected GitHub Pages shape, if the approved repository name is used:

```text
https://falloutmule.github.io/hermes-nonprofit-volunteer-board/
https://falloutmule.github.io/hermes-nonprofit-volunteer-board/privacy/
https://falloutmule.github.io/hermes-nonprofit-volunteer-board/terms/
```

Do not paste the expected URLs into Twilio until they are live and directly verified.

---

## Campaign name

```text
Hermes Non-Profit Volunteer SMS Testing
```

## Campaign use case

**Do not guess from this document. Inspect the exact options presented for the approved Brand.**

Preferred selection if available:

```text
LOW_VOLUME / Low Volume Mixed
```

This matches a very low-volume campaign containing conversational replies, event confirmations, reminders, cancellations, and standby offers.

If LOW_VOLUME is not available, stop and inspect the available use cases before selecting another one. Do not select `CHARITY` unless **Hermes Non-Profit itself**, not another organization, has been verified by Twilio as an eligible 501(c)(3) nonprofit.

## Campaign description

```text
Hermes Non-Profit sends low-volume SMS messages to invited internal test participants who voluntarily opt in to test a volunteer event coordination system. Messages may include test volunteer opportunities, event details, signup confirmations, follow-up questions, reminders, cancellation confirmations, and standby-opening offers. Recipients are individuals who review the public SMS disclosure and text JOIN to the Hermes Non-Profit number. Messages are not used for purchased lists, lead generation, or unsolicited marketing.
```

## How do end users consent to receive messages? / Message flow

Replace all three URL placeholders before submission:

```text
End users opt in through the publicly accessible Hermes Non-Profit SMS Testing page at https://falloutmule.github.io/hermes-nonprofit-volunteer-board/. The page identifies Hermes Non-Profit and displays the complete SMS disclosure immediately with the Text JOIN call to action. It explains that participants will receive recurring automated volunteer-coordination messages, including test volunteer opportunities, event information, signup confirmations, questions, reminders, cancellation confirmations, and standby-opening offers. It states that message frequency varies, that most participants receive 1–8 messages per test event plus replies to messages they initiate, that message and data rates may apply, and that users may reply STOP to opt out or HELP for help.

After reviewing that disclosure, an invited test participant voluntarily texts JOIN to +1 (970) 470-8839. The system records the phone number, Twilio MessageSid, timestamp, JOIN keyword, and applicable policy version, then sends an enrollment confirmation. No checkbox is preselected. Numbers are not purchased, rented, scraped, imported from third-party lists, or enrolled through verbal consent. Keyword opt-in is the only consent method used for this campaign.

Privacy Policy: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/privacy/
SMS Terms and Conditions: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/terms/
```

## Opt-in keyword

```text
JOIN
```

## Opt-in confirmation message

```text
Hermes Non-Profit: You're enrolled in volunteer SMS testing. Msg frequency varies, typically 1-8 msgs/test event. Msg & data rates may apply. Reply HELP for help or STOP to opt out.
```

## Opt-out keyword advertised to participants

```text
STOP
```

Twilio may also recognize standard long-code opt-out synonyms. Do not advertise `CANCEL` for event cancellation because Twilio may interpret it as a global opt-out.

## Opt-out confirmation message

```text
Hermes Non-Profit: You are unsubscribed and will receive no more messages. Reply START to re-enroll.
```

## Help keyword

```text
HELP
```

## Help message

```text
Hermes Non-Profit SMS Testing: Help at Falloutmule@gmail.com. Msg & data rates may apply. Reply STOP to opt out.
```

## Re-enrollment keyword

```text
START
```

## Event-specific cancellation command

```text
DROP
```

`DROP` is an application command and must not be configured as a global opt-out keyword.

---

## Representative message samples

### Sample 1 — signup confirmation

```text
Hermes Non-Profit: You're signed up for [TEST EVENT] on [DATE] at [TIME]. Reply DROP to cancel this event. Reply STOP to opt out of all texts.
```

### Sample 2 — follow-up question

```text
Hermes Non-Profit: For [TEST EVENT], can you help with [ROLE OR TASK]? Reply YES or NO. Reply STOP to opt out.
```

### Sample 3 — reminder

```text
Hermes Non-Profit reminder: [TEST EVENT] begins [DATE] at [TIME] at [LOCATION]. Reply DROP if you need to cancel. Reply STOP to opt out.
```

### Sample 4 — standby opening

```text
Hermes Non-Profit: A spot opened for [TEST EVENT] on [DATE]. Reply YES by [TIME] to accept or NO to pass. Reply STOP to opt out.
```

### Sample 5 — cancellation confirmation

```text
Hermes Non-Profit: Your signup for [TEST EVENT] has been cancelled. You remain enrolled in SMS testing. Reply STOP to opt out of all texts.
```

---

## Embedded content declarations

For the current campaign:

```text
Has embedded links in SMS messages: No
Has embedded phone numbers in SMS messages: No
```

The public policies contain links, but the representative SMS messages do not.

If production messages later contain URLs or phone numbers in the message body, update the campaign declaration and samples before sending that traffic.

## Number of sending phone numbers

```text
1
```

Current sender:

```text
+1 (970) 470-8839
```

## Opt-in evidence reviewers should be able to verify

The public page must visibly show, before the participant acts:

- Hermes Non-Profit as the sender;
- the number +1 (970) 470-8839;
- JOIN as the affirmative action;
- the message categories;
- recurring automated texts;
- message frequency;
- “Message and data rates may apply”;
- STOP instructions;
- HELP instructions;
- direct Privacy Policy link;
- direct SMS Terms link.

## Final submission gate

Do not submit until every item is true:

- [ ] Public site URL opens without login.
- [ ] Privacy URL opens directly without login or download.
- [ ] Terms URL opens directly without login or download.
- [ ] All three pages are on the same public domain.
- [ ] Brand name is exactly “Hermes Non-Profit.”
- [ ] The site explains the internal testing use case.
- [ ] The phone number is exactly +1 (970) 470-8839.
- [ ] The email is exactly Falloutmule@gmail.com.
- [ ] The Privacy Policy contains the mobile-number and consent non-sharing clause.
- [ ] Frequency and message/data-rate disclosures appear at the point of opt-in.
- [ ] JOIN produces the stated confirmation.
- [ ] STOP prevents further application messages.
- [ ] HELP returns the stated help response.
- [ ] The system does not send an extra reply when Twilio has already handled an OptOutType event.
- [ ] A2P answers and actual behavior match.
