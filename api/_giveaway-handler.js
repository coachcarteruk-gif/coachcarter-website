const { requireAuth, getSchoolId } = require('./_auth');
const { resolveSchoolFromRequest } = require('./_tenant');
const { ensureCsrfCookie, verifyCsrf, parseCookies, appendSetCookie } = require('./_csrf');
const { checkRateLimit, getClientIp } = require('./_rate-limit');
const { InputError } = require('../tools/giveaway/domain.cjs');
const { logAuditRequired } = require('./_audit');
const { createHash } = require('node:crypto');
const COOKIE = '__Secure-cc_giveaway';
const fail = (res,status,code,message,fields={}) => res.status(status).json({error:true,code,message,fields});
function createHandler({ db, sql, vault, enabled = false, runIntegration, now = () => Date.now(), onError = async () => {} }) {
  return async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    if (!enabled) return fail(res,404,'DISABLED','This giveaway is not available.');
    try {
      const action = req.query?.action;
      if (!['config','nominate','invitation','apply','withdraw','withdraw-marketing','review','integration-status','privacy-queue','privacy-export','request-erasure','record-invitation-request','run-integration'].includes(action)) return fail(res,404,'ACTION','Action not found.');
      const expectedMethod = ['config','review','integration-status','privacy-queue'].includes(action) ? 'GET' : 'POST';
      if (req.method !== expectedMethod) return fail(res,405,'METHOD','Method not allowed.');
      const tenant = await resolveSchoolFromRequest({ headers: req.headers, query: {} },{sql});
      if (!tenant) return fail(res,404,'SCHOOL','School not found.');
      const schoolId = Number(tenant.schoolId);
      const [school] = await sql`SELECT config->'giveaway' AS giveaway FROM schools WHERE id=${schoolId}`;
      const config = school?.giveaway;
      const privacyAction=['privacy-queue','privacy-export','request-erasure','withdraw-marketing'].includes(action);
      // Closing entries must preserve authenticated review and operational visibility.
      const existingAccess=privacyAction || ['config','invitation','withdraw','review','integration-status','record-invitation-request','run-integration'].includes(action);
      if ((!existingAccess && config?.enabled !== true) || typeof config?.campaign_key !== 'string') return fail(res,404,'DISABLED','This giveaway is not available.');
      const [campaign] = await sql`SELECT closes_at,enabled,closes_at>clock_timestamp() AS open FROM giveaway_campaigns
        WHERE school_id=${schoolId} AND campaign_key=${config.campaign_key}`;
      if (!campaign && !privacyAction) return fail(res,404,'CAMPAIGN','This giveaway is not available.');
      if (req.method === 'POST') {
        if (req.headers.origin !== config.origin || !String(req.headers['content-type']).startsWith('application/json') || !verifyCsrf(req)) return fail(res,403,'CSRF','Reload this page and try again.');
        if (JSON.stringify(req.body || {}).length>20000) return fail(res,413,'SIZE','This submission is too large.');
      }
      if (action === 'config') {
        ensureCsrfCookie(req,res);
        return res.json({ok:true,deadline:campaign.closes_at,open:config.enabled===true && campaign.enabled && campaign.open});
      }
      if (['record-invitation-request','run-integration'].includes(action)) {
        const admin=requireAuth(req,{roles:['admin']});
        if (!admin || Number(getSchoolId(admin,req))!==schoolId) return fail(res,401,'AUTH','School administrator access required.');
        const id=req.body?.nomination_id;
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||'')) return fail(res,400,'ID','Choose a nomination.');
        const [row]=await sql`SELECT id FROM giveaway_nominations WHERE school_id=${schoolId} AND campaign_key=${config.campaign_key}
          AND id=${id} AND erasure_requested_at IS NULL`;
        if (!row) return fail(res,404,'NOMINATION','Nomination unavailable.');
        if (action==='record-invitation-request') {
          const reference=req.body?.verification_reference;
          if (req.body?.nominee_requested!==true || typeof reference!=='string' || !/^[A-Za-z0-9 _.-]{3,100}$/.test(reference))
            return fail(res,400,'EVIDENCE','Confirm the nominee requested this invitation and record the evidence reference.');
          await logAuditRequired(sql,{adminId:admin.id,adminEmail:admin.email,schoolId,req,action:'giveaway.record-invitation-request',targetType:'giveaway',
            details:{nomination_id:id,verification_reference:reference,stage:'authorized_request'}});
          return res.json({ok:await db.recordInvitationRequest(schoolId,config.campaign_key,id,reference)});
        }
        if (config.integration?.enabled!==true || typeof runIntegration!=='function') return fail(res,409,'DISABLED','Integration worker is disabled.');
        await logAuditRequired(sql,{adminId:admin.id,adminEmail:admin.email,schoolId,req,action:'giveaway.run-integration',targetType:'giveaway',details:{nomination_id:id,stage:'authorized_request'}});
        return res.json({ok:true,result:await runIntegration({...config.integration,schoolId,campaignKey:config.campaign_key,nominationId:id,
          invitation:{...config.integration.invitation,origin:config.origin}})});
      }
      if (action === 'review' || action === 'privacy-queue' || action === 'integration-status') {
        const admin = requireAuth(req,{roles:['admin']});
        if (!admin || Number(getSchoolId(admin,req)) !== schoolId) return fail(res,401,'AUTH','Sign in as a school administrator.');
        if(action==='integration-status') {
          // Aggregate only. Include erasure-pending work: it still needs reconciliation.
          // Expired dispatches are shown as uncertain without mutating the journal.
          const jobs=await sql`SELECT j.kind,
            CASE WHEN j.state='dispatching' AND j.lease_until<clock_timestamp() THEN 'uncertain' ELSE j.state END AS state,
            count(*)::int AS count
            FROM giveaway_jobs j JOIN giveaway_nominations n ON n.school_id=j.school_id AND n.id=j.nomination_id
            WHERE n.school_id=${schoolId} AND n.campaign_key=${config.campaign_key}
            GROUP BY j.kind,CASE WHEN j.state='dispatching' AND j.lease_until<clock_timestamp() THEN 'uncertain' ELSE j.state END
            ORDER BY j.kind,state`;
          return res.json({ok:true,jobs});
        }
        const before = req.query.before || 'ffffffff-ffff-ffff-ffff-ffffffffffff';
        if (!/^[0-9a-f-]{36}$/i.test(before)) return fail(res,400,'CURSOR','Invalid page cursor.');
        if(action==='privacy-queue') {
          const rows=await sql`SELECT n.id,n.campaign_key,n.erasure_requested_at,
            EXISTS(SELECT 1 FROM giveaway_jobs j WHERE j.school_id=n.school_id AND j.nomination_id=n.id
              AND j.state IN ('claimed','dispatching','uncertain')) AS unresolved_work
            FROM giveaway_nominations n WHERE n.school_id=${schoolId} AND n.erasure_requested_at IS NOT NULL
              AND n.id<${before}::uuid ORDER BY n.id DESC LIMIT 51`;
          return res.json({ok:true,records:rows.slice(0,50),next:rows.length>50?rows[49].id:null});
        }
        const rows = await sql`SELECT id,nomination,application,created_at,submitted_at FROM giveaway_nominations
          WHERE school_id=${schoolId} AND campaign_key=${config.campaign_key} AND id<${before}::uuid
          AND erasure_requested_at IS NULL ORDER BY id DESC LIMIT 51`;
        return res.json({ok:true,records:rows.slice(0,50).map(row=>({id:row.id,...row.nomination,application:row.application,created_at:row.created_at,submitted_at:row.submitted_at})),next:rows.length>50?rows[49].id:null});
      }
      if (['privacy-export','request-erasure','withdraw-marketing'].includes(action)) {
        const admin=requireAuth(req,{roles:['admin']});
        if (!admin || Number(getSchoolId(admin,req))!==schoolId) return fail(res,401,'AUTH','School administrator access required.');
        const reference=req.body?.verification_reference;
        if (typeof reference!=='string' || !/^[A-Za-z0-9 _.-]{3,100}$/.test(reference)) return fail(res,400,'VERIFICATION','Record the identity-verification case reference.');
        const email=String(req.body?.verified_email || '').trim().toLowerCase();
        const id=req.body?.nomination_id;
        if (action!=='request-erasure' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res,400,'EMAIL','Enter the verified email address.');
        if (action==='request-erasure' && !/^[0-9a-f-]{36}$/i.test(id || '')) return fail(res,400,'ID','Choose a nomination.');
        await logAuditRequired(sql,{adminId:admin.id,adminEmail:admin.email,schoolId,req,action:'giveaway.'+action,targetType:'giveaway',
          details:{verification_reference:reference,subject_hash:createHash('sha256').update(action==='request-erasure'?id:email).digest('hex'),stage:'authorized_request'}});
        if (action==='withdraw-marketing') return res.json(await db.withdrawForEmail(schoolId,email));
        if (action==='privacy-export') return res.json({ok:true,records:await db.exportForEmail(schoolId,email)});
        return res.json({ok:await db.requestErasure(schoolId,id),message:'Erasure review requested. Provider cleanup is required before final deletion.'});
      }
      // Wrap the shared limiter fail-closed for this new invitation-generating endpoint.
      let limiterFailed = false;
      const limitedSql = async (...args) => { try { return await sql(...args); } catch(error) { limiterFailed=true; throw error; } };
      const limit = await checkRateLimit(limitedSql,{key:`giveaway:${schoolId}:${action}:${getClientIp(req)}`,max:action==='nominate'?10:60,windowSeconds:3600});
      if (limiterFailed || !limit.allowed) return fail(res,429,'RATE_LIMIT','Please try again later.');
      if (action === 'nominate') return res.json(await db.nominate(schoolId,config.campaign_key,req.body || {}, {
        afterCreated: async nominationId => {
          if (config.integration?.enabled!==true || config.integration.invitation?.enabled!==true ||
              config.integration.invitation?.permissionMode!=='nomination' || typeof runIntegration!=='function') return;
          try {
            // Await bounded invitation work; never perform CRM writes from public submission.
            await runIntegration({...config.integration,schoolId,campaignKey:config.campaign_key,nominationId,
              crm:{enabled:false},provisioning:{enabled:false},
              invitation:{...config.integration.invitation,origin:config.origin}});
          } catch (error) {
            // The nomination is committed. Delivery failure must not report entry failure
            // or encourage duplicates; the persisted job is available for staff review.
            try { await onError(error); } catch {}
          }
        }
      }));
      let token;
      if (action === 'invitation' && req.body?.token) {
        token = req.body.token;
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return fail(res,404,'INVITATION','This invitation is unavailable.');
        const result = await db.inspect(schoolId,token);
        const session = vault.seal(JSON.stringify({token,until:now()+43200000}),`giveaway-session:${schoolId}`);
        appendSetCookie(res,`${COOKIE}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/api/giveaway; Max-Age=43200`);
        return res.json(result);
      }
      try {
        const session = JSON.parse(vault.open(parseCookies(req)[COOKIE],`giveaway-session:${schoolId}`));
        if (session.until>now()) token=session.token;
      } catch { /* invalid, expired or other-school cookie */ }
      if (!token) return fail(res,401,'INVITATION','Reopen your invitation link to continue.');
      if (action==='invitation') return res.json(await db.inspect(schoolId,token));
      if (action==='apply') return res.json(await db.apply(schoolId,token,req.body || {}));
      return res.json(await db.withdraw(schoolId,token));
    } catch(error) {
      if (error instanceof InputError) return fail(res,error.status,'INPUT',error.message,error.fields);
      try { await onError(new Error('Giveaway API operation failed')); } catch { /* report failure must not expose internals */ }
      return fail(res,500,'SERVER','We could not save that right now. Please try again.');
    }
  };
}
module.exports = { createHandler };
