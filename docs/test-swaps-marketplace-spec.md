# Test Swaps Marketplace Spec

## Purpose

Create a school-scoped test swap marketplace where learners with an official driving test saved on their profile can list their test for swapping, browse same-centre swap opportunities, request suitable slots, and agree a swap in principle. Once two learners agree in principle, an admin is alerted and coordinates the real-world DVSA swap off-platform.

This is version one. It is learner + admin only. Instructors do not see or manage test swaps.

## Core Decisions

- Learners must have an official test saved on their profile before they can create a listing or request another listing.
- The learner profile should store official test date, official test time, and official test centre.
- The official test summary should be placed prominently at the top of the learner profile page.
- If a learner browses Test Swaps without saved official test details, the page should remind and prompt them to add those details to their profile.
- Swaps are same test centre only.
- Learners may have only one active swap listing at a time.
- Multiple learners may request the same listing while it is active.
- A listing owner may accept only one request.
- Learners may delete their own active listing.
- Learners may withdraw requests they have made.
- Learners browsing listings must not see identity/contact details for other learners.
- Admins must be able to see learner identities/contact details for accepted swaps, because they coordinate the swap off-platform.

## Learner Profile Test Details

Add or extend learner profile fields for:

- Official test date
- Official test time
- Official test centre

These fields are the source of truth for marketplace eligibility and request matching.

The learner profile page should show these details near the top, before less urgent profile information.

## Listing Creation

A learner can create one active test swap listing if:

- they are authenticated as a learner
- they belong to the current school
- they have official test date, time, and test centre saved on their profile
- they do not already have an active swap listing

A listing should contain:

- the learner's current official test date
- the learner's current official test time
- the learner's current official test centre
- one or more acceptable replacement date windows
- optional unavailable dates
- status

Acceptable replacement windows are simple date ranges only. Version one does not include time-of-day preferences for wanted dates.

Unavailable dates are specific dates the listing owner cannot attend. They exist to reduce wasted requests and back-and-forth.

## Browsing Listings

All learners in the same school can view the Test Swaps page.

The marketplace should show active listings from the learner's school and same test centre where relevant. Cards/list rows should show only:

- test centre
- offered test date
- offered test time
- acceptable replacement date windows
- unavailable dates, if any
- request availability/status where appropriate

Do not show learner name, instructor, phone, email, or contact details to other learners.

If the current learner has no official test saved, show a clear prompt at the top of the Test Swaps page asking them to add their official test date, time, and centre to their profile before posting or requesting.

## Requesting A Slot

A learner can click "Request this slot" on a listing if:

- they are authenticated as a learner
- they belong to the same school as the listing
- they are not requesting their own listing
- they have official test date, time, and test centre saved on their profile
- their test centre matches the listing's test centre
- their own official test date falls inside one of the listing owner's acceptable replacement windows
- their own official test date is not one of the listing owner's unavailable dates
- the listing is still active
- the listing has no accepted request yet

The requester does not need to have created their own public listing.

If the requester does have their own active listing, apply the strict reverse check too:

- the listing owner's offered test date must fall inside one of the requester's acceptable replacement windows
- the listing owner's offered test date must not be one of the requester's unavailable dates

When a request is made:

- create a pending request
- notify the listing owner by email and SMS
- show an in-app notification count next to the Test Swaps learner sidebar button
- show the incoming request prominently at the top of the listing owner's Test Swaps page

## Accepting, Declining, And Withdrawing

The listing owner can:

- accept one pending request
- decline pending requests

Once one request is accepted:

- no other request can be accepted for that listing
- the accepted swap becomes "agreed in principle"
- admins should be alerted or shown the accepted swap on the admin Test Swap Requests page
- later learner-facing updates should appear in-app at the top of the Test Swaps page

The requester can withdraw their own pending request.

Learners should receive in-app updates for relevant status changes such as accepted, declined, withdrawn, or completed. Email/SMS is only required for new incoming requests in version one.

## Admin Workflow

Create a dedicated admin page for accepted test swap requests.

The admin Test Swap Requests page should show accepted-in-principle swaps waiting for admin coordination. It should include:

- both learners' names
- both learners' contact details
- both learners' official test dates
- both learners' official test times
- shared test centre
- listing/request status
- created/requested/accepted timestamps
- action to mark completed

The admin coordinates the actual DVSA test swap off-platform.

When admin marks a swap completed:

- archive or complete the accepted request
- remove/clear both involved tests from the active test swap marketplace
- ensure neither learner's completed listing remains browseable as active

Version one does not require CoachCarter to automatically update both learners' official test dates after completion, unless this is explicitly added later.

## Suggested Status Model

Listing statuses:

- active
- accepted_in_principle
- completed
- cancelled

Request statuses:

- pending
- accepted
- declined
- withdrawn
- completed

Use final naming that matches existing project conventions.

## Suggested Data Model

Exact schema should follow existing migration and API conventions, but likely needs:

Learner profile fields:

- official_test_date
- official_test_time
- official_test_centre

Test swap listings table:

- id
- school_id
- learner_id
- test_date
- test_time
- test_centre
- status
- created_at
- updated_at
- cancelled_at
- completed_at

Test swap acceptable windows table:

- id
- listing_id
- school_id
- start_date
- end_date

Test swap unavailable dates table:

- id
- listing_id
- school_id
- unavailable_date

Test swap requests table:

- id
- school_id
- listing_id
- requester_learner_id
- requester_test_date_snapshot
- requester_test_time_snapshot
- requester_test_centre_snapshot
- status
- created_at
- accepted_at
- declined_at
- withdrawn_at
- completed_at

Snapshotting requested test details is recommended so the accepted-in-principle admin queue reflects what was requested at the time, even if a learner edits their profile later.

## Tenant, Auth, And Privacy Rules

- Every table and query must be scoped by school_id.
- Learner APIs must only expose same-school listings and must hide learner identity/contact details from other learners.
- Admin APIs may expose identity/contact details for coordination.
- Use existing auth helpers and role checks.
- Do not trust client-submitted learner identity, school_id, or matching decisions.
- Server-side validation must enforce same-centre and date-window matching.
- If notifications send SMS/email, use existing notification patterns and avoid exposing account-existence details.

## Open Implementation Questions

- Which existing learner profile table/fields should hold official test details?
- Should test centre be free text initially, or should it use a controlled list/admin-managed values?
- Should completion clear only marketplace listings, or should admin also be offered a separate action to update each learner's official saved test?
- What exact notification provider/helpers should be used for SMS/email in this codebase?
- Where should the learner sidebar notification count be sourced from: pending incoming request count, unread update count, or both?

## Out Of Scope For Version One

- Cross-centre swaps
- Instructor-facing test swap management
- Learner-to-learner messaging
- Showing learner identities to other learners
- Automatically changing DVSA bookings
- Automatically updating both learners' official test records after admin completion
- Time-of-day preferences for wanted replacement slots
- Multiple active listings per learner
