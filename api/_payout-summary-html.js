'use strict';

/**
 * HTML renderer for the instructor payout summary.
 *
 * Spec §8 recommends HTML + headless screenshot over server-side image
 * composition, "because the same markup then serves an in-app 'my earnings'
 * view for instructors, which removes the manual send entirely". That is also
 * the right call for this codebase specifically: MIGRATION-PLAN.md wants logic
 * server-side and the frontend a thin display layer, Playwright is already a
 * dependency, and the alternative would mean adding a Python runtime to a
 * Node/Vercel deploy purely to draw a PNG.
 *
 * Every measurement here comes from spec §6 and is verified against
 * docs/payout/reference-output.png: 1080px canvas, 330px header band, cards
 * inset 48px, green spine on earnings, orange on deductions.
 *
 * Two constraints from the spec are load-bearing in the markup:
 *
 *   §6.3  "Never set currency in Bricolage. Its £ glyph renders poorly at large
 *         sizes." All money uses Lato Black, including the 92px net figure.
 *   §6.5  The sub-note is the rate basis and "is what lets the instructor
 *         reproduce the total themselves — it is not decorative, keep it."
 *
 * Fonts are embedded as base64 rather than linked, because a headless capture
 * can fire before a network font arrives and silently render in a fallback
 * face — which changes every glyph width and breaks the layout comparison.
 */

const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'docs', 'payout', 'fonts');

// Spec §6.2. Semantic rule: green is money owed to the instructor, orange is
// money owed to the business. Never mix.
const TOKENS = {
  charcoal: '#272727',
  orange: '#F58321',
  green: '#1A9E5C',
  bg: '#F7F6F4',
  white: '#FFFFFF',
  muted: '#7A7A7A',
  body: '#555555',
  line: '#E2E0DC',
  headerSub: '#B2B2B2',
  netWorking: '#A0A0A0',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function money(pence) {
  const negative = pence < 0;
  const abs = Math.abs(pence);
  const formatted = (abs / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${negative ? '-' : ''}£${formatted}`;
}

/**
 * Inline the fonts. A `@font-face` pointing at a file or CDN is a race: the
 * screenshot can be taken before the face loads, and the page then renders in
 * a fallback with different metrics. Base64 removes the race entirely.
 */
function fontFaceCss() {
  const faces = [
    ['Lato', 400, 'normal', 'Lato-Regular.ttf'],
    ['Lato', 700, 'normal', 'Lato-Bold.ttf'],
    ['Lato', 900, 'normal', 'Lato-Black.ttf'],
    ['Bricolage', 800, 'normal', 'Bricolage.ttf'],
  ];
  return faces.map(([family, weight, style, file]) => {
    const full = path.join(FONT_DIR, file);
    if (!fs.existsSync(full)) {
      throw new Error(`Payout renderer font missing: ${full}. See docs/payout/fonts/README.md.`);
    }
    const b64 = fs.readFileSync(full).toString('base64');
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};`
      + `src:url(data:font/ttf;base64,${b64}) format('truetype');font-display:block;}`;
  }).join('\n');
}

function renderRow(line) {
  const note = line.note
    ? `<div class="note">${escapeHtml(line.note)}</div>`
    : '';
  return `
      <div class="row${line.note ? '' : ' row--nonote'}">
        <div class="row-date">${escapeHtml(line.date)}</div>
        <div class="row-desc">
          <div class="desc">${escapeHtml(line.description)}</div>
          ${note}
        </div>
        <div class="row-amount">${escapeHtml(money(line.amount_pence))}</div>
      </div>`;
}

function renderCard({ label, accent, lines, subtotalPence }) {
  return `
    <section class="card card--${accent}">
      <div class="spine"></div>
      <div class="card-body">
        <div class="section-label">${escapeHtml(label)}</div>
        ${lines.map(renderRow).join('')}
        <div class="subtotal">
          <div class="subtotal-label">Subtotal</div>
          <div class="subtotal-amount">${escapeHtml(money(subtotalPence))}</div>
        </div>
      </div>
    </section>`;
}

/**
 * Build the full page.
 *
 * `summary` is the output of buildPayoutSummary. Nothing is calculated here:
 * the renderer displays what the calculation produced, so a rendering change
 * can never alter a figure.
 */
function renderPayoutSummaryHtml(summary, options = {}) {
  const {
    title = ['Weekly Payment', 'Summary'],
    eyebrow = 'COACHCARTER DRIVING SCHOOL',
    periodLabel,
    footer,
  } = options;

  // Spec §9 rule 9, enforced again at the render boundary. The calculation
  // already checks this, but a summary can be constructed or mutated by hand
  // between the two, and rendering a total that does not match its lines is the
  // one failure the whole exercise exists to prevent.
  const lineSum = summary.earnings.reduce((sum, l) => sum + l.amount_pence, 0);
  if (lineSum !== summary.totals.subtotal_pence) {
    throw new Error(`Refusing to render: subtotal ${summary.totals.subtotal_pence} does not equal the sum of lines ${lineSum}`);
  }
  const dedSum = summary.deductions.reduce((sum, l) => sum + l.amount_pence, 0);
  if (dedSum !== summary.totals.deducted_pence) {
    throw new Error(`Refusing to render: deductions ${summary.totals.deducted_pence} does not equal the sum of lines ${dedSum}`);
  }
  if (summary.totals.net_pence !== summary.totals.subtotal_pence - summary.totals.deducted_pence) {
    throw new Error('Refusing to render: net does not reconcile');
  }

  const instructorName = summary.instructor.name;
  const firstName = instructorName.split(' ')[0];
  const period = periodLabel || `${summary.period.start} – ${summary.period.end}`;

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Payout summary — ${escapeHtml(instructorName)}</title>
<style>
${fontFaceCss()}

*{margin:0;padding:0;box-sizing:border-box;}
body{
  width:1080px;
  background:${TOKENS.bg};
  font-family:'Lato',sans-serif;
  -webkit-font-smoothing:antialiased;
}

/* Header band — spec §6.4: 330px tall, 14px orange rule, 60px left margin. */
.header{height:330px;background:${TOKENS.charcoal};position:relative;padding:0 60px;}
.rule{position:absolute;top:0;left:0;right:0;height:14px;background:${TOKENS.orange};}
.eyebrow{
  position:absolute;top:66px;left:60px;
  font-weight:700;font-size:26px;color:${TOKENS.orange};
  letter-spacing:4px;line-height:1;
}
/* Bricolage is display only. Variable axes per spec §6.3: opsz 96, wght 800. */
.title{
  position:absolute;left:60px;
  font-family:'Bricolage',sans-serif;font-weight:800;
  font-variation-settings:'opsz' 96,'wght' 800,'wdth' 100;
  font-size:72px;color:${TOKENS.white};line-height:1;
}
.title--1{top:108px;}
.title--2{top:186px;}
.subtitle{
  position:absolute;top:282px;left:60px;
  font-size:30px;color:${TOKENS.headerSub};line-height:1;
}

/* Cards — spec §6.4: 48px gutter, 40px padding, 26px radius, 12px spine. */
.card{
  position:relative;margin:0 48px;background:${TOKENS.white};
  border-radius:26px;overflow:hidden;
}
/* Spec §6.4: first card sits 56px below the 330px header band, so its top edge
   is y=386 — matching the reference renderer's y = HDR_H + 56. */
.card:first-of-type{margin-top:56px;}
.card + .card{margin-top:40px;}
.spine{position:absolute;top:0;left:0;width:12px;height:100%;border-radius:6px;}
.card--green .spine{background:${TOKENS.green};}
.card--orange .spine{background:${TOKENS.orange};}
.card-body{padding:0 40px;}

.section-label{
  height:92px;display:flex;align-items:center;
  font-weight:900;font-size:27px;letter-spacing:3px;
}
.card--green .section-label{color:${TOKENS.green};}
.card--orange .section-label{color:${TOKENS.orange};}

/* Rows — 74px tall, description offset 200px, 2px divider inset by padding.
   The divider sits 8px ABOVE the row's bottom edge, not on it: the reference
   renderer advances ry by ROW_H and then draws at ry minus 8. A plain
   border-bottom lands 6px lower, which compounds down the card and left the
   whole page 21px short per card. */
.row{
  height:74px;display:flex;align-items:center;position:relative;
}
.row::after{
  content:'';position:absolute;left:0;right:0;bottom:8px;
  height:2px;background:${TOKENS.line};
}
.row-date{width:200px;flex:none;font-weight:700;font-size:29px;color:${TOKENS.charcoal};}
.row-desc{flex:1;min-width:0;}
.desc{font-size:29px;color:${TOKENS.body};line-height:1.1;}
/* Spec §6.4: a row with a sub-note shifts the description up and places the
   note below it; a row without one is vertically centred. */
.note{font-size:22px;color:${TOKENS.muted};line-height:1.1;margin-top:6px;}
.row-amount{
  flex:none;text-align:right;
  font-weight:700;font-size:33px;color:${TOKENS.charcoal};
}

.subtotal{height:88px;display:flex;align-items:center;}
.subtotal-label{flex:1;font-weight:700;font-size:29px;color:${TOKENS.muted};}
.subtotal-amount{font-weight:900;font-size:42px;}
.card--green .subtotal-amount{color:${TOKENS.green};}
.card--orange .subtotal-amount{color:${TOKENS.orange};}

/* Net card — 210px tall, charcoal. Money in Lato Black, never Bricolage. */
.net{
  margin:48px 48px 0;height:210px;background:${TOKENS.charcoal};
  border-radius:26px;padding:0 40px;position:relative;
}
.net-label{
  position:absolute;top:42px;left:40px;
  font-weight:900;font-size:28px;color:${TOKENS.orange};letter-spacing:3px;line-height:1;
}
.net-amount{
  position:absolute;top:84px;left:40px;
  font-weight:900;font-size:92px;color:${TOKENS.white};line-height:1;
}
.net-working{
  position:absolute;top:132px;right:40px;
  font-size:28px;color:${TOKENS.netWorking};line-height:1;
}

/* Spec §6.4: 46px below the net card, 92px of padding after.
   The reference renderer measures that 92px from the footer's TEXT ORIGIN
   (it draws at y, then crops at y + FOOTER_PAD), not from the bottom of the
   line box. A CSS margin measures from the line box, which sits ~32px lower —
   so the page came out 32px taller with identical content. line-height:1 and a
   reduced bottom margin put the crop back where the reference has it. */
.footer{
  margin:46px 0 66px;padding:0 54px;
  font-size:26px;line-height:1;color:${TOKENS.muted};
}
</style>
</head>
<body>
  <header class="header">
    <div class="rule"></div>
    <div class="eyebrow">${escapeHtml(eyebrow)}</div>
    <div class="title title--1">${escapeHtml(title[0])}</div>
    <div class="title title--2">${escapeHtml(title[1])}</div>
    <div class="subtitle">${escapeHtml(instructorName)}&nbsp;&nbsp;·&nbsp;&nbsp;${escapeHtml(period)}</div>
  </header>

${renderCard({
    label: `COACHCARTER OWES ${firstName.toUpperCase()}`,
    accent: 'green',
    lines: summary.earnings,
    subtotalPence: summary.totals.subtotal_pence,
  })}

${renderCard({
    label: `${firstName.toUpperCase()} OWES COACHCARTER`,
    accent: 'orange',
    lines: summary.deductions,
    subtotalPence: summary.totals.deducted_pence,
  })}

  <section class="net">
    <div class="net-label">NET PAYABLE TO ${escapeHtml(firstName.toUpperCase())}</div>
    <div class="net-amount">${escapeHtml(money(summary.totals.net_pence))}</div>
    <div class="net-working">${escapeHtml(money(summary.totals.subtotal_pence))}&nbsp;&nbsp;–&nbsp;&nbsp;${escapeHtml(money(summary.totals.deducted_pence))}</div>
  </section>

  <div class="footer">${escapeHtml(footer || '')}</div>
</body>
</html>`;
}

/**
 * Spec §6.6: state the midday boundary explicitly. "It pre-empts the most
 * common instructor query."
 */
function buildFooter(summary, { periodStartLabel, periodEndLabel, monthYear }) {
  const hours = Number.isInteger(summary.counts.hours)
    ? summary.counts.hours
    : Number(summary.counts.hours.toFixed(1));
  return `Midday ${periodStartLabel} – midday ${periodEndLabel} ${monthYear}`
    + `  ·  ${summary.counts.lessons} lessons  ·  ${hours} hours`;
}

module.exports = {
  TOKENS,
  money,
  renderPayoutSummaryHtml,
  buildFooter,
};
