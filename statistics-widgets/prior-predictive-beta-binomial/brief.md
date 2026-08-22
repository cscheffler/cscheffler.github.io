# Brief — prior predictive, Beta prior with Binomial likelihood

For the next widget, we want to combine a prior and likelihood to show what the resulting
prior-predictive distribution looks like. We'll use a Beta prior on p and a Binomial likelihood
Binomial(x | n, p) -- note that we'll call the variable x rather than k like in a previous Binomial
widget. This is to match the notation in a separate resource I have. Show the prior first, then the
likelihood. Allow the user to adjust the alpha, beta, and n parameters. Plot the resulting
prior-predictive distribution. This can be done analytically since the Beta is a conjugate prior of
the Binomial likelihood. Use the same colour scheme as before and the same basic design.

## Decisions taken while building

**A fourth control, `p`.** The brief names three parameters to adjust (α, β, n), but a Binomial
likelihood cannot be drawn at all without saying which *p* to draw it at — it is a family of
distributions, not one. Step 2 therefore has a `p` slider that selects a single member of that
family to draw in bold. It is labelled "one slice of the likelihood to inspect" and the help text
says explicitly that it is not a parameter of the model; sweeping it while the predictive stays put
is the point.

**The pale family in step 2.** Behind the selected slice, twelve more Binomials are drawn at the
prior's twelve equal-probability quantiles, and the same twelve values are ticked on the prior's
axis in step 1. This is what makes the averaging visible rather than asserted: the reader can see
the family the integral runs over. It is a visual aid only — step 3 is the exact closed form, not
the average of those twelve (their average is within about 0.005 of it at the defaults).

**The pale family is joined up.** Drawn as twelve independent clouds of faint dots it read as
scatter rather than as twelve Binomials, and at large n the dots were effectively invisible. Each
member is now a thin line in a dedicated `--family` tint (0.45 alpha, up from an effective 0.175),
with the points marked only when the slots are wide enough to be worth marking (n up to about 14).
The selected slice keeps its stems and dots and gains a card-coloured halo so it reads in front.
The discrete reading is carried by the bold slice; the pale lines are background context for the
integral, not a claim that the Binomial is continuous.

**No reference Binomial in step 3.** An earlier version overlaid Binomial(x | n, p̄) at the prior
mean as hollow circles, sharing the predictive's scale. Removed on request: step 3 now plots the
prior predictive alone, and its axis scales to the predictive alone, which stops a tall reference
peak from squashing it. The overdispersion factor √((α+β+n)/(α+β+1)) briefly survived as a summary
line reading "N× wider than Binomial(x | n, p̄)", but "wider" invites reading across the horizontal
axis, which runs 0 to n in both cases — it was a claim about standard deviations dressed up as a
claim about the plot. Dropped. Steps 2 and 3 each report their own sd, so the comparison is still
there to be made, and the help says what factor to expect.

**One axis-lock toggle, three axes.** As in the other widgets, unchecking "auto-scale vertical axes"
freezes each panel where it currently sits; the three frozen values ride in the fragment as `y1`,
`y2`, `y3`.

**x, not k.** Per the brief, the count variable is `x` throughout, including the axis labels and the
hover readout. The earlier Binomial widgets keep `k`.

**One-screen layout.** Three stacked panels ran to about 1,400px of page, so following the
argument meant scrolling between the prior and its consequence. Above 64rem wide and 36rem tall —
any ordinary laptop or desktop window — the widget switches to a single screen: controls in a row
across the top, the three steps side by side left to right, and the plots absolutely positioned
inside cards that a flex row sizes, so they grow into whatever height is left. The three steps
share four explicit grid rows (head, note, plot, summary) so those parts line up across the columns
however the text wraps. Below either threshold — a phone, a browser sidebar, a short window — the
stacked scrolling layout is kept, and the canvases go back to taking their height from their width.

## URL fragment keys

`a`, `b`, `n`, `p`, and `y1` / `y2` / `y3` for a frozen prior / likelihood / predictive axis.
