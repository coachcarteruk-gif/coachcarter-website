const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { validateInstructorRescheduleSlot } = require('../api/_instructor-reschedule-slot');

test('travel override is opt-in and cannot bypass overlapping lessons', async () => {
  const args = {
    schoolId: 7, targetInstructorId: 3, newDate: '2026-10-20', newStartTime: '10:00',
    now: new Date('2026-10-18T08:00:00Z'), geocode: async () => ({}),
    booking: { id: 10, instructor_id: 3, duration_minutes: 90, pickup_address: 'SW1A 1AA',
      scheduled_date: '2026-10-19', start_time: '10:00' },
  };
  const sql = overlap => async strings => {
    const query = strings.join(' ');
    if (query.includes('FROM instructors')) return [{ id: 3, active: true, transmission_type: 'manual' }];
    if (query.includes('pickup_address IS NOT NULL')) return [{ id: 20, start_time: '11:35', end_time: '13:00', pickup_address: 'SW1A 1AA' }];
    if (overlap && query.includes('FROM lesson_bookings')) return [{ id: 20 }];
    return [];
  };
  await expect(validateInstructorRescheduleSlot(sql(false), args)).rejects.toMatchObject({ code: 'PICKUP_TRAVEL_CONFLICT' });
  const result = await validateInstructorRescheduleSlot(sql(false), { ...args, allowPickupTravelConflict: true });
  expect(result.travelConflict).toMatchObject({ direction: 'after', gap_minutes: 5, booking_id: 20 });
  await expect(validateInstructorRescheduleSlot(sql(true), { ...args, allowPickupTravelConflict: true }))
    .rejects.toMatchObject({ code: 'LESSON_CONFLICT' });
});

test('admin sees warning, can decline or confirm, and a changed slot clears acknowledgement', async ({ page }) => {
  const source = fs.readFileSync(path.join(__dirname, '../public/admin/portal.js'), 'utf8');
  const start = source.indexOf('function setAdminRescheduleStatus(');
  const end = source.indexOf('function setReservedGoodwillStatus(', start);
  await page.setContent(`<select id="adminRescheduleInstructor"><option value="4">Target</option></select>
    <input id="adminRescheduleDate" value="2026-10-20"><input id="adminRescheduleStartTime" value="10:00">
    <div id="adminRescheduleStatus"></div><div id="adminRescheduleEndTime"></div>
    <div id="adminRescheduleTransferNote"></div><button id="adminRescheduleSubmitBtn">Reschedule lesson</button>`);
  await page.addScriptTag({ content: `
    let adminRescheduleBooking = {id:10,currentInstructorId:3};
    let adminRescheduleValidationSeq = 0, adminRescheduleTravelWarning = null;
    const HEADERS = {}; const sent = [];
    let warn = true, saveConflict = false;
    function closeModal() {} function toast() {} function loadBookings() {}
    async function fetchAdmin(url, options) {
      if (options.method === 'POST') {
        sent.push(JSON.parse(options.body));
        if(saveConflict) return {ok:false,json:async()=>({code:'PICKUP_TRAVEL_CONFLICT'})};
        return {ok:true,json:async()=>({ok:true})};
      }
      return {ok:true,json:async()=>({available:true,new_end_time:'11:30',instructor:{name:'Target'},travel_warning:warn?{gap_minutes:5}:null})};
    }
    ${source.slice(start, end)}
    document.getElementById('adminRescheduleSubmitBtn').onclick = submitAdminReschedule;
  ` });
  await page.evaluate(() => checkAdminRescheduleAvailability());
  await expect(page.locator('#adminRescheduleStatus')).toContainText('Warning:');
  await expect(page.locator('button')).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('button').click();
  expect(await page.evaluate(() => sent.length)).toBe(0);
  // A changed date produces a fresh preview without inheriting the warning.
  await page.evaluate(async () => {
    document.getElementById('adminRescheduleDate').value = '2026-10-21'; warn = false;
    await checkAdminRescheduleAvailability(); saveConflict = true;
  });
  await page.locator('button').click();
  expect(await page.evaluate(() => sent[0].confirm_pickup_travel)).toBe(false);
  await expect(page.locator('#adminRescheduleStatus')).toContainText('Select Reschedule lesson to confirm');
  await page.evaluate(() => { saveConflict = false; });
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Continue with this change anyway?'); await dialog.accept();
  });
  await page.locator('button').click();
  expect(await page.evaluate(() => sent[1].confirm_pickup_travel)).toBe(true);
});
