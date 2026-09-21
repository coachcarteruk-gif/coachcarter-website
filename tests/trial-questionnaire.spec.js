const {test,expect}=require('@playwright/test');
const {qualify,availability,configuration}=require('../api/_trial-qualification');
const {questionnaireConfig}=require('./helpers/trial-funnel-fixture');
const config={trial_questionnaire:questionnaireConfig};
const now=new Date('2026-09-21T10:00:00Z');
const answer={practical_booked:true,practical_date:'2027-12-20',practical_time:'10:30',centre_choice:'Reading',budget:'saved'};
for(const centre of ['Reading','Greenham','Farnborough','Basingstoke','Other'])for(const budget of ['saved','payg','lower','lowest']){
  test('route '+centre+' / '+budget,()=>{
    const q=qualify({...answer,centre_choice:centre,other_centre:'Oxford',budget},config,now);
    expect(q.route).toBe(centre==='Other'||budget==='lowest'?'request':'booking');
    expect(q.practical.date).toBe('2027-12-20'); // no four-month cutoff
  });
}
for(const theory of [true,false])for(const budget of ['saved','payg','lower','lowest'])test('no practical, theory '+theory+' / '+budget,()=>{
  const q=qualify({...answer,practical_booked:false,theory_booked:theory,theory_date:'2027-01-01',theory_time:'09:00',budget},config,now);
  expect(q.route).toBe('request');expect(q.practical).toEqual({booked:false,date:null,time:null,centre:null});
  expect(q.theory).toEqual({booked:theory,date:theory?'2027-01-01':null,time:theory?'09:00':null});
});
test('strict school gate, configuration, dates, times and hidden stale answers',()=>{
  expect(qualify(null,{},now)).toBe(null);
  expect(qualify(null,{trial_questionnaire:{enabled:'true'}},now)).toBe(null);
  expect(()=>configuration({trial_questionnaire:{enabled:true}})).toThrow('configuration');
  for(const patch of [{practical_date:'2027-02-29'},{practical_date:'2026-09-20'},{practical_time:'25:00'},{practical_time:''},{centre_choice:'Other',other_centre:''},{budget:'fake'},{practical_booked:'yes'}])expect(()=>qualify({...answer,...patch},config,now)).toThrow();
  expect(()=>qualify({practical_booked:false,theory_booked:true,budget:'saved',theory_date:'2027-02-30',theory_time:'10:00'},config,now)).toThrow();
  expect(qualify({...answer,theory_booked:true,theory_date:'invalid',other_centre:'stale'},config,now).theory.booked).toBe(null);
  expect(availability(['1:morning','7:evening','1:morning'])).toEqual(['1:morning','7:evening']);
  for(const v of [[],['8:morning'],['1:midnight'],null])expect(()=>availability(v)).toThrow();
  expect(()=>qualify({...answer,practical_date:'2026-09-21',practical_time:'10:00'},config,now)).toThrow('future');
  expect(()=>qualify({...answer,practical_date:'2027-03-28',practical_time:'01:30'},config,now)).toThrow('valid');
});

test.describe('questionnaire browser behaviour',()=>{
  test.use({serviceWorkers:'block'});
  test.beforeEach(async({page})=>{
    await page.route('**/api/schools?action=public-config**',r=>r.fulfill({json:{ok:true,trial_questionnaire:questionnaireConfig,local_date:'2026-09-21'}}));
    await page.route('**/api/slots?action=trial-window-context**',r=>r.fulfill({json:{from:'2026-09-21',to:'2026-10-19',days_ahead:28}}));
    await page.route('**/api/slots?action=available**',r=>r.fulfill({json:{slots:{}}}));
    await page.route(/^https:\/\//,r=>r.fulfill({status:204,body:''}));
    await page.addInitScript(()=>localStorage.setItem('cc_cookie_consent',JSON.stringify({analytics:false,marketing:false,version:2,timestamp:new Date().toISOString()})));
  });
  test('keyboard, Back, conditional details and stale answer clearing',async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/free-trial.html');
    await expect(page.locator('#trialBookingFlow')).toBeHidden();
    await page.getByLabel('Yes',{exact:true}).focus();await page.keyboard.press('Space');await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.locator('.question-progress')).toHaveText('Question 2 of 3');
    await expect(page.locator('#questionSlide')).toHaveCSS('animation-name','none');
    await page.getByLabel('Practical test date').fill('2027-06-20');await page.getByLabel('Practical test time').fill('11:20');
    await page.getByLabel('Test centre',{exact:true}).selectOption('Other');await page.getByLabel('Which test centre?').fill('Oxford');
    await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Yes, I have money set aside for lessons.').check();
    await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Which test centre?')).toHaveValue('Oxford');
    await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByLabel('No',{exact:true}).check();await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Have you booked your theory test?'})).toBeFocused();
    await page.getByLabel('Yes',{exact:true}).check();await page.getByLabel('Theory test date').fill('2027-01-04');await page.getByLabel('Theory test time').fill('09:10');
    await page.getByLabel('No',{exact:true}).check();await expect(page.getByLabel('Theory test date')).toBeHidden();
    await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByLabel('Yes, I have money set aside for lessons.')).toBeChecked();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    expect(await page.evaluate(()=>ccTrialQuestionnaire.answers())).toMatchObject({practical_booked:false,practical_date:'',practical_time:'',centre_choice:'',other_centre:'',theory_booked:false,theory_date:'',theory_time:''});
  });
  test('supported centre at lowest budget uses request; retry and consent emit no booking',async({page})=>{
    await page.goto('/free-trial.html');await page.getByLabel('Yes',{exact:true}).check();await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByLabel('Practical test date').fill('2027-06-20');await page.getByLabel('Practical test time').fill('11:20');await page.getByLabel('Test centre',{exact:true}).selectOption('Reading');
    await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('No, I would need lessons to be around £45/hr.').check();await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Request your free trial'})).toBeVisible();
    await page.getByRole('button',{name:'Monday Morning',exact:true}).click();await expect(page.getByRole('button',{name:'Monday Morning',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Monday Morning',exact:true}).click();await expect(page.getByRole('button',{name:'Monday Morning',exact:true})).toHaveAttribute('aria-pressed','false');
    await page.getByRole('button',{name:'Sunday Evening',exact:true}).click();
    for(const [id,v]of Object.entries({requestName:'Request test',requestEmail:'request@example.invalid',requestPhone:'07912345678',requestPostcode:'RG1'}))await page.locator('#'+id).fill(v);
    const bodies=[];await page.route('**/api/trial-requests?action=submit**',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?500:200,json:bodies.length===1?{message:'Try again'}:{ok:true}});});
    await page.getByRole('button',{name:'Send trial request'}).click();await expect(page.locator('#requestError')).toHaveText('Try again');await page.getByRole('button',{name:'Send trial request'}).click();
    await expect(page.getByRole('heading',{name:/your trial request is received/})).toBeVisible();expect(bodies[0].submission_key).toBe(bodies[1].submission_key);expect(bodies[1].funnel_context.analytics_consent_at_booking).toBe(false);
  });
  test('eligible no-slots fallback preserves answers and contact details',async({page})=>{
    await page.goto('/free-trial.html');await page.getByLabel('Yes',{exact:true}).check();await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByLabel('Practical test date').fill('2027-06-20');await page.getByLabel('Practical test time').fill('11:20');await page.getByLabel('Test centre',{exact:true}).selectOption('Reading');await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByLabel('No, I would need lessons to be around £50/hr.').check();await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.locator('#slotPicker')).toContainText('No free trial slots');await page.locator('#guest_name').fill('Carried name');await page.locator('#guest_email').fill('carried@example.invalid');
    await page.getByRole('button',{name:'No suitable time? Request a trial'}).click();await expect(page.locator('#requestName')).toHaveValue('Carried name');await expect(page.locator('#requestEmail')).toHaveValue('carried@example.invalid');
    expect(await page.evaluate(()=>ccTrialQuestionnaire.answers())).toMatchObject({budget:'lower',centre_choice:'Reading'});
  });
  test('new progress and request analytics require current consent and discard all personal fields',async({page})=>{
    await page.route('**/static/array.js',r=>r.fulfill({contentType:'application/javascript',body:"var c=posthog._i[0][1];window.events=[];posthog.__loaded=true;posthog.capture=function(event,properties){var e=c.before_send({event,properties});if(e)events.push(e);};posthog.opt_out_capturing=function(){};posthog.opt_in_capturing=function(){};posthog.reset=function(){};c.loaded();"}));
    await page.goto('/free-trial.html');
    expect(await page.evaluate(()=>ccTrialFunnel.send('trial_questionnaire_step_1_completed'))).toBe(false);
    await page.evaluate(()=>{localStorage.setItem('cc_cookie_consent',JSON.stringify({analytics:true,marketing:false,version:2,timestamp:new Date().toISOString()}));document.dispatchEvent(new CustomEvent('cookie-consent-updated',{detail:{analytics:true}}));});
    await expect.poll(()=>page.evaluate(()=>window.events?.length||0)).toBe(1);
    await page.evaluate(()=>{ccTrialFunnel.send('trial_questionnaire_step_2_completed');posthog.capture('trial_request_submitted',{form_version:'qualification_v1',email:'PII_CANARY',phone:'PII_CANARY',postcode:'PII_CANARY',practical_date:'PII_CANARY',theory_time:'PII_CANARY',centre:'PII_CANARY',budget:'PII_CANARY',$current_url:'PII_CANARY'});});
    const events=await page.evaluate(()=>events);expect(events.map(e=>e.event)).toEqual(['free_trial_page_viewed','trial_questionnaire_step_2_completed','trial_request_submitted']);expect(JSON.stringify(events)).not.toContain('PII_CANARY');
    await page.evaluate(()=>{localStorage.setItem('cc_cookie_consent',JSON.stringify({analytics:false,marketing:false,version:2,timestamp:new Date().toISOString()}));document.dispatchEvent(new CustomEvent('cookie-consent-updated',{detail:{analytics:false}}));ccTrialFunnel.send('trial_request_submitted');});
    expect(await page.evaluate(()=>events.length)).toBe(3);
  });
  test('private admin review blocks analytics and renders request text safely',async({page})=>{
    const path=require('path');
    await page.route('**/admin/learner-controls.html',r=>r.fulfill({contentType:'text/html',body:'<main><div class="toolbar"></div><details id="trial-funnel-panel"></details></main>'}));
    await page.goto('/admin/learner-controls.html');
    await page.evaluate(()=>{window.ccCookieConsent={analyticsAllowed:()=>true};window.posthog={__SV:true,init:(_key,c)=>window.phConfig=c};});
    await page.addScriptTag({path:path.resolve(__dirname,'../public/posthog-loader.js')});
    expect(await page.evaluate(()=>({capture:phConfig.autocapture,replay:phConfig.disable_session_recording,result:phConfig.before_send({event:'$autocapture',properties:{text:'PII_CANARY'}})}))).toEqual({capture:false,replay:true,result:null});
    await page.evaluate(c=>{const x='<img id="xss-probe" src=x onerror="window.xss=1">';window.ccAdminAuth={fetchAuthed:async url=>new Response(JSON.stringify(url.includes('settings')?{configuration:c}:{requests:[{id:1,name:x,email:x,phone:x,postcode_area:x,submitted_at:'2026-09-21',availability:['1:morning'],questionnaire:{practical:{booked:true,date:'2027-01-01',time:'10:00',centre:x},theory:{booked:null},budget:'saved',config_snapshot:c,reasons:['other_centre']},funnel_context:{entry_page:'free_direct'},reason:'qualification'}]}))};},questionnaireConfig);
    await page.addScriptTag({path:path.resolve(__dirname,'../public/admin/trial-requests.js')});
    await page.locator('#trial-requests-panel > summary').click();await expect(page.locator('#trialRequestList')).toContainText('<img id=');expect(await page.locator('#xss-probe').count()).toBe(0);expect(await page.evaluate(()=>window.xss||0)).toBe(0);
  });
});
