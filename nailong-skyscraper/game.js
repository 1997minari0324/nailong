'use strict';

const BEST_KEY = 'nailong-skyscraper-best';
const MUTE_KEY = 'nailong-skyscraper-mute';
const FLOOR_H = 78;
const CELL = 78;
const MODULE_GAP = 5;

const SKINS = [
  { id: 'happy', file: 'assets/happy.jpg' },
  { id: 'wink', file: 'assets/wink.jpg' },
  { id: 'wow', file: 'assets/wow.jpg' },
  { id: 'mad', file: 'assets/mad.jpg' },
  { id: 'sleep', file: 'assets/sleep.jpg' },
  { id: 'egg', file: 'assets/egg.jpg' },
];

const WALLS = [
  { wall: '#ffe08a', trim: '#e2b14a', side: '#d39a3a', roof: '#fff1c2' },
  { wall: '#ffd0dc', trim: '#e07a90', side: '#d46880', roof: '#ffe4ec' },
  { wall: '#c7e8ff', trim: '#6eb6e8', side: '#5aa0d4', roof: '#e5f5ff' },
  { wall: '#d5f5c4', trim: '#7cbc62', side: '#6aaa52', roof: '#eafadf' },
  { wall: '#e4d4ff', trim: '#a98ae0', side: '#9678cc', roof: '#f3eaff' },
  { wall: '#ffe0c2', trim: '#e09458', side: '#cc8048', roof: '#ffedd8' },
];

const SKY = [
  { at: 0, top: [143, 212, 255], mid: [232, 248, 255], bot: [186, 228, 140] },
  { at: 28, top: [110, 196, 255], mid: [214, 240, 255], bot: [154, 208, 240] },
  { at: 58, top: [255, 170, 116], mid: [255, 216, 176], bot: [130, 178, 228] },
  { at: 88, top: [36, 50, 96], mid: [70, 86, 150], bot: [28, 36, 78] },
  { at: 125, top: [7, 10, 24], mid: [18, 24, 52], bot: [8, 12, 32] },
];

const images = {};
SKINS.forEach((skin) => {
  const img = new Image();
  img.src = skin.file;
  images[skin.id] = img;
});

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const board = document.getElementById('board');
const overlay = document.getElementById('overlay');
const card = document.getElementById('card');
const scoreEl = document.getElementById('score');
const floorsEl = document.getElementById('floors');
const bestEl = document.getElementById('best');
const muteBtn = document.getElementById('mute');

let w = 0;
let h = 0;
let layoutW = 0;
let dpr = 1;
let mode = 'menu';
let phase = 'swing';
let best = { people: 0, floors: 0 };
let residents = 0;
let combo = 0;
let comboTime = 0;
let comboMax = 2.3;
let newPeople = false;
let newHeight = false;
let muted = false;
let actx = null;
let time = 0;
let swingClock = 0;
let cam = 0;
let shake = 0;
let overDelay = 0;
let overShown = false;
let floors = [];
let piece = null;
let hangForm = 'cubes';
let debris = [];
let floaters = [];
let puffs = [];
let clouds = [];
let stars = [];

function loadStore() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      best.people = Number(data.people) || 0;
      best.floors = Number(data.floors) || 0;
    }
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) { /* ignore */ }
  muteBtn.textContent = muted ? '🔇' : '🔊';
}

function saveBest() {
  const built = builtFloors();
  if (residents > best.people) {
    best.people = residents;
    newPeople = true;
  }
  if (built > best.floors) {
    best.floors = built;
    newHeight = true;
  }
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch (e) { /* ignore */ }
}

function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!actx) actx = new AC();
  if (actx.state === 'suspended') actx.resume();
}

function tone(freq, dur, type, vol) {
  if (muted || !actx) return;
  try {
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(actx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (e) { /* ignore */ }
}

function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function builtFloors() {
  return Math.max(0, floors.length - 1);
}

function widthFor(cells, form) {
  const n = Math.max(1, cells);
  if (n === 1 || form === 'box') return n * CELL;
  return n * CELL + (n - 1) * MODULE_GAP;
}

function makeFloor(center, cells, form, seed) {
  const use = cells <= 1 ? 'cubes' : form;
  return {
    center,
    cells,
    form: use,
    seed,
    flash: 0,
    width: widthFor(cells, use),
  };
}

function anchorY() {
  return h * 0.56;
}

function floorTop(index) {
  return anchorY() + cam - index * FLOOR_H;
}

function swingOmega() {
  const n = builtFloors();
  if (n < 2) return 0.82;
  return Math.min(2.45, 0.92 + n * 0.026);
}

function swingAmp() {
  const n = builtFloors();
  return Math.min(1.02, 0.58 + n * 0.0045);
}

function cableLen() {
  return Math.min(138, Math.max(96, h * 0.2));
}

function pendulum() {
  const omega = swingOmega();
  const amp = swingAmp();
  const angle = Math.sin(swingClock * omega) * amp;
  const dAngle = Math.cos(swingClock * omega) * omega * amp;
  const cable = cableLen();
  const pivotX = w / 2;
  const pivotY = 28;
  const hx = pivotX + Math.sin(angle) * cable;
  const hy = pivotY + Math.cos(angle) * cable;
  const vx = Math.cos(angle) * cable * dAngle;
  const vy = -Math.sin(angle) * cable * dAngle;
  return { hx, hy, vx, vy, pivotX, pivotY, angle };
}

function makeClouds() {
  clouds = [];
  for (let i = 0; i < 7; i++) {
    clouds.push({
      x: (i + 0.2) / 7,
      y: 0.08 + (i % 3) * 0.1,
      s: 0.75 + (i % 4) * 0.18,
      v: 0.008 + (i % 3) * 0.004,
    });
  }
  stars = [];
  for (let i = 0; i < 48; i++) {
    stars.push({
      x: (i * 47 % 100) / 100,
      y: (i * 29 % 70) / 100,
      r: i % 5 === 0 ? 1.8 : 1,
      p: i * 0.7,
    });
  }
}

function spawnFloat(text, x, y, big) {
  floaters.push({
    text,
    x: x == null ? w / 2 : x,
    y: y == null ? anchorY() - 24 : y,
    life: 1,
    big: !!big,
  });
}

function spawnDust(x, y, width) {
  for (let i = 0; i < 7; i++) {
    puffs.push({
      x: x + (Math.random() - 0.5) * width,
      y,
      vx: (Math.random() - 0.5) * 90,
      vy: -20 - Math.random() * 50,
      life: 0.45,
    });
  }
}

function spawnDebris(x, y, width, dir, seed) {
  if (width < 4) return;
  debris.push({
    x,
    y,
    w: width,
    h: FLOOR_H,
    vx: dir * (70 + Math.random() * 40),
    vy: 20,
    rot: 0,
    vr: dir * (1.2 + Math.random()),
    life: 1,
    seed,
  });
}

function syncHud() {
  scoreEl.textContent = String(residents);
  floorsEl.textContent = builtFloors() + ' 层';
  bestEl.textContent = '最高 ' + best.people;
}

function showMenu() {
  mode = 'menu';
  phase = 'swing';
  card.innerHTML = '<h1>奶龙摩天楼</h1>'
    + '<p class="lead">方块里装着奶龙。它会左右摆，点一下放下来，叠到下面那块的正上方。</p>'
    + '<p class="note">有的是正方块，有的是长方块。叠歪了，多出来的一截会掉下去。连续叠正，入住的人会更多。</p>'
    + '<button class="primary" type="button" data-act="start">开始盖楼</button>'
    + '<p class="note">最高入住 ' + best.people + ' 人 · 最高 ' + best.floors + ' 层</p>'
    + '<a class="ghost" href="../">返回</a>';
  overlay.classList.add('show');
  syncHud();
}

function showOver() {
  overShown = true;
  const record = newPeople ? '<p class="record">新的入住纪录！</p>' : (newHeight ? '<p class="record">盖得更高了！</p>' : '');
  card.innerHTML = '<h1>楼盖倒啦</h1>'
    + '<p class="score-lg">' + residents + ' 人</p>'
    + record
    + '<p class="note">盖了 ' + builtFloors() + ' 层</p>'
    + '<p class="note">最高入住 ' + best.people + ' 人 · 最高 ' + best.floors + ' 层</p>'
    + '<div class="actions"><button class="primary" type="button" data-act="retry">再盖一次</button>'
    + '<a class="ghost" href="../">返回</a></div>';
  overlay.classList.add('show');
  syncHud();
}

function resetTower() {
  residents = 0;
  combo = 0;
  comboTime = 0;
  comboMax = 2.3;
  newPeople = false;
  newHeight = false;
  cam = 0;
  shake = 0;
  overDelay = 0;
  overShown = false;
  debris = [];
  floaters = [];
  puffs = [];
  piece = null;
  hangForm = 'cubes';
  floors = [makeFloor(w / 2, 3, 'cubes', 0)];
  phase = 'swing';
  swingClock = (Math.PI / 2) / swingOmega();
}

function startGame() {
  unlockAudio();
  resetTower();
  mode = 'play';
  overlay.classList.remove('show');
  syncHud();
  tone(520, 0.08, 'triangle', 0.04);
}

function release() {
  if (mode !== 'play' || phase !== 'swing') return;
  const pend = pendulum();
  const top = floors[floors.length - 1];
  const vx = Math.max(-120, Math.min(120, pend.vx * 0.46));
  piece = {
    left: pend.hx - top.width / 2,
    top: pend.hy + 4,
    vx,
    vy: 70,
    width: top.width,
    cells: top.cells,
    form: hangForm,
    seed: floors.length * 2 + 1,
    rot: 0,
    vr: 0,
    failing: false,
  };
  phase = 'fall';
  tone(340, 0.06, 'square', 0.03);
}

function award(perfect, x, y) {
  if (perfect) {
    combo += 1;
    comboMax = Math.max(0.78, 2.4 - combo * 0.065);
    comboTime = comboMax;
    const gain = 20 * combo;
    residents += gain;
    spawnFloat('完美 +' + gain, x, y, true);
    tone(620 + combo * 28, 0.12, 'triangle', 0.05);
    buzz(10);
  } else {
    if (combo >= 3) spawnFloat('连击 ' + combo, x, y - 18, false);
    combo = 0;
    comboTime = 0;
    residents += 8;
    spawnFloat('+8', x, y, false);
    tone(180, 0.08, 'sine', 0.05);
  }
}

function milestone(n) {
  if (n === 20) spawnFloat('穿过云层', w / 2, anchorY() - 70, true);
  if (n === 50) spawnFloat('飞机从旁边飞过', w / 2, anchorY() - 70, true);
  if (n === 80) spawnFloat('看见月亮了', w / 2, anchorY() - 70, true);
  if (n === 120) spawnFloat('盖进太空了', w / 2, anchorY() - 70, true);
}

function failPiece() {
  if (mode !== 'play') return;
  mode = 'over';
  overDelay = 0.62;
  overShown = false;
  shake = 14;
  if (piece) {
    piece.failing = true;
    piece.vy = Math.max(piece.vy, 90);
    piece.vr = piece.vx >= 0 ? 1.6 : -1.6;
  }
  if (combo >= 3) spawnFloat('连击 ' + combo, w / 2, anchorY() - 36, false);
  combo = 0;
  comboTime = 0;
  saveBest();
  tone(220, 0.18, 'sawtooth', 0.04);
  tone(140, 0.28, 'sine', 0.05);
  buzz(36);
  syncHud();
}

function landPiece() {
  const top = floors[floors.length - 1];
  const roofY = floorTop(floors.length - 1);
  const b1 = top.center - top.width / 2;
  const b2 = top.center + top.width / 2;
  const a1 = piece.left;
  const a2 = piece.left + piece.width;
  const left = Math.max(a1, b1);
  const right = Math.min(a2, b2);
  const overlap = right - left;
  const minKeep = Math.max(18, top.width * 0.14);
  if (overlap < minKeep) {
    failPiece();
    return;
  }
  const offset = Math.abs((a1 + a2) / 2 - top.center);
  const perfect = offset <= Math.max(7, top.width * 0.05);
  if (!perfect) {
    if (a1 < b1 - 1) spawnDebris(a1, roofY - FLOOR_H, b1 - a1, -1, piece.seed);
    if (a2 > b2 + 1) spawnDebris(b2, roofY - FLOOR_H, a2 - b2, 1, piece.seed);
  }
  let kept = perfect ? top.cells : Math.floor((overlap / top.width) * top.cells + 0.22);
  kept = Math.max(0, Math.min(top.cells, kept));
  let form = kept <= 1 ? 'cubes' : (piece.form || 'cubes');
  let width = widthFor(kept, form);
  if (!perfect && width > overlap + 2) {
    kept -= 1;
    if (kept < 1) {
      failPiece();
      return;
    }
    form = kept <= 1 ? 'cubes' : form;
    width = widthFor(kept, form);
  }
  if (kept < 1) {
    failPiece();
    return;
  }
  let center = perfect ? top.center : (left + right) / 2;
  if (!perfect) {
    const half = width / 2;
    if (center - half < left) center = left + half;
    if (center + half > right) center = right - half;
  }
  floors.push({
    center,
    width,
    cells: kept,
    form,
    seed: piece.seed,
    flash: perfect ? 0.55 : 0.18,
  });
  hangForm = Math.random() < 0.48 ? 'box' : 'cubes';
  spawnDust(center, roofY, width);
  award(perfect, center, roofY - FLOOR_H - 8);
  milestone(builtFloors());
  shake = perfect ? 3.5 : 7;
  piece = null;
  phase = 'swing';
  syncHud();
}

function update(dt) {
  time += dt;
  swingClock += dt;
  const alt = builtFloors();
  const camTarget = alt * FLOOR_H;
  cam += (camTarget - cam) * Math.min(1, dt * 5.5);
  if (shake > 0) shake = Math.max(0, shake - dt * 28);

  if (mode === 'play' && phase === 'swing' && combo > 0) {
    comboTime -= dt;
    if (comboTime <= 0) {
      if (combo >= 3) spawnFloat('连击 ' + combo, w / 2, anchorY() - 30, false);
      combo = 0;
      comboTime = 0;
    }
  }

  if (piece && phase === 'fall') {
    piece.vy += 2300 * dt;
    piece.left += piece.vx * dt;
    piece.top += piece.vy * dt;
    piece.rot += piece.vr * dt;
    if (mode === 'play' && !piece.failing) {
      const roofY = floorTop(floors.length - 1);
      if (piece.top + FLOOR_H >= roofY) landPiece();
    }
  }

  if (mode === 'over' && !overShown) {
    overDelay -= dt;
    if (overDelay <= 0) showOver();
  }

  debris.forEach((d) => {
    d.vy += 1800 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.rot += d.vr * dt;
    d.life -= dt * 0.85;
  });
  debris = debris.filter((d) => d.life > 0 && d.y < h + 80);

  puffs.forEach((p) => {
    p.vy += 280 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  });
  puffs = puffs.filter((p) => p.life > 0);

  floaters.forEach((f) => {
    f.y -= 28 * dt;
    f.life -= dt * 0.7;
  });
  floaters = floaters.filter((f) => f.life > 0);

  floors.forEach((floor) => {
    if (floor.flash > 0) floor.flash = Math.max(0, floor.flash - dt);
  });
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgb(c) {
  return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
}

function sampleSky(alt) {
  let i = 0;
  while (i < SKY.length - 2 && alt >= SKY[i + 1].at) i += 1;
  const a = SKY[i];
  const b = SKY[Math.min(SKY.length - 1, i + 1)];
  const span = b.at - a.at || 1;
  const t = Math.min(1, Math.max(0, (alt - a.at) / span));
  return { top: mix(a.top, b.top, t), mid: mix(a.mid, b.mid, t), bot: mix(a.bot, b.bot, t) };
}

function roundRect(x, y, rw, rh, r) {
  const rad = Math.max(0, Math.min(r, rw / 2, rh / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + rw, y, x + rw, y + rh, rad);
  ctx.arcTo(x + rw, y + rh, x, y + rh, rad);
  ctx.arcTo(x, y + rh, x, y, rad);
  ctx.arcTo(x, y, x + rw, y, rad);
  ctx.closePath();
}

function drawCover(img, x, y, rw, rh) {
  if (!img || !img.complete || !img.naturalWidth) {
    ctx.fillStyle = '#ffe08a';
    ctx.fillRect(x, y, rw, rh);
    return;
  }
  const ir = img.naturalWidth / img.naturalHeight;
  const r = rw / rh;
  let sx;
  let sy;
  let sw;
  let sh;
  if (ir > r) {
    sh = img.naturalHeight;
    sw = sh * r;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / r;
    sx = 0;
    sy = (img.naturalHeight - sh) * 0.18;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, rw, rh);
}

function drawModule(x, y, rw, rh, seed, flash) {
  const depth = Math.min(18, Math.max(11, Math.min(rw, rh) * 0.2));
  const wall = WALLS[Math.abs(seed) % WALLS.length];
  const skew = depth * 0.62;
  const skin = SKINS[Math.abs(seed) % SKINS.length];

  ctx.beginPath();
  ctx.moveTo(x + rw, y);
  ctx.lineTo(x + rw + depth, y - skew);
  ctx.lineTo(x + rw + depth, y + rh - skew);
  ctx.lineTo(x + rw, y + rh);
  ctx.closePath();
  ctx.fillStyle = wall.side;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + depth * 0.28, y - skew);
  ctx.lineTo(x + rw + depth, y - skew);
  ctx.lineTo(x + rw, y);
  ctx.closePath();
  ctx.fillStyle = wall.roof;
  ctx.fill();

  ctx.fillStyle = wall.wall;
  ctx.fillRect(x, y, rw, rh);
  ctx.strokeStyle = wall.trim;
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 2, y + 2, rw - 4, rh - 4);

  const pad = Math.max(7, Math.min(rw, rh) * 0.12);
  const side = Math.min(rw, rh) - pad * 2;
  if (side > 8) {
    const ix = x + (rw - side) / 2;
    const iy = y + (rh - side) / 2;
    ctx.save();
    roundRect(ix, iy, side, side, 8);
    ctx.fillStyle = '#fff6d0';
    ctx.fill();
    ctx.clip();
    drawCover(images[skin.id], ix, iy, side, side);
    ctx.restore();
    ctx.save();
    roundRect(ix, iy, side, side, 8);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  if (flash > 0) {
    ctx.strokeStyle = 'rgba(255, 186, 40, ' + flash + ')';
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 2, y + 2, rw - 4, rh - 4);
  }
}

function drawBlocks(x, y, width, cells, form, seed, flash) {
  const count = Math.max(1, cells || 1);
  if (count <= 1 || form === 'box') {
    drawModule(x, y, width, FLOOR_H, seed, flash);
    return;
  }
  const cellW = (width - MODULE_GAP * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    drawModule(x + i * (cellW + MODULE_GAP), y, cellW, FLOOR_H, seed + i * 2, flash);
  }
}

function drawAntenna(index) {
  if (index !== floors.length - 1) return;
  const floor = floors[index];
  const x = floor.center + 8;
  const y = floorTop(index);
  ctx.strokeStyle = '#6d6254';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 2);
  ctx.lineTo(x, y - 18);
  ctx.stroke();
  ctx.fillStyle = Math.sin(time * 6) > 0 ? '#ff5d73' : '#ffd0d8';
  ctx.beginPath();
  ctx.arc(x, y - 20, 3.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawGround() {
  const ground = floorTop(0) + FLOOR_H;
  if (ground > h + 30) return;
  const sky = sampleSky(builtFloors());
  const night = sky.top[2] < 80;
  ctx.fillStyle = night ? '#1c2438' : '#8ed45a';
  ctx.fillRect(0, ground, w, Math.max(0, h - ground + 8));
  if (!night) {
    ctx.fillStyle = '#b7e888';
    ctx.fillRect(0, ground, w, 8);
    ctx.fillStyle = '#d7c07a';
    ctx.fillRect(0, ground + 18, w, 16);
    ctx.fillStyle = '#f4e7b0';
    for (let x = 12; x < w; x += 28) ctx.fillRect(x, ground + 24, 10, 3);
  }
  ctx.fillStyle = night ? '#2a334c' : '#9aa4b0';
  const backs = [0.08, 0.22, 0.78, 0.9];
  backs.forEach((p, i) => {
    const bh = 34 + (i % 3) * 16;
    const bw = 28 + (i % 2) * 14;
    ctx.fillRect(w * p, ground - bh, bw, bh);
  });
}

function drawCloud(cx, cy, s) {
  ctx.beginPath();
  ctx.arc(cx, cy, 16 * s, 0, Math.PI * 2);
  ctx.arc(cx + 18 * s, cy + 4 * s, 12 * s, 0, Math.PI * 2);
  ctx.arc(cx - 16 * s, cy + 6 * s, 11 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawSky() {
  const alt = builtFloors();
  const sky = sampleSky(alt);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgb(sky.top));
  g.addColorStop(0.55, rgb(sky.mid));
  g.addColorStop(1, rgb(sky.bot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const starAlpha = Math.min(1, Math.max(0, (alt - 78) / 28));
  if (starAlpha > 0) {
    stars.forEach((star) => {
      const tw = 0.45 + Math.sin(time * 3 + star.p) * 0.35;
      ctx.globalAlpha = starAlpha * tw;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  if (alt > 70) {
    const moonA = Math.min(1, (alt - 70) / 18);
    ctx.globalAlpha = moonA;
    ctx.fillStyle = '#fff6cf';
    ctx.beginPath();
    ctx.arc(w * 0.78, h * 0.16, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = moonA * 0.35;
    ctx.fillStyle = '#f0e2a8';
    ctx.beginPath();
    ctx.arc(w * 0.78 - 6, h * 0.16 - 4, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (alt > 130) {
    ctx.globalAlpha = Math.min(1, (alt - 130) / 20);
    ctx.fillStyle = '#f0c27a';
    ctx.beginPath();
    ctx.arc(w * 0.22, h * 0.22, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 194, 122, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w * 0.22, h * 0.22, 18, 6, -0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const cloudAlpha = Math.max(0, 1 - Math.max(0, alt - 60) / 40);
  if (cloudAlpha > 0.02) {
    ctx.globalAlpha = cloudAlpha;
    ctx.fillStyle = '#fff';
    clouds.forEach((cloud) => {
      const cx = ((cloud.x + time * cloud.v) % 1.25) * w - w * 0.1;
      drawCloud(cx, cloud.y * h, cloud.s);
    });
    ctx.globalAlpha = 1;
  }

  if (alt > 32 && alt < 95) {
    const px = ((time * 0.06) % 1.4) * w - w * 0.2;
    const py = h * 0.2;
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 34, 8);
    ctx.fillRect(10, -5, 16, 6);
    ctx.fillStyle = '#9fd0ff';
    ctx.fillRect(14, -3, 6, 3);
    ctx.restore();
  }
}

function drawCrane(pivotX, pivotY, hx, hy, hanging) {
  ctx.strokeStyle = '#f0b429';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(16, pivotY);
  ctx.lineTo(w - 16, pivotY);
  ctx.stroke();
  ctx.fillStyle = '#f2c14b';
  roundRect(pivotX - 16, pivotY - 16, 32, 18, 4);
  ctx.fill();
  ctx.fillStyle = '#fff6d2';
  ctx.fillRect(pivotX - 8, pivotY - 10, 6, 6);
  if (!hanging) return;
  ctx.strokeStyle = '#8d6a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = '#e23d3d';
  ctx.beginPath();
  ctx.arc(hx, hy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2c14b';
  ctx.fillRect(hx - 7, hy, 14, 4);
}

function drawPiece(p, rotating) {
  ctx.save();
  if (rotating) {
    ctx.translate(p.left + p.width / 2, p.top + FLOOR_H / 2);
    ctx.rotate(p.rot || 0);
    drawBlocks(-p.width / 2, -FLOOR_H / 2, p.width, p.cells, p.form, p.seed, 0);
  } else {
    drawBlocks(p.left, p.top, p.width, p.cells, p.form, p.seed, 0);
  }
  ctx.restore();
}

function drawCombo() {
  if (combo <= 0 || comboTime <= 0 || mode !== 'play') return;
  const ratio = Math.max(0, Math.min(1, comboTime / comboMax));
  const bw = Math.min(220, w - 48);
  const x = (w - bw) / 2;
  const y = 46;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  roundRect(x, y, bw, 12, 6);
  ctx.fill();
  ctx.fillStyle = '#ffb703';
  roundRect(x, y, Math.max(12, bw * ratio), 12, 6);
  ctx.fill();
  ctx.fillStyle = '#8a5a00';
  ctx.font = '700 13px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('连击 ' + combo, w / 2, y + 22);
}

function drawFloaters() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  floaters.forEach((f) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
    ctx.font = (f.big ? '800 22px ' : '700 16px ') + '"PingFang SC", "Noto Sans SC", sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = '#ef9f00';
    ctx.fillText(f.text, f.x, f.y);
  });
  ctx.globalAlpha = 1;
}

function draw() {
  if (w < 2 || h < 2) return;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  if (shake > 0) {
    ctx.translate(Math.sin(time * 48) * shake, Math.cos(time * 42) * shake * 0.45);
  }
  drawSky();
  drawGround();
  floors.forEach((floor, index) => {
    const y = floorTop(index);
    if (y > h + 30 || y < -80) return;
    drawBlocks(floor.center - floor.width / 2, y, floor.width, floor.cells, floor.form, floor.seed, floor.flash);
    drawAntenna(index);
  });
  debris.forEach((d) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, d.life);
    ctx.translate(d.x + d.w / 2, d.y + d.h / 2);
    ctx.rotate(d.rot);
    drawModule(-d.w / 2, -d.h / 2, d.w, d.h, d.seed, 0);
    ctx.restore();
  });
  puffs.forEach((p) => {
    ctx.globalAlpha = Math.max(0, p.life / 0.45);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  if (phase === 'swing') {
    const pend = pendulum();
    const top = floors[floors.length - 1];
    drawCrane(pend.pivotX, pend.pivotY, pend.hx, pend.hy, true);
    drawBlocks(pend.hx - top.width / 2, pend.hy + 4, top.width, top.cells, hangForm, floors.length * 2 + 1, 0);
  } else if (piece) {
    drawCrane(w / 2, 28, w / 2, 28, false);
    drawPiece(piece, piece.failing);
  }

  if (mode === 'play' && floors.length === 1 && phase === 'swing') {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#2c5a14';
    ctx.font = '700 15px "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('点一下，放下这块方块', w / 2, h - 46);
    ctx.globalAlpha = 1;
  }

  drawCombo();
  drawFloaters();
  ctx.restore();
}

function frame(now) {
  if (!frame.last) frame.last = now;
  const dt = Math.min(0.033, (now - frame.last) / 1000);
  frame.last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

function resize() {
  const rect = board.getBoundingClientRect();
  const nextW = rect.width;
  const nextH = rect.height;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  if (layoutW && nextW && floors.length) {
    const scale = nextW / layoutW;
    floors.forEach((floor) => {
      floor.center = nextW / 2 + (floor.center - layoutW / 2) * scale;
      floor.width *= scale;
    });
    if (piece) {
      const mid = piece.left + piece.width / 2;
      piece.width *= scale;
      piece.left = nextW / 2 + (mid - layoutW / 2) * scale - piece.width / 2;
      piece.vx *= scale;
    }
  }
  w = nextW;
  h = nextH;
  layoutW = nextW;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

overlay.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (!act) return;
  if (act.dataset.act === 'start' || act.dataset.act === 'retry') startGame();
});

muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (err) { /* ignore */ }
});

canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'play') return;
  e.preventDefault();
  unlockAudio();
  release();
});

canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  e.preventDefault();
  unlockAudio();
  if (mode === 'menu') startGame();
  else if (mode === 'over' && overShown) startGame();
  else release();
});

window.addEventListener('resize', resize);

loadStore();
makeClouds();
resize();
resetTower();
showMenu();
requestAnimationFrame(frame);
