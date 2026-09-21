const {test,expect}=require('@playwright/test');
async function setup(page,{consent=false}={}) {
  await page.addInitScript(analytics=>{localStorage.setItem('cc_cookie_consent',JSON.stringify({analytics,marketing:false,version:2,timestamp:new Date().toISOString()}));window.events=[];},consent);
  await page.route(/^https:\/\//,route=>{
    if(route.request().url().includes('/static/array.js'))return route.fulfill({contentType:'application/javascript',body:`var config=posthog._i[0][1];window.phConfig=config;posthog.__loaded=true;posthog.capture=function(event,props){var e=config.before_send({event:event,properties:props});if(e)window.events.push(e);};posthog.opt_out_capturing=function(){};posthog.opt_in_capturing=function(){};posthog.reset=function(){};config.loaded();`});
    return route.fulfill({status:204,body:''});
  });
  await page.route('**/api/**',route=>route.fulfill({json:{ok:true,test_date_trial_funnel_enabled:true}}));
}
test('mobile fallback, keyboard CTA and optional video failure never block booking',async({page})=>{
  await setup(page);await page.setViewportSize({width:375,height:812});
  await page.goto('/test-booked.html');
  await expect(page.locator('h1')).toContainText('You’ve booked');
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('#videoFallback img')).toBeVisible();
  const cta=page.locator('[data-trial-placement="hero"]');await cta.focus();await expect(cta).toBeFocused();
  await expect(cta).toHaveAttribute('href','/free?campaign=test_booked_v1');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.route('**/content/test-booked-vsl.json',route=>route.fulfill({json:{enabled:true,version:'video_v1',src:'/media/test-booked/missing.mp4',poster:'/media/test-booked/poster.jpg',captions_src:'/media/test-booked/captions.vtt',transcript_src:'/media/test-booked/transcript.txt'}}));
  await page.reload();await expect(page.locator('video')).toHaveCount(1);
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('error')));
  await expect(page.locator('#videoFallback')).toBeVisible();await expect(cta).toBeVisible();
});
test('no/late/revoked consent; allowlist rejects PII canaries and success refresh is not conversion',async({page})=>{
  await setup(page);await page.goto('/test-booked.html');
  await page.evaluate(()=>{ccTrialFunnel.send('trial_booking_cta_clicked','hero');});
  expect(await page.evaluate(()=>window.events)).toEqual([]);
  await page.evaluate(()=>{localStorage.setItem('cc_cookie_consent',JSON.stringify({analytics:true,marketing:false,version:2,timestamp:new Date().toISOString()}));document.dispatchEvent(new CustomEvent('cookie-consent-updated',{detail:{analytics:true}}));});
  await expect.poll(()=>page.evaluate(()=>window.events.length)).toBe(1);
  expect(await page.evaluate(()=>window.events[0].event)).toBe('trial_landing_viewed');
  await page.evaluate(()=>{posthog.capture('free_trial_confirmed',{entry_page:'test_booked',campaign_key:'canary@example.invalid',name:'PII_CANARY',date:'2027-01-01',centre:'PII_CANARY',booking_id:123,$current_url:location.href});posthog.capture('$autocapture',{text:'PII_CANARY'});});
  const events=await page.evaluate(()=>window.events);expect(JSON.stringify(events)).not.toContain('PII_CANARY');expect(JSON.stringify(events)).not.toContain('2027-01-01');expect(JSON.stringify(events)).not.toContain('booking_id');expect(JSON.stringify(events)).not.toContain('canary@');
  expect(await page.evaluate(()=>{var capture=posthog.capture;posthog.capture=function(){throw new Error('Blocked SDK');};var sent=ccTrialFunnel.send('free_trial_submitted');posthog.capture=capture;return sent;})).toBe(false);
  await page.evaluate(()=>{localStorage.setItem('cc_cookie_consent',JSON.stringify({analytics:false,marketing:false,version:2,timestamp:new Date().toISOString()}));document.dispatchEvent(new CustomEvent('cookie-consent-updated',{detail:{analytics:false}}));ccTrialFunnel.send('trial_booking_cta_clicked','hero');});
  expect(await page.evaluate(()=>window.events.length)).toBe(2);
  await page.goto('/free-trial-success.html');await page.reload();expect(await page.evaluate(()=>window.events)).toEqual([]);
});
test('shared optional form clears hidden fields and keeps draft on API validation error',async({page})=>{
  await setup(page);
  await page.route('**/api/slots?action=trial-window-context**',route=>route.fulfill({json:{from:'2030-07-20',to:'2030-08-17',days_ahead:28}}));
  await page.route('**/api/slots?action=available**',route=>route.fulfill({json:{slots:{'2030-07-20':[{start_time:'10:00',end_time:'11:00',instructor_id:7,transmission_type:'manual'}]}}}));
  let payload;
  await page.route('**/api/slots?action=book-free-trial**',route=>{payload=route.request().postDataJSON();return route.fulfill({status:400,json:{error:'Correct the date or add it later.'}});});
  await page.goto('/free?campaign=test_booked_v1');
  await expect(page.locator('#trialTestDetails')).toBeVisible();
  await page.locator('#trialTestBooked').selectOption('yes');await page.locator('#trialTestDate').fill('2030-06-01');await page.locator('#trialTestCentre').fill('Centre canary');
  await page.getByRole('button',{name:/10:00/}).click();await expect(page.locator('#trialTestTiming')).toContainText('before this lesson');
  await page.locator('#trialTestBooked').selectOption('no');await expect(page.locator('#trialTestDate')).toHaveValue('');await expect(page.locator('#trialTestCentre')).toHaveValue('');
  for(const [id,value]of Object.entries({guest_name:'Fixture',guest_email:'fixture@example.invalid',guest_phone:'07912345678',guest_pickup_address:'Fixture address'}))await page.locator('#'+id).fill(value);
  await page.getByRole('button',{name:'Book my free trial'}).click();await expect(page.locator('#formError')).toContainText('Correct the date');
  expect(payload.test_details).toEqual({booked:false,date:null,centre:null});expect(payload.funnel_context.entry_page).toBe('test_booked');
  await expect(page.locator('#guest_email')).toHaveValue('fixture@example.invalid');await expect(page.locator('#summaryBar')).toBeVisible();
});
