# Brief — Binomial likelihood function

Something very similar to the Binomial PMF widget, but for a Binomial likelihood function.

- Plot the same function, Binomial(k | n, p), but as a function of p rather than k.
- The input sliders should be for the variables k and n.
- All other functionality the same as the PMF widget (text boxes beside the sliders, live update,
  auto-scale toggle for the vertical axis, hover readout, help modal, state in the URL fragment).
- The colour scheme should be the same. We are just changing the variable.
- This is a new widget; the existing PMF widget is not to be modified.

Unit: Introduction.

## Deviation from "the same"

p is continuous, so this plots a continuous curve rather than the discrete dots used for k in the
PMF widget. The contrast between the two is the point: the same expression is a discrete
distribution over k and a continuous likelihood over p.
