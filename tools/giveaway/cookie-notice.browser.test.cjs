const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('@playwright/test');
test('giveaway notice preserves site consent and disables optional tracking; other pages keep choices',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:320,height:700}});
    const script=fs.readFileSync(require('node:path').join(__dirname,'../../public/cookie-consent.js'),'utf8');
    await page.route('https://notice.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body><script>'+script+'</script></body>'}));
    const previous=JSON.stringify({version:2,analytics:true,marketing:true});
    await page.addInitScript(value=>localStorage.setItem('cc_cookie_consent',value),previous);
    await page.goto('https://notice.test/giveaway/apply.html');
    assert.equal(await page.locator('#cc-necessary-notice').count(),1);
    assert.equal(await page.locator('#cc-consent-overlay').count(),0);
    assert.equal(await page.locator('input[type=checkbox]').count(),0);
    assert.equal(await page.locator('#cc-necessary-notice a').getAttribute('href'),'/giveaway/privacy.html');
    assert.deepEqual(await page.evaluate(()=>[ccCookieConsent.analyticsAllowed(),ccCookieConsent.marketingAllowed()]),[false,false]);
    await page.getByRole('button',{name:'Got it'}).click();await page.reload();
    assert.equal(await page.locator('#cc-necessary-notice').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('cc_cookie_consent')),previous);
    await page.evaluate(()=>ccCookieConsent.show());assert.equal(await page.locator('#cc-necessary-notice').count(),1);
    await page.goto('https://notice.test/free');await page.evaluate(()=>ccCookieConsent.show());
    assert.equal(await page.locator('#cc-analytics-toggle').count(),1);assert.equal(await page.locator('#cc-marketing-toggle').count(),1);
    assert.deepEqual(await page.evaluate(()=>[ccCookieConsent.analyticsAllowed(),ccCookieConsent.marketingAllowed()]),[true,true]);
  } finally {await browser.close();}
});
