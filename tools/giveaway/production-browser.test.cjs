// Isolated browser-to-SQL check: no .env loading, provider calls or running-preview changes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('@playwright/test');
const jwt=require('jsonwebtoken');
const {createDatabase,tagged,tokenVault}=require('./database.cjs');
const {createHandler}=require('../../api/_giveaway-handler');

test('production pages: nomination, private invitation, separate answers and authenticated review', {timeout:90000}, async()=>{
  const root=path.resolve(__dirname,'../..'), pg=new PGlite();
  const middleware=fs.readFileSync(path.join(root,'middleware.js'),'utf8');
  const cspBlock=middleware.match(/set\('Content-Security-Policy', \[([\s\S]*?)\]\.join/);
  assert.ok(cspBlock,'Use the current production CSP');
  const csp=[...cspBlock[1].matchAll(/"([^"]+)"/g)].map(match=>match[1]).join('; ');
  const previous=process.env.JWT_SECRET;
  process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
  let browser, server;
  try {
    await pg.exec("CREATE TABLE schools(id INTEGER PRIMARY KEY,config JSONB,primary_host TEXT,slug TEXT,active BOOLEAN); CREATE TABLE rate_limits(key TEXT PRIMARY KEY,request_count INTEGER,window_start TIMESTAMPTZ)");
    for(const file of ['077_giveaway_storage.sql','078_giveaway_privacy.sql']) await pg.exec(fs.readFileSync(path.join(root,'db/migrations',file),'utf8'));
    const vault=tokenVault(crypto.randomBytes(32)), db=createDatabase({transaction:cb=>pg.transaction(client=>cb(tagged(client))),vault});
    const handler=createHandler({db,sql:tagged(pg),vault,enabled:true});
    server=http.createServer(async(req,res)=>{
      res.setHeader('Content-Security-Policy',csp);
      res.setHeader('X-Content-Type-Options','nosniff');
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/api/giveaway') {
        let body=''; for await(const chunk of req) body+=chunk;
        req.body=body?JSON.parse(body):{}; req.query=Object.fromEntries(url.searchParams);
        res.status=code=>{res.statusCode=code;return res;}; res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res;};
        return handler(req,res);
      }
      const publicRoot=path.join(root,'public'), file=path.resolve(publicRoot,'.'+url.pathname);
      if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    await pg.query('INSERT INTO schools VALUES(1,$1::jsonb,$2,$3,true)',[JSON.stringify({giveaway:{enabled:true,campaign_key:'browser',origin}}),'127.0.0.1','browser']);
    await pg.exec("INSERT INTO giveaway_campaigns VALUES(1,'browser',now()+interval '1 day',now()+interval '90 days',true)");
    browser=await chromium.launch({headless:true,channel:'msedge'});
    const context=await browser.newContext({viewport:{width:1365,height:1000}}), page=await context.newPage();
    const errors=[], external=[], failedAssets=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(/Content Security Policy|violates.*directive/i.test(message.text())) errors.push(message.text());});
    page.on('response',response=>{if(response.status()>=400 && ['script','stylesheet','font','image'].includes(response.request().resourceType())) failedAssets.push(response.url());});
    await context.route('**/*',route=>{
      if(!route.request().url().startsWith(origin+'/')) {external.push(route.request().url());return route.abort();}
      return route.continue();
    });
    assert.equal((await context.request.get(origin+'/api/giveaway?action=review')).status(),401);
    await page.goto(origin+'/giveaway/index.html');
    await page.getByRole('button',{name:'Got it',exact:true}).click();
    await page.locator('#nomination:not([hidden])').waitFor();
    for(const [name,value] of Object.entries({nominee_name:'Robin Browser',nominee_phone:'07700900789',nominee_email:'robin@example.test',nominator_name:'Casey Browser',nominator_phone:'07700900654',nominator_email:'casey@example.test',reason:'Private nomination, never shared with the applicant.'})) await page.locator('[name='+name+']').fill(value);
    await page.locator('#permission').check(); await page.getByRole('button',{name:/Send their nomination/}).click();
    await page.getByText('A lovely thing to do.').waitFor();
    const row=(await pg.query('SELECT * FROM giveaway_nominations')).rows[0];
    const job=(await pg.query("SELECT * FROM giveaway_jobs WHERE kind='invitation'")).rows[0];
    const token=vault.open(job.payload.sealed_token,`1:${row.id}`);
    await page.goto(origin+'/giveaway/apply.html#'+token); await page.locator('#application:not([hidden])').waitFor();
    assert.equal(new URL(page.url()).hash,'');
    for (const width of [320,506,706,1365]) {
      await page.setViewportSize({width,height:715});
      await page.evaluate(()=>scrollTo(0,0));
      await page.waitForFunction(()=>!document.body.classList.contains('application-started'));
      const styles=await page.evaluate(()=>['application-heading','start-application'].map(id=>{
        const e=document.getElementById(id),s=getComputedStyle(e),r=e.getBoundingClientRect();
        return {color:s.color,background:s.backgroundColor,radius:s.borderRadius,font:s.fontSize,height:r.height,left:r.left,width:r.width};
      }));
      assert.deepEqual(styles[0],styles[1]);
      for (const offset of [8,-8,8,-8]) {
        await page.evaluate(offset=>{const h=document.getElementById('application-heading').getBoundingClientRect(),b=document.getElementById('start-application').getBoundingClientRect();scrollBy(0,h.top-b.top-offset);},offset);
        await page.waitForFunction(docked=>document.body.classList.contains('application-started')===docked,offset<0);
        assert.equal(await page.locator('#application-heading').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(245, 131, 33)');
        assert.equal(await page.locator('#application-heading').evaluate(e=>e.getAnimations().length),0);
      }
    }
    assert.match(await page.locator('#nominated-by').innerText(),/Casey Browser/);
    assert.doesNotMatch(await page.locator('body').innerText(),/Private nomination|casey@example.test/);
    assert.equal(await page.locator('input[type=checkbox]:checked').count(),0);
    assert.ok((await context.cookies()).some(c=>c.name==='__Secure-cc_giveaway'&&c.httpOnly&&c.secure));
    const meaning='Independent travel would let me reach work and support my family.';
    const barriers='Lesson costs have prevented me from starting. Free lessons remove that barrier.';
    for(const [name,value] of Object.entries({meaning,hours:'0',address:'1 Fictional Lane',postcode:'RG1 1AA'})) await page.locator('#'+name).fill(value);
    await page.locator('[name=test_booked][value=no]').check(); await page.locator('[name=practice_car][value=no]').check();
    await page.locator('#employment').selectOption('prefer-not-to-say'); await page.locator('#contact_confirmed').check();
    await page.getByRole('button',{name:/Send my application/}).click();
    assert.equal(await page.locator('#barriers').getAttribute('aria-invalid'),'true');
    assert.equal(await page.locator('#meaning').inputValue(),meaning);
    await page.locator('#barriers').fill(barriers);
    await page.setViewportSize({width:320,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const shots=path.join(root,'tmp/giveaway-production-screenshots');fs.mkdirSync(shots,{recursive:true});
    await page.screenshot({path:path.join(shots,'application-mobile.png'),fullPage:true});
    await page.route('**/api/giveaway?action=apply',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary test failure'})}),{times:1});
    await page.getByRole('button',{name:/Send my application/}).click(); await page.getByText('Temporary test failure').waitFor();
    assert.equal(await page.locator('#meaning').inputValue(),meaning); assert.equal(await page.locator('#barriers').inputValue(),barriers);
    await page.getByRole('button',{name:/Send my application/}).click(); await page.getByText('You’re all done.').waitFor();
    await page.reload(); await page.getByText('You’re all done.').waitFor();
    const saved=(await pg.query('SELECT application FROM giveaway_nominations WHERE id=$1',[row.id])).rows[0].application;
    assert.equal(saved.meaning,meaning); assert.equal(saved.barriers,barriers);
    const admin=jwt.sign({id:1,role:'admin',isAdmin:true,school_id:1},process.env.JWT_SECRET,{expiresIn:'5m'});
    await context.addCookies([{name:'cc_admin',value:admin,url:origin,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(origin+'/giveaway/review.html'); await page.getByText(/All available records loaded/).waitFor();
    await page.locator('#nomination-'+row.id+' > summary').click();
    await page.getByText('Invitation and CRM controls',{exact:true}).click();
    await page.getByRole('button',{name:'Run invitation / CRM once',exact:true}).click();
    await page.getByText('Integration worker is disabled.',{exact:true}).waitFor();
    await page.locator('#nomination-'+row.id+' > summary').click();
    await page.locator('#nomination-'+row.id+' > summary').click();
    await page.getByRole('heading',{name:'1. Difference driving would make to everyday life'}).waitFor();
    await page.getByRole('heading',{name:'2. Barriers free lessons would help overcome'}).waitFor();
    assert.ok((await page.locator('#records').innerText()).includes(meaning)); assert.ok((await page.locator('#records').innerText()).includes(barriers));
    await page.setViewportSize({width:1365,height:1000}); await page.screenshot({path:path.join(shots,'review-desktop.png'),fullPage:true});
    // Historical combined answers retain their original value and review label.
    await pg.query("UPDATE giveaway_nominations SET application=application-'barriers' WHERE id=$1",[row.id]);
    await page.reload(); await page.locator('#nomination-'+row.id+' > summary').click();
    await page.getByRole('heading',{name:'Earlier combined story answer'}).waitFor();
    assert.equal((await pg.query('SELECT application FROM giveaway_nominations WHERE id=$1',[row.id])).rows[0].application.meaning,meaning);
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]); assert.deepEqual(failedAssets,[]);
  } finally {
    if(browser) await browser.close();
    if(server) await new Promise(resolve=>server.close(resolve));
    await pg.close();
    if(previous===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=previous;
  }
});
