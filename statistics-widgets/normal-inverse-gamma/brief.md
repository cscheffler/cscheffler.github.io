# Brief — the Normal-Inverse-Gamma distribution

For the next widget, we want to visualize the Normal-Inverse-Gamma distribution:
m, s^2 ~ Normal-Inverse-Gamma(mu_0, nu_0, alpha_0, beta_0). Allow the user to adjust the parameters
of the distribution and show a 2-d heat map with contours of (m, s^2). Use the viridis colour map
for the heat map, unless there is another colour map that is even better suited to colour blindness.

## The colour map: cividis, with viridis one control away

Viridis is perceptually uniform and monotonic in lightness, so it survives greyscale and reads well
under the common colour-vision deficiencies. **Cividis** goes further: it was designed specifically
so that a viewer with deuteranopia or protanopia sees essentially the same image as a viewer without
(Nuñez, Anderton & Renslow, 2018). Since the brief invited a better-for-CVD option, cividis is the
default and viridis is a dropdown away for comparison.

Both tables are exact: dumped from the locally installed matplotlib at 32 stops and interpolated,
rather than recalled from memory.

## The maths, checked before building

    p(m, s²) = Normal(m | mu_0, s²/nu_0) · Inv-Gamma(s² | alpha_0, beta_0)
             ∝ (s²)^(-alpha_0-3/2) · exp[ -(2·beta_0 + nu_0(m-mu_0)²) / (2s²) ]

Verified against numerical integration of the joint:

- integrating out `m` gives Inv-Gamma(alpha_0, beta_0) — agrees to ~1e-14;
- integrating out `s²` gives Student-t with 2·alpha_0 df, centre mu_0, scale √(beta_0/(alpha_0·nu_0))
  — agrees to ~1e-13 once the quadrature range is wide enough (an apparent 8e-7 discrepancy at
  alpha_0 = 0.6 turned out to be tail truncation in the *test*, and fell to 6e-13 on a wider range);
- the incomplete-gamma routine used for quantiles round-trips through its own CDF to ~1e-13.

## Decisions taken while building

**Choosing the window was the hard part.** The support is unbounded in both directions, so the view
has to be inferred. The first rule — `s²` from 0 to the 99th percentile of the Inverse-Gamma —
captures 98.5% of the mass across the parameter range, which sounded fine and was useless: at
alpha_0 = 0.6 the tail is so heavy that the 99th percentile sits **820 medians** up the page and the
entire bulk collapses into the bottom row of pixels. Capping the height at nine medians fixes it.
The final rule is

    v1 = min(Q(0.99), 9·median),  m = mu_0 ± 3.2·sqrt(min(Q(0.90), v1)/nu_0)

which holds ≥85% of the mass everywhere tested and ≥98% for ordinary parameters, while keeping the
bulk visible. The fraction actually held is reported under the plot rather than hidden.

**Contours enclose mass, not arbitrary density levels.** Levels are found by sorting the rendered
density values and walking down from the densest cell until the accumulated mass reaches 50%, 80%
and 95%. Verified: the mass above each level comes out at 0.500 / 0.800 / 0.950. A contour is
skipped when the window does not hold that much mass — which is why the alpha_0 = 0.6 view shows
only 50% and 80%, and says so. Widths run thickest-innermost so the three are distinguishable
without counting inwards.

**Performance.** The density factors into a per-row and a per-column part, so the inner loop of the
heat map is one multiply, one subtract and one `exp`; colour goes through a 256-entry ramp rather
than interpolating per pixel. Mass and contours use a grid at a third of the pixel resolution —
sorting a third of a million values per slider tick would not keep up. A frame costs about 3 ms at
700×420.

**Square-root colour scale.** Linear is what `imshow` does by default, but the window holds nearly
all the mass, so almost all of it sits far below the peak and a linear ramp paints the panel one
flat colour. The equivalent in matplotlib is `norm=PowerNorm(0.5)`; the colour bar says so.

**Marginals on two sides.** The `m` marginal (Student-t) sits above sharing the horizontal axis, the
`s²` marginal (Inverse-Gamma) to the right sharing the vertical. They are an addition to the brief,
included because the funnel is much easier to read when you can see what each axis looks like on its
own, and because they make the 2·alpha_0 degrees of freedom concrete.

**Bug worth recording:** the right-hand strip's rotated label was invisible at first. Under a −90°
rotation the glyphs grow towards screen-right, so `textBaseline = "top"` pushed them straight off
the edge of the canvas. `"middle"` fixes it.

**Unit placement.** Filed under *Building Statistical Models* rather than *Introduction*: the
Introduction group is the Binomial/Beta conjugacy thread, and this is a prior for a model rather
than a step in that story. Easy to move.

## URL fragment keys

`mu`, `nu`, `a`, `b`; `cm=1` for viridis; `ct=0` to hide contours; and `m0`/`m1`/`v1` when the
window is frozen.
