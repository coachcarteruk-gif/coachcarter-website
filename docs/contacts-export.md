# GoHighLevel contact export

Admin Portal → Dashboard → **Export GoHighLevel CSV** downloads all saved
contacts for the authenticated school, independent of dashboard filters or page
limits. The read-only route is `GET /api/admin?action=export-contacts` and accepts
the existing admin and instructor-admin sessions. Platform superadmins choose
a school from the export's school selector (`?school_id=ID` can preselect it).
No schema migration is needed.

The file has exactly these headers, in order:

`First Name,Last Name,Email,Phone,Tags,Address1,City,State,Postal Code,Country,Source`

- Sources: all learners, active/inactive instructors and school admins, enquiries
  (including trial requests), and unregistered lesson-request, lesson-offer and
  guest-booking contacts. Waitlisted learners are covered by learner accounts.
  Anonymised bookings and empty contact records are excluded. Temporary checkout
  holds, payment histories, internal notes and authentication data are not contacts.
- Matching emails are combined case-insensitively, preferring account details,
  then newer submissions. Phone-only records are combined with matching
  phone-only records; different emails are kept separate even if a phone is shared.
- Tags identify the source contact types and inactive staff accounts. They do not
  assert lesson activity, theory-test results or marketing consent.
- The first word of the saved name becomes First Name; the remainder becomes
  Last Name. Missing names use `Unknown` and a `name needs review` tag so the row
  can still be imported.
- Recognisable UK and international numbers are converted to E.164. Other values
  are preserved and tagged `phone needs review`.
- The complete saved pickup address is retained in Address1, with a recognisable
  UK postcode also copied to Postal Code. City and State remain blank because the
  site does not store them separately. Country is `GB`, as requested.
- Source uses enquiry `utm_source` when present, otherwise `website` for learner
  and guest records. Staff-only records have no source.
- CSV uses UTF-8 with a BOM, CRLF rows and quoted/escaped cells. Formula-like
  values are prefixed with an apostrophe, except valid E.164 phone numbers.

The response is uncached, and an awaited audit records the school, actor, format
and exported count without storing the contact list. This downloads a file only;
it does not send contacts to GoHighLevel or change communication preferences.

Verification: `npx playwright test tests/contacts-export.spec.js` covers CSV
round-tripping, mapping, deduplication, phone formatting, real session-role checks,
tenant query scope, errors, and the dashboard download with a mocked API.
