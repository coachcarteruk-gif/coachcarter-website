const { test, expect } = require('@playwright/test');
const { responseFor } = require('./helpers/flexible-bank-ui-fixture');

for (const width of [1280,390]) test('pending refund and later outcome at width '+width,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.addInitScript(()=>localStorage.setItem('cc_admin',JSON.stringify({role:'admin',school_id:1})));
  let reduction=null;const submissions=[];
  await page.route('**/api/**',async route=>{
    const request=route.request(),action=new URL(request.url()).searchParams.get('action');
    if(action==='admin-overview')return route.fulfill({json:{purchases:[{source_id:1,learner_name:'Alex Example',product_slug:'flexible-15-hours',amount_pence:81000,payment_provider:'stripe',remaining_units:reduction?0:30,rate_pence_per_unit:2700,refundable_value_pence:reduction?0:81000}],reductions:reduction?[reduction]:[]}});
    if(action==='record-refund-evidence'){
      const body=request.postDataJSON();submissions.push(body);
      reduction={id:7,source_id:1,units_reduced:body.units,learner_refund_pence:81000,provider_refund_id:body.provider_refund_id,provider_status:body.provider_status};
      return route.fulfill({json:{ok:true,reduction}});
    }
    if(action==='record-refund-status'){
      const body=request.postDataJSON();submissions.push(body);reduction.provider_status=body.provider_status;
      return route.fulfill({json:{ok:true}});
    }
    return route.fulfill({json:responseFor(action)});
  });
  await page.goto('/admin/packages.html');
  await page.getByText('Record original-method refund',{exact:true}).click();
  const form=page.locator('.flexible-refund-evidence-form');
  await expect(form).toContainText('removes these hours from the spendable balance immediately');
  await form.getByLabel('Stripe refund status').selectOption('pending');
  await form.getByLabel('Units refunded').fill('30');
  await form.getByLabel('Stripe refund ID').fill('re_pending');
  await form.getByLabel('Evidence reference').fill('Stripe refund record');
  await form.getByLabel('Audit reason').fill('Unused hours');
  await form.getByRole('button',{name:'Record refund evidence'}).click();
  const history=page.locator('#flexible-package-operations');
  await expect(history).toContainText('Pending — bank processing');
  await expect(history).toContainText('These hours are unavailable for booking');
  await expect(form).toHaveCount(0);
  expect(submissions[0]).toMatchObject({units:30,provider_status:'pending',provider_refund_id:'re_pending'});
  const status=page.locator('.flexible-refund-status-form');
  await status.getByLabel('Latest status shown in Stripe').selectOption('succeeded');
  await status.getByRole('button').click();
  await expect(status).toHaveCount(0);
  await expect(history).toContainText('Succeeded');
  expect(submissions[1]).toEqual({reduction_id:7,provider_status:'succeeded'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
