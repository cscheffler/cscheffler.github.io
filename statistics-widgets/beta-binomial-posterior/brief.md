# Brief — from prior to posterior, Beta prior with Binomial likelihood

For the next widget, how might we best visualize going from the prior and likelihood to the
posterior? The prior is a Beta again and the likelihood function a Binomial. The posterior will also
be Beta from conjugacy. The goal here is to help visualize how the posterior arises from the prior
and the likelihood. Anything that helps build the intuition that the posterior is the prior
reweighted by the likelihood would be great. We can leave out the marginal likelihood for now in
that it is just a constant that normalizes the product of the prior and the likelihood to give the
posterior.

## Answers to the design questions

- **Main view:** the overlay of all three curves, with a toggle to step through the calculation.
- **Grid approximation:** skipped entirely, not even as a toggle.
- **Data input:** `x` and `n` sliders, matching the earlier Binomial widgets.

## The finding that shaped the design

The obvious design — draw the prior, draw the likelihood, and draw their literal pointwise product
so the heights visibly multiply — does not survive contact with the numbers. Scaling the prior and
the likelihood each to peak 1 and taking the product, the product's own peak is:

| prior, data | product peak |
| --- | --- |
| Beta(1,1), 6/9 | 1.0 |
| Beta(2,2), 6/9 | 0.91 |
| Beta(2,2), 0/20 | 0.068 |
| Beta(20,5), 2/20 | 3×10⁻⁶ |
| Beta(50,50), 90/100 | 2×10⁻⁹ |
| Beta(30,3), 10/100 | 5×10⁻¹⁸ |

So a shared linear axis works only where the prior is weak and roughly agrees with the data.
Precisely in the interesting cases — prior and data in conflict, or both sharp — the product
collapses onto the axis and the posterior becomes invisible. Hence: the overlay puts every curve at
peak 1 so all three are always legible, and the multiplication is carried by a numeric readout
rather than by absolute heights.

## Decisions taken while building

**Peak-normalisation is exact, not a fudge.** In the overlay each curve is divided by its own
maximum, and the posterior drawn is *defined* as the drawn product divided by that product's own
peak. So the arithmetic printed in the readout lands exactly on the drawn curve — a student can
check it. This is honest because Bayes' rule fixes the posterior only up to a constant anyway, and
saying so is part of the lesson.

**The readout shows the constant.** `prior 0.80 × likelihood 0.50 = 0.40, ÷ 0.417 = posterior 0.96`.
The divisor never changes as `p` moves, which is the point: normalising is one constant, not a
reshaping. Sweeping `p` is an active check a student can perform.

**The stepper runs on true vertical scales.** Steps 1 → 2 → 3 are prior density, prior × likelihood,
and posterior density. Step 2's axis auto-scales, so the shape is always visible however tiny the
peak (down to 10⁻¹⁸ in the conflict case). Steps 2 and 3 draw an identical curve and only the axis
labels change — which is the marginal-likelihood-is-just-a-constant lesson, told by the axis rather
than by the curve.

**The marginal likelihood is present but not foregrounded.** Step 3's caption gives the divisor as a
number without naming it. The help Notes point out that it is exactly the Beta-Binomial prior
predictive probability of the observed `x` — the quantity the previous widget plots. Verified
numerically: prior × likelihood = Z × posterior to ~10⁻¹⁴ relative error.

**The balance beam.** Below the plot, a track on the same `p` scale showing the posterior mean
sitting between the prior mean and `x/n`. This is exact:

    posterior mean = (α+β)/(α+β+n) · prior mean + n/(α+β+n) · x/n

which is what makes "a Beta(α, β) prior is worth α+β observations" concrete, and shows the data
taking over as n grows.

**n = 0 is allowed.** With no data the likelihood is flat at 1 and the posterior is exactly the
prior — a good starting point for the argument, and the `x` slider disables itself.

**Colour roles.** Prior grey, likelihood orange, posterior blue, distinguished also by weight and
dash pattern: prior thin solid with a wash, likelihood dashed, posterior thick solid. A legend sits
in the plot so the three are readable without a key elsewhere.

**No auto-scale toggle.** The other widgets carry one, but it has nothing to do here: the overlay's
axis is fixed at peak 1 by construction, and the stepper's axis has to auto-scale or step 2 is
invisible.

**Layout.** One plot rather than three, so the controls go in a column beside it rather than in a
row above it — a single plot given the full remaining height reads better than a very wide short
one. Same breakpoint as the prior-predictive widget (≥ 64rem, ≥ 36rem, ≥ 3:2 landscape); below it
everything stacks and scrolls.

**Left out:** sequential updating (posterior becomes the next prior). It is a good widget but a
different one, and mixing it in muddies the single-update story.

## URL fragment keys

`a`, `b`, `n`, `x`, `p` (the inspected value), and `v` for the view — omitted for the overlay,
`1`/`2`/`3` for the three steps.
