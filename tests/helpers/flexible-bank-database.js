'use strict';

const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const readMigration = name => fs.readFileSync(path.join(__dirname, '../../db/migrations', name), 'utf8');
const content = {
  name: '15-hour Flexible Hours package',
  entitlement: { units: 30, hours: 15, unit_minutes: 30, scope: 'school' },
  consumer_rights: {
    disclosure_version: 'flexible-hours-consumer-rights-v1',
    checkout_acknowledgement: 'I accept the Flexible Hours terms.',
    immediate_access_request: 'I expressly request immediate access during the 14-day cancellation period.',
  },
};

async function createBankDatabase() {
  const db = new PGlite();
  // Minimal unrelated foundations; all package tables, FKs, views and append-only
  // triggers are taken from the actual production migrations, not SQL mocks.
  await db.exec(`
    CREATE TABLE schools (id INTEGER PRIMARY KEY, active BOOLEAN DEFAULT TRUE, config JSONB, primary_host TEXT);
    CREATE TABLE learner_users (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, email_verified BOOLEAN DEFAULT TRUE,
      name TEXT, email TEXT, balance_minutes INTEGER DEFAULT 0, UNIQUE(id,school_id));
    CREATE TABLE instructors (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, name TEXT, UNIQUE(id,school_id));
    CREATE TABLE admin_users (id INTEGER PRIMARY KEY);
    CREATE TABLE lesson_bookings (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, UNIQUE(id,school_id));
    CREATE TABLE package_products (id BIGINT PRIMARY KEY, school_id INTEGER NOT NULL, slug TEXT, product_type TEXT,
      active BOOLEAN DEFAULT TRUE, visible BOOLEAN DEFAULT TRUE, sort_order INTEGER DEFAULT 1, UNIQUE(id,school_id));
    CREATE TABLE package_product_versions (id BIGINT PRIMARY KEY, school_id INTEGER NOT NULL, product_id BIGINT,
      version_number INTEGER DEFAULT 1, price_pence INTEGER, currency TEXT, content JSONB, customer_terms_version TEXT,
      effective_from TIMESTAMPTZ DEFAULT '2026-01-01', UNIQUE(id,school_id), UNIQUE(id,school_id,product_id));
    CREATE TABLE audit_log (id BIGSERIAL PRIMARY KEY, admin_id INTEGER, admin_email TEXT, action TEXT,
      target_type TEXT, target_id INTEGER, details JSONB, ip_address TEXT, school_id INTEGER);
  `);
  const packageSql = readMigration('050_flexible_hours_packages.sql');
  await db.exec(packageSql.slice(packageSql.indexOf('CREATE TABLE IF NOT EXISTS flexible_package_purchase_attempts')));
  await db.exec(readMigration('051_flexible_hours_credit_flow.sql'));
  // Columns installed by 068; the bank slice never creates a post-trial quote.
  await db.exec(`ALTER TABLE flexible_package_purchases ADD COLUMN post_trial_quote_id UUID;`);
  await db.exec(readMigration('072_flexible_bank_transfer_purchases.sql'));
  await db.exec(`
    INSERT INTO schools(id,active,config) VALUES (1,TRUE,'{"features":{"learner_flexible_package_purchasing_live_enabled":true}}'),(2,TRUE,'{}');
    INSERT INTO learner_users(id,school_id,name,email) VALUES (41,1,'Alex Example','alex@example.test'),(42,1,'Sam Example','sam@example.test'),(99,2,'Other School','other@example.test');
    INSERT INTO instructors(id,school_id) VALUES (1,1);
    INSERT INTO admin_users VALUES (1);
    INSERT INTO lesson_bookings VALUES (501,1);
    INSERT INTO package_products(id,school_id,slug,product_type) VALUES (20,1,'flexible-15-hours','flexible_hours'),(21,2,'flexible-15-hours','flexible_hours');
  `);
  await db.query(`INSERT INTO package_product_versions(id,school_id,product_id,price_pence,currency,content,customer_terms_version)
    VALUES (30,1,20,81000,'GBP',$1::jsonb,'flexible-hours-v1'),(31,2,21,81000,'GBP',$1::jsonb,'flexible-hours-v1')`, [JSON.stringify(content)]);
  return db;
}

module.exports = { createBankDatabase, content };
