# Payout summary fonts

Bundled deliberately (spec §8: "Fonts must be bundled with the deploy, not
system-resolved"). These are the first font binaries tracked in this repo — the
rest of the site loads Lato from Google Fonts over the network.

Both families are SIL Open Font License 1.1, so redistribution here is fine.

## Provenance

Downloaded 2026-09-18 from the `google/fonts` repository, `main` branch:

```bash
cd docs/payout/fonts
for f in Lato-Regular Lato-Bold Lato-Black; do
  curl -sfL -o "$f.ttf" "https://github.com/google/fonts/raw/main/ofl/lato/$f.ttf"
done
curl -sfL -o Bricolage.ttf \
  "https://github.com/google/fonts/raw/main/ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf"
```

`BricolageGrotesque[opsz,wdth,wght].ttf` is renamed to `Bricolage.ttf` because
`payout_renderer.py` loads that filename (square brackets are awkward to quote).

## SHA-256

```
413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682  Bricolage.ttf
808c62839c62dbce7de689af7603666fc7f8b81e0df537d8a5212c87580d4337  Lato-Black.ttf
8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1  Lato-Bold.ttf
d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251  Lato-Regular.ttf
```

Verify with `sha256sum *.ttf`. If these change, the pixel baseline below moves.

## Bricolage is a variable font

`payout_renderer.py` calls `set_variation_by_axes([96.0, 800.0, 100.0])` —
opsz 96, weight 800, width 100. Available axis ranges in this file:

| Axis | Min | Default | Max |
|---|---|---|---|
| Optical size | 12 | 96 | 96 |
| Weight | 200 | 800 | 800 |
| Width | 75 | 100 | 100 |

Display use only. **Never set currency in Bricolage** — its `£` glyph renders
poorly at large sizes (spec §6.3). All money is Lato Black.

## Known variance against reference-output.png

`reference-output.png` was produced with an **older Bricolage release** than the
one pinned here. Re-rendering the fixture with these files reproduces the layout
exactly but not the glyph rasterisation:

| Measure | Result |
|---|---|
| Canvas size | 1080×2514 — exact match |
| Row ink-profile correlation | 1.00000 |
| Header band / net card fill means | delta 0.000 |
| Differing pixels | 2.65%, of which 91% lie on glyph edges |
| Title line 1 ink extent | reference 533px wide, current 540px (both start x=61) |

Layout, colours, geometry, card radii, dividers, spines and content are
pixel-identical. Only glyph shapes differ, from the font version plus the Pillow
rasteriser (verified with Pillow 12.1.1).

**Therefore a byte-equality assertion against `reference-output.png` will fail**
on a machine with different font or Pillow versions. The regression test must be
structural — ink-profile correlation, solid-fill means, and text extents within
tolerance — not `==`. See spec §8 "Testing".
