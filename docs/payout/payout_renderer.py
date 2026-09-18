"""
Reference renderer for the CoachCarter instructor payout summary.

Companion to PAYOUT-SUMMARY-SPEC.md. This is the canonical output: any
reimplementation (HTML/Playwright, Canvas, etc.) should match this pixel layout
and, more importantly, these numbers.

Fonts required (Google Fonts, SIL OFL):
  Lato-Regular.ttf, Lato-Bold.ttf, Lato-Black.ttf
  BricolageGrotesque[opsz,wdth,wght].ttf  -> saved as Bricolage.ttf

Usage:
    python payout_renderer.py            # renders the 11-18 Sep 2026 fixture
"""

import math
from dataclasses import dataclass, field
from PIL import Image, ImageDraw, ImageFont

FONT_DIR = "./fonts/"

# ---------------------------------------------------------------- calculation

SHARE_RATE = 0.90
STRIPE_PCT = 0.015
STRIPE_FIXED = 0.20
FREE_TRIAL_RATE = 30.00


def truncate_2dp(x: float) -> float:
    """Truncate, never round. Applied ONCE, at the end of the calculation."""
    return math.floor(x * 100) / 100


def payout(hours: float,
           pupil_hourly_price: float = 55.00,
           *,
           free_trial: bool = False,
           stripe: bool = True,
           transaction_count: int = 1,
           share_rate: float = SHARE_RATE) -> float:
    """Instructor payout for a single lesson.

    stripe            False when the pupil paid outside Stripe (direct to bank), or
                      when the lesson is drawn from a package already charged in full.
                      No percentage AND no fixed fee are deducted.
    transaction_count Number of Stripe charges this lesson was paid across. Only
                      applies when stripe=True. See "Open decision" in the spec:
                      set this from real charge data, never guess.
    """
    if free_trial:
        return truncate_2dp(FREE_TRIAL_RATE * hours)
    gross = pupil_hourly_price * hours
    fee = (gross * STRIPE_PCT + STRIPE_FIXED * transaction_count) if stripe else 0.0
    return truncate_2dp((gross - fee) * share_rate)


@dataclass
class Line:
    date: str
    description: str
    note: str
    amount: float


@dataclass
class Summary:
    instructor: str
    period: str
    earnings: list
    deductions: list
    footer: str
    title: tuple = ("Weekly Payment", "Summary")

    @property
    def subtotal(self):
        return round(sum(l.amount for l in self.earnings), 2)

    @property
    def deducted(self):
        return round(sum(l.amount for l in self.deductions), 2)

    @property
    def net(self):
        return round(self.subtotal - self.deducted, 2)

    def validate(self):
        """Every total must reconcile exactly. Raise rather than render a lie."""
        if abs(self.subtotal - sum(l.amount for l in self.earnings)) > 0.005:
            raise ValueError("earnings subtotal does not reconcile")
        if abs(self.net - (self.subtotal - self.deducted)) > 0.005:
            raise ValueError("net does not reconcile")


# ------------------------------------------------------------------- tokens

W = 1080
CHARCOAL = (39, 39, 39)
ORANGE = (245, 131, 33)
GREEN = (26, 158, 92)
BG = (247, 246, 244)
WHITE = (255, 255, 255)
MUTED = (122, 122, 122)
BODY = (85, 85, 85)
LINE = (226, 224, 220)
HEADER_SUB = (178, 178, 178)
NET_WORKING = (160, 160, 160)

HDR_H = 330
RULE_H = 14
MARGIN = 60
CARD_X0, CARD_X1 = 48, W - 48
PAD = 40
RADIUS = 26
SPINE_W = 12
SECTION_HEAD_H = 92
ROW_H = 74
DESC_OFFSET = 200
CARD_GAP = 40
NET_GAP = 48
NET_H = 210
FOOTER_PAD = 92


def bricolage(size, weight=800):
    f = ImageFont.truetype(FONT_DIR + "Bricolage.ttf", size)
    try:
        f.set_variation_by_axes([96.0, float(weight), 100.0])
    except Exception:
        pass
    return f


def lato(size, style="Regular"):
    return ImageFont.truetype(FONT_DIR + f"Lato-{style}.ttf", size)


def money(x):
    return f"£{x:,.2f}"


def draw_tracked(d, xy, text, font, fill, track=0):
    """Letter-spacing: most image libs have no native tracking."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + track


def draw_right(d, x, y, text, font, fill):
    d.text((x - d.textlength(text, font=font), y), text, font=font, fill=fill)


# ------------------------------------------------------------------- render

def render(s: Summary, path: str) -> str:
    s.validate()

    est = HDR_H + 400 + ROW_H * (len(s.earnings) + len(s.deductions)) + 800
    img = Image.new("RGB", (W, est), BG)
    d = ImageDraw.Draw(img)

    # header
    d.rectangle([0, 0, W, HDR_H], fill=CHARCOAL)
    d.rectangle([0, 0, W, RULE_H], fill=ORANGE)
    draw_tracked(d, (MARGIN, 66), "COACHCARTER DRIVING SCHOOL",
                 lato(26, "Bold"), ORANGE, track=4)
    d.text((MARGIN, 108), s.title[0], font=bricolage(72), fill=WHITE)
    d.text((MARGIN, 186), s.title[1], font=bricolage(72), fill=WHITE)
    d.text((MARGIN, 282), f"{s.instructor}  ·  {s.period}",
           font=lato(30), fill=HEADER_SUB)

    y = HDR_H + 56

    def section(y, label, accent, lines):
        body_h = SECTION_HEAD_H + ROW_H * len(lines) + 88
        d.rounded_rectangle([CARD_X0, y, CARD_X1, y + body_h],
                            radius=RADIUS, fill=WHITE)
        d.rounded_rectangle([CARD_X0, y, CARD_X0 + SPINE_W, y + body_h],
                            radius=SPINE_W // 2, fill=accent)
        draw_tracked(d, (CARD_X0 + PAD, y + 34), label,
                     lato(27, "Black"), accent, track=3)

        ry = y + SECTION_HEAD_H
        for ln in lines:
            if ln.note:
                d.text((CARD_X0 + PAD, ry + 8), ln.date, font=lato(29, "Bold"), fill=CHARCOAL)
                d.text((CARD_X0 + PAD + DESC_OFFSET, ry + 2), ln.description,
                       font=lato(29), fill=BODY)
                d.text((CARD_X0 + PAD + DESC_OFFSET, ry + 38), ln.note,
                       font=lato(22), fill=MUTED)
            else:
                d.text((CARD_X0 + PAD, ry + 16), ln.date, font=lato(29, "Bold"), fill=CHARCOAL)
                d.text((CARD_X0 + PAD + DESC_OFFSET, ry + 16), ln.description,
                       font=lato(29), fill=BODY)
            draw_right(d, CARD_X1 - PAD, ry + 12, money(ln.amount),
                       lato(33, "Bold"), CHARCOAL)
            ry += ROW_H
            d.line([CARD_X0 + PAD, ry - 8, CARD_X1 - PAD, ry - 8], fill=LINE, width=2)

        total = sum(l.amount for l in lines)
        d.text((CARD_X0 + PAD, ry + 22), "Subtotal", font=lato(29, "Bold"), fill=MUTED)
        draw_right(d, CARD_X1 - PAD, ry + 14, money(total), lato(42, "Black"), accent)
        return y + body_h

    y = section(y, "COACHCARTER OWES SIMON", GREEN, s.earnings)
    y += CARD_GAP
    y = section(y, "SIMON OWES COACHCARTER", ORANGE, s.deductions)
    y += NET_GAP

    # net card — money always in Lato, never Bricolage
    d.rounded_rectangle([CARD_X0, y, CARD_X1, y + NET_H], radius=RADIUS, fill=CHARCOAL)
    draw_tracked(d, (CARD_X0 + PAD, y + 42), "NET PAYABLE TO SIMON",
                 lato(28, "Black"), ORANGE, track=3)
    d.text((CARD_X0 + PAD, y + 84), money(s.net), font=lato(92, "Black"), fill=WHITE)
    draw_right(d, CARD_X1 - PAD, y + 132,
               f"{money(s.subtotal)}  –  {money(s.deducted)}",
               lato(28), NET_WORKING)
    y += NET_H + 46

    d.text((CARD_X0 + 6, y), s.footer, font=lato(26), fill=MUTED)
    y += FOOTER_PAD

    img.crop((0, 0, W, y)).save(path)
    return path


# ------------------------------------------------------- fixture: 11-18 Sep 2026

def _fixture() -> Summary:
    std, pkg, ft = 55.00, None, None
    L = Line
    e = [
        L("Fri 11 Sep", "Daniela – 1 hr", "£48.57/hr", payout(1)),
        L("Fri 11 Sep", "Emilie – 2 hr", "£55/hr pupil price", payout(2)),
        L("Sat 12 Sep", "Viba – 1 hr", "£48.35/hr", 48.35),
        L("Sat 12 Sep", "Giovanni – 1 hr", "£46.77/hr", 46.77),
        L("Mon 14 Sep", "Emilie – 1 hr", "£48.57/hr", payout(1)),
        L("Mon 14 Sep", "Jasmine – 2 hr", "£55/hr pupil price", payout(2)),
        L("Mon 14 Sep", "Georgie – 1 hr", "Free trial", payout(1, free_trial=True)),
        L("Mon 14 Sep", "Sophia White – 1 hr", "£48.57/hr", payout(1)),
        L("Tue 15 Sep", "Esha – 1.5 hr", "Package rate £46.77/hr",
          truncate_2dp(46.77 * 1.5)),
        L("Tue 15 Sep", "Shannon – 1.5 hr", "£55/hr pupil price", payout(1.5)),
        L("Tue 15 Sep", "Shannon – 1.5 hr", "£55/hr pupil price", payout(1.5)),
        L("Tue 15 Sep", "Amelie – 1 hr", "Free trial", payout(1, free_trial=True)),
        L("Wed 16 Sep", "Daniela – 1 hr", "£48.57/hr", payout(1)),
        L("Wed 16 Sep", "Jasmine – 2 hr", "£55/hr pupil price", payout(2)),
        L("Wed 16 Sep", "Rahil – 1 hr", "Free trial", payout(1, free_trial=True)),
        L("Wed 16 Sep", "Becky – 1 hr", "£48.57/hr", payout(1)),
        L("Thu 17 Sep", "Morgan – 1.5 hr", "£55/hr pupil price", payout(1.5)),
    ]
    return Summary(
        instructor="Simon Edwards",
        period="11 – 18 Sep 2026",
        earnings=e,
        deductions=[L("Weekly", "Franchise fee", "", 90.00)],
        footer="Midday Fri 11 – midday Fri 18 September 2026  ·  "
               f"17 lessons  ·  22 hours",
    )


if __name__ == "__main__":
    # rate fixtures from the spec
    assert payout(1) == 48.57, payout(1)
    assert payout(1.5) == 72.95, payout(1.5)
    assert payout(2) == 97.33, payout(2)
    assert payout(1, stripe=False) == 49.50             # direct to bank
    assert payout(1.5, stripe=False) == 74.25
    assert payout(1, free_trial=True) == 30.00
    assert truncate_2dp(46.77 * 1.5) == 70.15

    s = _fixture()
    assert s.subtotal == 1008.96, s.subtotal
    assert s.net == 918.96, s.net

    out = render(s, "payout-simon-edwards-2026-09-11.png")
    print(f"all fixtures pass — rendered {out}")
    print(f"  subtotal {money(s.subtotal)}  net {money(s.net)}")
