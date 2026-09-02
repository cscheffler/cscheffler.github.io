// plant-model.js — turns the shared event log into what the plant looks like
// right now. Pure functions, no DOM, no Firebase. Both pages import this so
// the control page and every student's display agree exactly.
//
// The log is tiny and append-only:
//   { planted: ms, seed: int, waterings: {id: ms, ...}, picks: {id: ms, ...} }
// Everything else (growth, wilt, fruit, the bowl) is derived from it.

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

export const GROWTH = {
  tauHours: 36,      // soil moisture e-folding time. Daily watering keeps it above half.
  wiltStart: 0.5,    // moisture at which leaves begin to droop (about 25 h dry)
  wiltFull: 0.12,    // fully wilted (about 3 days dry)
  thirstyBelow: 0.6, // the control page nags below this (about 18 h dry)
  // Stage thresholds in "care days": one calendar day with a watering counts as one.
  sprout: 1,
  seedling: 2.5,
  young: 5,
  mature: 10,
  fruitStart: 13,    // first fruit sets; its flower shows flowerDays earlier
  slotSpacing: 0.8,  // later fruit slots start this many care days apart
  flowerDays: 2,
  ripenDays: 4,      // from fruit set to fully red
  regrowDays: 3,     // after a pick, that slot fruits again after this
  pickable: 0.5,     // ripeness needed to pick (full size, still green)
  slots: 9,
  heightScale: 6     // stem length saturates as 1 - exp(-careDays / heightScale)
};

const P = GROWTH;
const TAU = P.tauHours * HOUR;
const PER_DAY = 1 - Math.exp(-DAY / TAU);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// Accepts the raw database value (objects keyed by push id, or arrays).
export function normaliseLog(raw) {
  if (!raw || !raw.planted) return null;
  const planted = Number(raw.planted) || 0;
  const seed = Number(raw.seed) || 1;
  const list = v => (v ? Object.values(v) : [])
    .map(Number)
    .filter(t => Number.isFinite(t) && t >= planted)
    .sort((a, b) => a - b);
  return { planted, seed, waterings: list(raw.waterings), picks: list(raw.picks) };
}

// Growth accrued by time t, in care days. Each watering contributes the
// integral of its decaying moisture until the next watering (or t).
export function careDaysAt(t, waterings) {
  let g = 0;
  for (let i = 0; i < waterings.length; i++) {
    const w = waterings[i];
    if (w > t) break;
    const next = i + 1 < waterings.length ? waterings[i + 1] : Infinity;
    const end = Math.min(t, next);
    g += (1 - Math.exp(-(end - w) / TAU)) / PER_DAY;
  }
  return g;
}

export function moistureAt(t, waterings) {
  let last = -Infinity;
  for (const w of waterings) { if (w <= t) last = w; else break; }
  if (last === -Infinity) return 0;
  return Math.exp(-(t - last) / TAU);
}

function simulateFruit(G, careAt, picks) {
  const slots = [];
  for (let k = 0; k < P.slots; k++) slots.push({ k, start: P.fruitStart + k * P.slotSpacing });
  const bowl = [];
  for (const t of picks) {
    const g = careAt(t);
    let best = null;
    for (const s of slots) {
      const r = (g - s.start) / P.ripenDays;
      if (r >= P.pickable && (!best || r > best.r)) best = { s, r };
    }
    if (!best) continue; // a pick with nothing to pick is ignored
    bowl.push({ ripeness: Math.min(1, best.r), pickedAt: t });
    best.s.start = g + P.regrowDays;
  }
  const out = slots.map(s => {
    const r = (G - s.start) / P.ripenDays;
    if (r >= 0) return { k: s.k, kind: 'fruit', ripeness: Math.min(1, r), pickable: r >= P.pickable };
    const f = (G - (s.start - P.flowerDays)) / P.flowerDays;
    if (f >= 0) return { k: s.k, kind: 'flower', progress: Math.min(1, f) };
    return { k: s.k, kind: 'none' };
  });
  return { slots: out, bowl };
}

function stageOf(G, slots) {
  if (slots.some(s => s.kind === 'fruit')) return 'fruiting';
  if (slots.some(s => s.kind === 'flower')) return 'flowering';
  if (G >= P.mature) return 'mature';
  if (G >= P.young) return 'young';
  if (G >= P.seedling) return 'seedling';
  if (G >= P.sprout) return 'sprout';
  return 'seed';
}

export const STAGE_LABEL = {
  seed: 'a seed in the soil',
  sprout: 'a sprout',
  seedling: 'a seedling',
  young: 'a young plant',
  mature: 'a mature plant',
  flowering: 'flowering',
  fruiting: 'bearing fruit'
};

// The full derived state at time `now`.
export function plantState(log, now) {
  const { planted, seed, waterings, picks } = log;
  const careAt = t => careDaysAt(t, waterings);
  const G = careAt(now);
  const moisture = moistureAt(now, waterings);
  const wilt = 1 - smooth(P.wiltFull, P.wiltStart, moisture);
  const lastWatered = waterings.length ? waterings[waterings.length - 1] : null;
  const { slots, bowl } = simulateFruit(G, careAt, picks);
  const stage = stageOf(G, slots);
  return {
    planted, seed, now,
    daysSincePlanted: (now - planted) / DAY,
    careDays: G,
    moisture, wilt,
    lastWatered,
    hoursSinceWater: lastWatered ? (now - lastWatered) / HOUR : null,
    needsWater: moisture < P.thirstyBelow,
    stage,
    stageLabel: STAGE_LABEL[stage],
    slots, bowl,
    pickable: slots.filter(s => s.kind === 'fruit' && s.pickable).length,
    fruitOnPlant: slots.filter(s => s.kind === 'fruit').length,
    flowers: slots.filter(s => s.kind === 'flower').length,
    totalPicked: bowl.length
  };
}

// A synthetic log for previews: planted `days` ago, watered daily until
// `dry` days ago, with `picked` picks, the last one `pickago` days ago and
// the rest `pickgap` days apart before it.
export function demoLog({ days = 16, dry = 0.3, picked = 2, seed = 7, pickago = 1 / 6, pickgap = 1 / 6 } = {}, now = Date.now()) {
  const planted = now - days * DAY;
  let lastWater = now - dry * DAY;
  // A plant younger than `dry` days still gets watered once, at planting.
  if (lastWater < planted) lastWater = planted + Math.min(HOUR, (now - planted) / 2);
  const waterings = [];
  for (let t = planted + 2 * HOUR; t <= lastWater; t += DAY) waterings.push(t);
  if (lastWater >= planted) waterings.push(lastWater);
  const picks = [];
  for (let i = 0; i < picked; i++) picks.push(now - (pickago + i * pickgap) * DAY);
  return { planted, seed, waterings, picks };
}

export function fmtAgo(hours) {
  if (hours == null) return 'never';
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + ' min ago';
  if (hours < 48) return Math.round(hours) + ' h ago';
  return (hours / 24).toFixed(1) + ' days ago';
}
