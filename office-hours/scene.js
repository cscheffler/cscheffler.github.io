// scene.js — draws the office, the view through the window, the plant and the
// bowl as SVG. Everything dynamic is a pure function of (state, time), so all
// viewers see the same picture.

import { GROWTH } from './plant-model.js';
import { clamp, lerpHex, shadeHex, mixHex, mulberry32, n } from './util.js';
import { weatherAt, rainFrom, officeClock, utcOffsetHours, sunState, skyColors, seasonWeights, smoothNoise } from './weather.js';

export const W = 1200, H = 560;
export const WALL = '#e8dfcf';
export const NIGHT_TINT = '#1a2038';

const VIEW = { x: 414, y: 54, w: 432, h: 254 };
const WIN = { x: 400, y: 40, w: 460, h: 282 };
const SILL = { x: 378, y: 322, w: 504, h: 20 };
const POT = { cx: 560, base: 322, h: 64, top: 100, bottom: 74 };
const SOIL_Y = POT.base - POT.h - 1;
export const PLANT_ORIGIN = { x: POT.cx, y: SOIL_Y };
const BOWL = { cx: 764, rim: 276, base: 322, rx: 68, ry: 10 };
const CLOCK = { cx: 1128, cy: 150, r: 36 };
const LAMP = { glowX: 1085, glowY: 300 };

const P = GROWTH;
const rad = a => a * Math.PI / 180;

// ---------------------------------------------------------------- static room

function defs() {
  return `<defs>
  <linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f1eadc"/><stop offset="1" stop-color="#e2d8c6"/>
  </linearGradient>
  <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#b98b5c"/><stop offset="1" stop-color="#96693f"/>
  </linearGradient>
  <linearGradient id="potGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#b8623d"/><stop offset="0.5" stop-color="#d4805a"/><stop offset="1" stop-color="#a65533"/>
  </linearGradient>
  <linearGradient id="bowlGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7fa1c1"/><stop offset="1" stop-color="#4b6a8a"/>
  </linearGradient>
  <linearGradient id="screenGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6d8fd0"/><stop offset="1" stop-color="#3c5ea0"/>
  </linearGradient>
  <radialGradient id="lampGlow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ffd98a" stop-opacity="0.6"/>
    <stop offset="0.5" stop-color="#ffd98a" stop-opacity="0.2"/>
    <stop offset="1" stop-color="#ffd98a" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="viewClip"><rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}"/></clipPath>
  <clipPath id="bowlClip">
    <ellipse cx="${BOWL.cx}" cy="${BOWL.rim}" rx="${BOWL.rx - 6}" ry="${BOWL.ry - 2.5}"/>
    <ellipse cx="${BOWL.cx}" cy="${BOWL.rim - 6}" rx="50" ry="24"/>
  </clipPath>
</defs>`;
}

function room() {
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${WALL}"/>
  <rect x="0" y="0" width="${W}" height="470" fill="url(#wallGrad)"/>
  <rect x="0" y="470" width="${W}" height="90" fill="url(#floorGrad)"/>`;
  for (let x = -60; x < W; x += 150) {
    s += `<line x1="${x}" y1="470" x2="${x}" y2="500" stroke="#7d5535" stroke-opacity="0.5"/>`;
    s += `<line x1="${x + 75}" y1="500" x2="${x + 75}" y2="530" stroke="#7d5535" stroke-opacity="0.5"/>`;
    s += `<line x1="${x}" y1="530" x2="${x}" y2="560" stroke="#7d5535" stroke-opacity="0.5"/>`;
  }
  s += `<line x1="0" y1="500" x2="${W}" y2="500" stroke="#7d5535" stroke-opacity="0.45"/>
  <line x1="0" y1="530" x2="${W}" y2="530" stroke="#7d5535" stroke-opacity="0.45"/>
  <rect x="0" y="462" width="${W}" height="10" fill="#d9cfbd"/>
  <rect x="0" y="462" width="${W}" height="2" fill="#efe8da"/>`;
  return s;
}

function bookshelf(rnd) {
  const x = 40, y = 70, w = 250, h = 400;
  const shelves = 5, gap = (h - 14) / shelves;
  const palette = ['#b5443b', '#3f6fa3', '#d9a441', '#4c8a5a', '#7c4f9e', '#2f4f6f', '#c9744a', '#e0d6c2', '#8b3a3a', '#5b7f9c', '#a6a63d', '#3b3b3b', '#d97b8c'];
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#5e4028"/>
  <rect x="${x + 8}" y="${y + 8}" width="${w - 16}" height="${h - 16}" fill="#7a5638"/>`;
  for (let i = 0; i < shelves; i++) {
    const shelfY = y + 8 + (i + 1) * gap - 6;
    let cx = x + 14;
    let maxX = x + w - 14;
    if (i === 1) { // a horizontal stack of books
      for (let k = 0; k < 4; k++) {
        const bw = 44 + rnd() * 8, bh = 8;
        s += `<rect x="${n(cx + (48 - bw) / 2)}" y="${n(shelfY - (k + 1) * bh)}" width="${n(bw)}" height="${bh - 1}" rx="1" fill="${palette[Math.floor(rnd() * palette.length)]}"/>`;
      }
      cx += 56;
    }
    if (i === 3) { // a globe
      const gx = cx + 22, gy = shelfY - 30;
      s += `<rect x="${gx - 10}" y="${shelfY - 5}" width="20" height="4" rx="1" fill="#3a2a1a"/>
      <line x1="${gx}" y1="${shelfY - 5}" x2="${gx}" y2="${gy + 10}" stroke="#3a2a1a" stroke-width="2"/>
      <path d="M ${gx - 22} ${gy} A 22 22 0 0 0 ${gx + 8} ${gy + 20}" stroke="#3a2a1a" stroke-width="2.5" fill="none"/>
      <circle cx="${gx}" cy="${gy}" r="18" fill="#4a86c8"/>
      <path d="M ${gx - 12} ${gy - 8} q 8 -6 14 2 q -2 8 -8 10 q -8 -2 -6 -12 Z" fill="#5fae5a"/>
      <path d="M ${gx + 2} ${gy + 6} q 6 -2 8 4 q -4 6 -8 2 Z" fill="#5fae5a"/>`;
      cx += 52;
    }
    if (i === 4) maxX -= 76;
    while (cx < maxX - 10) {
      const bw = 10 + rnd() * 12, bh = 40 + rnd() * 24;
      const col = palette[Math.floor(rnd() * palette.length)];
      if (rnd() < 0.06) { cx += 6; continue; }
      s += `<rect x="${n(cx)}" y="${n(shelfY - bh)}" width="${n(bw)}" height="${n(bh)}" rx="1" fill="${col}"/>
      <rect x="${n(cx + 2)}" y="${n(shelfY - bh + 6)}" width="${n(bw - 4)}" height="2" fill="#fff" fill-opacity="0.35"/>
      <rect x="${n(cx + 2)}" y="${n(shelfY - 10)}" width="${n(bw - 4)}" height="2" fill="#000" fill-opacity="0.15"/>`;
      cx += bw + 1;
    }
    if (i === 4) { // box files at the end of the bottom shelf
      for (let k = 0; k < 3; k++) {
        const bx = x + w - 14 - 72 + k * 24;
        s += `<rect x="${bx}" y="${n(shelfY - 62)}" width="21" height="62" rx="1" fill="${k === 1 ? '#556b8a' : '#7d8a99'}"/>
        <rect x="${bx + 5}" y="${n(shelfY - 50)}" width="11" height="16" fill="#f3f0e8"/>
        <circle cx="${bx + 10.5}" cy="${n(shelfY - 22)}" r="2.5" fill="#333"/>`;
      }
    }
    s += `<rect x="${x + 8}" y="${n(shelfY)}" width="${w - 16}" height="6" fill="#4a3220"/>`;
  }
  return s;
}

function pinboard() {
  return `<rect x="304" y="180" width="92" height="122" fill="#8a6a42"/>
  <rect x="310" y="186" width="80" height="110" fill="#c9a06a"/>
  <g transform="rotate(-2 350 240)">
    <rect x="316" y="196" width="68" height="94" fill="#fdfbf3" stroke="#d8d2c0"/>
    <circle cx="350" cy="201" r="3.5" fill="#d3372f"/>
  </g>
  <g id="note" font-size="11.5" font-family="'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive" fill="#333" text-anchor="middle"></g>`;
}

function windowFrame() {
  const f = '#f4f0e7', st = '#b6ad9c';
  return `<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="14" fill="${f}" stroke="${st}"/>
  <rect x="${WIN.x}" y="${VIEW.y + VIEW.h}" width="${WIN.w}" height="14" fill="${f}" stroke="${st}"/>
  <rect x="${WIN.x}" y="${WIN.y}" width="14" height="${WIN.h}" fill="${f}" stroke="${st}"/>
  <rect x="${VIEW.x + VIEW.w}" y="${WIN.y}" width="14" height="${WIN.h}" fill="${f}" stroke="${st}"/>
  <rect x="${VIEW.x + VIEW.w / 2 - 4}" y="${VIEW.y}" width="8" height="${VIEW.h}" fill="${f}" stroke="${st}"/>
  <rect x="${VIEW.x}" y="${VIEW.y + VIEW.h / 2 - 4}" width="${VIEW.w}" height="8" fill="${f}" stroke="${st}"/>
  <rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="2"/>
  <rect x="${SILL.x}" y="${SILL.y}" width="${SILL.w}" height="${SILL.h}" fill="#ede8dd" stroke="#b9b0a0"/>
  <rect x="${SILL.x}" y="${SILL.y}" width="${SILL.w}" height="5" fill="#f8f5ee"/>
  <rect x="${SILL.x + 4}" y="${SILL.y + SILL.h}" width="${SILL.w - 8}" height="6" fill="#000" fill-opacity="0.08"/>`;
}

function radiator() {
  let s = `<rect x="480" y="380" width="300" height="72" rx="4" fill="#e9e6df" stroke="#c4bfb2"/>`;
  for (let i = 0; i < 15; i++) {
    s += `<rect x="${n(488 + i * 19.5)}" y="386" width="13" height="60" rx="2" fill="#dedad0" stroke="#c4bfb2"/>`;
  }
  s += `<rect x="484" y="384" width="292" height="6" rx="2" fill="#d2cec4"/>
  <rect x="780" y="436" width="14" height="5" fill="#b8b2a6"/>
  <circle cx="798" cy="438" r="5" fill="#c2bcaf" stroke="#9a948a"/>`;
  return s;
}

function desk() {
  return `<rect x="900" y="350" width="280" height="14" rx="2" fill="#8b5a2b"/>
  <rect x="900" y="364" width="280" height="16" fill="#7a4d24"/>
  <rect x="1090" y="367" width="80" height="10" rx="1" fill="#6a4220"/>
  <rect x="1126" y="371" width="8" height="2" fill="#c9a86a"/>
  <rect x="912" y="380" width="12" height="90" fill="#6a4220"/>
  <rect x="1156" y="380" width="12" height="90" fill="#6a4220"/>
  <rect x="950" y="282" width="90" height="58" rx="3" fill="#2b2f36"/>
  <rect x="954" y="286" width="82" height="50" fill="url(#screenGrad)"/>
  <rect x="962" y="296" width="40" height="3" fill="#fff" fill-opacity="0.6"/>
  <rect x="962" y="304" width="58" height="3" fill="#fff" fill-opacity="0.4"/>
  <rect x="962" y="312" width="30" height="3" fill="#fff" fill-opacity="0.4"/>
  <polygon points="940,340 1050,340 1056,350 934,350" fill="#3a3f47"/>
  <rect x="960" y="342" width="70" height="3" fill="#20242a"/>
  <rect x="1064" y="322" width="26" height="28" rx="3" fill="#c9463d"/>
  <path d="M 1090 328 a 7 7 0 0 1 0 16" stroke="#c9463d" stroke-width="4" fill="none"/>
  <rect x="1095" y="341" width="46" height="9" fill="#f7f5ee" stroke="#d5d0c4"/>
  <rect x="1097" y="338" width="44" height="3" fill="#fff" stroke="#d5d0c4"/>
  <rect x="1146" y="334" width="8" height="14" fill="#3a3a3a"/>
  <ellipse cx="1150" cy="348" rx="22" ry="5" fill="#3a3a3a"/>
  <line x1="1150" y1="338" x2="1118" y2="262" stroke="#3a3a3a" stroke-width="5" stroke-linecap="round"/>
  <ellipse id="lamp-bulb" cx="1118" cy="262" rx="26" ry="5" fill="#ffe9a8" opacity="0"/>
  <polygon points="1104,232 1132,232 1148,262 1088,262" fill="#b23a2f" stroke="#7d2820"/>
  <rect x="960" y="120" width="100" height="80" fill="#caa451" stroke="#8a6a1e" stroke-width="2"/>
  <rect x="966" y="126" width="88" height="68" fill="#fbf8ef"/>
  <rect x="978" y="134" width="64" height="4" fill="#5a5a5a"/>
  <rect x="984" y="144" width="52" height="3" fill="#8a8a8a"/>
  <rect x="972" y="152" width="76" height="3" fill="#8a8a8a"/>
  <rect x="976" y="160" width="68" height="3" fill="#8a8a8a"/>
  <rect x="972" y="168" width="40" height="3" fill="#8a8a8a"/>
  <polygon points="1036,176 1042,188 1030,188" fill="#a33"/>
  <circle cx="1036" cy="176" r="6" fill="#d33" stroke="#a11"/>
  <circle cx="${CLOCK.cx}" cy="${CLOCK.cy}" r="${CLOCK.r}" fill="#fbfbf7" stroke="#3b3b3b" stroke-width="4"/>
  ${clockTicks()}
  <g id="clock-hands"></g>
  <circle cx="${CLOCK.cx}" cy="${CLOCK.cy}" r="2.5" fill="#3b3b3b"/>`;
}

function clockTicks() {
  let s = '';
  for (let i = 0; i < 12; i++) {
    const a = rad(i * 30), long = i % 3 === 0;
    const r1 = CLOCK.r - (long ? 8 : 5), r2 = CLOCK.r - 2;
    s += `<line x1="${n(CLOCK.cx + r1 * Math.sin(a))}" y1="${n(CLOCK.cy - r1 * Math.cos(a))}" x2="${n(CLOCK.cx + r2 * Math.sin(a))}" y2="${n(CLOCK.cy - r2 * Math.cos(a))}" stroke="#3b3b3b" stroke-width="${long ? 2 : 1}"/>`;
  }
  return s;
}

function pot() {
  const { cx, base, h, top, bottom } = POT;
  const y0 = base - h;
  return `<ellipse cx="${cx}" cy="${y0}" rx="${top / 2 - 6}" ry="5" fill="#3f2d1f"/>
  <rect x="${cx - top / 2}" y="${y0}" width="${top}" height="12" rx="2" fill="#cc7a4f" stroke="#9c4f2f"/>
  <polygon points="${cx - top / 2 + 4},${y0 + 12} ${cx + top / 2 - 4},${y0 + 12} ${cx + bottom / 2},${base} ${cx - bottom / 2},${base}" fill="url(#potGrad)" stroke="#9c4f2f"/>
  <ellipse cx="${cx}" cy="${base}" rx="${bottom / 2 + 8}" ry="3" fill="#000" fill-opacity="0.15"/>`;
}

function bowlBack() {
  const { cx, rim, base, rx, ry } = BOWL;
  return `<ellipse cx="${cx}" cy="${base}" rx="${rx - 10}" ry="3" fill="#000" fill-opacity="0.15"/>
  <path d="M ${cx - rx} ${rim} C ${cx - rx + 4} ${base - 10} ${cx - 30} ${base} ${cx} ${base} C ${cx + 30} ${base} ${cx + rx - 4} ${base - 10} ${cx + rx} ${rim} Z" fill="url(#bowlGrad)"/>
  <ellipse cx="${cx}" cy="${rim}" rx="${rx}" ry="${ry}" fill="#6f8fae"/>
  <ellipse cx="${cx}" cy="${rim}" rx="${rx - 6}" ry="${ry - 2.5}" fill="#35506b"/>`;
}

function bowlFront() {
  const { cx, rim, rx, ry } = BOWL;
  return `<path d="M ${cx - rx} ${rim} A ${rx} ${ry} 0 0 0 ${cx + rx} ${rim}" stroke="#8fb0cf" stroke-width="5" fill="none"/>
  <path d="M ${cx - rx + 10} ${rim + 14} Q ${cx - rx + 14} ${rim + 30} ${cx - 20} ${rim + 38}" stroke="#fff" stroke-opacity="0.25" stroke-width="3" fill="none" stroke-linecap="round"/>`;
}

function lighting() {
  return `<path id="dim" fill-rule="evenodd" d="M0 0 H${W} V${H} H0 Z M${VIEW.x} ${VIEW.y} H${VIEW.x + VIEW.w} V${VIEW.y + VIEW.h} H${VIEW.x} Z" fill="${NIGHT_TINT}" opacity="0"/>
  <g id="lamp-glow" opacity="0"><circle cx="${LAMP.glowX}" cy="${LAMP.glowY}" r="170" fill="url(#lampGlow)"/></g>`;
}

function staticScene(seed) {
  return defs() + room() + bookshelf(mulberry32(seed + 3)) + pinboard()
    + `<rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}" fill="#9cc7ea"/><g id="view" clip-path="url(#viewClip)"></g>`
    + windowFrame() + radiator() + desk()
    + `<g id="sill-objects">` + bowlBack() + `<g id="bowl-fruit" clip-path="url(#bowlClip)"></g>` + bowlFront()

    + pot() + `<g id="plant"></g></g>` + lighting();
}

// ---------------------------------------------------------------- the plant

function leafPath(len, w, curl) {
  return `M0 0 C ${n(w)} ${n(-len * 0.3)} ${n(w * 0.9)} ${n(-len * 0.75)} ${n(curl)} ${n(-len)} C ${n(-w * 0.9)} ${n(-len * 0.75)} ${n(-w)} ${n(-len * 0.3)} 0 0 Z`;
}

function fruitSVG(x, y, r, side, j) {
  const s = clamp(r / P.pickable, 0.12, 1);
  let col;
  if (r < 0.5) col = lerpHex('#4c9a3c', '#74b03c', r / 0.5);
  else if (r < 0.75) col = lerpHex('#74b03c', '#e08a2a', (r - 0.5) / 0.25);
  else col = lerpHex('#e08a2a', '#c8302b', (r - 0.75) / 0.25);
  const l = 36 * s, w = 6.5 * s, tilt = side * (10 + 8 * j);
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(tilt)})">
    <line x1="0" y1="0" x2="0" y2="7" stroke="#4f7f34" stroke-width="1.6"/>
    <g transform="translate(0 7)">
      <path d="M ${n(-w)} 0 C ${n(-w * 1.15)} ${n(l * 0.5)} ${n(-w * 0.2)} ${n(l * 0.85)} ${n(w * 0.25)} ${n(l)} C ${n(w * 0.6)} ${n(l * 0.8)} ${n(w * 1.15)} ${n(l * 0.5)} ${n(w)} 0 Z" fill="${col}" stroke="${shadeHex(col, 0.75)}" stroke-width="0.6"/>
      <path d="M ${n(-w * 0.5)} ${n(l * 0.15)} Q ${n(-w * 0.75)} ${n(l * 0.5)} ${n(-w * 0.25)} ${n(l * 0.75)}" stroke="#fff" stroke-opacity="0.35" stroke-width="${n(1.4 * s)}" fill="none" stroke-linecap="round"/>
      <path d="M ${n(-w * 1.2)} 1.5 L ${n(-w * 0.55)} -3 L 0 1.5 L ${n(w * 0.55)} -3 L ${n(w * 1.2)} 1.5 Z" fill="#4f7f34"/>
    </g></g>`;
}

function flowerSVG(x, y, p, side, j) {
  const ang = side * (40 + 15 * j);
  if (p < 0.3) {
    return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(ang)})">
      <line x1="0" y1="0" x2="0" y2="-6" stroke="#4f7f34" stroke-width="1.4"/>
      <ellipse cx="0" cy="-8" rx="2.2" ry="3.5" fill="#6da84a"/></g>`;
  }
  const s = 0.35 + 0.65 * (p - 0.3) / 0.7;
  let petals = '';
  for (let i = 0; i < 5; i++) petals += `<ellipse cx="0" cy="-5" rx="3" ry="5.2" fill="#fbfbf3" stroke="#e2dec6" stroke-width="0.6" transform="rotate(${i * 72})"/>`;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(ang)})">
    <line x1="0" y1="0" x2="0" y2="-8" stroke="#4f7f34" stroke-width="1.4"/>
    <g transform="translate(0 -12) scale(${n(s)})">${petals}<circle r="2.4" fill="#e5c032"/></g></g>`;
}

function plantSVG(state) {
  if (!state) return '';
  const G = state.careDays, wilt = state.wilt;
  const rnd = mulberry32((state.seed | 0) * 2654435 + 12345);
  const J = []; for (let i = 0; i < 80; i++) J.push(rnd() * 2 - 1);
  const ox = PLANT_ORIGIN.x, oy = PLANT_ORIGIN.y;
  const stems = [], leaves = [], extras = [];
  const leafFill = lerpHex('#3e8c3b', '#a8a24a', wilt);
  const leafDark = shadeHex(leafFill, 0.82);
  const stemCol = lerpHex('#5c8f3a', '#8c8a4c', wilt * 0.6);

  function stem(x, y, ang, len, w) {
    const ex = x + len * Math.sin(rad(ang)), ey = y - len * Math.cos(rad(ang));
    stems.push(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(ex)}" y2="${n(ey)}" stroke="${stemCol}" stroke-width="${n(w)}" stroke-linecap="round"/>`);
    return { x: ex, y: ey };
  }
  const along = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  function leaf(x, y, ang, len, dark, round) {
    if (len < 1) return;
    const w = len * (round ? 0.55 : 0.36) * (1 - 0.25 * wilt);
    const curl = wilt * len * 0.18;
    leaves.push(`<g transform="translate(${n(x)} ${n(y)}) rotate(${n(ang)})">
      <path d="${leafPath(len, w, curl)}" fill="${dark ? leafDark : leafFill}"/>
      <path d="M0 0 Q ${n(curl * 0.3)} ${n(-len * 0.5)} ${n(curl)} ${n(-len)}" stroke="${shadeHex(leafFill, 0.65)}" stroke-width="0.8" fill="none"/></g>`);
  }

  if (G < P.sprout) {
    const p = (G - 0.15) / (P.sprout - 0.15);
    if (p <= 0) return '';
    const h = 4 + 30 * p;
    const top = stem(ox, oy, J[0] * 6, h, 2.2);
    const cl = 5 + 9 * p;
    leaf(top.x, top.y, J[0] * 6 - 55 - 30 * wilt, cl, true, true);
    leaf(top.x, top.y, J[0] * 6 + 55 + 30 * wilt, cl, false, true);
    return stems.join('') + leaves.join('');
  }

  const L = 205 * (1 - Math.exp(-G / P.heightScale));
  const fB = clamp((G - 2) / 3, 0, 1);      // main branches
  const fS = clamp((G - 4.5) / 4, 0, 1);    // secondary branches
  const slotPos = new Array(P.slots).fill(null);

  const trunkAng = J[0] * 3;
  const t0 = { x: ox, y: oy };
  const t1 = stem(ox, oy, trunkAng, L * 0.4, 3 + L * 0.02);

  // cotyledons linger near the base while the plant is small
  const cot = 10 * clamp(1 - (G - 3) / 2, 0, 1);
  if (cot > 0.5) {
    const c = along(t0, t1, 0.12);
    leaf(c.x, c.y, trunkAng - 70 - 30 * wilt, cot, true, true);
    leaf(c.x, c.y, trunkAng + 70 + 30 * wilt, cot, false, true);
  }
  [[0.28, -1], [0.46, 1], [0.64, -1], [0.82, 1]].forEach(([at, side], i) => {
    const pos = along(t0, t1, at);
    const size = L * 0.25 * (0.85 + 0.15 * J[1 + i]);
    leaf(pos.x, pos.y, trunkAng + side * (48 + 10 * J[5 + i] + 78 * wilt), size, side < 0, false);
  });
  if (fB > 0) { // a pair of leaves at the first fork
    leaf(t1.x, t1.y, trunkAng - (30 + 8 * J[9] + 70 * wilt), L * 0.2 * fB, true, false);
    leaf(t1.x, t1.y, trunkAng + (30 + 8 * J[9] + 70 * wilt), L * 0.2 * fB, false, false);
  }
  slotPos[0] = { x: t1.x, y: t1.y, side: J[7] > 0 ? 1 : -1 };

  if (fB > 0) {
    [-1, 1].forEach((side, si) => {
      const b = 10 + si * 24;
      const ang = trunkAng + side * (34 + 8 * J[b] + 22 * wilt);
      const len = L * 0.32 * fB * (0.9 + 0.1 * J[b + 1]);
      const b1 = stem(t1.x, t1.y, ang, len, 2.2 + L * 0.012);
      const p1 = along(t1, b1, 0.45);
      leaf(p1.x, p1.y, ang + side * (50 + 10 * J[b + 2] + 70 * wilt), L * 0.22 * fB * (0.9 + 0.1 * J[b + 3]), false, false);
      const p2 = along(t1, b1, 0.8);
      leaf(p2.x, p2.y, ang - side * (45 + 10 * J[b + 4] + 70 * wilt), L * 0.2 * fB * (0.9 + 0.1 * J[b + 5]), true, false);
      slotPos[side < 0 ? 1 : 2] = { x: b1.x, y: b1.y, side };
      const pm = along(t1, b1, 0.6);
      slotPos[side < 0 ? 7 : 8] = { x: pm.x, y: pm.y, side };
      if (fS > 0) {
        [-1, 1].forEach((s2, ui) => {
          const c = b + 6 + ui * 8;
          const ang2 = ang + s2 * (26 + 6 * J[c]) + side * wilt * 12;
          const len2 = L * 0.26 * fS * (0.9 + 0.1 * J[c + 1]);
          const c1 = stem(b1.x, b1.y, ang2, len2, 1.6 + L * 0.008);
          const q = along(b1, c1, 0.38);
          leaf(q.x, q.y, ang2 + s2 * (50 + 10 * J[c + 2] + 70 * wilt), L * 0.19 * fS * (0.9 + 0.1 * J[c + 3]), s2 < 0, false);
          const q2 = along(b1, c1, 0.7);
          leaf(q2.x, q2.y, ang2 - s2 * (46 + 10 * J[c + 3] + 70 * wilt), L * 0.17 * fS * (0.9 + 0.1 * J[c + 2]), s2 > 0, false);
          [-1, 1].forEach((s3, ti) => {
            leaf(c1.x, c1.y, ang2 + s3 * (32 + 8 * J[c + 4 + ti] + 70 * wilt), L * 0.17 * fS * (0.9 + 0.1 * J[c + 6 + ti]), s3 < 0, false);
          });
          slotPos[3 + si * 2 + ui] = { x: c1.x, y: c1.y, side: s2 };
        });
      }
    });
  }

  state.slots.forEach(slot => {
    const pos = slotPos[slot.k];
    if (!pos || slot.kind === 'none') return;
    const j = J[60 + slot.k];
    extras.push(slot.kind === 'fruit'
      ? fruitSVG(pos.x, pos.y, slot.ripeness, pos.side, j)
      : flowerSVG(pos.x, pos.y, slot.progress, pos.side, j));
  });

  return stems.join('') + leaves.join('') + extras.join('');
}

const BOWL_SHOWN = 23;
function bowlSVG(bowl) {
  if (!bowl || !bowl.length) return '';
  const { cx, rim } = BOWL;
  const rnd = mulberry32(4242);
  const shown = bowl.slice(-BOWL_SHOWN);
  const rows = [6, 5, 5, 4, 3];
  let s = '';
  let idx = 0;
  for (let row = 0; row < rows.length && idx < shown.length; row++) {
    const count = rows[row];
    for (let i = 0; i < count && idx < shown.length; i++, idx++) {
      const f = shown[idx];
      const x = cx + (i - (count - 1) / 2) * 16 + (rnd() - 0.5) * 4;
      const y = rim + 3 - row * 7.5 + (rnd() - 0.5) * 2;
      const side = i % 2 === 0 ? 1 : -1;
      const rot = side * (80 + (rnd() - 0.5) * 24);
      s += `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)}) scale(0.72)">${fruitSVG(0, -7, Math.max(f.ripeness, P.pickable), 0, 0)}</g>`;
    }
  }
  return s;
}

// ---------------------------------------------------------------- the window

const SEASON = {
  far:    { winter: '#e3e9ef', spring: '#8fbd77', summer: '#7fa46f', autumn: '#b39a55' },
  near:   { winter: '#f1f4f7', spring: '#7ab35e', summer: '#5f8a4a', autumn: '#9a8f3c' },
  skyTop: { winter: '#8fb3d6', spring: '#4d97dc', summer: '#3d8fdc', autumn: '#5a93c8' },
  skyBot: { winter: '#dbe6ee', spring: '#cfe6f6', summer: '#c3e4f8', autumn: '#dcd9c8' }
};
const AUTUMN_CANOPY = ['#d0742c', '#c9a227', '#b5452f', '#e0913a', '#a86b2a'];
const TREES = [[0.06, 0.72, 1], [0.19, 0.75, 0.8], [0.33, 0.73, 1.1], [0.47, 0.75, 0.75], [0.96, 0.74, 0.9]];
const HOUSES = [
  { fx: 0.56, w: 42, h: 28, wall: '#e9dcc4', roof: '#8a4b3b', win: [[7, 9], [27, 9]], dark: 1 },
  { fx: 0.665, w: 34, h: 24, wall: '#d8b9a1', roof: '#5b5b68', win: [[6, 8], [21, 8]], dark: 0 },
  { fx: 0.755, w: 50, h: 34, wall: '#f1e8d8', roof: '#7a3d2f', win: [[7, 11], [22, 11], [36, 11]], dark: 2 },
  { fx: 0.87, w: 38, h: 26, wall: '#cbd5de', roof: '#4d4d56', win: [[6, 8], [24, 8]], dark: -1 }
];

function seasonHex(pal, w) {
  return mixHex([[pal.winter, w.winter], [pal.spring, w.spring], [pal.summer, w.summer], [pal.autumn, w.autumn]]);
}

function makeClouds(seed) {
  const rnd = mulberry32(seed + 77);
  return Array.from({ length: 7 }, () => ({
    baseX: rnd() * (VIEW.w + 260),
    y: VIEW.y + 16 + rnd() * VIEW.h * 0.42,
    scale: 0.55 + rnd() * 0.75,
    speed: 0.7 + rnd() * 0.6,
    blobs: Array.from({ length: 5 }, () => ({ dx: rnd() * 64 - 32, dy: rnd() * 12 - 10, r: 12 + rnd() * 13 }))
  }));
}

function makeDrops(seed, count) {
  const rnd = mulberry32(seed + 99);
  return Array.from({ length: count }, () => ({
    x: VIEW.x - 20 + rnd() * (VIEW.w + 40),
    y: VIEW.y - 60 + rnd() * (VIEW.h + 60),
    l: 10 + rnd() * 10,
    r: 1.2 + rnd() * 1.3
  }));
}

// Cloud drift is a continuous function of time: a steady speed plus a slowly
// varying "gust" term, so wind changes never make clouds jump.
function cloudTransform(c, t, seed) {
  const span = VIEW.w + 260;
  const px = c.baseX + c.speed * (t * 1.5 + 5000 * smoothNoise(t / 3600, 2.5, seed + 5));
  const x = VIEW.x - 130 + ((px % span) + span) % span;
  return `translate(${n(x)} ${n(c.y)}) scale(${n(c.scale)})`;
}

function cloudShape(c, fill) {
  let s = `<rect x="-40" y="-4" width="80" height="16" rx="8" fill="${fill}"/>`;
  for (const b of c.blobs) s += `<circle cx="${n(b.dx)}" cy="${n(b.dy)}" r="${n(b.r)}" fill="${fill}"/>`;
  return s;
}

function housesSVG(d, grey, season) {
  const { x, y, w, h } = VIEW;
  const baseY = y + h * 0.745;
  const tint = (dayHex, nightHex) => lerpHex(lerpHex(nightHex, dayHex, d), '#8a8f94', grey);
  let s = '';
  HOUSES.forEach((hs, i) => {
    const hx = x + w * hs.fx - hs.w / 2, hy = baseY - hs.h;
    const wall = tint(hs.wall, '#151c2b');
    const roofDay = lerpHex(hs.roof, '#eef2f6', season.winter * 0.9);
    const roof = tint(roofDay, '#0e141f');
    const peak = hy - hs.h * 0.55;
    const cx = hx + hs.w * 0.7;
    s += `<rect x="${n(cx - 2.5)}" y="${n(peak + 6)}" width="5" height="${n(hy - peak - 2)}" fill="${tint('#6b4a3c', '#0e141f')}"/>
    <rect x="${n(hx)}" y="${n(hy)}" width="${hs.w}" height="${hs.h}" fill="${wall}"/>
    <polygon points="${n(hx - 3)},${n(hy)} ${n(hx + hs.w + 3)},${n(hy)} ${n(hx + hs.w / 2)},${n(peak)}" fill="${roof}"/>
    <rect x="${n(hx + hs.w / 2 - 3.5)}" y="${n(baseY - 10)}" width="7" height="10" fill="${tint('#5a3f32', '#0b1018')}"/>`;
    hs.win.forEach(([wx, wy], k) => {
      const lit = k === hs.dark ? 0.15 : 1;
      s += `<rect x="${n(hx + wx)}" y="${n(hy + wy)}" width="6" height="7" fill="${tint('#7f9bb8', '#1b2333')}"/>
      <rect x="${n(hx + wx)}" y="${n(hy + wy)}" width="6" height="7" fill="#ffe08a" opacity="${n((1 - d) * 0.95 * lit)}"/>`;
    });
  });
  return s;
}

function viewSVG(sun, wx, season, clouds, drops, t, seed) {
  const { x, y, w, h } = VIEW;
  const d = sun.daylight;
  const [top, bot] = skyColors(d, sun.twilight, wx, seasonHex(SEASON.skyTop, season), seasonHex(SEASON.skyBot, season));
  const horizon = y + h * 0.6;
  let s = `<defs>
    <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient>
    <radialGradient id="glowGrad" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff9a4a" stop-opacity="0.85"/><stop offset="0.5" stop-color="#ff9a4a" stop-opacity="0.3"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#skyGrad)"/>`;

  if (sun.stars > 0.01) {
    const rnd = mulberry32(99);
    const op = sun.stars * (1 - wx.cloud * 0.85) * (1 - wx.fog);
    for (let i = 0; i < 50; i++) {
      const sx = x + rnd() * w, sy = y + rnd() * h * 0.7, r = 0.6 + rnd() * 1;
      const bright = rnd();
      // faint stars are the first to go as twilight brightens
      s += `<circle cx="${n(sx)}" cy="${n(sy)}" r="${n(r)}" fill="#fff" opacity="${n(clamp(op * (0.4 + 0.6 * bright) - (1 - sun.stars) * (1 - bright) * 0.6, 0, 1))}"/>`;
    }
  }
  const sunX = x + sun.x * w;
  if (sun.twilight > 0.02) {
    const gx = clamp(sunX, x + w * 0.1, x + w * 0.9);
    s += `<ellipse cx="${n(gx)}" cy="${n(horizon)}" rx="${n(w * 0.5)}" ry="${n(h * 0.34)}" fill="url(#glowGrad)" opacity="${n(sun.twilight * 0.8 * (1 - wx.cloud * 0.5) * (1 - wx.fog))}"/>`;
  }
  if (sun.elevation > -1.5 && sun.x > -0.1 && sun.x < 1.1) {
    const sy = horizon - sun.elevation / 60 * h * 0.85;
    const col = lerpHex('#ffb347', '#fff6c8', clamp(sun.elevation / 20, 0, 1));
    s += `<circle cx="${n(sunX)}" cy="${n(sy)}" r="40" fill="${col}" opacity="${n(0.22 * (1 - wx.cloud * 0.7) * (1 - wx.fog))}"/>
    <circle cx="${n(sunX)}" cy="${n(sy)}" r="15" fill="${col}" opacity="${n((1 - wx.cloud * 0.85) * (1 - wx.fog * 0.7))}"/>`;
  }
  if (d < 0.6) {
    const f = clamp(sun.moonFrac, 0, 1);
    const mx = x + 30 + f * (w - 60), my = y + h * 0.8 - Math.sin(Math.PI * f) * h * 0.6;
    const op = clamp(1 - d * 1.6, 0, 1) * (1 - wx.cloud * 0.8) * (1 - wx.fog);
    s += `<g opacity="${n(op)}"><circle cx="${n(mx)}" cy="${n(my)}" r="12" fill="#f4f1e0"/><circle cx="${n(mx + 5)}" cy="${n(my - 3)}" r="10" fill="${top}"/></g>`;
  }

  const grey = wx.cloud * 0.4 * d;
  const tint = (dayHex, nightHex) => lerpHex(lerpHex(nightHex, dayHex, d), '#8d9aa0', grey);
  const far = tint(seasonHex(SEASON.far, season), '#1e2a44');
  const near = tint(seasonHex(SEASON.near, season), '#16202e');
  s += `<path d="M ${x} ${y + h * 0.62} Q ${x + w * 0.18} ${y + h * 0.44} ${x + w * 0.38} ${y + h * 0.58} T ${x + w * 0.72} ${y + h * 0.5} T ${x + w + 10} ${y + h * 0.6} V ${y + h} H ${x} Z" fill="${far}"/>`;
  s += housesSVG(d, grey, season);
  s += `<path d="M ${x - 10} ${y + h * 0.74} Q ${x + w * 0.25} ${y + h * 0.62} ${x + w * 0.5} ${y + h * 0.72} T ${x + w + 10} ${y + h * 0.7} V ${y + h} H ${x - 10} Z" fill="${near}"/>`;

  const trunk = tint('#5a3f2a', '#0e1218');
  const leafy = 1 - season.winter;
  TREES.forEach(([tx, ty, ts], i) => {
    const px = x + w * tx, py = y + h * ty;
    const canopy = tint(mixHex([['#8fcf6a', season.spring], ['#3f7a3a', season.summer], [AUTUMN_CANOPY[i], season.autumn]]), '#12202a');
    s += `<rect x="${n(px - 2.5 * ts)}" y="${n(py)}" width="${n(5 * ts)}" height="${n(22 * ts)}" fill="${trunk}"/>
    <path d="M ${n(px)} ${n(py + 2 * ts)} L ${n(px - 11 * ts)} ${n(py - 10 * ts)} M ${n(px)} ${n(py)} L ${n(px + 10 * ts)} ${n(py - 12 * ts)} M ${n(px)} ${n(py - 2 * ts)} L ${n(px + 1 * ts)} ${n(py - 18 * ts)} M ${n(px)} ${n(py + 4 * ts)} L ${n(px - 6 * ts)} ${n(py - 2 * ts)} L ${n(px - 12 * ts)} ${n(py - 1 * ts)}" stroke="${trunk}" stroke-width="${n(2 * ts)}" fill="none" stroke-linecap="round"/>`;
    if (leafy > 0.02) {
      s += `<g opacity="${n(leafy)}"><circle cx="${n(px)}" cy="${n(py - 4 * ts)}" r="${n(16 * ts)}" fill="${canopy}"/>
      <circle cx="${n(px - 9 * ts)}" cy="${n(py + 2 * ts)}" r="${n(11 * ts)}" fill="${canopy}"/>
      <circle cx="${n(px + 9 * ts)}" cy="${n(py + 1 * ts)}" r="${n(12 * ts)}" fill="${canopy}"/>`;
      if (season.spring > 0.05) {
        const blossom = tint('#f6b8cc', '#3a2a3a');
        const pts = [[-8, -10], [5, -14], [12, -2], [-13, 2], [0, -3], [-4, 7], [9, 8]];
        s += `<g opacity="${n(season.spring)}">` + pts.map(([bx, by]) => `<circle cx="${n(px + bx * ts)}" cy="${n(py + by * ts)}" r="${n(2.6 * ts)}" fill="${blossom}"/>`).join('') + `</g>`;
      }
      s += `</g>`;
    }
    if (season.winter > 0.3) {
      s += `<ellipse cx="${n(px)}" cy="${n(py + 22 * ts)}" rx="${n(16 * ts)}" ry="${n(3 * ts)}" fill="${tint('#f4f7fa', '#1c2432')}" opacity="${n((season.winter - 0.3) / 0.7)}"/>`;
    }
  });

  const dayFill = lerpHex('#ffffff', '#6b7480', 0.25 * wx.cloud + 0.5 * wx.rain);
  const cloudFill = lerpHex(lerpHex('#232c45', dayFill, d), '#f0a070', sun.twilight * 0.55 * (1 - wx.rain));
  s += `<g id="clouds">`;
  clouds.forEach((c, i) => {
    const op = clamp(wx.cloud * 8 - i, 0, 1) * 0.95;
    s += `<g id="cloud${i}" opacity="${n(op)}" transform="${cloudTransform(c, t, seed)}">${cloudShape(c, cloudFill)}</g>`;
  });
  s += `</g>`;

  if (wx.fog > 0.02) {
    const fogCol = lerpHex('#1c2230', '#d8dde3', d);
    s += `<rect x="${x}" y="${y + h * 0.3}" width="${w}" height="${h * 0.7}" fill="${fogCol}" opacity="${n(wx.fog * 0.75)}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fogCol}" opacity="${n(wx.fog * 0.35)}"/>`;
  }
  if (wx.rain > 0.02) {
    if (wx.snow > 0.5) {
      s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#c8d2dc" opacity="${n(wx.rain * 0.25)}"/>`;
      s += `<g id="snow" opacity="${n(0.85 * wx.rain)}" fill="#fff">`;
      for (const f of drops) s += `<circle cx="${n(f.x)}" cy="${n(f.y)}" r="${n(f.r)}"/>`;
      s += `</g>`;
    } else {
      s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#3b4a5c" opacity="${n(wx.rain * 0.22)}"/>`;
      s += `<g id="rain" opacity="${n(0.55 * wx.rain)}" stroke="${lerpHex('#9fb3c8', '#e3eef8', d)}" stroke-width="1.2" stroke-linecap="round">`;
      for (const r of drops) s += `<line x1="${n(r.x)}" y1="${n(r.y)}" x2="${n(r.x - r.l * 0.25)}" y2="${n(r.y + r.l)}"/>`;
      s += `</g>`;
    }
  }
  s += `<polygon points="${x + 40},${y} ${x + 110},${y} ${x + 30},${y + h} ${x - 40},${y + h}" fill="#fff" opacity="0.06"/>
  <polygon points="${x + 130},${y} ${x + 160},${y} ${x + 80},${y + h} ${x + 50},${y + h}" fill="#fff" opacity="0.05"/>`;
  return s;
}

// ---------------------------------------------------------------- controller

export function createScene(svg, { weatherSeed = 0, timeZone, location = { latitude: 56.12, longitude: -3.94 } } = {}) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = staticScene(weatherSeed);
  const byId = id => svg.querySelector('#' + id);
  const clouds = makeClouds(weatherSeed);
  const drops = makeDrops(weatherSeed, 70);
  let overrides = {};
  let liveTarget = null;   // latest live conditions, or null to use the synthetic weather
  let eased = null;        // live conditions eased over a few renders so changes never pop

  function clockFor(now) {
    const clk = officeClock(now, timeZone);
    if (overrides.hour != null) {
      const hrs = ((overrides.hour % 24) + 24) % 24;
      clk.hours = hrs; clk.hour = Math.floor(hrs); clk.minute = Math.floor((hrs % 1) * 60); clk.second = 0;
    }
    if (overrides.doy != null) {
      clk.doy = overrides.doy;
      // daylight saving depends on the date being previewed, not today
      clk.utcOffset = utcOffsetHours(Date.UTC(clk.year, 0, overrides.doy, 12), timeZone);
    }
    return clk;
  }

  function positionDynamic(t) {
    clouds.forEach((c, i) => {
      const el = byId('cloud' + i);
      if (el) el.setAttribute('transform', cloudTransform(c, t, weatherSeed));
    });
    const rn = byId('rain');
    if (rn) rn.setAttribute('transform', `translate(0 ${n((t * 240) % 60)})`);
    const sn = byId('snow');
    if (sn) sn.setAttribute('transform', `translate(${n(10 * Math.sin(t * 0.5))} ${n((t * 22) % 60)})`);
  }

  function renderView(now) {
    const clk = clockFor(now);
    const sun = sunState(clk.hours, clk.doy, location.latitude, location.longitude, clk.utcOffset);
    const season = seasonWeights(clk.doy);
    let wx = weatherAt(now, weatherSeed);
    wx.snow = season.winter > 0.5 ? 1 : 0;
    if (liveTarget) {
      if (!eased) eased = { ...liveTarget };
      else for (const k of ['cloud', 'rain', 'snow', 'fog', 'wind']) eased[k] += (liveTarget[k] - eased[k]) * 0.25;
      wx = { ...wx, ...eased, source: liveTarget.source };
    }
    if (overrides.cloud != null) {
      wx.cloud = clamp(overrides.cloud, 0, 1);
      wx.rain = rainFrom(wx.cloud, wx.wet);
    }
    if (overrides.rain != null) wx.rain = clamp(overrides.rain, 0, 1);
    if (overrides.snow != null) wx.snow = overrides.snow ? 1 : 0;
    if (overrides.fog != null) wx.fog = clamp(overrides.fog, 0, 1);
    byId('view').innerHTML = viewSVG(sun, wx, season, clouds, drops, Date.now() / 1000, weatherSeed);
    const d = sun.daylight;
    byId('dim').setAttribute('opacity', n(clamp((1 - d) * 0.5, 0, 1)));
    byId('lamp-glow').setAttribute('opacity', n(1 - d));
    byId('lamp-bulb').setAttribute('opacity', n(1 - d));
    byId('sill-objects').style.filter = d > 0.98 ? '' : `brightness(${n(1 - (1 - d) * 0.45)})`;
    return { daylight: d, wx, clk, season, background: lerpHex(WALL, NIGHT_TINT, (1 - d) * 0.5) };
  }

  function renderClock(now) {
    const clk = clockFor(now);
    const { cx, cy, r } = CLOCK;
    const hand = (deg, len, wdt) => `<line x1="${cx}" y1="${cy}" x2="${n(cx + len * Math.sin(rad(deg)))}" y2="${n(cy - len * Math.cos(rad(deg)))}" stroke="#3b3b3b" stroke-width="${wdt}" stroke-linecap="round"/>`;
    byId('clock-hands').innerHTML =
      hand((clk.hours % 12) * 30, r * 0.5, 3.5) +
      hand(clk.minute * 6 + clk.second * 0.1, r * 0.75, 2.5) +
      `<line x1="${cx}" y1="${cy}" x2="${n(cx + r * 0.8 * Math.sin(rad(clk.second * 6)))}" y2="${n(cy - r * 0.8 * Math.cos(rad(clk.second * 6)))}" stroke="#c0392b" stroke-width="1"/>`;
  }

  function renderPlant(state) {
    byId('plant').innerHTML = plantSVG(state);
    byId('bowl-fruit').innerHTML = bowlSVG(state ? state.bowl : []);
  }

  function renderNote(lines) {
    byId('note').innerHTML = lines.slice(0, 6).map((t, i) =>
      `<text x="350" y="${218 + i * 13.5}" transform="rotate(-2 350 240)"${i === 0 ? ' font-weight="bold"' : ''}>${escapeXml(t)}</text>`).join('');
  }

  (function frame() {
    requestAnimationFrame(frame);
    if (!document.hidden) positionDynamic(Date.now() / 1000);
  })();

  return {
    renderView, renderClock, renderPlant, renderNote,
    setOverrides(o) { overrides = o || {}; },
    setWeather(target) { liveTarget = target || null; if (!target) eased = null; }
  };
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
