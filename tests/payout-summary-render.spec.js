const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderPayoutSummaryHtml, money } = require('../api/_payout-summary-html');
const { referenceWeek } = require('../scripts/payout-fixture.cjs');

const REFERENCE_PNG = path.join(__dirname, '..', 'docs', 'payout', 'reference-output.png');

/**
 * Why this test is structural rather than a byte comparison.
 *
 * docs/payout/reference-output.png was produced by docs/payout/payout_renderer.py
 * with Pillow. This renderer is HTML captured by Chromium. Two different
 * rasterisers will never agree pixel for pixel on glyph edges, and the reference
 * was additionally drawn with an older Bricolage Grotesque release than Google
 * Fonts now ships — title ink measures 533px there against 540px now.
 *
 * A strict equality assertion would therefore fail on a font update, a Pillow
 * update or a Chromium update while nothing was actually broken, and the
 * resulting noise would mask a real regression. What must not change is the
 * geometry: canvas size, band and card positions, row pitch, solid fills, and
 * the totals. Those are asserted exactly; glyph pixels are given a tolerance.
 *
 * See docs/payout/fonts/README.md for the measured variance.
 */

/**
 * Measure both images inside the browser and return only the summary numbers.
 *
 * Playwright ships Chromium, so no PNG decoder dependency is needed. The
 * measurement runs in-page rather than shipping ~11MB of RGBA per image back
 * over the CDP bridge, which is slow enough to exceed the test timeout.
 */
async function measure(page, renderedFile, referenceFile) {
  const payload = {
    rendered: fs.readFileSync(renderedFile).toString('base64'),
    reference: fs.readFileSync(referenceFile).toString('base64'),
  };
  return page.evaluate(async ({ rendered, reference }) => {
    async function load(b64) {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
    }
    const px = (im, x, y) => {
      const i = (im.w * y + x) << 2;
      return [im.d[i], im.d[i + 1], im.d[i + 2]];
    };
    const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    const dividers = (im) => {
      const out = [];
      for (let y = 380; y < 1840; y += 1) if (same(px(im, 500, y), [226, 224, 220])) out.push(y);
      return out;
    };
    const profile = (im) => {
      const rows = new Array(im.h).fill(0);
      for (let y = 0; y < im.h; y += 1) {
        for (let x = 0; x < im.w; x += 2) {
          const i = (im.w * y + x) << 2;
          if ((im.d[i] + im.d[i + 1] + im.d[i + 2]) / 3 < 200) rows[y] += 1;
        }
      }
      return rows;
    };
    const corr = (a, b) => {
      const mean = (v) => v.reduce((s, n) => s + n, 0) / v.length;
      const ma = mean(a); const mb = mean(b);
      let n = 0; let da = 0; let db = 0;
      for (let i = 0; i < a.length; i += 1) {
        n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
      }
      return n / Math.sqrt(da * db);
    };

    const R = await load(rendered);
    const F = await load(reference);
    const probes = [
      ['orange rule', 500, 5, [245, 131, 33]],
      ['header band', 500, 200, [39, 39, 39]],
      ['card fill', 500, 700, [255, 255, 255]],
      ['green spine', 54, 700, [26, 158, 92]],
      ['page background', 20, 1845, [247, 246, 244]],
      ['net card', 500, 2250, [39, 39, 39]],
    ].map(([name, x, y, want]) => ({
      name,
      rendered: same(px(R, x, y), want),
      reference: same(px(F, x, y), want),
    }));

    const dr = dividers(R); const df = dividers(F);
    return {
      rendered: { w: R.w, h: R.h },
      reference: { w: F.w, h: F.h },
      probes,
      dividerCounts: [dr.length, df.length],
      dividerMaxDelta: dr.length === df.length
        ? Math.max(...dr.map((v, i) => Math.abs(v - df[i])), 0) : null,
      correlation: R.h === F.h ? corr(profile(F), profile(R)) : null,
    };
  }, payload);
}

function eq(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

async function renderFixturePng(page) {
  const { summary } = referenceWeek();
  const html = renderPayoutSummaryHtml(summary, {
    periodLabel: '11 – 18 Sep 2026',
    footer: 'Midday Fri 11 – midday Fri 18 September 2026  ·  17 lessons  ·  22 hours',
  });
  await page.setViewportSize({ width: 1080, height: 800 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(os.tmpdir(), `payout-render-${process.pid}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

test.describe('payout summary render — geometry matches the reference exactly', () => {
  test('canvas, fills, dividers and ink profile all match', async ({ page }) => {
    const file = await renderFixturePng(page);
    const m = await measure(page, file, REFERENCE_PNG);
    fs.unlinkSync(file);

    // Canvas — spec §6.1: 1080px fixed width, height cropped to content.
    expect(m.rendered.w).toBe(1080);
    expect(m.rendered.h).toBe(m.reference.h);

    // Spec §6.2 tokens at known positions. A colour change or a shifted band
    // breaks these immediately; a font change cannot.
    for (const probe of m.probes) {
      expect(probe.reference, `${probe.name} in reference`).toBe(true);
      expect(probe.rendered, `${probe.name} in rendered`).toBe(true);
    }

    // Row pitch. Same count, and each divider within 2px — PIL draws a 2px
    // line, Chromium paints a 2px box, and they can disagree on the edge.
    expect(m.dividerCounts[0]).toBe(m.dividerCounts[1]);
    expect(m.dividerMaxDelta).toBeLessThanOrEqual(2);

    // Every element on the same row. Glyph rasterisation moves this a little;
    // a shifted row or a dropped line moves it a lot.
    expect(m.correlation).toBeGreaterThan(0.98);
  });
});

test.describe('render refuses rather than showing a total that does not reconcile', () => {
  const base = () => referenceWeek().summary;

  test('a subtotal that disagrees with its lines is refused', () => {
    const summary = base();
    summary.totals.subtotal_pence += 1;
    expect(() => renderPayoutSummaryHtml(summary)).toThrow(/does not equal the sum of lines/);
  });

  test('deductions that disagree with their lines are refused', () => {
    const summary = base();
    summary.totals.deducted_pence += 100;
    expect(() => renderPayoutSummaryHtml(summary)).toThrow(/does not equal the sum of lines/);
  });

  test('a net that is not subtotal minus deductions is refused', () => {
    const summary = base();
    summary.totals.net_pence += 1;
    expect(() => renderPayoutSummaryHtml(summary)).toThrow(/net does not reconcile/);
  });

  test('the reference fixture itself renders', () => {
    expect(() => renderPayoutSummaryHtml(base())).not.toThrow();
  });
});

test.describe('money formatting (spec §6.5: always 2dp, always £)', () => {
  test('thousands separator and two decimals', () => {
    expect(money(100896)).toBe('£1,008.96');
    expect(money(4857)).toBe('£48.57');
    expect(money(3000)).toBe('£30.00');
    expect(money(0)).toBe('£0.00');
  });

  test('a negative net renders with the sign outside the symbol', () => {
    expect(money(-4143)).toBe('-£41.43');
  });
});

test.describe('markup carries the spec constraints', () => {
  test('money is never set in Bricolage (spec §6.3)', () => {
    const html = renderPayoutSummaryHtml(referenceWeek().summary);
    // Bricolage is display only: the two title lines and nothing else. Its £
    // glyph renders poorly at large sizes, which was a real defect found in
    // testing, so every money element must resolve to Lato.
    const css = html.slice(html.indexOf('*{margin:0'), html.indexOf('</style>'));
    const usesBricolage = (selector) => {
      const rule = css.match(new RegExp(`\\${selector}\\{[^}]*\\}`, 's'));
      return Boolean(rule && rule[0].includes('Bricolage'));
    };
    expect(usesBricolage('.title')).toBe(true);
    for (const moneySelector of ['.net-amount', '.row-amount', '.subtotal-amount', '.net-working']) {
      expect(usesBricolage(moneySelector), `${moneySelector} must not use Bricolage`).toBe(false);
    }
    // body sets the default face, so anything not explicitly Bricolage is Lato.
    expect(css).toMatch(/body\{[^}]*font-family:'Lato'/s);
  });

  test('every rate sub-note is rendered, not dropped (spec §6.5)', () => {
    const { summary } = referenceWeek();
    const html = renderPayoutSummaryHtml(summary);
    for (const line of summary.earnings) {
      if (line.note) expect(html).toContain(line.note);
    }
  });

  test('pupil names are escaped', () => {
    const summary = referenceWeek().summary;
    summary.earnings[0].description = 'O\'Brien <script> – 1 hr';
    const html = renderPayoutSummaryHtml(summary);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
