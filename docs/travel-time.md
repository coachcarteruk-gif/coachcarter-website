# Travel time check

> Reference material — load when working on slot filtering, booking warnings, or pickup address flows.

`api/_travel-time.js` provides two modes of travel time checking between pickup postcodes.

## Slot filtering (pre-booking)

`handleAvailable()` in `slots.js` hides slots where the instructor can't travel between adjacent bookings in time. Uses postcodes.io (free, no key) for geocoding + haversine distance estimation. The learner's postcode is passed via `&pickup_postcode=` query param from `book.html`. Formula: gap between slots must be >= estimated drive time + 10 min buffer.

## Booking warning (post-booking)

`handleBook()` in `slots.js` returns `travel_warnings` in the response using OpenRouteService for precise routing. Warning only, does not block.

## Rules & behaviour

- Slot filtering requires no API key (uses postcodes.io + distance estimation)
- Booking warnings require `OPENROUTESERVICE_API_KEY` env var (free from openrouteservice.org)
- Threshold configurable per instructor via `instructors.max_travel_minutes` (default 30), editable from admin portal
- Extracts UK postcodes from free-text addresses using regex
- Gracefully degrades — if no postcode provided or API unavailable, all slots show
- Skip booking warning with `?skip_travel_check=true` query param
- API returns `travel_hidden` count when slots are removed by the filter
- `book.html` shows a banner: "X slots hidden due to travel distance from your pickup address"
- `book.html` shows an inline postcode prompt above the slot feed for learners without a pickup_address; saves to profile and re-fetches with travel filter
- `setmore-sync.js` step 5d backfills `learner_users.pickup_address` from the learner's most recent booking if their profile field is empty
