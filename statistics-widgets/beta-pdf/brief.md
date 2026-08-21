# Brief — Beta distribution PDF

Something very similar to the previous widgets, but for the Beta distribution.

- Plot the PDF Beta(p | alpha, beta) as a function of p.
- Provide input sliders for the alpha and beta parameters.
- Same colour scheme, and the same functionality as the other widgets (text boxes beside the
  sliders, live update, auto-scale toggle for the vertical axis, hover readout, help modal, state
  in the URL fragment).

Unit: Introduction.

## Notes on the shape of this one

Beta is a continuous density over p, so it is drawn as a curve, like the likelihood widget.

Unlike the previous two, the plotted quantity is a *density*, not a probability, so it is not
bounded above by 1: the vertical axis has no upper limit. When alpha < 1 or beta < 1 the density
diverges at an endpoint, so the auto-scaled axis is taken from the central 98% of the range and the
off-scale part of the curve is marked with carets.
