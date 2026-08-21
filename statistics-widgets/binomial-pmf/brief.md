# Brief — Binomial distribution PMF

Make a widget for visualising the Binomial distribution function, Binomial(k | n, p).

- Plot the PMF as a function of k.
- Provide two input sliders, each with an associated text input, for n and p.
- Update the PMF plot as the inputs change.
- This is a discrete distribution, so use dots to show the discrete points rather than
  plotting a continuous curve.

Unit: Introduction.

## Follow-up tweaks

1. The vertical axis rescales automatically as the inputs change, which is good, but can also be
   confusing when the axis should stay static. Add a toggle that lets the user decide whether the
   vertical axis auto-rescales. It should auto-rescale by default.
