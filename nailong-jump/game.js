'use strict';

const BEST_KEY = 'nailong-jump-best';
const SKIN_KEY = 'nailong-jump-skin';
const MUTE_KEY = 'nailong-jump-mute';
const CHARGE_MS = 1150;

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
let camera = { x: 0, y: 0 };
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
    y: h * 0.72 - (y - camera.y) - (lift || 0),
  };
}

function worldPos(p) {
  if (!p.moveAmp) return { x: p.x, y: p.y };
  return {
    x: p.x + Math.sin(time * p.moveSpeed + p.phase) * p.moveAmp,
    y: p.y,
  };
}

function nextDistance() {
  const n = platforms.length;
  const ramp = Math.min(100, score * 1.5);
  const min = n < 4 ? 156 : 168;
  const span = n < 4 ? 36 : 48 + ramp;
  return min + Math.random() * span;
}

function makePlatform(x, y, side, starter) {
  const hard = !starter && score >= 6 && Math.random() < Math.min(0.42, 0.08 + score / 90);
  const moving = !starter && score >= 10 && Math.random() < Math.min(0.38, (score - 8) / 80);
  return {
    x, y, side,
    r: starter ? 52 : hard ? 28 + Math.random() * 6 : 40 + Math.random() * 10,
    h: starter ? 56 : 42 + Math.random() * 34,
    skin: (Math.random() * SKINS.length) | 0,
    moveAmp: moving ? 20 + Math.random() * 22 : 0,
    moveSpeed: 1.15 + Math.random() * 1.3,
    phase: Math.random() * Math.PI * 2,
  };
}

function addPlatform(starter) {
  if (!platforms.length) {
    platforms.push(makePlatform(0, 0, 1, true));
    return;
  }
  const last = platforms[platforms.length - 1];
  const side = -last.side;
  const dist = nextDistance();
  platforms.push(makePlatform(
    last.x + side * dist * 0.78,
    last.y + dist * 0.62,
    side,
    false
  ));
}

function ensureAhead() {
  while (platforms.length < current + 6) addPlatform(false);
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
  camera.x = 0;
  camera.y = -30;
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
    + '<p class="lead">按住蓄力，松手起跳。跳到方块中心分数更高，连续跳中会一直加分。</p>'
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
  const from = worldPos(platforms[current]);
  const next = platforms[current + 1];
  if (!next) {
    mode = 'ready';
    return;
  }
  const target = worldPos(next);
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  jump = {
    x: from.x,
    y: from.y,
    ux: dx / len,
    uy: dy / len,
    dist: 48 + charge * 360,
    t: 0,
    dur: 0.4 + charge * 0.2,
  };
  mode = 'jump';
  didJump = true;
  tone(420 + charge * 180, 0.08, 'triangle', 0.04);
}

function finishJump() {
  const plat = platforms[current + 1];
  const next = worldPos(plat);
  const d = Math.hypot(player.x - next.x, player.y - next.y);
  player.lift = 0;
  if (d <= plat.r + 8) {
    current += 1;
    const landed = worldPos(platforms[current]);
    player.x = landed.x;
    player.y = landed.y;
    const perfect = d <= Math.max(14, plat.r * 0.36);
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
    const ground = worldPos(platforms[current]);
    player.x = ground.x;
    player.y = ground.y;
    player.lift = 0;
  } else if (mode === 'ready' && platforms[current]) {
    const ground = worldPos(platforms[current]);
    player.x = ground.x;
    player.y = ground.y;
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
    camera.x += (player.x * 0.22 - camera.x) * Math.min(1, dt * 6);
    camera.y += (player.y - 36 - camera.y) * Math.min(1, dt * 6);
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

function drawPlatform(p) {
  const pos = worldPos(p);
  const top = project(pos.x, pos.y, 0);
  const rx = p.r;
  const ry = p.r * 0.46;
  const skin = SKINS[p.skin];
  ctx.beginPath();
  ctx.ellipse(top.x + 8, top.y + p.h + 8, rx * 0.86, ry * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40, 80, 20, 0.14)';
  ctx.fill();
  ctx.fillStyle = skin.body;
  ctx.fillRect(top.x - rx, top.y, rx * 2, p.h);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(top.x - rx, top.y, rx * 2, p.h);
  ctx.beginPath();
  ctx.ellipse(top.x, top.y + p.h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin.body;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.96, ry * 0.96, 0, 0, Math.PI * 2);
  ctx.clip();
  const img = images[skin.id];
  if (img.complete && img.naturalWidth) {
    ctx.drawImage(img, top.x - rx, top.y - rx * 0.92, rx * 2, rx * 1.7);
  } else {
    ctx.fillStyle = skin.belly;
    ctx.fillRect(top.x - rx, top.y - ry, rx * 2, ry * 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.96, ry * 0.96, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.3, ry * 0.3, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
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

function drawHint() {
  if (didJump || mode === 'pick' || mode === 'over' || mode === 'fall') return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '700 15px PingFang SC, sans-serif';
  ctx.fillStyle = 'rgba(40, 80, 20, 0.82)';
  ctx.fillText(mode === 'charge' ? '松手起跳' : '按住蓄力，松手起跳', w / 2, h - 28);
  ctx.restore();
}

function render() {
  if (w < 10 || h < 10) return;
  drawBackground();
  if (mode !== 'pick') {
    const order = platforms.map((p, index) => ({ p, index }));
    order.sort((a, b) => b.p.y - a.p.y);
    order.forEach((item) => {
      if (item.index >= current - 1 && item.index <= current + 5) drawPlatform(item.p);
    });
    if (mode !== 'over') drawJumper();
    drawFloaters();
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
