const { test, expect } = require('@playwright/test');
const { responseFor } = require('./helpers/flexible-bank-ui-fixture');

async function setup(page, options = {}) {
  const submitted = [];
  await page.addInitScript(() => localStorage.setItem('cc_admin',JSON.stringify({ role:'admin',school_id:1 })));
  await page.route('**/api/**', async route => {
    const request=route.request(),action=new URL(request.url()).searchParams.get('action');
    if(action==='record-bank-purchase') {
      submitted.push(request.postDataJSON());
      if(options.failFirst&&submitted.length===1) return route.fulfill({ status:500,json:{message:'Connection interrupted. Retry with the same reference.'} });
    }
    return route.fulfill({ json:responseFor(action) });
  });
  await page.goto('/admin/packages.html');
  return submitted;
}

async function fill(page) {
  const form=page.locator('.bank-purchase-form');
  await form.getByRole('combobox',{name:'Learner',exact:true}).selectOption('41');
  await form.getByRole('combobox',{name:'Flexible Hours package',exact:true}).selectOption('30');
  await expect(form.getByLabel('Amount received (GBP)')).toHaveValue('810.00');
  await form.getByLabel('Unique bank transaction reference').fill('BANK-EXAMPLE-1');
  await form.getByLabel('Consent evidence reference').fill('Agreement archive item 15');
  for (const name of ['funds_received_confirmed','adult_age_confirmed','consumer_terms_accepted','immediate_access_requested']) await form.locator('[name='+name+']').check();
  return form;
}

test('admin records a package, sees bank origin, and cannot accidentally resubmit', async ({ page }) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const submitted=await setup(page);
  const form=await fill(page);
  await expect(form.locator('.bank-purchase-summary')).toContainText('adds 15 hours for £810.00');
  await form.getByRole('button',{name:'Record payment and add hours'}).click();
  await expect(form.locator('.bank-result')).toHaveText('Payment recorded. 15 Flexible Hours · purchase #1.');
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ learner_id:41,product_version_id:30,amount_pence:81000,bank_reference:'BANK-EXAMPLE-1' });
  await expect(form.getByRole('button')).toBeDisabled();
  await expect(page.locator('#flexible-package-operations')).toContainText('Bank transfer · 2026-09-24 · BANK-EXAMPLE-1');
  await expect(page.locator('.flexible-refund-evidence-form')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('failed requests keep the exact request identity and mobile form fits the viewport', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  const submitted=await setup(page,{failFirst:true});
  const form=await fill(page);
  await form.getByRole('button').click();
  await expect(form.locator('.bank-result')).toContainText('Connection interrupted');
  await form.getByRole('button').click();
  await expect(form.locator('.bank-result')).toContainText('Payment recorded');
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/flexible-bank-mobile.png',fullPage:true});
});
