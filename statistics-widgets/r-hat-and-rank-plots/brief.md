# Brief — R̂ and rank plots, from four chains

Next, we want a widget that provides the correct intuition for how the R-hat statistic for
diagnosing sampling problems in PyMC is calculated. My basic idea is to have 4 chains represented by
4 1-d Normal distributions. The user can adjust the mean and standard deviation of each of these
Normals. The widget computes the result R-hat. We see that the 4 chains have to be very similar in
order to get R-hat < 1.01.

Perhaps this widget should be linked to rank plots too. The 4 chains -> the rank plot of the 4
chains -> R-hat. We would see the rank plot becoming less uniform as the 4 chains are made to be
more different.

## Answers to the design questions

**Scope, first pass: minimal.** Chains, rank plot, between/within, R̂, presets, N and seed — no
folded R̂, no split-chain toggle, no autocorrelation.

**Scope, revised: fold added.** On seeing the built widget report R̂ = 1.00 for four visibly
different chains, the σ-blind spot was judged too big a pedagogical problem to ship as a
documented limitation, and the folded lens was added. Rank normalisation and split chains were
considered at the same time and again declined, so the number here is still not exactly
`az.summary`'s.

## Decisions taken while building

**Real draws, not analytic Normals.** A rank plot needs draws to rank, so the four Normals are
sampled rather than evaluated. This also buys the noise floor: R̂ computed from N draws is a random
quantity, and with short chains it wobbles by more than the 0.01 budget (see below). Standardised
draws `z` are generated once per seed for the maximum chain length and sliced to N, so raising N
extends the same chain rather than resampling it, and dragging μ or σ rescales draws already in hand
rather than redrawing them — which is what keeps the sliders smooth.

**The statistic is the textbook Gelman–Rubin R̂**, on the raw draws, unsplit:

    W = mean of the four within-chain variances
    b = variance of the four chain means          (divisor M-1)
    R̂ = sqrt(1 - 1/N + b/W)

That compact form is algebraically identical to the usual `sqrt(V̂/W)` with
`V̂ = ((N-1)/N)W + B/N` and `B = N/(M-1) Σ(θ̄ₘ-θ̄)²` — verified to machine precision. It is written
this way because every symbol in it is then something the student can see on the screen: b is the
spread of the four centres, W is the width of one chain.

**The threshold as a number.** R̂ < 1.01 means √b < 0.1418·√W: the chains' centres must agree to
within about one seventh of a single chain's own width. Equivalently, two chains at −0.123σ and two
at +0.123σ — a separation of a quarter of a chain's sd — already sit exactly on 1.01. That is the
"very similar" of the brief, made quantitative, and it is drawn as a threshold marker on the √b
ruler rather than only asserted.

**What the rank plot contributes.** It is the same information seen a second way, and it is what
`az.plot_rank` shows. Each chain's draws are ranked among all 4N pooled draws and histogrammed; four
chains exploring the same distribution give four flat histograms. Each chain's **mean rank** is
marked, because that marker is the visual proxy for the chain mean that feeds b — which is what ties
"the histogram tilts" to "R̂ rises".

**The σ-only blind spot, and the fold that fixes it.** R̂ consumes exactly one summary per chain —
the mean — so four chains that share a centre and differ in width leave b at nothing but sampling
noise. Measured mean ranks for σ = 0.5, 1, 1.5, 3 at N = 500 come out 963, 1017, 986, 1032 against a
uniform expectation of 999.5: there is genuinely nothing there for the statistic to react to, even
though the rank histograms are unmistakable.

The fix is not a different statistic but a different view of the draws. Replacing each draw by
ζ = |θ − median of all 4N pooled draws| turns a difference in spread into a difference in location:
the folded chain means come out 0.413, 0.824, 1.163, 2.344, against the σ·√(2/π) = 0.399, 0.798,
1.197, 2.394 that theory predicts. The same B/W machinery then reads 1.282 where it read 1.001.
Measured on the widget's own draws at seed 1, N = 500:

| preset | R̂(θ) | R̂(\|θ − median\|) | reported |
| --- | --- | --- | --- |
| converged | 1.000 | 1.000 | 1.000 |
| just over the line | 1.013 | 1.000 | 1.013 |
| one chain stuck | 1.726 | 1.410 | 1.726 |
| different scales | 1.001 | 1.282 | **1.282** |
| two modes | 3.076 | 1.002 | 3.076 |

The last two rows are why the reported value is the **maximum** of the two and not the folded one
alone: folding destroys location information, so the two-modes case — which the unfolded lens calls
3.076 — folds down to 1.002. Each lens is blind to what the other catches. That is worth having in
the widget rather than hidden, so both numbers are always listed and the reader can watch them
trade places.

**The fold is a lens, not a second panel.** It would have been cheaper to print a second number
under the first. Instead the `view` buttons switch all three panels at once: step 1 redraws the
folded draws (and the folded-Normal densities), so four chains that sat on top of each other visibly
separate; step 2 ranks the folded draws, and a histogram that was flat acquires a tilt; step 3 runs
identical arithmetic. The lesson is then *one mechanism applied to two views*, and the fold is
something the reader watches happen rather than a term in a footnote. The headline number stays the
reported maximum in both views, while the rulers and the formula below it belong to the view on
screen.

**The noise floor is real and is exposed.** Four *identical* chains, 3,000 replicates:

| N | mean R̂ | sd | P(R̂ > 1.01) |
| --- | --- | --- | --- |
| 25 | 1.0002 | 0.0167 | 0.23 |
| 50 | 1.0000 | 0.0083 | 0.12 |
| 100 | 1.0001 | 0.0043 | 0.034 |
| 250 | 1.0000 | 0.0016 | 0.000 |
| 1000 | 1.0000 | 0.0004 | 0.000 |

So at N = 50 nearly one run in eight of four perfectly good chains fails the test. The N slider and
the reseed button make that reproducible in class. It also means R̂ lands a hair below 1 quite often;
the widget reports the number it computed rather than clipping at 1, and the help says why.

**The chain means are drawn on the trace.** Four overlaid traces of 500 iid draws are, honestly,
a block of spaghetti — which is what a real trace plot of well-mixed chains looks like, but it
carries no reading. Each chain's own mean is therefore drawn straight through it as a horizontal
line on a halo. Converged chains give four lines sitting on top of one another; separating the
centres fans them apart, and that fan *is* √b. It puts step 3's quantity in step 1's picture without
a second plot.

**Presets.** Eight sliders is too many to stumble onto anything by accident: converged / just over
the line / one chain stuck / different scales / two modes.

**Colour.** Four chains need four colours, so the Okabe–Ito colourblind-safe set is used rather than
extending the house two-colour scheme. Hue is never the only cue: the four density curves carry
distinct dash patterns, and the rank plot gives every chain its own labelled sub-panel.

**Left out:** split chains and a per-chain drift control (which is what makes splitting bite), rank
normalisation, autocorrelation and ESS. All were offered and declined. The consequence is that the
number here is max(bulk, tail) on the raw draws rather than the rank-normalised split version
`az.summary` prints — the help says exactly what ArviZ adds on top, including that plain R̂ is not
merely blind to drift but actively fooled by it, since a drifting chain has an inflated within-chain
variance and so pushes R̂ down.

## URL fragment keys

`m1`–`m4` and `s1`–`s4` for the four means and standard deviations, `n` for the draws per chain,
`seed` for the PRNG seed, and `v` for the lens — `t` for the draws, `f` for |θ − median|.
