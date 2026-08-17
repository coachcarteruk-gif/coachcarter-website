// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const aggregate = fs.readFileSync(path.join(__dirname, '..', 'db', 'migration.sql'), 'utf8');
const migration = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'migrations', '052_balance_audit_security_definer.sql'),
  'utf8'
);

for (const [label, sql] of [['aggregate', aggregate], ['standalone', migration]]) {
  test(`${label} migration keeps balance audit writes owner-controlled`, () => {
    expect(sql).toMatch(/FUNCTION\s+(?:public\.)?trg_balance_audit\(\)[\s\S]*SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path = pg_catalog, public/i);
    expect(sql).toContain('INSERT INTO public.balance_audit');
    expect(sql).toContain("pg_catalog.current_setting('application_name', true)");
    expect(sql).toMatch(/ALTER FUNCTION public\.trg_balance_audit\(\) OWNER TO neondb_owner/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.trg_balance_audit\(\) FROM PUBLIC/i);
    expect(sql).not.toMatch(/GRANT\s+(?:INSERT|ALL)[\s\S]{0,80}(?:balance_audit|balance_audit_id_seq)/i);
    expect(sql).not.toContain('cc_prod_runtime');
  });
}
