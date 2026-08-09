'use strict';

const { neon } = require('@neondatabase/serverless');
const { createAccountsV2StripeClient } = require('./_stripe-clients');
const core = require('./_connect-v2');
const store = require('./_connect-v2-store');
const { validateProviderAccount } = require('./_connect-v2-routes');
const { reportError } = require('./_error-alert');

async function getRawBody(req) {
  if (typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody)) return req.rawBody;
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function eventCreatedIso(event) {
  if (typeof event.created === 'string' && Number.isFinite(Date.parse(event.created))) return new Date(event.created).toISOString();
  if (Number.isFinite(event.created)) return new Date(event.created * 1000).toISOString();
  return null;
}

function defaultDependencies() {
  const env = process.env;
  let sql;
  return {
    env,
    getSql: () => {
      if (sql) return sql;
      if (!env.POSTGRES_URL) return null;
      sql = neon(env.POSTGRES_URL);
      return sql;
    },
    createClient: (mode) => createAccountsV2StripeClient({ expectedMode: mode }),
    now: () => new Date(),
  };
}

function createConnectV2WebhookHandler(overrides = {}) {
  const deps = { ...defaultDependencies(), ...overrides };
  let sqlResolved = false;
  let resolvedSql;
  const getSql = () => {
    if (!sqlResolved) {
      resolvedSql = Object.prototype.hasOwnProperty.call(deps, 'sql')
        ? deps.sql
        : deps.getSql();
      sqlResolved = true;
    }
    return resolvedSql;
  };
  return async function connectV2Webhook(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED' });
    const secret = deps.env.STRIPE_CONNECT_V2_WEBHOOK_SECRET;
    const signature = req.headers?.['stripe-signature'];
    if (!secret || !signature) return res.status(503).json({ error: true, code: 'CONNECT_V2_WEBHOOK_INACTIVE' });

    let event;
    let envelope;
    let stripe;
    try {
      const rawBody = await getRawBody(req);
      stripe = deps.createClient(deps.env.STRIPE_MODE);
      event = stripe.parseEventNotification(rawBody, signature, secret);
      envelope = core.validateThinEventEnvelope(event);
    } catch (error) {
      console.error('[connect-v2-webhook] signature or envelope rejected', error?.name || 'Error');
      return res.status(400).json({ error: true, code: 'CONNECT_V2_WEBHOOK_REJECTED' });
    }

    try {
      const sql = getSql();
      if (!sql) throw new Error('CONNECT_V2_DATABASE_UNAVAILABLE');
      const prior = await store.loadEventReceipt(sql, envelope.id);
      if (prior) {
        const sameEnvelope = prior.evidence_json?.event_envelope_fingerprint === envelope.fingerprint
          && prior.stripe_account_id === envelope.account_id
          && prior.event_type === envelope.type
          && prior.event_context === envelope.context;
        if (!sameEnvelope) return res.status(409).json({ error: true, code: 'CONNECT_V2_EVENT_CONTRADICTION' });
        return res.status(200).json({ received: true, duplicate: true });
      }

      const scope = await store.loadScopeByAccount(sql, envelope.account_id);
      if (!scope || scope.owner_type !== 'instructor' || !scope.school_id || !scope.instructor_id) {
        reportError('/api/webhook-connect-v2 (unknown account scope)', new Error('CONNECT_V2_UNKNOWN_ACCOUNT_SCOPE'));
        return res.status(409).json({ error: true, code: 'CONNECT_V2_UNKNOWN_ACCOUNT_SCOPE' });
      }
      const expectedContext = scope.evidence_json?.event_context;
      if (!expectedContext || expectedContext !== envelope.context) {
        reportError('/api/webhook-connect-v2 (context mismatch)', new Error('CONNECT_V2_EVENT_CONTEXT_MISMATCH'));
        return res.status(409).json({ error: true, code: 'CONNECT_V2_EVENT_CONTEXT_MISMATCH' });
      }
      const mode = scope.evidence_json?.stripe_mode;
      if (!['test', 'live'].includes(mode) || envelope.livemode !== (mode === 'live') || deps.env.STRIPE_MODE !== mode) {
        return res.status(409).json({ error: true, code: 'CONNECT_V2_EVENT_MODE_MISMATCH' });
      }
      const school = await store.loadSchoolConfig(sql, scope.school_id);
      const gate = core.evaluateConnectV2Gate({ env: deps.env, schoolConfig: school?.config, operation: 'webhook' });
      if (!gate.enabled) return res.status(202).json({ received: true, processed: false, reason: 'inactive' });

      // Accounts v2 thin events are notifications, not account snapshots.
      // This context-aware retrieval is the ordering boundary: every stored
      // observation describes provider-current state at processing time.
      const account = typeof event.fetchRelatedObject === 'function'
        ? await event.fetchRelatedObject()
        : await stripe.v2.core.accounts.retrieve(envelope.account_id, {
          include: ['configuration.recipient', 'defaults', 'identity', 'requirements', 'future_requirements'],
        }, envelope.context === 'platform' ? undefined : { stripeContext: envelope.context });
      validateProviderAccount(account, {
        schoolId: scope.school_id,
        instructorId: scope.instructor_id,
        mode,
        expectedAccountId: scope.stripe_account_id,
        expectedIntentId: scope.evidence_json.creation_intent_id,
      });
      const observedAt = deps.now().toISOString();
      const normalized = core.normalizeAccountObservation({
        account,
        schoolId: scope.school_id,
        instructorId: scope.instructor_id,
        connectScopeId: scope.id,
        expectedAccountId: scope.stripe_account_id,
        eventId: envelope.id,
        eventType: envelope.type,
        eventContext: envelope.context,
        observedAt,
        providerEventCreatedAt: eventCreatedIso(event),
      });
      await store.insertObservation(sql, {
        ...normalized,
        event_envelope_fingerprint: envelope.fingerprint,
      });
      return res.status(200).json({ received: true, processed: true });
    } catch (error) {
      console.error('[connect-v2-webhook] processing failed', error?.name || 'Error');
      reportError('/api/webhook-connect-v2 (processing)', new Error('CONNECT_V2_WEBHOOK_PROCESSING_FAILED'));
      return res.status(500).json({ error: true, code: 'CONNECT_V2_WEBHOOK_PROCESSING_FAILED' });
    }
  };
}

module.exports = createConnectV2WebhookHandler();
module.exports.createConnectV2WebhookHandler = createConnectV2WebhookHandler;
module.exports.getRawBody = getRawBody;
