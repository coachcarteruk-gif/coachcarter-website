const { createHash } = require('node:crypto');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const email = value => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
// Caller supplies trusted campaign/sender settings, never request-body configuration.
function invitationHandler({config,vault,transport,maySend,now=()=>new Date()}) {
  config=structuredClone(config);
  const confirmation=config.recipientRole==='nominator';
  const origin=new URL(config.origin);
  if (origin.href!==origin.origin+'/' || origin.username || origin.password ||
      (origin.protocol!=='https:' && !(config.testOnly===true && origin.origin==='http://127.0.0.1:61531')) ||
      !Number.isSafeInteger(config.schoolId) || !config.campaignKey || !email(config.from) || !email(config.replyTo) ||
      typeof maySend!=='function') throw Error('Invalid invitation configuration');
  return async source => {
    if(source.kind!=='invitation' || source.school_id!==config.schoolId || source.campaign_key!==config.campaignKey ||
       source.campaign_enabled!==true || !Number.isFinite(Date.parse(source.closes_at)) || Date.parse(source.closes_at)<=now().getTime() ||
       source.application || source.erasure_requested_at || !source.nomination.permission?.accepted_at) throw Error('Invitation unavailable');
    if (confirmation !== (source.event_key==='nominator-confirmation')) throw Error('Invitation recipient mismatch');
    const to=source.nomination[confirmation?'nominator':'nominee'].email;
    if(!email(to) || config.testOnly===true && to!==config.testRecipient || await maySend(source)!==true) throw Error('Invitation suppressed');
    const token=vault.open(source.payload.sealed_token,`${source.school_id}:${source.id}`);
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('Invalid invitation token');
    const url=new URL('/giveaway/apply.html',origin);url.hash=token;
    const privacyUrl=new URL('/giveaway/privacy.html',origin).href;
    const closes=new Date(source.closes_at);
    const midnight=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(closes)==='00:00:00';
    const deadline=midnight
      ? new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'full'}).format(new Date(closes.getTime()-1))+' at midnight (end of day)'
      : new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'full',timeStyle:'short'}).format(closes);
    const intro=config.testOnly?'TEST EMAIL — fictional nomination for the rehearsal site.\n\n':'';
    let text=intro+`Hi ${source.nomination.nominee.name},\n\n${source.nomination.nominator.name} has nominated you for our first Lifelong Learner Pass.\n\nComplete your application:\n${url.href}\n\nOne free one-hour automatic driving lesson each week until you pass your practical test.\n\nIf you are selected, you will receive:\n\n• One free one-hour automatic driving lesson every week until you pass.\n• 1.5 hours of car use for every practical test attempt.\n• The £2,000 Lifelong Learner Pass free of charge.\n\nYou pay for your DVSA test bookings.\n\nThe main prize is for residents of RG1, RG2, RG5 or RG6, aged 17+ with a valid provisional licence and no driving disqualification. You can apply before passing your theory test or booking a practical test, but both a theory pass and a practical test booking in Reading are required before lessons start. Weekly lesson cancellation conditions apply; see the full terms on your application page.\n\nIf you would like to take part, complete your application by ${deadline} (UK time). One person will receive the Pass following a review of the nominations and applications. We will give equal importance to the difference driving would make to your everyday life and the barriers these free lessons could help you overcome. A nomination is an invitation to apply, not confirmation that you have won. The planned winner announcement is on Monday 19 October 2026; we will contact the winner by email and phone, with five days to respond, after which we will select a new winner if we have not received a response.\n\nKeep this personal link private. If you were not expecting this invitation, you can ignore it or reply to us. Applying does not sign you up for marketing.\n\nHow we use your information, where it came from and your rights:\n${privacyUrl}\n\nCoachCarter`;
    if (confirmation) text=intro+`Hi ${source.nomination.nominator.name},\n\nYour nomination for ${source.nomination.nominee.name} has been submitted. Thank you for putting them forward.\n\n${source.invitation_status==='accepted_by_provider'?'We have also emailed your nominee their private application link.':'Their private application link is below. You can send it directly to them even if their invitation email has not arrived.'}\n\nYou can also copy this link and send it to your nominee to ensure they definitely receive the link so they can submit before the deadline:\n${url.href}\n\nThey must complete their application by ${deadline} (UK time). A nomination alone is not a completed application.\n\nShare this personal link only with your nominee; it gives access to their application. Please do not post it publicly.\n\nThis email confirms your nomination and does not sign you or your nominee up for promotional emails. If you need help, reply to this email.\n\nCampaign privacy notice:\n${privacyUrl}\n\nCoachCarter`;
    const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f8f6f1;color:#272727;font:17px/1.6 Arial,sans-serif"><main style="max-width:580px;margin:32px auto;padding:32px;background:white;border-radius:16px"><p style="font-weight:bold">CoachCarter</p><div style="padding:24px;background:#272727;color:white;border-radius:12px"><p style="margin:0 0 12px;color:#f58321">SOMEONE BELIEVES IN YOU</p><h1 style="font-size:32px;line-height:1.15;margin:0">Lifelong<br><span style="color:#f58321">Learner Pass</span></h1><p style="margin:18px 0 0;font-size:20px;line-height:1.4">${confirmation?'Your nomination has been submitted':'One free one-hour automatic driving lesson each week until you pass your practical test.'}</p></div>${text.split('\n\n').filter(p=>confirmation || p!=='One free one-hour automatic driving lesson each week until you pass your practical test.').map(p=>p.startsWith('• ')?`<ul style="padding-left:24px">${p.split('\n').map(line=>`<li style="margin:8px 0">${esc(line.slice(2))}</li>`).join('')}</ul>`:`<p>${esc(p).replace(/\n/g,'<br>').replace(esc(privacyUrl),`<a href="${esc(privacyUrl)}">Campaign privacy notice</a>`).replace(esc(url.href),`<a href="${esc(url.href)}" style="display:inline-block;background:#f58321;color:#272727;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${confirmation?'Your nominee’s application link':'Complete my application ↗'}</a>`)}</p>`).join('')}</main></body></html>`;
    const idempotencyKey='giveaway-'+createHash('sha256').update(`${source.school_id}:${source.campaign_key}:${source.id}:${confirmation?'nominator-confirmation-v1':'invitation-v1'}`).digest('hex');
    const result=await transport.send({from:`CoachCarter <${config.from}>`,reply_to:config.replyTo,to:[to],subject:(config.testOnly?'[TEST] ':'')+(confirmation?'Your nomination has been submitted':'You’ve been nominated for a Lifelong Learner Pass'),text,html},idempotencyKey);
    if(result?.accepted!==true || !/^[A-Za-z0-9_-]{1,100}$/.test(result.id || '')) throw Error('Unconfirmed invitation');
    return {accepted:true,receipt:{provider:'resend',id:result.id}};
  };
}
// Separate activation gate. No implicit retries: timeout/error is uncertain forever
// until an operator has terminal provider evidence. A 24h idempotency key is extra defence.
function resendTransport({apiKey,enabled=false,fetchImpl=fetch}) {
  return {async send(message,idempotencyKey){
    if(enabled!==true || !apiKey) throw Error('Invitation sender disabled');
    try {
      const r=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(message)});
      if(!r.ok) throw Error('Provider failure');const data=await r.json();
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(data.id||'')) throw Error('Missing receipt');
      return {accepted:true,id:data.id};
    } catch {throw Error('Invitation send uncertain');}
  }};
}
module.exports={invitationHandler,resendTransport};
