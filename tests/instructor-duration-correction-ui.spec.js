const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('instructor completed-length editor submits only duration, explains funding and recovers from refusal', async ({ page }) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/instructor/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/instructor/index.js'), 'utf8');
  await page.setContent(html.slice(html.indexOf('<!-- ── Edit Booking Modal'), html.indexOf('<!-- ── Add Lesson Modal'))
    + '<div id="bookingDetailContent"></div><div id="bookingModalActions"></div><div id="bookingModal"></div>');
  const start = js.indexOf('let editBookingId =');
  const end = js.indexOf('// ─── Add Lesson (Instructor-Initiated Booking)');
  const detail = js.slice(js.indexOf('function openBookingDetail('), js.indexOf('// ─── Learner History'));
  await page.addScriptTag({ content: `
    var bookingCache = {past:[{id:501,learner_name:'Test learner',status:'chargeable',scheduled_date:'2026-09-25',
      start_time:'10:00:00',end_time:'11:30:00',minutes_deducted:90,lesson_type_id:1,payment_method:'flexible_package',
      can_report_not_delivered:true}]};
    var DAY_FULL=[],MON_FULL=[],selectedBooking=null,instructorTransmissionType='manual',lastRequest=null,lastUrl=null;
    function esc(s){return s || '';} function statusLabel(s){return s;} function bookingTransmissionBadge(){return '';}
    function closeBookingModal(){} function showToast(s){window.lastToast=s;}
    function configureLessonTransmissionSelect(){} function normaliseTransmissionType(s){return s;}
    async function refreshSchedule(){window.refreshed=true;}
    var ccAuth = {fetchAuthed:async function(url,options){
      if(url.includes('lesson-types')) return {json:async()=>({lesson_types:[{id:1,name:'90 minutes',duration_minutes:90},{id:2,name:'1 hour',duration_minutes:60},{id:3,name:'2 hours',duration_minutes:120}]})};
      lastUrl=url;lastRequest=JSON.parse(options.body);
      return window.saveSuccess ? {ok:true,json:async()=>({ok:true,minutes_returned:30})}
        : {ok:false,status:409,json:async()=>({error:'This lesson is already included in a payout.'})};
    }};
    ${detail}
    ${js.slice(start, end)}
  ` });
  await page.evaluate(() => openBookingDetail(501));
  await expect(page.locator('[data-action="correct-lesson-length"]')).toHaveText('Edit lesson length');
  await page.evaluate(() => openEditBookingModal(501, true));
  await expect(page.locator('#editBookingDate')).toBeDisabled();
  await expect(page.locator('#editBookingTime')).toBeDisabled();
  await expect(page.locator('#editBookingTransmission')).toBeDisabled();
  await expect(page.locator('#editBookingNotify')).toBeHidden();
  await expect(page.locator('#editBookingType')).toHaveValue('');
  await expect(page.locator('#editBookingEndTime')).toHaveText('11:30');
  await page.selectOption('#editBookingType', '2');
  await page.evaluate(() => updateEditEndTime());
  await expect(page.locator('#editBookingEndTime')).toHaveText('11:00');
  await expect(page.locator('#editBookingBalanceInfo')).toContainText('30 minutes will be returned to the learner’s Flexible Hours');
  await page.evaluate(() => confirmEditBooking(false));
  expect(await page.evaluate(() => lastRequest)).toEqual({ booking_id:501,lesson_type_id:2,expected_duration_minutes:90 });
  expect(await page.evaluate(() => lastUrl)).toBe('/api/instructor?action=correct-delivered-duration');
  expect(await page.evaluate(() => lastToast)).toContain('already included in a payout');
  await expect(page.locator('#editBookingSaveBtn')).toBeEnabled();
  await page.evaluate(() => { bookingCache.past[0].payment_method='credit'; return openEditBookingModal(501, true); });
  await page.selectOption('#editBookingType', '3');
  await page.evaluate(() => updateEditEndTime());
  await expect(page.locator('#editBookingBalanceInfo')).toContainText('30 extra minutes will be used from the learner’s lesson credit with you');
  await page.evaluate(() => { window.saveSuccess=true; return confirmEditBooking(false); });
  expect(await page.evaluate(() => window.refreshed)).toBe(true);
  await expect(page.locator('#editBookingModal')).not.toHaveClass(/open/);
  await page.evaluate(() => openEditBookingModal(501));
  await expect(page.locator('#editBookingDate')).toBeEnabled();
  await expect(page.locator('#editBookingNotify')).toBeVisible();
  await page.evaluate(() => { bookingCache.past[0].can_report_not_delivered=false; openBookingDetail(501); });
  await expect(page.locator('[data-action="correct-lesson-length"]')).toHaveCount(0);
});
