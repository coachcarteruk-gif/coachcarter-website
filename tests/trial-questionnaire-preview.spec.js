const {test,expect}=require('@playwright/test');
const jwt=require('jsonwebtoken');
const path=require('path'),os=require('os');
const {randomUUID}=require('crypto');
const h=require('./helpers/trial-funnel-fixture');
test.describe('complete qualifying journeys on local Vercel',()=>{
  test.skip(process.env.TRIAL_FUNNEL_PREVIEW!=='1','Requires the isolated local Vercel workspace');
  test.describe.configure({mode:'serial'});test.use({serviceWorkers:'block'});
  let sql,pool,fixture;
  test.beforeAll(async()=>{({sql,pool}=h.database());});test.afterAll(async()=>pool?.end());
  test.beforeEach(async({page})=>{
    fixture=await h.seed(sql,'qualifying-preview-'+randomUUID());await h.enableQuestionnaire(sql);await sql`DELETE FROM rate_limits`;
    await page.route(/^https:\/\//,r=>r.fulfill({status:204,body:''}));
    await page.addInitScript(()=>localStorage.setItem('cc_cookie_consent',JSON.stringify({analytics:false,marketing:false,version:2,timestamp:new Date().toISOString()})));
  });
  for(const width of [375,1365]){
    test('eligible live booking and confirmed snapshot at width '+width,async({page,baseURL})=>{
      test.setTimeout(120000);expect(baseURL).toBe('http://localhost:3107');await page.setViewportSize({width,height:900});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const landing=await page.goto('/test-booked');expect(landing.status()).toBe(200);await page.locator('[data-trial-placement=hero]').click();await expect(page).toHaveURL(/\/free\?/);
      await page.goto('/free?campaign=test_booked_v1&instructor_id='+fixture.instructorId);
      await expect(page.locator('.question-progress')).toHaveText('Question 1 of 3');
      await page.screenshot({path:path.join(os.tmpdir(),'trial-questionnaire-'+width+'.png'),fullPage:true});
      await page.getByLabel('Yes',{exact:true}).check();await page.getByRole('button',{name:'Continue',exact:true}).click();
      await page.getByLabel('Practical test date').fill('2027-12-10');await page.getByLabel('Practical test time').fill('10:30');await page.getByLabel('Test centre',{exact:true}).selectOption('Reading');
      await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('No, I would need lessons to be around £50/hr.').check();await page.getByRole('button',{name:'Continue',exact:true}).click();
      await page.locator('.slot-btn').first().click();const suffix=String(Date.now()).slice(-8),email='qualified-'+suffix+'@example.invalid';
      for(const [id,value]of Object.entries({guest_name:'Qualified preview',guest_email:email,guest_phone:'079'+suffix,guest_pickup_address:'Isolated preview pickup'}))await page.locator('#'+id).fill(value);
      await expect(page.locator('#trialTestDetails')).toBeHidden();
      const bookingResponse=page.waitForResponse(r=>r.url().includes('action=book-free-trial'));
      await page.getByRole('button',{name:'Book my free trial'}).click();const result=await bookingResponse;expect(result.status()).toBe(200);
      await expect(page).toHaveURL(/free-trial-success/);
      const [intake]=await sql`SELECT t.* FROM trial_booking_intakes t JOIN learner_users lu ON lu.id=t.learner_id AND lu.school_id=1 WHERE t.school_id=1 AND lu.email=${email}`;
      expect(intake.questionnaire.budget).toBe('lower');expect(intake.test_time_snapshot).toBe('10:30');expect(intake.entry_page).toBe('test_booked');expect(intake.segment).toBe('over_4_calendar_months');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
    });
    test('theory branch → saved request → school admin review at width '+width,async({page,context,baseURL,request})=>{
      test.setTimeout(120000);expect(baseURL).toBe('http://localhost:3107');await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('/free');await page.getByLabel('No',{exact:true}).check();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Yes',{exact:true}).check();
      await page.getByLabel('Theory test date').fill('2027-01-12');await page.getByLabel('Theory test time').fill('11:40');await page.getByRole('button',{name:'Continue',exact:true}).click();
      await page.getByLabel('Yes, only on a pay-as-you-go basis.').check();await page.getByRole('button',{name:'Continue',exact:true}).click();
      const suffix=String(Date.now()).slice(-8),email='request-'+suffix+'@example.invalid';
      for(const [id,value]of Object.entries({requestName:'Request preview '+suffix,requestEmail:email,requestPhone:'079'+suffix,requestPostcode:'RG1'}))await page.locator('#'+id).fill(value);
      await page.getByRole('button',{name:'Monday Morning',exact:true}).click();await page.getByRole('button',{name:'Wednesday Afternoon',exact:true}).click();await page.getByRole('button',{name:'Sunday Evening',exact:true}).click();
      await page.screenshot({path:path.join(os.tmpdir(),'trial-request-'+width+'.png'),fullPage:true});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const requestResponse=page.waitForResponse(r=>r.url().includes('action=submit'));
      await page.getByRole('button',{name:'Send trial request'}).click();const saved=await requestResponse;expect(saved.status(),await saved.text()).toBe(200);
      await expect(page.getByRole('heading',{name:/your trial request is received/})).toBeVisible();
      const [r]=await sql`SELECT r.* FROM trial_requests r JOIN enquiries e ON e.id=r.enquiry_id AND e.school_id=1 WHERE r.school_id=1 AND e.email=${email}`;
      expect(r.questionnaire.theory).toMatchObject({booked:true,date:'2027-01-12',time:'11:40'});expect(r.reason).toBe('qualification');expect(await sql`SELECT id FROM learner_users WHERE school_id=1 AND email=${email}`).toHaveLength(0);
      const denied=await request.get('/api/trial-requests?action=list');expect(denied.status()).toBe(401);
      await context.addCookies([{name:'cc_admin',value:jwt.sign({id:1,role:'admin',school_id:1},'isolated-trial-funnel-fixture-secret'),url:baseURL,httpOnly:true},{name:'cc_csrf',value:'fixture',url:baseURL}]);
      await page.evaluate(()=>localStorage.setItem('cc_admin',JSON.stringify({admin:{id:1,name:'Isolated admin',school_id:1}})));
      await page.goto('/admin/learner-controls.html');await page.locator('#trial-requests-panel > summary').click();
      const item=page.locator('#trialRequestList details').filter({hasText:email});await item.locator('summary').click();await expect(item).toContainText('2027-01-12');await expect(item).toContainText('Monday morning');await expect(item).toContainText('no practical test');
      await page.locator('#trial-requests-panel').screenshot({path:path.join(os.tmpdir(),'trial-request-admin-'+width+'.png')});expect(errors).toEqual([]);
    });
  }
});
