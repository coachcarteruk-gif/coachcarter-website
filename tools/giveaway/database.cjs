// Repository only: no environment loading, connection, route, cron or live sender.
const crypto = require('node:crypto');
const { subjectHash } = require('../../api/_giveaway-privacy');
const { nomination, application, InputError, WORDING } = require('./domain.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = () => crypto.randomUUID();
const unavailable = () => { throw new InputError({}, 404, 'This invitation is unavailable.'); };
const scope = id => { if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid school scope'); };

// Works with an injected pg/Neon Pool client or PGlite transaction client.
function tagged(client) {
  return async (parts, ...values) => (await client.query(parts.reduce((sql, part, index) => sql + (index ? '$' + index : '') + part, ''), values)).rows;
}
function poolTransactions(pool) {
  return async callback => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await callback(tagged(client)); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
}
function tokenVault(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A dedicated 32-byte invitation encryption key is required');
  return {
    seal(token, context) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
    },
    open(envelope, context) {
      const bytes = Buffer.from(envelope, 'base64url'), decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
function createDatabase({ transaction, vault }) {
  async function job(sql, school, id, kind, event, payload = {}) {
    await sql`INSERT INTO giveaway_jobs(school_id,id,nomination_id,kind,event_key,payload)
      VALUES (${school},${uuid()},${id},${kind},${event},${JSON.stringify(payload)}::jsonb) ON CONFLICT DO NOTHING`;
  }
  async function find(sql, school, token) {
    const [row] = await sql`SELECT * FROM giveaway_nominations WHERE school_id=${school}
      AND token_hash=${hash(String(token || ''))} AND erasure_requested_at IS NULL FOR UPDATE`;
    if (!row) unavailable(); return row;
  }
  async function open(sql, school, campaign) {
    const [row] = await sql`SELECT * FROM giveaway_campaigns WHERE school_id=${school} AND campaign_key=${campaign}
      AND enabled=TRUE AND closes_at>clock_timestamp() FOR SHARE`;
    if (!row) throw new InputError({}, 410, 'Applications have closed or are not yet open.');
    return row;
  }
  return {
    async nominate(school, campaign, body) {
      scope(school); if (body.website) return { ok: true };
      const data = nomination(body);
      return transaction(async sql => {
        await open(sql, school, campaign);
        const id = uuid(), token = crypto.randomBytes(32).toString('base64url');
        const [{ timestamp }] = await sql`SELECT clock_timestamp() AS timestamp`;
        data.permission = { wording: WORDING.permission, version: 'giveaway-v1', accepted_at: timestamp };
        const rows = await sql`INSERT INTO giveaway_nominations(school_id,id,campaign_key,submission_key,pair_hash,token_hash,nomination)
          VALUES (${school},${id},${campaign},${body.submission_key},${hash(JSON.stringify([data.nominee.email,data.nominator.email]))},${hash(token)},${JSON.stringify(data)}::jsonb)
          ON CONFLICT DO NOTHING RETURNING id`;
        if (rows.length) {
          await job(sql, school, id, 'invitation', 'nomination', { sealed_token: vault.seal(token, `${school}:${id}`) });
          await job(sql, school, id, 'crm', 'nomination');
        }
        return { ok: true };
      });
    },
    async inspect(school, token) {
      scope(school); return transaction(async sql => {
        const row = await find(sql, school, token);
        if (row.application) return { ok: true, completed: true, submitted_at: row.submitted_at };
        await open(sql, school, row.campaign_key);
        return { ok: true, completed: false, nominator_name: row.nomination.nominator.name, nominee: row.nomination.nominee };
      });
    },
    async apply(school, token, body) {
      scope(school); return transaction(async sql => {
        const row = await find(sql, school, token);
        if (row.application) return { ok: true, completed: true };
        await open(sql, school, row.campaign_key); const data = application(body);
        await sql`UPDATE giveaway_nominations SET application=${JSON.stringify(data)}::jsonb,submitted_at=clock_timestamp()
          WHERE school_id=${school} AND id=${row.id}`;
        for (const channel of ['email','sms']) await sql`INSERT INTO giveaway_consents(school_id,nomination_id,channel,granted,wording,version)
          VALUES (${school},${row.id},${channel},${data.marketing[channel]},${WORDING[channel]},'giveaway-v1')`;
        await job(sql, school, row.id, 'crm', 'application'); return { ok: true, completed: true };
      });
    },
    async withdraw(school, token) {
      scope(school); return transaction(async sql => {
        const row = await find(sql, school, token);
        for (const channel of ['email','sms']) {
          const key=subjectHash(channel,row.nomination.nominee[channel==='email'?'email':'phone']);
          await sql`INSERT INTO giveaway_marketing_suppressions(school_id,channel,subject_hash)
            VALUES (${school},${channel},${key}) ON CONFLICT DO NOTHING`;
        }
        const changed = await sql`UPDATE giveaway_consents SET withdrawn_at=clock_timestamp() WHERE school_id=${school}
          AND nomination_id=${row.id} AND granted=TRUE AND withdrawn_at IS NULL RETURNING channel`;
        await job(sql, school, row.id, 'suppression', 'withdrawal');
        return { ok: true };
      });
    },
    async mayMarket(school,id,channel) {
      scope(school);if(!['email','sms'].includes(channel)) throw Error('Invalid channel');
      return transaction(async sql=>{
        const [row]=await sql`SELECT nomination FROM giveaway_nominations WHERE school_id=${school} AND id=${id}
          AND erasure_requested_at IS NULL AND application IS NOT NULL`;
        if(!row)return false;
        const key=subjectHash(channel,row.nomination.nominee[channel==='email'?'email':'phone']);
        const [consent]=await sql`SELECT granted,withdrawn_at FROM giveaway_consents WHERE school_id=${school} AND nomination_id=${id} AND channel=${channel}`;
        const blocked=await sql`SELECT 1 FROM giveaway_marketing_suppressions WHERE school_id=${school} AND channel=${channel} AND subject_hash=${key}`;
        return consent?.granted===true && !consent.withdrawn_at && blocked.length===0;
      });
    },
    async claim(school, kind) {
      scope(school); return transaction(async sql => {
        // A crash after dispatch started is ambiguous, never automatically replayed.
        await sql`UPDATE giveaway_jobs SET state='uncertain' WHERE school_id=${school} AND state='dispatching' AND lease_until<clock_timestamp()`;
        const token = uuid();
        const rows = await sql`WITH candidate AS (
          SELECT j.id FROM giveaway_jobs j JOIN giveaway_nominations n ON n.school_id=j.school_id AND n.id=j.nomination_id
          WHERE j.school_id=${school} AND j.kind=${kind} AND n.erasure_requested_at IS NULL
          AND (j.state='pending' OR (j.state='claimed' AND j.lease_until<clock_timestamp())) AND j.available_at<=clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM giveaway_jobs older WHERE older.school_id=j.school_id AND older.nomination_id=j.nomination_id
            AND older.kind=j.kind AND older.id<>j.id AND (older.state IN ('dispatching','uncertain') OR
              (older.state IN ('pending','claimed') AND (older.created_at,older.id)<(j.created_at,j.id))))
          ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
          UPDATE giveaway_jobs SET state='claimed',claim_token=${token},lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1
          WHERE school_id=${school} AND id IN (SELECT id FROM candidate) RETURNING *`;
        return rows[0] || null;
      });
    },
    async loadClaim(school, id, claim) {
      scope(school); return transaction(async sql => {
        const [row] = await sql`SELECT n.*,j.kind FROM giveaway_jobs j JOIN giveaway_nominations n
          ON n.school_id=j.school_id AND n.id=j.nomination_id
          WHERE j.school_id=${school} AND j.id=${id} AND j.claim_token=${claim}
          AND j.state='claimed' AND j.lease_until>clock_timestamp() AND n.erasure_requested_at IS NULL`;
        if (!row) throw Error('Claim ownership lost');
        return row;
      });
    },
    // Only a live pre-dispatch claim may be deferred. Never resets uncertain work.
    async deferClaim(school, id, claim) {
      scope(school); return transaction(async sql => {
        const rows = await sql`UPDATE giveaway_jobs SET state='pending',claim_token=NULL,lease_until=NULL,
          available_at=clock_timestamp()+interval '5 minutes'
          WHERE school_id=${school} AND id=${id} AND claim_token=${claim}
          AND state='claimed' AND lease_until>clock_timestamp() RETURNING id`;
        return rows.length===1;
      });
    },
    async beginDispatch(school, id, claim) {
      scope(school); return transaction(async sql => {
        const rows = await sql`UPDATE giveaway_jobs j SET state='dispatching' WHERE j.school_id=${school} AND j.id=${id}
          AND j.claim_token=${claim} AND j.state='claimed' AND j.lease_until>clock_timestamp()
          AND EXISTS (SELECT 1 FROM giveaway_nominations n WHERE n.school_id=j.school_id AND n.id=j.nomination_id AND n.erasure_requested_at IS NULL)
          RETURNING j.id`;
        return rows.length === 1;
      });
    },
    async complete(school, id, claim, accepted, receipt) {
      const safeReceipt = receipt?.provider === 'resend' && /^[A-Za-z0-9_-]{1,100}$/.test(receipt.id || '')
        ? { provider: 'resend', id: receipt.id } : {};
      scope(school); return transaction(async sql => {
        const rows = await sql`UPDATE giveaway_jobs SET state=${accepted === true ? 'succeeded' : 'uncertain'},completed_at=clock_timestamp(),
          payload=CASE WHEN ${accepted === true} THEN ${JSON.stringify(safeReceipt)}::jsonb ELSE payload END
          WHERE school_id=${school} AND id=${id} AND claim_token=${claim} AND state='dispatching' RETURNING id,nomination_id,kind`;
        if (rows.length && accepted === true && rows[0].kind === 'invitation') await job(sql, school, rows[0].nomination_id, 'crm', 'invitation-accepted');
        return rows.length === 1;
      });
    },
    async loadDispatch(school, id, claim) {
      scope(school); return transaction(async sql => {
        const [row] = await sql`SELECT n.*,j.kind,j.payload,c.enabled AS campaign_enabled,c.closes_at FROM giveaway_jobs j JOIN giveaway_nominations n
          ON n.school_id=j.school_id AND n.id=j.nomination_id
          JOIN giveaway_campaigns c ON c.school_id=n.school_id AND c.campaign_key=n.campaign_key
          WHERE j.school_id=${school} AND j.id=${id}
          AND j.claim_token=${claim} AND j.state='dispatching' AND j.lease_until>clock_timestamp() AND n.erasure_requested_at IS NULL`;
        if (!row) throw new Error('Dispatch ownership lost');
        const [invitation] = await sql`SELECT state FROM giveaway_jobs WHERE school_id=${school} AND nomination_id=${row.id} AND kind='invitation'`;
        return { ...row, invitation_status: invitation?.state === 'succeeded' ? 'accepted_by_provider' : invitation?.state === 'uncertain' ? 'uncertain' : 'queued' };
      });
    },
    async saveCrmState(school, id, claim, state) {
      scope(school); return transaction(async sql => {
        const rows = await sql`UPDATE giveaway_nominations n SET crm_state=(${JSON.stringify(state)}::jsonb-'contact_provisioning'-'provider_cleanup') ||
          CASE WHEN n.crm_state ? 'contact_provisioning' THEN jsonb_build_object('contact_provisioning',n.crm_state->'contact_provisioning') ELSE '{}'::jsonb END ||
          CASE WHEN n.crm_state ? 'provider_cleanup' THEN jsonb_build_object('provider_cleanup',n.crm_state->'provider_cleanup') ELSE '{}'::jsonb END FROM giveaway_jobs j
          WHERE j.school_id=${school} AND j.id=${id} AND j.claim_token=${claim} AND j.state='dispatching'
          AND j.lease_until>clock_timestamp() AND n.school_id=j.school_id AND n.id=j.nomination_id AND n.erasure_requested_at IS NULL RETURNING n.id`;
        if (!rows.length) throw new Error('Dispatch ownership lost');
      });
    },
    // Caller must authenticate/verify this email. Export each person's own answers only.
    async exportForEmail(school, verifiedEmail) {
      scope(school); const email = String(verifiedEmail).trim().toLowerCase();
      return transaction(async sql => {
        const rows = await sql`SELECT id,nomination,application,created_at,submitted_at FROM giveaway_nominations WHERE school_id=${school}
          AND (nomination->'nominee'->>'email'=${email} OR nomination->'nominator'->>'email'=${email})`;
        const mappings = await sql`SELECT crm_state FROM giveaway_nominations WHERE school_id=${school}
          AND (crm_state ? 'contact_provisioning' OR crm_state ? 'contacts')`;
        const {contactReferences}=require('./privacy-references.cjs');
        const result = [];
        for (const row of rows) {
          if (row.nomination.nominee.email === email) {
            const consents = await sql`SELECT channel,granted,wording,version,recorded_at,withdrawn_at FROM giveaway_consents WHERE school_id=${school} AND nomination_id=${row.id}`;
            const suppression = [];
            for (const channel of ['email','sms']) {
              const key=subjectHash(channel,row.nomination.nominee[channel==='email'?'email':'phone']);
              const entries=await sql`SELECT channel,recorded_at FROM giveaway_marketing_suppressions
                WHERE school_id=${school} AND channel=${channel} AND subject_hash=${key}`;
              suppression.push(...entries);
            }
            result.push({ role: 'nominee', id: row.id, contact: row.nomination.nominee, application: row.application, consents, suppression, provider_contacts:contactReferences(mappings,row.nomination.nominee,school) });
          }
          if (row.nomination.nominator.email === email) result.push({ role: 'nominator', id: row.id, contact: row.nomination.nominator,
            reason: row.nomination.reason, relationship: row.nomination.relationship, permission: row.nomination.permission, created_at: row.created_at, provider_contacts:contactReferences(mappings,row.nomination.nominator,school) });
        }
        return result;
      });
    },
    // Flag due records; do not silently erase mappings needed for external cleanup.
    async requestRetention(school) {
      scope(school); return transaction(async sql => {
        const rows = await sql`UPDATE giveaway_nominations n SET erasure_requested_at=clock_timestamp() FROM giveaway_campaigns c
          WHERE n.school_id=${school} AND c.school_id=n.school_id AND c.campaign_key=n.campaign_key
          AND c.retain_until<=clock_timestamp() AND n.erasure_requested_at IS NULL RETURNING n.id`;
        await sql`UPDATE giveaway_jobs j SET state='cancelled',payload='{}'::jsonb WHERE j.school_id=${school} AND j.state IN ('pending','claimed')
          AND EXISTS (SELECT 1 FROM giveaway_nominations n WHERE n.school_id=j.school_id AND n.id=j.nomination_id AND n.erasure_requested_at IS NOT NULL)`;
        return rows.map(row => row.id);
      });
    },
    async requestErasure(school, id) {
      scope(school); return transaction(async sql => {
        const [subject]=await sql`SELECT nomination FROM giveaway_nominations WHERE school_id=${school} AND id=${id} FOR UPDATE`;
        if(!subject) return false;
        for (const channel of ['email','sms']) {
          const key=subjectHash(channel,subject.nomination.nominee[channel==='email'?'email':'phone']);
          await sql`INSERT INTO giveaway_marketing_suppressions(school_id,channel,subject_hash)
            VALUES (${school},${channel},${key}) ON CONFLICT DO NOTHING`;
        }
        const rows = await sql`UPDATE giveaway_nominations SET erasure_requested_at=COALESCE(erasure_requested_at,clock_timestamp())
          WHERE school_id=${school} AND id=${id} RETURNING id`;
        await sql`UPDATE giveaway_jobs SET state='cancelled',payload='{}'::jsonb WHERE school_id=${school} AND nomination_id=${id} AND state IN ('pending','claimed')`;
        return rows.length === 1;
      });
    },
    async eraseAfterProviderCleanup(school, id, cleanupConfirmed) {
      scope(school); if (cleanupConfirmed !== true) throw new Error('Provider cleanup evidence required');
      return transaction(async sql => {
        const rows = await sql`DELETE FROM giveaway_nominations n WHERE n.school_id=${school} AND n.id=${id} AND n.erasure_requested_at IS NOT NULL
          AND (NOT (n.crm_state ? 'provider_cleanup') OR n.crm_state->'provider_cleanup'->>'state'='verified_absent')
          AND (NOT EXISTS (SELECT 1 FROM jsonb_each(COALESCE(n.crm_state->'operations','{}'::jsonb)) op WHERE op.key LIKE '%:record:%')
            OR n.crm_state->'provider_cleanup'->>'state'='verified_absent')
          AND NOT EXISTS (SELECT 1 FROM giveaway_nominations anchor
            CROSS JOIN LATERAL jsonb_each(COALESCE(anchor.crm_state->'contact_provisioning','{}'::jsonb)) p
            WHERE anchor.school_id=n.school_id AND (anchor.id=n.id OR p.value->>'requester_id'=n.id::text)
              AND p.value->>'state' IN ('dispatching','uncertain'))
          AND NOT EXISTS (SELECT 1 FROM giveaway_jobs j WHERE j.school_id=n.school_id AND j.nomination_id=n.id AND j.state IN ('claimed','dispatching','uncertain')) RETURNING id`;
        return rows.length === 1;
      });
    },
  };
}
module.exports = { createDatabase, tagged, poolTransactions, tokenVault };
