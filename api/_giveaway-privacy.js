const { createHash } = require('node:crypto');
function subjectHash(channel, value) {
  let canonical=String(value || '').trim().toLowerCase();
  if(channel==='sms') canonical=canonical.replace(/\D/g,'').replace(/^44/,'0');
  if(!['email','sms'].includes(channel)||!canonical) throw Error('Invalid suppression subject');
  return createHash('sha256').update(canonical).digest('hex');
}
async function privacyReady(sql) {
  const [row]=await sql`SELECT to_regclass('public.giveaway_nominations') IS NOT NULL AS present,
    to_regclass('public.giveaway_nominations') IS NOT NULL
    AND to_regclass('public.giveaway_consents') IS NOT NULL
    AND to_regclass('public.giveaway_jobs') IS NOT NULL
    AND to_regclass('public.giveaway_marketing_suppressions') IS NOT NULL AS ready`;
  if(row?.present && !row.ready) throw Error('Giveaway privacy migration required');
  return row?.ready===true;
}
async function exportGiveaway(sql,schoolId,email) {
  if(!await privacyReady(sql)) return [];
  // Read-only operations; caller supplies authenticated school and verified identity.
  return require('../tools/giveaway/database.cjs').createDatabase({transaction:cb=>cb(sql)}).exportForEmail(schoolId,email);
}
// These queries join the authenticated deletion subject before its learner row is
// removed. Add them to the existing atomic transaction, never execute separately.
function learnerErasureQueries(sql,learnerId) {
  return [
    sql`INSERT INTO giveaway_marketing_suppressions(school_id,channel,subject_hash)
      SELECT DISTINCT n.school_id,v.channel,encode(sha256(convert_to(v.subject,'UTF8')),'hex')
      FROM giveaway_nominations n JOIN learner_users lu ON lu.id=${learnerId} AND lu.school_id=n.school_id
      CROSS JOIN LATERAL (VALUES (n.nomination->'nominee'),(n.nomination->'nominator')) person(contact)
      CROSS JOIN LATERAL (VALUES ('email',lower(trim(person.contact->>'email'))),
        ('sms',regexp_replace(regexp_replace(person.contact->>'phone','[^0-9]','','g'),'^44','0'))) v(channel,subject)
      WHERE lower(trim(person.contact->>'email'))=lower(trim(lu.email)) AND length(v.subject)>0
      ON CONFLICT DO NOTHING`,
    sql`UPDATE giveaway_nominations n SET erasure_requested_at=COALESCE(erasure_requested_at,clock_timestamp())
      FROM learner_users lu WHERE lu.id=${learnerId} AND lu.school_id=n.school_id
      AND (lower(trim(n.nomination->'nominee'->>'email'))=lower(trim(lu.email))
        OR lower(trim(n.nomination->'nominator'->>'email'))=lower(trim(lu.email)))`,
    sql`UPDATE giveaway_jobs j SET state='cancelled',payload='{}'::jsonb
      FROM giveaway_nominations n,learner_users lu
      WHERE lu.id=${learnerId} AND lu.school_id=n.school_id AND j.school_id=n.school_id AND j.nomination_id=n.id
      AND n.erasure_requested_at IS NOT NULL AND j.state IN ('pending','claimed')
      AND (lower(trim(n.nomination->'nominee'->>'email'))=lower(trim(lu.email))
        OR lower(trim(n.nomination->'nominator'->>'email'))=lower(trim(lu.email)))`,
  ];
}
module.exports={subjectHash,privacyReady,exportGiveaway,learnerErasureQueries};
