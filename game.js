'use strict';

const COLS = 8;
const SHOT_SPEED = 1020;
const BEST_KEY = 'nailong-bubble-best';
const MUTE_KEY = 'nailong-bubble-mute';
const STAR_KEY = 'nailong-level-stars';
const LEVEL_SCORE_KEY = 'nailong-level-scores';

const TYPES = [
  { name: '开心', file: 'assets/happy.jpg', color: '#FFC400', z: 1.08, oy: -0.03 },
  { name: '惊讶', file: 'assets/wow.jpg', color: '#1E88E5', z: 1.08, oy: -0.02 },
  { name: '生气', file: 'assets/mad.jpg', color: '#FF3B57', z: 1.02, oy: 0 },
  { name: '奶蛋', file: 'assets/egg.jpg', color: '#22C55E', z: 1.22, oy: -0.08 },
  { name: '眨眼', file: 'assets/wink.jpg', color: '#FF7A00', z: 1.08, oy: -0.01 },
  { name: '瞌睡', file: 'assets/sleep.jpg', color: '#8E44E8', z: 1.02, oy: 0 },
];

const S = {
  mode: 'menu',
  level: 1,
  score: 0,
  scoreBase: 0,
  best: 0,
  combo: 0,
  parity: 0,
  typeCount: 5,
  grid: new Map(),
  shot: null,
  current: 0,
  next: 1,
  untilDrop: 9,
  shotEvery: 10,
  cleared: 0,
  goal: 10,
  shotsUsed: 0,
  pressureCount: 0,
  angle: -Math.PI / 2,
  pressing: false,
  cancel: false,
  pointerId: null,
  falling: [],
  particles: [],
  rings: [],
  floaters: [],
  shake: 0,
  dropOffset: 0,
  lock: 0,
  loseIn: 0,
  banner: 0,
  bannerText: '',
  load: 1,
  rev: 0,
  time: 0,
  didShoot: false,
  mute: false,
  avatar: null,
};

let newRecord = false;
let menuHTML = '';
let sceneTimer = 0;
let w = 0;
let h = 0;
let radius = 20;
let actx = null;
let previewKey = '';
let previewCache = null;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const board = document.getElementById('board');
const overlay = document.getElementById('overlay');
const card = document.getElementById('card');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level-pill');
const dropEl = document.getElementById('drop-pill');
const goalEl = document.getElementById('goal-pill');
const muteBtn = document.getElementById('mute');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const key = (r, c) => r + ',' + c;
const rowH = () => Math.sqrt(3) * radius;
const isOdd = (r) => ((r + S.parity) & 1) === 1;

function cellPos(r, c) {
  return {
    x: radius + c * 2 * radius + (isOdd(r) ? radius : 0),
    y: radius + r * rowH(),
  };
}

function posToCell(x, y) {
  let r = Math.round((y - radius) / rowH());
  if (r < 0) r = 0;
  const x0 = radius + (isOdd(r) ? radius : 0);
  let c = Math.round((x - x0) / (2 * radius));
  if (c < 0) c = 0;
  if (c >= COLS) c = COLS - 1;
  return { r, c };
}

function neighborsOf(r, c) {
  const deltas = isOdd(r)
    ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
    : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
  const out = [];
  for (const [dr, dc] of deltas) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nc >= 0 && nc < COLS) out.push([nr, nc]);
  }
  return out;
}

function selfTest() {
  const savedR = radius;
  const savedP = S.parity;
  radius = 10;
  try {
    for (const parity of [0, 1]) {
      S.parity = parity;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < COLS; c++) {
          const p = cellPos(r, c);
          const g = posToCell(p.x, p.y);
          if (g.r !== r || g.c !== c) throw new Error('格子对不齐 ' + r + ',' + c);
          for (const [nr, nc] of neighborsOf(r, c)) {
            const back = neighborsOf(nr, nc);
            if (!back.some(([rr, cc]) => rr === r && cc === c)) {
              throw new Error('邻居不对称');
            }
            const q = cellPos(nr, nc);
            const d = Math.hypot(p.x - q.x, p.y - q.y);
            if (Math.abs(d - 20) > 0.05) throw new Error('间距不对 ' + d);
          }
          const x0 = radius + c * 2 * radius + (((r + parity) & 1) === 1 ? radius : 0);
          const x1 = radius + c * 2 * radius + (((r + 1 + (parity ^ 1)) & 1) === 1 ? radius : 0);
          if (Math.abs(x0 - x1) > 0.001) throw new Error('下压后会横跳');
        }
      }
    }
  } finally {
    radius = savedR;
    S.parity = savedP;
  }
}

function shooterPos() {
  return { x: w / 2, y: h - radius * 1.85 - 16 };
}

function nextPos() {
  const s = shooterPos();
  return { x: s.x + radius * 2.7, y: s.y + radius * 0.2, r: radius * 0.62 };
}

function limitCenterY() {
  return shooterPos().y - radius * 2.55;
}

function cluster(r, c) {
  const start = S.grid.get(key(r, c));
  if (!start) return [];
  const type = start.type;
  const seen = new Set([key(r, c)]);
  const stack = [[r, c]];
  const out = [];
  while (stack.length) {
    const [cr, cc] = stack.pop();
    out.push([cr, cc]);
    for (const [nr, nc] of neighborsOf(cr, cc)) {
      const k = key(nr, nc);
      if (seen.has(k)) continue;
      const b = S.grid.get(k);
      if (!b || b.type !== type) continue;
      seen.add(k);
      stack.push([nr, nc]);
    }
  }
  return out;
}

function hasNeighbor(r, c) {
  return neighborsOf(r, c).some(([nr, nc]) => S.grid.has(key(nr, nc)));
}

function orphans() {
  const seen = new Set();
  const stack = [];
  for (let c = 0; c < COLS; c++) {
    const k = key(0, c);
    if (S.grid.has(k)) {
      seen.add(k);
      stack.push([0, c]);
    }
  }
  while (stack.length) {
    const [cr, cc] = stack.pop();
    for (const [nr, nc] of neighborsOf(cr, cc)) {
      const k = key(nr, nc);
      if (seen.has(k) || !S.grid.has(k)) continue;
      seen.add(k);
      stack.push([nr, nc]);
    }
  }
  const list = [];
  for (const [k, b] of S.grid) if (!seen.has(k)) list.push(b);
  return list;
}

function tooLow() {
  const limit = limitCenterY();
  for (const b of S.grid.values()) {
    if (cellPos(b.r, b.c).y > limit) return true;
  }
  return false;
}

function randType() {
  return (Math.random() * S.typeCount) | 0;
}

function rollType() {
  const present = new Set();
  for (const b of S.grid.values()) {
    if (b.type < S.typeCount) present.add(b.type);
  }
  const list = [...present];
  if (list.length && Math.random() < 0.84) return list[(Math.random() * list.length) | 0];
  return randType();
}

function placeFresh(r, c) {
  for (let i = 0; i < 10; i++) {
    const type = randType();
    S.grid.set(key(r, c), { r, c, type });
    if (cluster(r, c).length < 3) return;
  }
}

function scrubMatches() {
  for (let guard = 0; guard < 48; guard++) {
    let dirty = false;
    for (const b of [...S.grid.values()]) {
      if (!S.grid.has(key(b.r, b.c))) continue;
      if (cluster(b.r, b.c).length >= 3) {
        b.type = (b.type + 1 + ((Math.random() * (S.typeCount - 1)) | 0)) % S.typeCount;
        dirty = true;
      }
    }
    if (!dirty) break;
  }
}

function levelPlan(level) {
  return {
    types: Math.min(TYPES.length, 2 + level),
    rowsWanted: Math.min(8, 4 + Math.floor((level - 1) / 2)),
    goal: 10 + (level - 1) * 4,
    shots: Math.max(5, 11 - level),
  };
}

function rowsFor(wanted) {
  const fit = Math.floor((limitCenterY() - radius) / rowH()) - 1;
  return Math.min(wanted, Math.max(2, fit));
}

function unlockName(level) {
  const prev = Math.min(TYPES.length, 2 + (level - 1));
  const now = Math.min(TYPES.length, 2 + level);
  if (now > prev && now > 0) return TYPES[now - 1].name;
  return '';
}

function trimLow() {
  let guard = 0;
  while (tooLow() && S.grid.size && guard++ < 24) {
    let maxR = 0;
    for (const b of S.grid.values()) if (b.r > maxR) maxR = b.r;
    for (const b of [...S.grid.values()]) {
      if (b.r === maxR) S.grid.delete(key(b.r, b.c));
    }
  }
}

function buildGrid(rows) {
  S.grid = new Map();
  S.parity = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) placeFresh(r, c);
  }
  scrubMatches();
  trimLow();
  S.rev++;
}

function readMap(storageKey) {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

function saveLevelResult(level, stars, levelScore) {
  const starsMap = readMap(STAR_KEY);
  const scoresMap = readMap(LEVEL_SCORE_KEY);
  const prevStars = Number(starsMap[level]) || 0;
  const prevScore = Number(scoresMap[level]) || 0;
  const improved = (prevStars > 0 || prevScore > 0) && (stars > prevStars || levelScore > prevScore);
  starsMap[level] = Math.max(prevStars, stars);
  scoresMap[level] = Math.max(prevScore, levelScore);
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify(starsMap));
    localStorage.setItem(LEVEL_SCORE_KEY, JSON.stringify(scoresMap));
  } catch (e) { /* ignore */ }
  return { bestStars: starsMap[level], bestScore: scoresMap[level], improved };
}

function rateLevel() {
  const levelScore = Math.max(0, S.score - S.scoreBase);
  const two = S.goal * 100;
  const three = S.goal * 180;
  let stars = 1;
  if (levelScore >= two) stars = 2;
  if (levelScore >= three && S.pressureCount === 0) stars = 3;
  return { stars, levelScore, two, three };
}

function starHtml(n) {
  let html = '';
  for (let i = 1; i <= 3; i++) html += i <= n ? '<span>★</span>' : '<span class="off">★</span>';
  return html;
}

function rememberBest() {
  if (S.score > S.best) {
    S.best = S.score;
    newRecord = true;
    try { localStorage.setItem(BEST_KEY, String(S.best)); } catch (e) { /* ignore */ }
  }
}

function stopScene() {
  if (sceneTimer) {
    clearInterval(sceneTimer);
    sceneTimer = 0;
  }
}

function startScene() {
  stopScene();
  const img = card.querySelector('.nailong-act');
  if (!img) return;
  const frames = (img.dataset.frames || '').split('|').filter(Boolean);
  if (!frames.length) return;
  frames.forEach((src) => {
    const pre = new Image();
    pre.src = src;
  });
  img.src = frames[0];
  if (reduceMotion || frames.length < 2) return;
  let i = 0;
  sceneTimer = setInterval(() => {
    i = (i + 1) % frames.length;
    img.src = frames[i];
  }, 260);
}

function begin(level, score) {
  stopScene();
  resize();
  newRecord = false;
  S.mode = 'playing';
  S.level = level;
  S.score = score;
  S.scoreBase = score;
  S.combo = 0;
  S.shot = null;
  S.falling = [];
  S.particles = [];
  S.rings = [];
  S.floaters = [];
  S.angle = -Math.PI / 2;
  S.pressing = false;
  S.cancel = false;
  S.shake = 0;
  S.dropOffset = 0;
  S.lock = 0;
  S.loseIn = 0;
  S.banner = 1.7;
  S.load = 1;
  const plan = levelPlan(level);
  S.typeCount = plan.types;
  S.shotEvery = plan.shots;
  S.untilDrop = plan.shots;
  S.cleared = 0;
  S.shotsUsed = 0;
  S.pressureCount = 0;
  if (level === 1 && score === 0) S.didShoot = false;
  buildGrid(rowsFor(plan.rowsWanted));
  S.goal = Math.min(plan.goal, Math.max(8, S.grid.size - 6));
  S.bannerText = '第' + level + '关  打掉' + S.goal + '个';
  S.current = rollType();
  S.next = rollType();
  previewKey = '';
  overlay.classList.remove('show');
  syncHud();
}

function showMenu() {
  stopScene();
  S.mode = 'menu';
  S.shot = null;
  card.innerHTML = menuHTML;
  const best = document.getElementById('best');
  if (best) best.textContent = S.best ? '最高 ' + S.best + ' 分' : '还没有记录';
  overlay.classList.add('show');
  syncHud();
}

function onWin() {
  if (S.mode === 'won') return;
  S.mode = 'won';
  const rating = rateLevel();
  const bonus = 200 * S.level * rating.stars;
  S.score += bonus;
  const saved = saveLevelResult(S.level, rating.stars, rating.levelScore);
  rememberBest();
  sfxWin();
  showEnd(true, bonus, rating, saved);
}

function onLoseSoon() {
  if (S.mode !== 'playing') return;
  S.mode = 'losing';
  S.loseIn = 0.55;
  S.shot = null;
}

function finishLose() {
  S.mode = 'lost';
  rememberBest();
  sfxLose();
  showEnd(false, 0);
}

function showEnd(win, bonus, rating, saved) {
  const record = newRecord ? '<p class="record">新纪录！</p>' : '';
  const nextStyle = unlockName(S.level + 1);
  const nextHint = nextStyle
    ? '下一关会多出「' + nextStyle + '」'
    : '下一关种类不变，但会更挤，顶上也压得更快';
  card.innerHTML = win
    ? winCard(bonus, rating, saved, nextHint)
    : '<h1>挤到下面了</h1><p class="end-copy">还差 ' + Math.max(0, S.goal - S.cleared) + ' 个就过关了</p><p class="score-lg">' + S.score + ' 分</p><p class="note">最高 ' + S.best + ' 分</p>' + record + '<div class="actions"><button class="primary" type="button" data-act="retry">再试一次</button><button class="ghost" type="button" data-act="menu">回首页</button></div>';
  if (win) startScene();
  overlay.classList.add('show');
  syncHud();
}

function winCard(bonus, rating, saved, nextHint) {
  const scenes = [
    {
      id: 'flower',
      title: '奶龙撒花啦',
      line: '奶龙把花撒给你',
      frames: ['assets/act-flower-1.jpg', 'assets/act-flower-2.jpg', 'assets/act-flower-3.jpg', 'assets/act-flower-4.jpg'],
    },
    {
      id: 'dance',
      title: '奶龙跳舞啦',
      line: '奶龙自己在跳舞',
      frames: ['assets/act-dance-1.jpg', 'assets/act-dance-2.jpg', 'assets/act-dance-4.jpg', 'assets/act-dance-3.jpg'],
    },
    {
      id: 'cheer',
      title: '奶龙欢呼啦',
      line: '奶龙跳起来欢呼',
      frames: ['assets/act-cheer-1.jpg', 'assets/act-cheer-2.jpg', 'assets/act-cheer-3.jpg', 'assets/act-cheer-4.jpg'],
    },
  ];
  const scene = scenes[(S.level - 1) % scenes.length];
  const fresh = saved.improved ? '<p class="record">刷新了本关纪录！</p>' : '';
  return '<div class="celebrate">'
    + '<img class="nailong-act" alt="奶龙" src="' + scene.frames[0] + '" data-frames="' + scene.frames.join('|') + '">'
    + '<p class="scene-line">' + scene.title + ' · ' + scene.line + '</p></div>'
    + '<h1>恭喜过关</h1>'
    + '<p class="stars" aria-label="' + rating.stars + '星">' + starHtml(rating.stars) + '</p>'
    + '<p class="score-lg">' + rating.levelScore + ' 分</p>'
    + '<p class="end-copy">第 ' + S.level + ' 关本关得分 · 用了 ' + S.shotsUsed + ' 发</p>'
    + '<p class="note">总分 ' + S.score + ' · 过关奖励 +' + bonus + '</p>'
    + '<p class="note">本关最佳 ' + starHtml(saved.bestStars) + ' · ' + saved.bestScore + ' 分</p>'
    + fresh
    + '<p class="note">二星 ' + rating.two + ' 分，三星 ' + rating.three + ' 分且顶上没下压</p>'
    + '<p class="note">' + nextHint + '</p>'
    + '<div class="actions"><button class="primary" type="button" data-act="next">下一关</button>'
    + '<button class="replay" type="button" data-act="retry">再玩本关</button>'
    + '<button class="ghost" type="button" data-act="menu">回首页</button></div>';
}

function pushDown() {
  S.pressureCount += 1;
  const next = new Map();
  for (const b of S.grid.values()) {
    const nb = { r: b.r + 1, c: b.c, type: b.type };
    next.set(key(nb.r, nb.c), nb);
  }
  S.parity ^= 1;
  S.grid = next;
  for (let c = 0; c < COLS; c++) placeFresh(0, c);
  for (let guard = 0; guard < 12; guard++) {
    let dirty = false;
    for (let c = 0; c < COLS; c++) {
      const b = S.grid.get(key(0, c));
      if (b && cluster(0, c).length >= 3) {
        b.type = (b.type + 1) % S.typeCount;
        dirty = true;
      }
    }
    if (!dirty) break;
  }
  S.dropOffset = -rowH();
  S.lock = 0.05;
  S.rev++;
  tone(96, 0.12, 'sine', 0.04);
}

function burst(x, y, type, n) {
  const color = TYPES[type].color;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 50 + Math.random() * 170;
    S.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 30,
      life: 0.4 + Math.random() * 0.25,
      color: i % 3 === 0 ? '#fff' : color,
      size: 2 + Math.random() * 2.6,
    });
  }
  S.rings.push({ x, y, r: radius * 0.45, a: 0.75, color });
}

function detach(list, delay) {
  let removed = 0;
  for (const item of list) {
    const b = Array.isArray(item) ? S.grid.get(key(item[0], item[1])) : item;
    if (!b || !S.grid.has(key(b.r, b.c))) continue;
    const p = cellPos(b.r, b.c);
    S.falling.push({
      x: p.x,
      y: p.y + S.dropOffset,
      vx: (Math.random() - 0.5) * 100,
      vy: 30 + Math.random() * 50,
      vr: (Math.random() - 0.5) * 7,
      rot: 0,
      type: b.type,
      delay,
    });
    S.grid.delete(key(b.r, b.c));
    removed += 1;
    if (S.particles.length < 140) burst(p.x, p.y, b.type, 6);
  }
  if (removed) S.rev++;
  return removed;
}

function resolve(r, c) {
  const group = cluster(r, c);
  if (group.length >= 3) {
    S.combo += 1;
    let sx = 0;
    let sy = 0;
    for (const [rr, cc] of group) {
      const p = cellPos(rr, cc);
      sx += p.x;
      sy += p.y;
    }
    sx /= group.length;
    sy /= group.length;
    const looseBefore = group.length;
    const popped = detach(group, 0);
    const loose = orphans();
    const dropped = detach(loose, 0.07);
    S.cleared += popped + dropped;
    const gained = looseBefore * 100 * S.combo + loose.length * 120 * S.combo;
    S.score += gained;
    rememberBest();
    const word = S.combo >= 4 ? '奶龙最棒' : S.combo === 3 ? '三连击' : S.combo === 2 ? '连击' : '掉落';
    S.floaters.push({ x: sx, y: sy, text: '+' + gained, sub: word, life: 0.95 });
    if (!reduceMotion) S.shake = Math.min(8, 2 + group.length * 0.4);
    if (navigator.vibrate) navigator.vibrate(12);
    sfxPop();
  } else {
    S.combo = 0;
    const p = cellPos(r, c);
    S.rings.push({ x: p.x, y: p.y + S.dropOffset, r: radius * 0.3, a: 0.45, color: '#fff' });
    tone(210, 0.05, 'sine', 0.03);
  }

  if (S.cleared >= S.goal || S.grid.size === 0) {
    onWin();
    return;
  }
  if (tooLow()) {
    onLoseSoon();
    return;
  }
  S.untilDrop -= 1;
  if (S.untilDrop <= 0) {
    pushDown();
    S.untilDrop = S.shotEvery;
    if (tooLow()) onLoseSoon();
  }
}

function findCell(x, y) {
  const candidates = [];
  if (y <= radius * 1.45) {
    for (let c = 0; c < COLS; c++) {
      if (!S.grid.has(key(0, c))) candidates.push([0, c]);
    }
  }
  let nearest = null;
  let nearestD = Infinity;
  for (const b of S.grid.values()) {
    const p = cellPos(b.r, b.c);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < nearestD) {
      nearestD = d;
      nearest = b;
    }
  }
  if (nearest && nearestD <= radius * 2.25) {
    for (const [nr, nc] of neighborsOf(nearest.r, nearest.c)) {
      if (!S.grid.has(key(nr, nc))) candidates.push([nr, nc]);
    }
  }
  const guess = posToCell(x, y);
  if (!S.grid.has(key(guess.r, guess.c)) && (guess.r === 0 || hasNeighbor(guess.r, guess.c))) {
    candidates.push([guess.r, guess.c]);
  }

  let best = null;
  let bestD = Infinity;
  const seen = new Set();
  for (const [r, c] of candidates) {
    const k = key(r, c);
    if (seen.has(k) || S.grid.has(k)) continue;
    seen.add(k);
    const p = cellPos(r, c);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = { r, c };
    }
  }
  if (best) return best;

  let fb = null;
  let fbD = Infinity;
  let maxR = 2;
  for (const b of S.grid.values()) if (b.r + 3 > maxR) maxR = b.r + 3;
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c < COLS; c++) {
      if (S.grid.has(key(r, c))) continue;
      if (r !== 0 && !hasNeighbor(r, c)) continue;
      const p = cellPos(r, c);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < fbD) {
        fbD = d;
        fb = { r, c };
      }
    }
  }
  return fb;
}

function hitTest(x, y) {
  if (y <= radius) return true;
  const limit = radius * 1.94;
  const limit2 = limit * limit;
  for (const b of S.grid.values()) {
    const p = cellPos(b.r, b.c);
    const dy = p.y - y;
    if (dy > limit || dy < -limit) continue;
    const dx = p.x - x;
    if (dx * dx + dy * dy <= limit2) return true;
  }
  return false;
}

function advance(ball, dt) {
  const speed = Math.hypot(ball.vx, ball.vy) || 1;
  const stepDist = Math.max(4, radius * 0.28);
  let left = dt;
  const maxT = stepDist / speed;
  while (left > 1e-5) {
    const t = Math.min(left, maxT);
    ball.x += ball.vx * t;
    ball.y += ball.vy * t;
    if (ball.x < radius) {
      ball.x = radius;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x > w - radius) {
      ball.x = w - radius;
      ball.vx = -Math.abs(ball.vx);
    }
    if (hitTest(ball.x, ball.y)) return true;
    left -= t;
  }
  return false;
}

function stick(ball) {
  const cell = findCell(ball.x, ball.y);
  S.shot = null;
  if (!cell) {
    onLoseSoon();
    return;
  }
  S.grid.set(key(cell.r, cell.c), { r: cell.r, c: cell.c, type: ball.type });
  S.rev++;
  resolve(cell.r, cell.c);
}

function canShoot() {
  return S.mode === 'playing' && !S.shot && S.lock <= 0 && Math.abs(S.dropOffset) < 0.8;
}

function shoot() {
  if (!canShoot()) return;
  const s = shooterPos();
  S.shot = {
    x: s.x,
    y: s.y,
    vx: Math.cos(S.angle) * SHOT_SPEED,
    vy: Math.sin(S.angle) * SHOT_SPEED,
    type: S.current,
    trail: [],
  };
  S.current = S.next;
  S.next = rollType();
  S.load = 0;
  S.didShoot = true;
  S.shotsUsed += 1;
  tone(460, 0.07, 'triangle', 0.035);
}

function swapAmmo() {
  if (!canShoot()) return;
  const t = S.current;
  S.current = S.next;
  S.next = t;
  S.load = 0;
  tone(640, 0.05, 'sine', 0.03);
}

function computePreview(angle) {
  const s = shooterPos();
  const ball = {
    x: s.x,
    y: s.y,
    vx: Math.cos(angle) * SHOT_SPEED,
    vy: Math.sin(angle) * SHOT_SPEED,
  };
  const points = [];
  for (let i = 0; i < 240; i++) {
    const hit = advance(ball, 1 / 90);
    if (i > 2 && i % 3 === 0) points.push({ x: ball.x, y: ball.y });
    if (hit) return { points, cell: findCell(ball.x, ball.y) };
  }
  return { points, cell: null };
}

function getPreview() {
  const id = S.angle.toFixed(3) + '|' + S.rev + '|' + w + '|' + h + '|' + S.parity;
  if (id !== previewKey) {
    previewKey = id;
    previewCache = computePreview(S.angle);
  }
  return previewCache;
}

function localPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function aimAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const s = shooterPos();
  const dx = x - s.x;
  const dy = y - s.y;
  if (dy >= -radius * 0.2) {
    S.cancel = true;
    return;
  }
  S.cancel = false;
  let ang = Math.atan2(dy, dx);
  const min = -Math.PI + 0.18;
  const max = -0.18;
  if (ang < min) ang = min;
  if (ang > max) ang = max;
  S.angle = ang;
}

function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  unlockAudio();
  const p = localPoint(e);
  if (S.mode === 'playing' && !S.shot && Math.hypot(p.x - nextPos().x, p.y - nextPos().y) <= nextPos().r + 14) {
    swapAmmo();
    return;
  }
  if (S.mode !== 'playing') return;
  S.pressing = true;
  S.pointerId = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  aimAt(e.clientX, e.clientY);
}

function onMove(e) {
  if (!S.pressing || (S.pointerId !== null && e.pointerId !== S.pointerId)) return;
  aimAt(e.clientX, e.clientY);
}

function onUp(e) {
  if (!S.pressing || (S.pointerId !== null && e.pointerId !== S.pointerId)) return;
  S.pressing = false;
  const cancel = S.cancel;
  S.cancel = false;
  if (!cancel) shoot();
}

function unlockAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
}

function tone(freq, dur, type, vol) {
  if (S.mute || !actx) return;
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

function sfxPop() {
  tone(520 + S.combo * 40, 0.08, 'sine', 0.04);
  tone(780 + S.combo * 30, 0.12, 'triangle', 0.03);
}

function sfxWin() {
  [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'sine', 0.045), i * 110));
}

function sfxLose() {
  tone(220, 0.16, 'sine', 0.04);
  setTimeout(() => tone(140, 0.28, 'triangle', 0.04), 120);
}

function toggleMute() {
  S.mute = !S.mute;
  muteBtn.textContent = S.mute ? '🔇' : '🔊';
  try { localStorage.setItem(MUTE_KEY, S.mute ? '1' : '0'); } catch (e) { /* ignore */ }
  if (!S.mute) {
    unlockAudio();
    tone(660, 0.06, 'sine', 0.03);
  }
}

function update(dt) {
  S.time += dt;
  if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 18);
  if (S.lock > 0) S.lock = Math.max(0, S.lock - dt);
  if (S.banner > 0) S.banner = Math.max(0, S.banner - dt);
  if (S.load < 1) S.load = Math.min(1, S.load + dt * 5.5);
  if (S.dropOffset) {
    S.dropOffset += (0 - S.dropOffset) * Math.min(1, dt * 9);
    if (Math.abs(S.dropOffset) < 0.35) S.dropOffset = 0;
  }
  if (S.mode === 'losing') {
    S.loseIn -= dt;
    if (S.loseIn <= 0) finishLose();
  }
  if (S.shot) {
    S.shot.trail.push({ x: S.shot.x, y: S.shot.y });
    if (S.shot.trail.length > 8) S.shot.trail.shift();
    if (advance(S.shot, dt)) stick(S.shot);
  }
  for (const f of S.falling) {
    if (f.delay > 0) {
      f.delay -= dt;
      continue;
    }
    f.vy += 2100 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;
  }
  S.falling = S.falling.filter((f) => f.y < h + 70);
  for (const p of S.particles) {
    p.vy += (p.confetti ? 260 : 760) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.vr) p.rot += p.vr * dt;
  }
  S.particles = S.particles.filter((p) => p.life > 0 && p.y < h + 40);
  for (const r of S.rings) {
    r.r += dt * 90;
    r.a -= dt * 1.8;
  }
  S.rings = S.rings.filter((r) => r.a > 0);
  for (const f of S.floaters) {
    f.y -= 28 * dt;
    f.life -= dt;
  }
  S.floaters = S.floaters.filter((f) => f.life > 0);
  syncHud();
}

function syncHud() {
  if (S.mode === 'menu') {
    levelEl.textContent = '奶龙';
    goalEl.textContent = '打掉过关';
    dropEl.textContent = S.best ? '最高 ' + S.best : '待发射';
    dropEl.classList.remove('warn');
  } else {
    const left = Math.max(0, S.goal - S.cleared);
    levelEl.textContent = '第 ' + S.level + ' 关';
    goalEl.textContent = left === 0 ? '过关' : '还差 ' + left;
    dropEl.textContent = S.untilDrop + ' 发后下压';
    dropEl.classList.toggle('warn', S.mode === 'playing' && S.untilDrop <= 2);
  }
  scoreEl.textContent = String(S.score);
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
  radius = w / (COLS * 2 + 1);
  previewKey = '';
}

function drawBubble(x, y, type, opt) {
  const scale = opt && opt.scale ? opt.scale : 1;
  const alpha = opt && opt.alpha !== undefined ? opt.alpha : 1;
  const rot = opt && opt.rot ? opt.rot : 0;
  const ghost = !!(opt && opt.ghost);
  const R = (radius - 1.2) * scale;
  if (R < 2) return;
  const spec = TYPES[type];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  if (!ghost) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(40, 80, 20, 0.14)';
    ctx.arc(1.4, 3, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = spec ? spec.color : '#ffc400';
  ctx.fill();
  const faceR = R * 0.72;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, faceR, 0, Math.PI * 2);
  ctx.clip();
  if (spec && spec.img) {
    const dw = faceR * 2 * spec.z;
    ctx.drawImage(spec.img, -dw / 2, -dw / 2 + faceR * 2 * spec.oy, dw, dw);
  } else {
    drawFallback(type, faceR);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, faceR, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, R * 0.07);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.clip();
  const gloss = ctx.createLinearGradient(0, -R, 0, R * 0.2);
  gloss.addColorStop(0, 'rgba(255,255,255,0.42)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(-R, -R, R * 2, R * 0.62);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1, R - 0.6), 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.2, R * 0.05);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  if (ghost) ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.restore();
}

function drawFallback(type, R) {
  ctx.save();
  const g = ctx.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.1, 0, 0, R);
  g.addColorStop(0, '#fff3b0');
  g.addColorStop(1, type === 5 ? '#ffe56a' : '#ffc83d');
  ctx.fillStyle = g;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  const eyeY = type === 5 ? -R * 0.2 : -R * 0.05;
  const eyeR = R * (type === 2 ? 0.26 : 0.2);
  const gap = R * 0.36;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const ex = side * gap;
    if (type === 4 || (type === 1 && side < 0)) {
      ctx.strokeStyle = '#6a4314';
      ctx.lineWidth = Math.max(2, R * 0.08);
      ctx.beginPath();
      ctx.arc(ex, eyeY, eyeR * 0.7, type === 4 ? 1.15 * Math.PI : 0.15 * Math.PI, type === 4 ? 1.85 * Math.PI : 0.85 * Math.PI);
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#37c94a';
    ctx.arc(ex, eyeY, eyeR * 0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#1b1b1b';
    ctx.arc(ex + eyeR * 0.08, eyeY, eyeR * 0.36, 0, Math.PI * 2);
    ctx.fill();
    if (type === 3) {
      ctx.strokeStyle = '#6a4314';
      ctx.lineWidth = Math.max(2, R * 0.07);
      ctx.beginPath();
      ctx.moveTo(ex - eyeR * 0.9, eyeY - eyeR * (side < 0 ? 1.2 : 0.7));
      ctx.lineTo(ex + eyeR * 0.9, eyeY - eyeR * (side < 0 ? 0.7 : 1.2));
      ctx.stroke();
    }
  }
  ctx.lineWidth = Math.max(2, R * 0.07);
  if (type === 2) {
    ctx.beginPath();
    ctx.fillStyle = '#7a3a32';
    ctx.arc(0, R * 0.32, R * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 3) {
    ctx.strokeStyle = '#c47a2a';
    ctx.beginPath();
    ctx.moveTo(-R * 0.16, R * 0.36);
    ctx.quadraticCurveTo(0, R * 0.2, R * 0.16, R * 0.36);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#c47a2a';
    ctx.beginPath();
    ctx.moveTo(-R * 0.2, R * 0.26);
    ctx.quadraticCurveTo(0, R * 0.46, R * 0.2, R * 0.26);
    ctx.stroke();
  }
  ctx.restore();
}

function drawScene() {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#7ecbff');
  sky.addColorStop(0.38, '#d9f6ff');
  sky.addColorStop(0.7, '#e5f7c4');
  sky.addColorStop(1, '#7dcd45');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  const clouds = [[0.16, 0.08, 1], [0.58, 0.13, 0.72], [0.86, 0.06, 0.48]];
  for (const [fx, fy, s] of clouds) {
    const x = ((fx + S.time * 0.012) % 1.2 - 0.1) * w;
    const y = fy * h;
    ctx.beginPath();
    ctx.ellipse(x, y, 36 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 24 * s, y + 4, 26 * s, 14 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 22 * s, y + 6, 22 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(0, 0, w, 8);

  ctx.fillStyle = '#67be3c';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h + 36, w * 0.78, 86, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#91e15d';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h + 24, w * 0.7, 52, 0, 0, Math.PI * 2);
  ctx.fill();

  const flowers = [[0.1, '#fff'], [0.22, '#ffe14a'], [0.8, '#fff'], [0.92, '#ffb7d0']];
  for (const [fx, color] of flowers) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(fx * w, h - 14, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDanger() {
  const y = limitCenterY();
  let gap = Infinity;
  for (const b of S.grid.values()) gap = Math.min(gap, y - cellPos(b.r, b.c).y);
  const close = gap < rowH() * 2.1;
  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = close ? 'rgba(214, 40, 70, 0.75)' : 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.moveTo(14, y);
  ctx.lineTo(w - 14, y);
  ctx.stroke();
  ctx.restore();
  if (close && S.mode === 'playing') {
    ctx.font = '700 12px PingFang SC, sans-serif';
    ctx.fillStyle = 'rgba(180, 30, 50, 0.85)';
    ctx.textAlign = 'right';
    ctx.fillText('小心', w - 16, y - 6);
  }
}

function drawGuide() {
  if (S.mode !== 'playing' || S.shot || Math.abs(S.dropOffset) > 1 || (S.pressing && S.cancel)) return;
  const preview = getPreview();
  ctx.fillStyle = S.pressing ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
  for (const p of preview.points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, S.pressing ? 3.2 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (preview.cell) {
    const p = cellPos(preview.cell.r, preview.cell.c);
    drawBubble(p.x, p.y + S.dropOffset, S.current, { alpha: S.pressing ? 0.55 : 0.28, ghost: true });
  }
}

function drawAvatar() {
  const r = Math.min(24, Math.max(16, radius * 0.8));
  const orbit = r + 18;
  const x = orbit + 6;
  const y = h - orbit - 12;
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = 'rgba(40,80,20,0.12)';
  ctx.arc(x + 1, y + 3, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  if (S.avatar) ctx.drawImage(S.avatar, x - r, y - r, r * 2, r * 2);
  else {
    ctx.fillStyle = '#ffc400';
    ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();
  drawBadgeText(x, y, orbit);
}

function drawBadgeText(x, y, orbit) {
  const chars = ['奶', '龙', '出', '品', '必', '属', '精', '品'];
  const size = Math.max(11, Math.min(14, (orbit - 18) * 0.58));
  ctx.save();
  ctx.font = '800 ' + size + 'px PingFang SC, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (let i = 0; i < chars.length; i++) {
    const ang = -Math.PI / 2 + i * (Math.PI * 2 / chars.length);
    ctx.save();
    ctx.translate(x + Math.cos(ang) * orbit, y + Math.sin(ang) * orbit);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeText(chars[i], 0, 0);
    ctx.fillStyle = '#1f5c16';
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawLauncher() {
  const s = shooterPos();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(s.x, s.y + 2, radius * 0.92, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
  if (S.current !== null && S.current !== undefined) {
    const bob = Math.sin(S.time * 3) * 2;
    const scale = 0.72 + 0.28 * S.load;
    drawBubble(s.x, s.y + bob * (1 - Math.min(1, S.load)), S.current, { scale });
  }
  const n = nextPos();
  drawBubble(n.x, n.y, S.next, { scale: n.r / Math.max(1, radius - 1.2) });
  ctx.font = '700 11px PingFang SC, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(40, 80, 20, 0.78)';
  ctx.fillText('下一个', n.x, n.y + n.r + 13);
  if (S.mode === 'playing' && !S.shot && (S.pressing && S.cancel || !S.didShoot)) {
    ctx.font = '700 13px PingFang SC, sans-serif';
    ctx.fillStyle = S.pressing && S.cancel ? 'rgba(180, 40, 50, 0.9)' : 'rgba(40, 80, 20, 0.8)';
    ctx.fillText(S.pressing && S.cancel ? '松手取消' : '按住瞄准，松手发射', s.x, s.y - radius * 2.05);
  }
}

function drawBanner() {
  if (S.banner <= 0) return;
  const a = Math.min(1, S.banner * 2);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = '800 28px PingFang SC, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.fillStyle = '#f0a000';
  ctx.strokeText(S.bannerText, w / 2, h * 0.42);
  ctx.fillText(S.bannerText, w / 2, h * 0.42);
  ctx.restore();
}

function render() {
  if (w < 10 || h < 10) return;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  if (S.shake > 0.2) {
    ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
  }
  drawScene();
  if (S.mode !== 'menu') drawDanger();
  for (const b of S.grid.values()) {
    const p = cellPos(b.r, b.c);
    drawBubble(p.x, p.y + S.dropOffset, b.type);
  }
  for (const f of S.falling) drawBubble(f.x, f.y, f.type, { rot: f.rot, scale: f.delay > 0 ? 1.08 : 1 });
  drawGuide();
  for (const r of S.rings) {
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = Math.max(0, r.a);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const p of S.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
    ctx.fillStyle = p.color;
    if (p.confetti) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot || 0);
      ctx.fillRect(-p.size, -p.size * 0.35, p.size * 2, p.size * 0.7);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (S.shot) {
    for (let i = 0; i < S.shot.trail.length; i++) {
      const t = S.shot.trail[i];
      drawBubble(t.x, t.y, S.shot.type, { alpha: 0.08 + i / S.shot.trail.length * 0.18, scale: 0.82 });
    }
    drawBubble(S.shot.x, S.shot.y, S.shot.type);
  }
  if (S.mode !== 'menu' || S.avatar) drawAvatar();
  if (S.mode === 'playing' || S.mode === 'losing') drawLauncher();
  for (const f of S.floaters) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.4));
    ctx.textAlign = 'center';
    ctx.font = '800 22px PingFang SC, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2f6a16';
    ctx.fillStyle = '#fff8d0';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillText(f.text, f.x, f.y);
    if (f.sub) {
      ctx.font = '700 13px PingFang SC, sans-serif';
      ctx.strokeText(f.sub, f.x, f.y + 18);
      ctx.fillText(f.sub, f.x, f.y + 18);
    }
    ctx.restore();
  }
  drawBanner();
  ctx.restore();
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function cropAvatar(img) {
  const size = 320;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  const sw = img.width * 0.62;
  const sh = sw;
  const sx = (img.width - sw) / 2;
  const sy = img.height * 0.035;
  g.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
  return c;
}

function bind() {
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', () => {
    S.pressing = false;
    S.cancel = false;
  });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(board);
  muteBtn.addEventListener('click', toggleMute);
  card.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    unlockAudio();
    const act = btn.dataset.act;
    if (act === 'start') begin(1, 0);
    else if (act === 'next') begin(S.level + 1, S.score);
    else if (act === 'retry') begin(S.level, S.scoreBase);
    else if (act === 'menu') showMenu();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm') {
      toggleMute();
      return;
    }
    if (S.mode !== 'playing') {
      if (e.key === 'Enter' && S.mode === 'menu') begin(1, 0);
      return;
    }
    const min = -Math.PI + 0.18;
    const max = -0.18;
    if (e.key === 'ArrowLeft') S.angle = Math.max(min, S.angle - 0.07);
    else if (e.key === 'ArrowRight') S.angle = Math.min(max, S.angle + 0.07);
    else if (e.key === 'ArrowUp' || e.key === ' ') {
      e.preventDefault();
      S.cancel = false;
      shoot();
    }
  });
}

let last = 0;
function frame(now) {
  if (!last) last = now;
  const dt = Math.min(0.034, (now - last) / 1000);
  last = now;
  if (!w) resize();
  update(dt);
  render();
  requestAnimationFrame(frame);
}

async function boot() {
  bind();
  try {
    selfTest();
  } catch (err) {
    card.innerHTML = '<h1>出了点问题</h1><p class="lead">' + err.message + '</p>';
    overlay.classList.add('show');
    console.error(err);
    return;
  }
  resize();
  try {
    S.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    S.mute = localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) { /* ignore */ }
  muteBtn.textContent = S.mute ? '🔇' : '🔊';
  const best = document.getElementById('best');
  if (best) best.textContent = S.best ? '最高 ' + S.best + ' 分' : '还没有记录';
  menuHTML = card.innerHTML;
  const imgs = await Promise.all(TYPES.map((t) => loadImage(t.file)));
  imgs.forEach((img, i) => { TYPES[i].img = img; });
  const hero = await loadImage('assets/hero.jpg');
  if (hero) S.avatar = cropAvatar(hero);
  requestAnimationFrame(frame);
}

boot();
