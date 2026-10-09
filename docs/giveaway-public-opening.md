# Public opening — 9 October 2026

The owner approved finalising the public notice, opening entries and enabling
controlled invitation sending. This continues the setup recorded in
[production setup](giveaway-production-setup.md). Automatic cleanup remains off
at the owner's explicit request. No marketing sending, CRM writes, contact
provisioning or new cron is authorised by this opening.

## Invitation operation

Fraser personally messages Facebook nominators the public nomination URL:
https://www.coachcarter.uk/giveaway/ . Nominators obtain permission and share the
campaign privacy notice before submitting someone else's details. They ask the
nominee to email fraser@coachcarter.uk to request a private application link.

Fraser checks the request against the submitted email in the authenticated
giveaway review page, records its evidence reference, then runs the invitation
for that nomination. A nomination checkbox alone is not invitation-request
evidence. Existing suppression checks, one-time dispatch protection and audit
records remain required. Ambiguous delivery is reviewed before any retry.
No automatic worker schedule is installed. No real invitation is sent during
deployment verification.

Applications close at 2026-10-11T23:00:00Z: midnight at the end of Sunday 11 October
in Europe/London. Fraser should process requested links promptly before then.
Existing Facebook nominations are handled fairly against the original offer;
the public notice offers a contact route for help completing the process.

## Legitimate interests assessment for limited campaign administration

Purpose: administer Fraser's requested nominations and applications, evaluate the
two equally weighted criteria, prevent duplicate entries/misuse and respond to
privacy requests. Marketing has a separate consent basis and is not necessary
for this purpose.

Necessity: contact details link nominations to the right person and allow a
requested private application email; brief answers support the published
criteria. Accounts and identity-document uploads are not required. Eligibility
checks occur for the selected person. Narratives are not copied to a CRM.

Balance: nominees may not expect their circumstances to be shared. The form
requires the nominator's permission confirmation, asks them to share the notice,
discourages sensitive information and does not email the nominee automatically.
Only the nominee's recorded request permits an invitation. The nominee sees the
nominator's name, not their private narrative or contact information. Access is
school-scoped and staff-authenticated; private links protect applications.
Consent is optional, separate by person and channel, and has no judging weight.

Conclusion: these limited administrative interests can support processing with
the safeguards above. This assessment does not authorise unsolicited marketing
or settle advertising-code judging requirements. Reassess if the purposes,
recipients, collection or contact workflow change. Fraser handles objections,
access, correction and deletion at the published address.

## Manual retention and transparency

Unsuccessful nomination/application details are due for deletion 90 days after
closing (2027-01-09T23:00:00Z). Automatic deletion remains disabled. Fraser must
review and carry out deletion manually, preserving separately justified records.
Winner details are needed while lessons are provided; afterwards retain only
what is necessary for outstanding queries or existing record-keeping duties.
Promotional contacts and consent are reviewed at the unsuccessful-entry cleanup
point, retaining only records with a continuing purpose and valid permission.
Minimal opt-out evidence is retained only to honour and demonstrate that choice.
No fixed 12-month marketing or 90-day post-lesson rule was approved or adopted.

Nominators are asked to share the notice before submission. Fraser must ensure
third-party nominees receive the privacy information within one month, even if
they do not apply; don't treat lack of an application as permission to ignore
this duty. Use the nominator's existing communication where appropriate and
handle any delivery problem personally, without adding a marketing email.

The notice names current processors Neon, Vercel and Resend and links their
published data-processing terms. This documents published safeguards, not an
independent audit of provider contracts or processing locations. CRM remains off.

References checked 9 October 2026:
- [ICO: right to be informed](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/)
- [ICO: storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/)
- [ICO: legitimate interests](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/legitimate-interests/)

## Release

Continue the existing release branch. A future deployment from main must include
these giveaway changes; main has not yet been merged. Record the deployed commit,
deployment and live gate verification below after opening.
