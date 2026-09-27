const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Exercise the actual editor functions and modal markup in a browser, keeping
// unrelated portal sections and production APIs outside this focused fixture.
test('admin editor explains the right balance and submits its original duration', async ({ page }) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin/portal.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/admin/portal.js'), 'utf8');
  const modalStart = html.lastIndexOf('<div', html.indexOf('id="adminEditBookingModal"'));
  const endMarker = html.indexOf('id="adminEditSaveBtn"', modalStart);
  await page.setContent(html.slice(modalStart, html.indexOf('</button>', endMarker) + 9) + '</div></div></div>');
  const scriptStart = js.indexOf('let adminEditBookingId =');
  const scriptEnd = js.indexOf('\n}', js.indexOf('async function confirmAdminEditBooking(')) + 2;
  await page.addScriptTag({ content: `
    var HEADERS = {}; var _detailLearnerId = null; var lastRequest = null;
    var allBookings = [{id:501, status:'chargeable',scheduled_date:'2026-09-25',start_time:'10:00:00',end_time:'11:30:00',
      minutes_deducted:90,lesson_type_id:1,payment_method:'flexible_package'}];
    function esc(s){return s;} function toast(s){window.lastToast=s;}
    function loadBookings(){} function loadLearners(){}
    async function fetchAdmin(url,options){
      if(url.includes('lesson-types')) return {json:async()=>({lesson_types:[{id:1,name:'90 minutes',duration_minutes:90},{id:2,name:'1 hour',duration_minutes:60}]})};
      lastRequest=JSON.parse(options.body); return {ok:false,status:409,json:async()=>({error:'This lesson is already included in a payout.'})};
    }
    ${js.slice(scriptStart, scriptEnd)}
  ` });
  await page.evaluate(() => openAdminEditBooking(501));
  await page.selectOption('#adminEditType', '2');
  await page.evaluate(() => updateAdminEditEnd());
  await expect(page.locator('#adminEditEndTime')).toHaveText('11:00');
  await expect(page.locator('#adminEditBalanceInfo')).toContainText('30 minutes will be returned to Flexible Hours.');
  await expect(page.locator('#adminEditBalanceInfo')).toContainText('before it is included in a payout');
  await page.evaluate(() => confirmAdminEditBooking(false));
  expect(await page.evaluate(() => lastRequest)).toMatchObject({ booking_id:501,lesson_type_id:2,expected_duration_minutes:90 });
  await expect(page.locator('#adminEditSaveBtn')).toBeEnabled();
  expect(await page.evaluate(() => lastToast)).toContain('already included in a payout');
  await page.evaluate(() => { allBookings[0].payment_method='credit'; return openAdminEditBooking(501); });
  await page.selectOption('#adminEditType', '2');
  await page.evaluate(() => updateAdminEditEnd());
  await expect(page.locator('#adminEditBalanceInfo')).toContainText('30 minutes will be returned to learner credit.');
});
