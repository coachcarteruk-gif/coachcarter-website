const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

async function setup(page, { minutes = 900, credit = 0, enabled = true, conflict = false, lostResponse = false, requestToBook = false } = {}) {
  const dates = Array.from({length:4}, (_,i) => {
    const d=new Date();d.setUTCDate(d.getUTCDate()+7+i*7);return d.toISOString().slice(0,10);
  });
  const commits=[];
  await page.addInitScript(() => {
    window.ccAuth={getAuth:()=>({user:{id:41,name:'Test Learner'}}),fetchAuthed:(...args)=>fetch(...args)};
  });
  await page.route('**/learner/book.html*', route => {
    const html=fs.readFileSync(path.join(__dirname,'../public/learner/book.html'),'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, script=>script.includes('src="/learner/book.js"')?script:'');
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.route('**/api/**', async route => {
    const url=new URL(route.request().url());
    const action=url.searchParams.get('action');
    let result={};
    if(url.pathname==='/api/instructors') result={instructors:[{id:1,name:'Test Instructor',max_booking_days_ahead:84,transmission_type:'manual'}]};
    else if(url.pathname==='/api/lesson-types') result={lesson_types:[{id:1,name:'Standard Lesson',slug:'standard',duration_minutes:90,price_pence:8100}]};
    else if(url.pathname==='/api/learner' && action==='profile') result={profile:{id:41,name:'Test Learner',phone:'07700900123',pickup_address:'Test pickup'}};
    else if(url.pathname==='/api/credits') result={balance_minutes:credit,selected_instructor_balance_minutes:credit,payments_enabled:true,incompatible_products_retired:true};
    else if(url.pathname==='/api/flexible-packages') result={remaining_minutes:minutes,weekly_booking_enabled:enabled};
    else if(action==='my-bookings') result={upcoming:[],past:[]};
    else if(action==='available') result={slots:Object.fromEntries(dates.map(date=>[date,[{instructor_id:1,instructor_name:'Test Instructor',date,start_time:'10:00',end_time:'11:30',transmission_type:'manual'}]]))};
    else if(action==='durations-for-slot') result={request_to_book:requestToBook,durations:[{lesson_type_id:1,name:'Standard Lesson',slug:'standard',duration_minutes:90,price_pence:8100,fits:true,end_time:'11:30'}]};
    else if(action==='flexible-weekly-preview') {
      const count=route.request().postDataJSON().repeat_weeks;
      result={ok:true,dates:dates.slice(0,count),required_minutes:90*count,balance_minutes:minutes,
        has_sufficient_hours:minutes>=90*count,can_commit:!conflict,conflicts:conflict?[{date:dates[1]}]:[]};
    } else if(action==='flexible-weekly-commit') {
      commits.push(route.request().postDataJSON());
      if(lostResponse && commits.length===1)return route.abort();
      const count=commits.at(-1).repeat_weeks;
      result={ok:true,funding_method:'flexible_package',booking_id:1001,booking_ids:dates.slice(0,count).map((_,i)=>1001+i),dates:dates.slice(0,count),flexible_package_remaining_minutes:minutes-count*90};
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('/learner/book.html');
  await page.locator('[data-action="select-slot"]').first().click();
  await page.locator('[data-action="continue-selected-slot"]').click();
  await expect(page.locator('#bookModal')).toBeVisible();
  return {commits,dates};
}

test('retired legacy controls stay hidden while package hours book four weekly lessons', async ({page})=>{
  const {commits}=await setup(page);
  await expect(page.locator('#repeatSection')).toBeHidden();
  await page.locator('#flexibleWeeklyToggle').check();
  await expect(page.locator('#flexibleWeeklyPreview li')).toHaveCount(4);
  await expect(page.locator('#flexibleWeeklyPreview')).toContainText('6 hours required');
  await page.locator('#btnConfirmBook').click();
  await expect(page.locator('#bookSuccessStep')).toBeVisible();
  await expect(page.locator('#successBalance')).toHaveText('Flexible Hours remaining: 9 hours');
  expect(commits).toHaveLength(1);
  expect(commits[0]).toMatchObject({repeat_weeks:4,funding_method:'flexible_package'});
  await page.screenshot({path:'test-results/flexible-weekly-success.png'});
});

test('insufficient package hours do not switch to plentiful Lesson Credit or payment',async({page})=>{
  await setup(page,{minutes:180,credit:900});
  await page.locator('#flexibleWeeklyToggle').check();
  await expect(page.locator('#flexibleWeeklyPreview')).toContainText('Not enough Flexible Hours');
  await expect(page.locator('#btnConfirmBook')).toBeDisabled();
  await expect(page.locator('#modalPayPath')).toBeHidden();
  await expect(page.locator('#fundingChoice')).toBeHidden();
  await page.locator('#flexibleWeeklyCount').selectOption('2');
  await expect(page.locator('#btnConfirmBook')).toBeEnabled();
  await expect(page.locator('#flexibleWeeklyPreview li')).toHaveCount(2);
  await page.screenshot({path:'test-results/flexible-weekly-preview.png'});
});

test('conflicts block confirmation',async({page})=>{
  await setup(page,{conflict:true});
  await page.locator('#flexibleWeeklyToggle').check();
  await expect(page.locator('#flexibleWeeklyPreview')).toContainText('unavailable');
  await expect(page.locator('#btnConfirmBook')).toBeDisabled();
});

test('lost response retries retain the same batch identity',async({page})=>{
  const {commits}=await setup(page,{lostResponse:true});
  await page.locator('#flexibleWeeklyToggle').check();
  await expect(page.locator('#btnConfirmBook')).toBeEnabled();
  await page.locator('#btnConfirmBook').click();
  await expect(page.locator('#btnConfirmBook')).toBeEnabled();
  await page.locator('#btnConfirmBook').click();
  await expect(page.locator('#bookSuccessStep')).toBeVisible();
  expect(commits).toHaveLength(2);
  expect(commits[0].client_request_id).toBe(commits[1].client_request_id);
});

test('migration not yet installed keeps weekly package control hidden',async({page})=>{
  await setup(page,{enabled:false});
  await expect(page.locator('#flexibleWeeklySection')).toBeHidden();
});

test('request-to-book instructor cannot use weekly package control',async({page})=>{
  await setup(page,{requestToBook:true});
  await expect(page.locator('#flexibleWeeklySection')).toBeHidden();
});

test('weekly preview fits a mobile viewport and retains a reachable confirmation button',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await setup(page);
  await page.locator('#flexibleWeeklyToggle').check();
  await expect(page.locator('#flexibleWeeklyPreview li')).toHaveCount(4);
  await page.locator('#btnConfirmBook').scrollIntoViewIfNeeded();
  await expect(page.locator('#btnConfirmBook')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/flexible-weekly-mobile.png'});
});
