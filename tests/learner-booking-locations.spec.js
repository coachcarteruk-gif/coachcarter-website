// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
}

function functionBody(source, name) {
  const asyncNeedle = `async function ${name}(`;
  const syncNeedle = `function ${name}(`;
  let start = source.indexOf(asyncNeedle);
  if (start < 0) start = source.indexOf(syncNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextSync = source.indexOf('\nfunction ', start + 1);
  const nextAsync = source.indexOf('\nasync function ', start + 1);
  const candidates = [nextSync, nextAsync].filter(idx => idx > start);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test.describe('learner per-booking pickup and drop-off locations', () => {
  test('booking and reschedule modals expose dropdown-only pickup/drop-off selectors', () => {
    const html = read('public/learner/book.html');

    expect(html).toContain('id="mdPickupMode"');
    expect(html).toContain('id="mdDropoffMode"');
    expect(html).toContain('Same as pickup');
    expect(html).toContain('Need a different address? Update your profile before booking.');
    expect(html).toContain('id="rmPickupMode"');
    expect(html).toContain('id="rmDropoffMode"');
    expect(html).not.toContain('Different pickup address');
    expect(html).not.toContain('Different drop-off address');
    expect(html).not.toContain('id="mdPickupCustom"');
    expect(html).not.toContain('id="rmPickupCustom"');
  });

  test('frontend uses the selected pickup for duration checks and submit payloads', () => {
    const js = read('public/learner/book.js');

    expect(functionBody(js, 'loadDurationsForSlot')).toContain('const pc = getActivePickupPostcode(isGuest);');
    expect(functionBody(js, 'confirmBookWithCredit')).toContain('pickup_address: locations.pickup_address');
    expect(functionBody(js, 'confirmPayAndBook')).toContain('guest_pickup_address: locations.pickup_address');
    expect(functionBody(js, 'confirmPayAndBook')).toContain('pickup_address: locations.pickup_address');
    expect(functionBody(js, 'confirmReschedule')).toContain('body.pickup_address = pickupAddress;');
    expect(js).toContain("guestPickup.addEventListener('change', function () { scheduleLocationDurationCheck(true); });");
    expect(js).toContain("profilePickup.addEventListener('change', function () { scheduleLocationDurationCheck(false); });");
    expect(js).not.toContain("guestPickup.addEventListener('input', function () { scheduleLocationDurationCheck(true); });");
    expect(js).toContain("pickupMode.addEventListener('change', function () {");
  });

  test('duration check keeps the multi-lesson dropdown path reachable', () => {
    const js = read('public/learner/book.js');
    const body = functionBody(js, 'loadDurationsForSlot');
    const autoCollapse = body.indexOf("if (durations.length === 1 && fitting.length === 1)");
    const dropdownRender = body.indexOf("document.getElementById('mdDurationPicker').style.display = 'flex';");

    expect(autoCollapse).toBeGreaterThan(0);
    expect(dropdownRender).toBeGreaterThan(autoCollapse);
    expect(body.slice(0, autoCollapse)).not.toContain("document.getElementById('mdSingleTypeRow').style.display = 'flex';\n    applyLessonTypeToModal(validatedType");
  });

  test('slot API gates changed pickups and carries locations into Stripe metadata', () => {
    const api = read('api/slots.js');

    expect(api).toContain('async function checkPickupTravelSpacingConflict');
    expect(api).toContain("code: 'PICKUP_TRAVEL_CONFLICT'");
    expect(functionBody(api, 'handleBook')).toContain('rejectIfPickupTravelConflict(res, sql');
    expect(functionBody(api, 'handleCheckoutSlot')).toContain('pickup_address:  checkoutPickupAddress');
    expect(functionBody(api, 'handleCheckoutSlot')).toContain('dropoff_address: checkoutDropoffAddress');
    expect(functionBody(api, 'handleCheckoutSlotGuest')).toContain('pickup_address:  cleanAddr');
    expect(functionBody(api, 'handleCheckoutSlotGuest')).toContain('dropoff_address: cleanDropoff');
    expect(functionBody(api, 'handleReschedule')).toContain('const { booking_id, new_date, new_start_time, new_instructor_id, pickup_address, dropoff_address } = req.body;');
    expect(functionBody(api, 'handleReschedule')).toContain('excludeBookingId: booking_id');
  });

  test('pay-per-slot webhook persists selected pickup and drop-off on booking insert', () => {
    const webhook = read('api/webhook.js');
    const body = functionBody(webhook, 'handleSlotBooking');

    expect(body).toContain("const pickupAddress = metadata.pickup_address || '';");
    expect(body).toContain("const dropoffAddress = metadata.dropoff_address || '';");
    expect(body).toContain('pickup_address, dropoff_address,');
    expect(body).toContain('${pickupAddress || null}, ${dropoffAddress || null}');
  });
});
