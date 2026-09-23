# Hermes Non-Profit — Twilio A2P Campaign Manual-Entry Answers

## Status and submission boundary

These answers are prepared for manual entry into the Hermes Non-Profit Sole Proprietor
campaign form.

    Campaign status: NOT SUBMITTED
    Campaign SID: NOT ASSIGNED
    Pre-check result: UNTESTED AFTER CORRECTION

This worksheet does not authorize Twilio Console changes or campaign submission. Review
every field against the live form, run pre-check manually, and do not submit while a
warning remains.

## Registered identity

    Brand name: Hermes Non-Profit
    Brand type: SOLE_PROPRIETOR
    Registration status: Registered
    Brand registration SID: BN9c7318484ae042864ccd898c2ce38354
    Trust Hub A2P Bundle SID: BUaa974072c99218e603ff8db997a91560
    Sole proprietor: Travis Omernick
    Twilio number: +1 (970) 470-8839
    E.164 number: +19704708839
    Public contact email: Falloutmule@gmail.com
    Campaign purpose: Internal development and testing of a volunteer event coordination system

Identity relationship:

    Travis Omernick
    → sole proprietor
    → operates Hermes Non-Profit
    → Hermes Non-Profit is an internal volunteer-system testing project

Do not substitute another organization, sender, proprietor, Brand, or use-case category.

## Public URLs

    Business / opt-in page: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/
    Privacy Policy: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/privacy/
    SMS Terms and Conditions: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/terms/

## Campaign name

Use this value if the form exposes an editable campaign name:

    Travis Omernick - Hermes Non-Profit SMS Testing

## Campaign use case

    SOLE_PROPRIETOR

Do not select or describe this campaign as Charity or any mixed-messaging campaign type.

## Campaign description

    Travis Omernick operates Hermes Non-Profit, an internal development project used to test a volunteer event coordination system. This Sole Proprietor campaign sends SMS only to invited test participants who voluntarily opt in by texting JOIN. Messages test signup confirmations, event questions, reminders, cancellation confirmations, YES/NO responses, and standby-opening workflows. The campaign is for software development and testing only and does not use purchased lists, lead generation, advertising, fundraising, or unsolicited marketing.

## Message flow / how end users consent

    The only opt-in method for this campaign is SMS keyword opt-in. Invited test participants review the public Hermes Non-Profit SMS disclosure at https://falloutmule.github.io/hermes-nonprofit-volunteer-board/ and voluntarily text JOIN from their own mobile phone to +1 (970) 470-8839. Sending JOIN is the affirmative action that gives Hermes Non-Profit, operated by sole proprietor Travis Omernick, permission to send recurring volunteer-system testing messages to that originating phone number.

    The website does not collect phone numbers and there is no web signup form or consent checkbox. The page displays the message types, frequency disclosure, notice that message and data rates may apply, STOP and HELP instructions, Privacy Policy, and SMS Terms.

    After JOIN is received, the system records consent and sends an enrollment confirmation. Phone numbers are not purchased, rented, scraped, imported from third-party lists, entered by staff, or enrolled through verbal consent.

    Privacy Policy: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/privacy/
    Terms: https://falloutmule.github.io/hermes-nonprofit-volunteer-board/terms/

## Opt-in type and keywords

    Opt-in type: via_text
    Opt-in keywords: JOIN, START

Keyword semantics:

- **JOIN** is first-time enrollment.
- **START** is re-enrollment after **STOP**.
- **YES** is not an opt-in keyword; it is an event/standby response in context.
- **DROP** cancels one event and is not a global opt-out.
- **STOP** is the advertised global opt-out.
- **HELP** requests assistance.

## Opt-in confirmation message

    Hermes Non-Profit: You're enrolled in recurring volunteer SMS testing. Msg frequency varies, typically 1-8 msgs/test event. Msg & data rates may apply. Reply HELP for help or STOP to opt out.

## Opt-out and help

    Advertised opt-out keyword: STOP
    Re-enrollment keyword: START
    Help keyword: HELP
    Event-specific cancellation command: DROP

Opt-out confirmation:

    Hermes Non-Profit: You are unsubscribed and will receive no more messages. Reply START to re-enroll.

Help message:

    Hermes Non-Profit SMS Testing: Help at Falloutmule@gmail.com. Msg & data rates may apply. Reply STOP to opt out.

## Representative message samples

Use two samples and leave optional samples 3–5 blank when the form permits.

### Sample 1

    Hermes Non-Profit Test: A signup was recorded for [TEST EVENT] on [DATE] at [TIME]. Reply DROP to test event cancellation or STOP to opt out.

### Sample 2

    Hermes Non-Profit Test: A standby opening is available for [TEST EVENT]. Reply YES to test acceptance or NO to decline. Reply STOP to opt out.

If the form requires or preserves a third sample, use:

    Hermes Non-Profit Test: Reminder for simulated event [TEST EVENT] on [DATE] at [TIME], [LOCATION]. Reply DROP to test cancellation or STOP to opt out.

## Message-content declarations

These declarations describe actual SMS bodies, not the public website:

    Contains embedded links: No
    Contains phone numbers: No
    Direct lending: No
    Age-gated content: No
    Purchased lists: No
    Lead generation: No
    Unsolicited marketing: No
    Number of sending phone numbers: 1

If actual SMS bodies later include a URL or phone number, update the declarations and
samples truthfully before sending that traffic.

## Manual pre-check gate

Before any submission:

- confirm the live form still identifies the registered Hermes Non-Profit Sole Proprietor Brand;
- confirm the public pages visibly connect Travis Omernick to Hermes Non-Profit;
- confirm the opt-in type remains **via_text**;
- confirm samples 3–5 are blank unless the form requires a third;
- run Twilio pre-check and record the exact result and any field-level warning;
- stop if pre-check still warns and do not keep rewriting copy randomly;
- do not submit without separate explicit authorization.
