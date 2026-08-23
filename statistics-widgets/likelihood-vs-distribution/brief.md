# Brief — distribution or likelihood?

I want students to build up intuition for the Binomial likelihood from two different perspectives.
We can think of the PMF as a function of x, in which case it is normalised. Or we can think of it as
a function of p, in which case it is not a normalised distribution function. Think about how to
convey that intuition and that, importantly, we use it as a likelihood (and not a distribution
function) when we compute a posterior distribution. This connects to the previous widget with the
posterior, but the new widget's aim is to explain that the likelihood function, even though it's a
Binomial PMF, is not a distribution function, does not normalise, and is continuous (p) rather than
discrete (x).

## Answers to the design questions

- **Surface with aligned slices** as the centrepiece, rather than two panels alone.
- **Show the normalised version** as a toggle, revealing Beta(x+1, n−x+1).

## The two facts it is built on

    Σ_x Binomial(x | n, p) = 1          for every p      (the binomial theorem)
    ∫₀¹ Binomial(x | n, p) dp = 1/(n+1) for every x      (the x-dependence cancels)

Both verified numerically to ~1e-14 at n = 1, 4, 9, 25, 100, across every x. Both are computed live
in the widget — the row sum by summation, the column area by Simpson's rule — rather than quoted, so
the numbers on screen are measured.

## Decisions taken while building

**The surface, and why it is banded.** Binomial(x | n, p) is drawn for every combination: x across
in n+1 discrete bands, p continuously up the page. Each band is one column of constant width with a
smooth vertical gradient, so the rendering itself carries "discrete in x, continuous in p" before
any text is read. Cutting along a row gives the PMF panel below; cutting down a column gives the
likelihood panel to the right.

**The slices are butted against what they came from.** The likelihood panel shares the surface's
grid row, so its vertical axis is the same p axis at the same pixels; the count panel shares the
surface's column, so its x positions line up band for band. The likelihood is therefore drawn
sideways — p vertical, likelihood value horizontal — which is unusual but is what makes the
correspondence unmissable.

**Colour codes the cut, not the quantity.** The row and everything it produces are orange; the
column and everything it produces are blue. The surface itself is a neutral ink ramp so the two
coloured cuts sit on top of it.

**Shading scale.** Absolute, not per-row, since "sums to 1 along a row" is a claim about absolute
values. Scaled to the height of the central ridge rather than to the global maximum — which is 1 in
the two corners, at (x=0, p=0) and (x=n, p=1), and would leave the whole interior washed out. Those
corners saturate, which is honest. A gamma of 0.62 keeps mid-range values visible.

**n caps at 100, not 200.** The siblings allow 200, but this widget's whole message is that x is
discrete, and at n = 200 the bands are a few pixels wide and the surface reads as continuous in both
directions. 100 keeps the bands legible at ordinary widths.

**The normalise toggle.** Multiplying the column slice by (n+1) makes its area 1 and produces exactly
Beta(x+1, n−x+1) — the posterior from a uniform prior. That is the sharpest available way to make
the third point: the rescaling that turns a likelihood into a distribution over p is not free
bookkeeping, it is what Bayes' rule does, and it needs a prior.

**Layout.** Four grid rows: surface | its caption | count panel | its caption, with the likelihood
panel in row 1 of column 2. Column 2's text (caption plus the "why it matters" note) lives in a
single cell spanning rows 2–4 with its own overflow — an earlier version put the likelihood caption
in the same grid row as the surface caption, and when the toggle lengthened it, the row inflated and
squeezed the count panel down to about 55px.

**The bitmap is cached.** Recomputing 40,000 shaded cells on every pointer move would not keep up,
and the surface depends only on n, its pixel size, and the palette, so it is rendered once to an
offscreen canvas and blitted. Dragging the cuts costs nothing.

## URL fragment keys

`n`, `x` (the column), `p` (the row), and `z=1` when the area-1 overlay is showing.
