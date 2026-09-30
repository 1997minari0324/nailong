'use strict';

const BEST_KEY = 'nailong-jump-best';
const SKIN_KEY = 'nailong-jump-skin';
const MUTE_KEY = 'nailong-jump-mute';
const CHARGE_MS = 1280;
const MIN_JUMP = 70;
const MAX_JUMP = 214;
const DEPTH = 0.5; // 深度方向（世界 y 轴）的屏幕压缩比，越大上表面越明显
const DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

const SKINS = [
  { id: 'happy', name: '开心奶龙', file: 'assets/happy.jpg', body: '#FFC44D', belly: '#fff6d2', egg: false },
  { id: 'wink', name: '眨眼奶龙', file: 'assets/wink.jpg', body: '#FF9A2E', belly: '#ffe3c2', egg: false },
  { id: 'wow', name: '惊讶奶龙', file: 'assets/wow.jpg', body: '#3DB7FF', belly: '#e7f6ff', egg: false },
  { id: 'mad', name: '生气奶龙', file: 'assets/mad.jpg', body: '#FF5A6E', belly: '#ffe4e8', egg: false },
  { id: 'sleep', name: '瞌睡奶龙', file: 'assets/sleep.jpg', body: '#B388FF', belly: '#f4ecff', egg: false },
  { id: 'egg', name: '奶蛋', file: 'assets/egg.jpg', body: '#FFE14A', belly: '#fff8dc', egg: true },
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
const bestEl = document.getElementById('best');
const comboEl = document.getElementById('combo');
const muteBtn = document.getElementById('mute');

let w = 0;
let h = 0;
let mode = 'pick';
let selected = 0;
let best = 0;
let score = 0;
let streak = 0;
let perfects = 0;
let jumps = 0;
let newRecord = false;
let muted = false;
let actx = null;
let time = 0;
let charge = 0;
let chargeFrom = 0;
let current = 0;
let platforms = [];
let jump = null;
let fallT = 0;
let player = { x: 0, y: 0, lift: 0 };
let camera = { x: 0, y: 0, scale: 1 };
const LOOK_AHEAD = 2;
let floaters = [];
let puffs = [];
let didJump = false;

function loadStore() {
  try {
    best = Number(localStorage.getItem(BEST_KEY)) || 0;
    selected = Number(localStorage.getItem(SKIN_KEY)) || 0;
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) { /* ignore */ }
  if (selected < 0 || selected >= SKINS.length) selected = 0;
  muteBtn.textContent = muted ? '🔇' : '🔊';
}

function saveBest() {
  if (score > best) {
    best = score;
    newRecord = true;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
  }
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

function project(x, y, lift) {
  return {
    x: w / 2 + (x - camera.x),
    y: h * 0.72 - (y - camera.y) * DEPTH - (lift || 0),
  };
}

function worldPos(p) {
  if (!p.moveAmp) return { x: p.x, y: p.y };
  return {
    x: p.x + Math.sin(time * p.moveSpeed + p.phase) * p.moveAmp,
    y: p.y,
  };
}

function pickGap(index) {
  if (index < 2) return 32 + Math.random() * 14;
  const roll = Math.random();
  if (roll < 0.36) return 26 + Math.random() * 16;
  if (roll < 0.7) return 58 + Math.random() * 20;
  return 96 + Math.random() * 26;
}

function pickBlock(index) {
  const shapes = ['cube', 'wide', 'long', 'cylinder', 'trap'];
  const shape = index < 1 ? 'cube' : shapes[(Math.random() * shapes.length) | 0];
  const scale = 0.78 + Math.random() * 0.5;
  let hx;
  let hy;
  let h;
  if (shape === 'cube') {
    const s = 36 * scale;
    hx = s;
    hy = s;
    h = 44 + Math.random() * 16;
  } else if (shape === 'wide') {
    hx = 54 * scale;
    hy = 28 * scale;
    h = 38 + Math.random() * 14;
  } else if (shape === 'long') {
    hx = 28 * scale;
    hy = 52 * scale;
    h = 56 + Math.random() * 18;
  } else if (shape === 'cylinder') {
    const s = 34 * scale;
    hx = s;
    hy = s * 0.62;
    h = 40 + Math.random() * 20;
  } else {
    hx = 32 * scale;
    hy = 30 * scale;
    h = 46 + Math.random() * 14;
  }
  return {
    shape,
    hx: Math.max(24, Math.min(62, hx)),
    hy: Math.max(24, Math.min(62, hy)),
    h,
  };
}

function makePlatform(x, y, heading, block, starter) {
  return {
    x,
    y,
    heading,
    shape: block.shape,
    hx: block.hx,
    hy: block.hy,
    h: starter ? 58 : block.h,
    skin: (Math.random() * SKINS.length) | 0,
    moveAmp: 0,
  };
}

function addPlatform(starter) {
  if (!platforms.length) {
    platforms.push(makePlatform(0, 0, 0, pickBlock(0), true));
    return;
  }
  const last = platforms[platforms.length - 1];
  const index = platforms.length;
  const choices = [0, 1, 2].filter((h) => h !== (last.heading + 2) % 4);
  let heading = index === 1 ? 0 : index === 2 ? 1 : last.heading;
  if (index > 2) {
    const turns = choices.filter((h) => h !== last.heading);
    heading = Math.random() < 0.3 && choices.includes(last.heading)
      ? last.heading
      : turns[(Math.random() * turns.length) | 0];
  }

  for (let turn = 0; turn < choices.length; turn++) {
    const start = Math.max(0, choices.indexOf(heading));
    const tryHeading = choices[(start + turn) % choices.length];
    const block = pickBlock(index);
    const dir = DIRS[tryHeading];
    const fromHalf = dir.x !== 0 ? last.hx : last.hy;
    const toHalf = dir.x !== 0 ? block.hx : block.hy;
    let dist = fromHalf + toHalf + pickGap(index);
    dist = Math.max(MIN_JUMP + 12, Math.min(MAX_JUMP - 8, dist));
    const x = last.x + dir.x * dist;
    const y = last.y + dir.y * dist;
    const crowded = platforms.some((p) => {
      return Math.abs(p.x - x) < p.hx + block.hx + 16 && Math.abs(p.y - y) < p.hy + block.hy + 16;
    });
    if (crowded) continue;
    platforms.push(makePlatform(x, y, tryHeading, block, false));
    return;
  }
  const block = pickBlock(index);
  const dir = DIRS[last.heading];
  const dist = Math.min(MAX_JUMP - 8, last.hx + block.hx + 80);
  platforms.push(makePlatform(last.x + dir.x * dist, last.y + dir.y * dist, last.heading, block, false));
}

function ensureAhead() {
  while (platforms.length < current + LOOK_AHEAD + 2) addPlatform(false);
}

function lookTarget() {
  const end = Math.min(platforms.length - 1, current + LOOK_AHEAD);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = current; i <= end; i++) {
    const p = platforms[i];
    if (!p) continue;
    minX = Math.min(minX, p.x - p.hx);
    maxX = Math.max(maxX, p.x + p.hx);
    minY = Math.min(minY, p.y - p.hy);
    maxY = Math.max(maxY, p.y + p.hy);
  }
  if (!isFinite(minX)) return { x: player.x, y: player.y };
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

// 计算让「当前 + 未来 2 块」完整放进屏幕的缩放系数（通常为 1，只在 3 块拉开时略缩）。
function viewScale() {
  const end = Math.min(platforms.length - 1, current + LOOK_AHEAD);
  if (end < current || w < 10 || h < 10) return 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = current; i <= end; i++) {
    const p = platforms[i];
    if (!p) continue;
    const c = project(p.x, p.y, 0);
    const halfW = Math.max(p.hx, p.shape === 'trap' ? p.hx * 1.28 : p.hx) + 14;
    const halfDepth = Math.max(8, p.hy * DEPTH);
    minX = Math.min(minX, c.x - halfW);
    maxX = Math.max(maxX, c.x + halfW);
    minY = Math.min(minY, c.y - halfDepth - 54);
    maxY = Math.max(maxY, c.y + halfDepth + p.h + 22);
  }
  if (!isFinite(minX)) return 1;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const s = Math.min(1, (w * 0.94) / width, (h * 0.86) / height);
  return Math.max(0.62, Math.min(1, s));
}

function startGame() {
  score = 0;
  streak = 0;
  perfects = 0;
  jumps = 0;
  newRecord = false;
  current = 0;
  platforms = [];
  floaters = [];
  puffs = [];
  jump = null;
  charge = 0;
  didJump = false;
  addPlatform(true);
  for (let i = 0; i < 5; i++) addPlatform(false);
  const origin = worldPos(platforms[0]);
  player.x = origin.x;
  player.y = origin.y;
  player.lift = 0;
  const view = lookTarget();
  camera.x = view.x;
  camera.y = view.y;
  camera.scale = viewScale();
  mode = 'ready';
  overlay.classList.remove('show');
  syncHud();
}

function showPick() {
  mode = 'pick';
  const skins = SKINS.map((skin, index) => {
    const on = index === selected ? ' on' : '';
    return '<button type="button" class="skin' + on + '" data-skin="' + index + '"><img src="' + skin.file + '" alt=""><span>' + skin.name + '</span></button>';
  }).join('');
  card.innerHTML = '<h1>奶龙跳一跳</h1>'
    + '<p class="lead">按住蓄力，松手起跳。每一跳都是横平或竖直的直线。跳到方块的哪个位置，就停在那里。</p>'
    + '<div class="skins">' + skins + '</div>'
    + '<button class="primary" type="button" data-act="start">开始跳</button>'
    + '<p class="note">最高 ' + best + ' 分</p>';
  overlay.classList.add('show');
  syncHud();
}

function showOver() {
  mode = 'over';
  const record = newRecord ? '<p class="record">新纪录！</p>' : '';
  card.innerHTML = '<h1>跳空啦</h1>'
    + '<p class="score-lg">' + score + ' 分</p>'
    + record
    + '<p class="note">最高 ' + best + ' 分</p>'
    + '<p class="note">跳了 ' + jumps + ' 下 · 完美 ' + perfects + ' 次</p>'
    + '<div class="actions"><button class="primary" type="button" data-act="retry">再跳一次</button>'
    + '<button class="ghost" type="button" data-act="skins">换角色</button></div>';
  overlay.classList.add('show');
  syncHud();
}

function syncHud() {
  scoreEl.textContent = String(score);
  bestEl.textContent = '最高 ' + best;
  if (streak > 1 && (mode === 'ready' || mode === 'charge' || mode === 'jump')) {
    comboEl.hidden = false;
    comboEl.classList.add('show');
    comboEl.textContent = '连击 ' + streak;
  } else {
    comboEl.hidden = true;
    comboEl.classList.remove('show');
  }
}

function addScore(perfect) {
  let add = 1;
  if (perfect) {
    streak += 1;
    add = Math.min(16, streak * 2);
    perfects += 1;
    tone(620 + streak * 40, 0.12, 'sine', 0.05);
    if (navigator.vibrate) navigator.vibrate(12);
  } else {
    streak = 0;
    tone(280, 0.07, 'triangle', 0.04);
  }
  score += add;
  jumps += 1;
  saveBest();
  floaters.push({
    x: player.x,
    y: player.y,
    text: '+' + add,
    sub: perfect ? (streak > 1 ? streak + ' 连击' : '完美') : '',
    life: 0.9,
  });
  puffs.push({ x: player.x, y: player.y, life: 0.35 });
}

function beginCharge(now) {
  if (mode !== 'ready') return;
  mode = 'charge';
  chargeFrom = now;
  charge = 0;
}

function releaseCharge(now) {
  if (mode !== 'charge') return;
  charge = Math.min(1, (now - chargeFrom) / CHARGE_MS);
  const base = platforms[current];
  const next = platforms[current + 1];
  if (!next) {
    mode = 'ready';
    return;
  }
  const dx = next.x - base.x;
  const dy = next.y - base.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  jump = {
    x: player.x,
    y: player.y,
    ux: horizontal ? Math.sign(dx || 1) : 0,
    uy: horizontal ? 0 : Math.sign(dy || 1),
    dist: MIN_JUMP + charge * (MAX_JUMP - MIN_JUMP),
    t: 0,
    dur: 0.4 + charge * 0.2,
  };
  mode = 'jump';
  didJump = true;
  tone(420 + charge * 180, 0.08, 'triangle', 0.04);
}

function finishJump() {
  const plat = platforms[current + 1];
  const dx = player.x - plat.x;
  const dy = player.y - plat.y;
  player.lift = 0;
  if (Math.abs(dx) <= plat.hx && Math.abs(dy) <= plat.hy) {
    current += 1;
    const perfect = Math.abs(dx) <= Math.max(12, plat.hx * 0.34) && Math.abs(dy) <= Math.max(12, plat.hy * 0.34);
    addScore(perfect);
    ensureAhead();
    mode = 'ready';
    charge = 0;
  } else {
    mode = 'fall';
    fallT = 0;
    tone(180, 0.22, 'sine', 0.04);
  }
}

function update(dt) {
  time += dt;
  if (mode === 'charge') {
    charge = Math.min(1, (performance.now() - chargeFrom) / CHARGE_MS);
    player.lift = 0;
  } else if (mode === 'ready' && platforms[current]) {
    player.lift = Math.sin(time * 3) * 3;
  } else if (mode === 'jump' && jump) {
    jump.t += dt;
    const p = Math.min(1, jump.t / jump.dur);
    const along = jump.dist * p;
    player.x = jump.x + jump.ux * along;
    player.y = jump.y + jump.uy * along;
    player.lift = Math.sin(p * Math.PI) * (78 + jump.dist * 0.2);
    if (p >= 1) finishJump();
  } else if (mode === 'fall') {
    fallT += dt;
    player.lift -= 920 * dt;
    if (fallT > 0.65) showOver();
  }

  if (mode === 'ready' || mode === 'charge' || mode === 'jump' || mode === 'fall') {
    const view = lookTarget();
    camera.x += (view.x - camera.x) * Math.min(1, dt * 5);
    camera.y += (view.y - camera.y) * Math.min(1, dt * 5);
    camera.scale += (viewScale() - camera.scale) * Math.min(1, dt * 4);
  }

  floaters.forEach((item) => {
    item.y += 28 * dt;
    item.life -= dt;
  });
  floaters = floaters.filter((item) => item.life > 0);
  puffs.forEach((item) => { item.life -= dt; });
  puffs = puffs.filter((item) => item.life > 0);
  syncHud();
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#8fd4ff');
  sky.addColorStop(0.45, '#e7f8ff');
  sky.addColorStop(1, '#c6ef8a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  [[0.18, 0.16, 1], [0.62, 0.22, 0.7], [0.84, 0.12, 0.5]].forEach(([fx, fy, s]) => {
    const x = fx * w;
    const y = fy * h;
    ctx.beginPath();
    ctx.ellipse(x, y, 34 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 22 * s, y + 4, 24 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function fillPoly(points, color) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function strokePoly(points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.stroke();
}

function drawImageCover(img, x, y, width, height) {
  const ir = img.naturalWidth / img.naturalHeight;
  const box = width / height;
  let dw = width;
  let dh = height;
  let dx = x;
  let dy = y;
  if (ir > box) {
    dw = height * ir;
    dx = x - (dw - width) / 2;
  } else {
    dh = width / ir;
    dy = y - (dh - height) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function paintFace(skin, x, y, width, height) {
  const img = images[skin.id];
  if (!img.complete || !img.naturalWidth || width < 8 || height < 8) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  drawImageCover(img, x, y, width, height);
  ctx.restore();
}

function drawBoxPlatform(c, p, skin) {
  const topW = p.hx;
  const botW = p.shape === 'trap' ? p.hx * 1.28 : p.hx;
  const halfDepth = Math.max(8, p.hy * DEPTH);
  const frontTop = c.y + halfDepth;
  const top = c.y - halfDepth;
  const bot = frontTop + p.h;
  const lip = halfDepth * 2;
  ctx.beginPath();
  ctx.ellipse(c.x, bot + 8, botW * 0.85, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40, 80, 20, 0.14)';
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.beginPath();
  ctx.moveTo(c.x + topW, frontTop);
  ctx.lineTo(c.x + topW + 12, top);
  ctx.lineTo(c.x + botW + 12, top + p.h);
  ctx.lineTo(c.x + botW, bot);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = skin.body;
  ctx.beginPath();
  ctx.moveTo(c.x - botW, bot);
  ctx.lineTo(c.x + botW, bot);
  ctx.lineTo(c.x + topW, frontTop);
  ctx.lineTo(c.x - topW, frontTop);
  ctx.closePath();
  ctx.fill();
  paintFace(skin, c.x - topW + 8, frontTop + 6, topW * 2 - 16, p.h - 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = skin.belly;
  ctx.fillRect(c.x - topW, top, topW * 2, lip);
  ctx.strokeRect(c.x - topW + 1, top + 1, topW * 2 - 2, lip - 2);
  ctx.beginPath();
  ctx.arc(c.x, top + lip / 2, 5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
}

function drawCylinderPlatform(c, p, skin) {
  const rx = p.hx;
  const ry = Math.max(7, Math.min(30, p.hy * DEPTH));
  const top = c.y;
  const bot = c.y + p.h;
  ctx.beginPath();
  ctx.ellipse(c.x, bot + 6, rx * 0.85, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40, 80, 20, 0.14)';
  ctx.fill();
  ctx.fillStyle = skin.body;
  ctx.beginPath();
  ctx.rect(c.x - rx, top, rx * 2, p.h);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(c.x, bot, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  paintFace(skin, c.x - rx + 10, top + 8, rx * 2 - 20, Math.max(12, p.h - 14));
  ctx.fillStyle = skin.belly;
  ctx.beginPath();
  ctx.ellipse(c.x, top, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c.x, top, 5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPlatform(p) {
  const pos = worldPos(p);
  const c = project(pos.x, pos.y, 0);
  const skin = SKINS[p.skin];
  if (p.shape === 'cylinder') drawCylinderPlatform(c, p, skin);
  else drawBoxPlatform(c, p, skin);
}

function drawJumper() {
  const ground = project(player.x, player.y, 0);
  const body = project(player.x, player.y, Math.max(0, player.lift));
  const skin = SKINS[selected];
  const squash = mode === 'charge' ? 1 - charge * 0.34 : mode === 'jump' ? 1.12 : 1;
  const widen = mode === 'charge' ? 1 + charge * 0.2 : 0.94;
  ctx.save();
  ctx.globalAlpha = Math.max(0.12, 0.38 - Math.max(0, player.lift) / 380);
  ctx.beginPath();
  ctx.ellipse(ground.x, ground.y + 8, 16 * widen, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40, 70, 20, 0.45)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.scale(widen, squash);
  ctx.beginPath();
  if (skin.egg) ctx.ellipse(0, -18, 22, 26, 0, 0, Math.PI * 2);
  else ctx.ellipse(0, -16, 17, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin.body;
  ctx.fill();
  if (!skin.egg) {
    ctx.beginPath();
    ctx.ellipse(0, -4, 11, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin.belly;
    ctx.fill();
  }
  const hr = skin.egg ? 16 : 15;
  const hy = skin.egg ? -24 : -28;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, hy, hr, 0, Math.PI * 2);
  ctx.clip();
  const img = images[skin.id];
  if (img.complete && img.naturalWidth) ctx.drawImage(img, -hr, hy - hr, hr * 2, hr * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, hy, hr, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawFloaters() {
  floaters.forEach((item) => {
    const p = project(item.x, item.y, 36);
    ctx.save();
    ctx.globalAlpha = Math.max(0, item.life);
    ctx.textAlign = 'center';
    ctx.font = '800 22px PingFang SC, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2f6a16';
    ctx.fillStyle = '#fff8d0';
    ctx.strokeText(item.text, p.x, p.y);
    ctx.fillText(item.text, p.x, p.y);
    if (item.sub) {
      ctx.font = '700 13px PingFang SC, sans-serif';
      ctx.strokeText(item.sub, p.x, p.y + 18);
      ctx.fillText(item.sub, p.x, p.y + 18);
    }
    ctx.restore();
  });
}

function drawRoute() {
  if (mode === 'fall' || mode === 'over') return;
  const end = Math.min(platforms.length - 1, current + LOOK_AHEAD);
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.lineCap = 'round';
  for (let i = current; i < end; i++) {
    const a = project(platforms[i].x, platforms[i].y, 0);
    const b = project(platforms[i + 1].x, platforms[i + 1].y, 0);
    const soon = i === current;
    ctx.strokeStyle = soon ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = soon ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHint() {
  if (mode === 'pick' || mode === 'over' || mode === 'fall' || mode === 'jump') return;
  const bw = Math.min(210, w - 96);
  const x = (w - bw) / 2;
  const y = h - 36;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillRect(x, y, bw, 12);
  if (charge > 0.01) {
    ctx.fillStyle = '#ffc107';
    ctx.fillRect(x, y, bw * charge, 12);
  }
  ctx.font = '700 13px PingFang SC, sans-serif';
  ctx.fillStyle = 'rgba(40, 80, 20, 0.82)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('近', x - 8, y + 6);
  ctx.textAlign = 'left';
  ctx.fillText('远', x + bw + 8, y + 6);
  if (!didJump) {
    ctx.textAlign = 'center';
    ctx.font = '700 15px PingFang SC, sans-serif';
    ctx.fillText(mode === 'charge' ? '松手起跳' : '按住蓄力，近的少按，远的多按', w / 2, y - 16);
  }
  ctx.restore();
}

function render() {
  if (w < 10 || h < 10) return;
  drawBackground();
  if (mode !== 'pick') {
    const order = platforms.map((p, index) => ({ p, index }));
    order.sort((a, b) => b.p.y - a.p.y);
    ctx.save();
    const anchorX = w / 2;
    const anchorY = h * 0.72;
    ctx.translate(anchorX, anchorY);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-anchorX, -anchorY);
    drawRoute();
    order.forEach((item) => {
      if (item.index >= current && item.index <= current + LOOK_AHEAD) drawPlatform(item.p);
    });
    if (mode !== 'over') drawJumper();
    drawFloaters();
    ctx.restore();
    drawHint();
  }
}

function resize() {
  const rect = board.getBoundingClientRect();
  w = rect.width;
  h = rect.height;
  if (w < 8 || h < 8) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop(now) {
  if (!loop.last) loop.last = now;
  const dt = Math.min(0.034, (now - loop.last) / 1000);
  loop.last = now;
  if (!w) resize();
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  unlockAudio();
  beginCharge(performance.now());
}

function onUp() {
  releaseCharge(performance.now());
}

card.addEventListener('click', (e) => {
  unlockAudio();
  const skin = e.target.closest('[data-skin]');
  if (skin) {
    selected = Number(skin.dataset.skin);
    try { localStorage.setItem(SKIN_KEY, String(selected)); } catch (err) { /* ignore */ }
    showPick();
    return;
  }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  if (act.dataset.act === 'start' || act.dataset.act === 'retry') startGame();
  else if (act.dataset.act === 'skins') showPick();
});

muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
  if (!muted) {
    unlockAudio();
    tone(660, 0.06, 'sine', 0.04);
  }
});

canvas.addEventListener('pointerdown', onDown);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', () => {
  if (mode === 'charge') mode = 'ready';
});
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(board);
window.addEventListener('keydown', (e) => {
  if (e.key === 'm') muteBtn.click();
  if (e.code === 'Space' && mode === 'ready') {
    e.preventDefault();
    beginCharge(performance.now());
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') releaseCharge(performance.now());
});

loadStore();
resize();
showPick();
requestAnimationFrame(loop);
