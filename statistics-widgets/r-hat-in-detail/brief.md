# Brief — R̂ in detail: split, rank-normalise, fold

The current R-hat widget is good for introducing students to R-hat. Later in the course, we will
learn how it works in depth. For that, create a copy of the current widget, give it a new directory,
and implement the whole modern statistic: fold (already done) + rank normalisation + split chains.
The pedagogical focus shifts from understanding the essence of how R-hat works to understanding it
in detail.

## What this one is for

[`r-hat-and-rank-plots`](../r-hat-and-rank-plots/) teaches the engine: R̂ is √(1 − 1/N + b/W), and
the chains' centres have to agree to within about a seventh of one chain's width. This widget keeps
that engine untouched and teaches the *layers* built on top of it — and, crucially, teaches them by
what each one is there to catch. The number here is the one `az.summary` prints.

## The design that follows from that

**A ladder, not a number.** Step 3 shows the statistic at all four stages at once — as drawn, split,
bulk, tail — plus the reported maximum. Each preset breaks the chains in exactly one way, and the
point of the widget is watching *which row is the first to move*:

| preset | plain | + split | bulk (ranks → z) | tail (fold → z) | reported |
| --- | --- | --- | --- | --- | --- |
| converged | 1.000 | 0.999 | 0.999 | 0.999 | 0.999 |
| shifted centre | 1.021 | 1.018 | 1.018 | 0.999 | 1.018 |
| drifting chain | **1.000** | **1.073** | 1.073 | 1.013 | 1.073 |
| heavy tails | **0.999** | **0.999** | **1.048** | 1.012 | 1.048 |
| different scales | 1.001 | 1.000 | 0.999 | **1.218** | 1.218 |
| two modes | 3.076 | 2.871 | 1.731 | 1.001 | 1.731 |

**Controls exist to make a layer matter.** Splitting is decorative unless a chain can drift, and rank
normalisation is decorative unless the tails can be heavy, so this widget adds a per-chain `drift`
and a global `tails` control that the introductory one does not have. Drift is applied *centred* on
the run, so it leaves a chain's overall mean alone — which is exactly why the unsplit statistic
cannot see it, and why it drops slightly *below* 1 (the drift inflates that chain's own variance, so
W grows while b does not).

**The heavy-tails demonstration had to be measured, not assumed.** The expectation going in was that
heavy tails make plain R̂ *unstable*; over 300 seeds it does not — the sd of the statistic under
Cauchy draws is 0.0009, essentially the same as under Normal ones. What heavy tails actually do is
make it **blind**: W is enormous, so a real disagreement between centres vanishes into it. With one
chain offset by 0.4σ and t₂ draws, the un-normalised statistic exceeds 1.01 on 0% of 300 seeds while
the rank-normalised one manages 18%. The shipped preset pushes that to a single-seed demonstration —
chain 4 offset by a full 1.5σ under Cauchy draws — where stages 1 and 2 read 0.999 and stage 3 reads
1.048. Checked at three seeds so the lesson is not a fluke of one.

**The stage selector drives all three panels.** Panel 1 redraws the values at that stage (with the
split marked and a mean line per half-chain), panel 2 re-ranks them. That makes one detail visible
that is otherwise pure assertion: **stages 2 and 3 have identical rank plots**, because
rank-normalising is a monotone transform and cannot move a rank. It changes the values b and W are
computed from, and nothing else. That is called out in the help as something to check rather than
believe.

**Student-t on a fixed pool.** Draws are z / √(χ²_ν/ν), with the χ² built by summing squares from a
fixed per-draw pool of NUMAX = 20 normals. So changing ν reshapes the same underlying randomness
instead of reshuffling it, which keeps the picture stable while the tails get heavier, and needs no
rejection sampler.

**Robust vertical ranging.** Cauchy draws put a handful of points enormous distances out, and
ranging on min/max flattens the trace to a line. Panel 1 cuts at the 0.5% and 99.5% quantiles,
clips the traces to the plot box, and reports the off-scale count under the plot. Nothing is
excluded from the arithmetic — only from the picture.

## Verification

Checked against **ArviZ 1.3.0** installed in a scratch virtualenv, on eight configurations spanning
all six presets. The reported value agrees with `az.rhat(method="rank")` to within 3×10⁻⁸ — the
residual of this page's Acklam Φ⁻¹ against SciPy's — and the split-only row agrees with
`az.rhat(method="split")` to machine precision. The live widget's ladder was then read back out of
the rendered page by clicking each preset in headless Chrome, and matches the reference on all six
presets in all five columns.

One detail was wrong until the cross-check found it: Blom's back-transform denominator is
`S − 2c + 1` = S + 1/4, not S − 1/4. With c = 3/8 the difference is small but not negligible — it
moved the two-modes bulk value by 3×10⁻³, which is a third of the 0.01 threshold.

## Order of operations (as ArviZ does it, and as implemented here)

1. Split each chain at `n // 2`; with an odd number of draws the middle one is dropped.
2. **bulk:** rank all pooled values with ties averaged, `z = Φ⁻¹((r − 3/8)/(S + 1/4))`, then B/W.
3. **tail:** `|θ − median|` where the median is over the *split* array, then rank-normalise, then B/W.
4. Report `max(bulk, tail)`.

## Left out

Effective sample size (bulk and tail), and the paper's localised R̂ on quantile indicators. Both are
named in the help Notes, along with the point that R̂ says nothing about how many effective draws
you have — a chain can pass at 1.00 and still be far too short to use.

## URL fragment keys

`m1`–`m4`, `s1`–`s4` and `d1`–`d4` for each chain's mean, standard deviation and drift; `nu` for the
Student-t degrees of freedom (`0` = Normal, snapped to the offered ladder); `n` draws per chain;
`seed`; and `st` for the stage on screen (`0`–`3`).
