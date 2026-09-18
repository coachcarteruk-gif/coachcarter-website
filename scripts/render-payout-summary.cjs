#!/usr/bin/env node
/**
 * Render an instructor payout summary to PNG via headless Chromium.
 *
 * Spec §8: HTML + headless render, so the same markup can later serve an in-app
 * instructor earnings page rather than only a WhatsApp image.
 *
 * Usage:
 *   node scripts/render-payout-summary.cjs --instructor 6 --week 2026-09-11
 *   node scripts/render-payout-summary.cjs --fixture      # the reference week
 *
 * Emits, per spec §8 "Output":
 *   payout-{instructor-slug}-{week-start}.png
 *   payout-{instructor-slug}-{week-start}.json   the lines and totals, so a
 *     disputed figure traces to lesson ids without regenerating anything.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const { renderPayoutSummaryHtml, buildFooter } = require('../api/_payout-summary-html');

function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Screenshot the page.
 *
 * deviceScaleFactor stays at 1: spec §6.1 says "Render at 1× (1080 wide is
 * already retina-adequate for messaging apps)", and a 2x capture would double
 * every pixel coordinate and make comparison against the reference meaningless.
 *
 * fullPage crops to content, matching the reference renderer's img.crop().
 */
async function screenshot(html, outPath) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    // Fonts are base64-inlined, so this resolves immediately — but waiting is
    // what makes that guarantee explicit rather than incidental.
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  loadEnv();
  const outDir = arg('out', process.cwd());

  let summary;
  let periodStart;
  let periodEnd;

  if (process.argv.includes('--fixture')) {
    ({ summary, periodStart, periodEnd } = require('./payout-fixture.cjs').referenceWeek());
  } else {
    const instructorId = Number(arg('instructor'));
    periodStart = arg('week');
    if (!instructorId || !periodStart) {
      console.error('Usage: --instructor <id> --week <YYYY-MM-DD>   (or --fixture)');
      process.exit(2);
    }
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(process.env.POSTGRES_URL);
    const { buildWeek } = require('./payout-week.cjs');
    ({ summary, periodEnd } = await buildWeek(sql, { instructorId, periodStart }));
  }

  const startDate = new Date(`${periodStart}T12:00:00Z`);
  const endDate = new Date(`${periodEnd}T12:00:00Z`);
  const footer = buildFooter(summary, {
    periodStartLabel: dayLabel(periodStart),
    periodEndLabel: dayLabel(periodEnd),
    monthYear: `${MONTHS[endDate.getUTCMonth()]} ${endDate.getUTCFullYear()}`,
  });
  const periodLabel = `${startDate.getUTCDate()} – ${endDate.getUTCDate()} `
    + `${MONTHS[endDate.getUTCMonth()].slice(0, 3)} ${endDate.getUTCFullYear()}`;

  const html = renderPayoutSummaryHtml(summary, { periodLabel, footer });

  const base = `payout-${slugify(summary.instructor.name)}-${periodStart}`;
  const pngPath = path.join(outDir, `${base}.png`);
  const jsonPath = path.join(outDir, `${base}.json`);

  await screenshot(html, pngPath);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  console.log(`rendered ${pngPath}`);
  console.log(`         ${jsonPath}`);
  console.log(`  subtotal £${(summary.totals.subtotal_pence / 100).toFixed(2)}`
    + `  net £${(summary.totals.net_pence / 100).toFixed(2)}`
    + `  (${summary.counts.lessons} lessons, ${summary.counts.hours} hours)`);
  if (summary.blocked?.length) {
    console.log(`  ${summary.blocked.length} blocked:`);
    for (const b of summary.blocked) {
      console.log(`    bk#${b.lesson_id} ${b.pupil_name} — ${b.summary}`);
    }
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
