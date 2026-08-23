# Deploy, Verify, and Submit Checklist

## Goal

Publish the Hermes Non-Profit SMS compliance pages, prove that reviewers can access them, align Twilio behavior with the public promises, and only then submit the A2P campaign.

## 1. Integrate files

Copy these files into the Volunteer Board project:

```text
public/index.html
public/styles.css
public/privacy/index.html
public/terms/index.html
docs/compliance/TWILIO-A2P-CAMPAIGN-ANSWERS.md
```

Preserve the relative paths so the policy links continue to work on GitHub Pages.

## 2. Verify factual alignment

Before publication, inspect implementation reality:

- raw SMS bodies are not retained in the primary application database;
- consent events store JOIN/STOP status, MessageSid, timestamp, and policy version;
- outbound messages are blocked for opted-out recipients;
- DROP cancels a specific event;
- STOP unsubscribes from the program;
- START permits re-enrollment;
- only one standby person is offered one opening at a time.

If actual behavior differs, fix the application or revise the public documents before publication. Never publish promises that are not operationally true.

## 3. Publish

Preferred public paths:

```text
/
 /privacy/
 /terms/
```

GitHub Pages is acceptable only after direct verification that:

- HTTPS works;
- no login is required;
- no download is required;
- pages do not redirect to an unrelated brand;
- the full brand and use case are visible.

## 4. Browser verification

Open in a private/incognito browser:

```text
{{PUBLIC_SITE_URL}}
{{PRIVACY_POLICY_URL}}
{{TERMS_URL}}
```

Verify:

- status 200;
- mobile text is readable;
- Text JOIN button points to +19704708839;
- Privacy and Terms links work in both directions;
- exact brand spelling is consistent;
- no placeholder or “document pending” text remains.

Capture screenshots and HTTP evidence.

## 5. Twilio configuration

Use a Messaging Service.

Before enabling Advanced Opt-Out, confirm the final keyword and response configuration. Twilio warns that Advanced Opt-Out is disabled by default and, once enabled, can only be disabled by contacting Twilio Support.

Advertised behavior:

```text
JOIN  = first enrollment
STOP  = global opt-out
START = re-enrollment after opt-out
HELP  = assistance
DROP  = cancel one event inside the application
```

Do not configure DROP as an opt-out keyword.

Twilio's standard long-code opt-out handling may recognize CANCEL as a global opt-out, so never tell participants to use bare CANCEL for an event.

When Twilio includes `OptOutType` in the inbound webhook, record it but do not send a second application-generated opt-out/help reply if Twilio has already replied.

## 6. End-to-end consent canary

From a test mobile number:

1. Open the public page.
2. Text JOIN to +1 (970) 470-8839.
3. Verify the opt-in record.
4. Verify the exact enrollment confirmation.
5. Send HELP.
6. Verify the exact help response.
7. Send STOP.
8. Verify the opt-out record and Twilio block behavior.
9. Verify an application send is blocked or suppressed.
10. Send START.
11. Verify re-enrollment.
12. Confirm no duplicate automated replies.

Redact the test participant's phone number from committed evidence.

## 7. Fill the campaign form

Use:

```text
docs/compliance/TWILIO-A2P-CAMPAIGN-ANSWERS.md
```

Replace the URL placeholders with directly verified public HTTPS URLs.

Do not select CHARITY unless Hermes Non-Profit itself has verified eligibility as a 501(c)(3).

Do not declare embedded links or phone numbers unless actual SMS message bodies include them.

## 8. Evidence package

Record:

```text
Git branch and HEAD
deployed commit
Pages deployment result
HTTP status for all three pages
incognito screenshots
JOIN/HELP/STOP/START canary results
Twilio MessageSids with participant numbers redacted
final campaign field values
submission timestamp
campaign SID
review status
```

## 9. Completion

This phase is complete only when:

- public documents are live and reviewed;
- real SMS consent behavior matches them;
- campaign submission is accepted by Twilio for review;
- the exact current state and evidence paths are reported.

A pending review is not an approved campaign.
