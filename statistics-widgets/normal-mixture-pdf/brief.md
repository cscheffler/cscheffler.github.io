# Brief — a mixture of two Normals

For the next widget, we want to visualize a mixture of 2 Normals,
$w Normal(x | \mu_1, \sigma_1^2) + (1-w) Normal(x | \mu_2, \sigma_2^2)$. Provide sliders for the two
means, the two standard deviations, and the mixture weight. Plot the resulting PDF. This widget will
be very similar to the "Beta distribution" widget, just with more sliders and a different domain.
You can still visualise where the mean of the resulting distribution is. Don't display the mode
since it's less well-defined (depending on local vs global definition of "mode"). Put it in a
directory called normal-mixture-pdf.

## Decisions taken while building

**Built on `beta-pdf`.** Same single-plot layout, same plot card, same summary-plus-toggle strip,
same hover readout (`x` and `density`, two lines), same axis-freeze behaviour, same control markup
and number handling. What differs is the maths, the unbounded domain, and five sliders instead of
two.

**Controls pair up above 40rem.** Five stacked sliders would push the plot off a laptop screen. In
two columns the grid falls out exactly right by itself: row 1 is (μ₁, σ₁), row 2 is (μ₂, σ₂), and
the weight takes the last row — each component's centre beside its own width.

**The two weighted components are drawn.** Pale dashed curves behind the bold one show
`w·N₁` and `(1−w)·N₂`, so the mixture reads as a sum: at every x the bold height is the two pale
heights added. This is a small addition to "plot the resulting PDF", but a mixture that does not
show what it is a mixture *of* makes the reader take the name on trust. They are weighted rather
than raw so that the arithmetic on screen is literally the arithmetic in the formula.

**The x range follows the parameters.** The Beta's domain is fixed at [0, 1]; this one is the whole
real line, so the view spans four standard deviations either side of each component. A component
whose weight has fallen below 0.005 stops being allowed to widen the view — otherwise sliding `w`
to 0 leaves a large empty region around a hump that is no longer there. The endpoints are left
exactly where the parameters put them — rounding them out to a multiple of the tick step opened up
empty margins for nothing — and only the tick *step* is snapped to a round number.

**Two bugs the screenshots caught.** The first pass chose tick decimals from the step's magnitude
(`step >= 1 ? 0 : ...`), so a step of 2.5 was printed with none and the tick at −2.5 was labelled
"−3". Decimals now come from what the step actually needs, checked over nine ranges so that every
label round-trips to its exact value. The second: the `<h1>` formula is long and was a single
unbreakable run, which pushed the help button off the right edge at 360px. Each term is still
unbreakable, but the sum may now wrap between them.

**One toggle freezes both axes.** `beta-pdf` freezes only the vertical axis, which is enough when
the horizontal one cannot move. Here a frozen vertical axis alone would not give a stable
comparison, so the toggle is relabelled "auto-scale axes" and pins x and y together. A frozen x
range only survives a URL if both ends are present and ordered.

**No mode, per the brief** — and the help says *why* rather than just omitting it: a mixture has one
peak or two depending on the weights as well as the means and widths, and once there is a local peak
that is not the global one, "the mode" stops being a single well-defined number.

**The default is deliberately bimodal.** μ = (−2, 2), σ = (1, 1), w = 0.5. The mean is then exactly
0, sitting in the valley between the humps at 27% of the peak height — measured, not estimated. A
distribution whose mean is one of the least likely values it can take is the most useful thing this
widget has to say, and it should be on screen before anyone touches a slider.

## Facts checked numerically before they went into the help

- Area under the default mixture: 1.000000000000.
- With equal weights and equal widths, a second hump appears at a separation of **exactly 2σ**
  (bisection puts the threshold at 2.000000). At 1.8σ there is one mode, at 2.01σ there are two.
- That threshold depends on the weights: at w = 0.3 it is 2.72σ, at w = 0.2 it is 2.98σ, and at
  w = 0.1 it is 3.32σ. The help rounds the w = 0.2 case to "about 3σ".
- Default mean 0, sd 2.2361; density at the mean 0.0540 against 0.1995 at a peak.

## URL fragment keys

`m1`, `s1`, `m2`, `s2`, `w`; and `x0` / `x1` / `y` for a frozen horizontal range and vertical
maximum.
