// game.js: the core of Lobo (menus, physics, combat, CPU, controls and the 3D scene).

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ARENA = { cx: 0, cy: 0, r: 260 };
const BEY_R = 16;
const MATCH_TIME_LIMIT = 60;        // seconds per single game

// --- Combat tuning ------------------------------------------------------------
// Spin is the bey's health, from 1 down to 0. How much a hit takes depends on how it
// lands (impact speed, who drove into whom, timing of the moves), not on the stats.
// Stats only shift things by a few percent; mostly they change how a bey moves.
const MAX_SPIN_LIFE = 1.0;
const SPIN_DECAY = 0.038;           // base decay per second
const STABLE_SPIN = 0.10;           // above this, decay is gentle; below, it speeds up
const KNOCKBACK_SCALE = 2.2;
const MIN_KNOCKBACK = 3.0;
const HIT_FULL_CLOSING = 260;       // impact speed that deals a full-value hit
const HIT_MAX = 0.055;              // spin removed by a full-value hit, before modifiers
const MIN_SPIN_LOSS = 0.004;        // even a graze takes a little
const MAX_SPIN_LOSS = 0.14;         // max per collision, so nothing one-shots
const SMASH = 0.04;                 // bonus for landing a base move
const SPECIAL_CD_REFUND = 1.6;      // seconds off the special cooldown per landed base hit
const PARRY_WINDOW = 0.35;          // Draciel: raise the shell this close to a hit and it's a parry
const IMPACT_COOLDOWN = 0.22;       // min seconds between damaging hits, so grinding doesn't pile up
const WALL_SPIN_LOSS_MIN = 0.02;
const WALL_SPIN_LOSS_MAX = 0.05;

function stat100(v) { return v * 10; }
// Each stat becomes a small multiplier around 1.0 (a stat of 5.5 gives exactly 1.0).
function statMod(v, per) { return 1 + (v - 5.5) * per; }
function atkCombatMult(atk) { return statMod(atk, 0.018); }  // damage dealt   ~0.92..1.08
function spinDefMult(def) { return statMod(def, 0.018); }    // damage taken / ~0.92..1.08
function pushMult(atk) { return statMod(atk, 0.045); }       // knockback dealt ~0.80..1.20
function defMult(def) { return statMod(def, 0.05); }         // knockback resisted ~0.78..1.23
function staMult(sta) { return statMod(sta, -0.02); }        // natural decay rate ~1.09..0.91
function steerAccel(f) { return 245 + f.bey.stats.speed * 5; }   // ~250..295
function maxSpeedOf(f) { return 142 + f.bey.stats.speed * 4; }   // ~146..182
// Spin lost in a collision at a given closing speed (before who-hit-whom and stats).
function impactLoss(closing) {
  const t = clamp01(closing / HIT_FULL_CLOSING);
  return MIN_SPIN_LOSS + HIT_MAX * Math.pow(t, 1.25);
}
// Move damage scaled by the attacker's attack and the defender's defense.
function scaled(att, def, amount) {
  return amount * atkCombatMult(att.bey.stats.attack) / spinDefMult(def.bey.stats.defense);
}
// No type advantage on damage anymore: the types show in how the beys play
// (attackers push, defenders parry, stamina types last longer).
const TYPE_BEATS = { attack: 'stamina', stamina: 'defense', defense: 'attack' };
function typeAdvantage() { return 1; }

// ---------------------------------------------------------------
// Simple flat icons for the 2D cards (selection and champion screens).
// The arena uses the 3D models further down.
// ---------------------------------------------------------------
function drawBeyIcon(ctx, bey, cx, cy, r, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
  grad.addColorStop(0, bey.colors.primary);
  grad.addColorStop(1, bey.colors.secondary);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.stroke();
  switch (bey.emblem) {
    case 'spiral': drawSpiral(ctx, r); break;
    case 'flame': drawFlame(ctx, r, false); break;
    case 'flame-dark': drawFlame(ctx, r, true); break;
    case 'stripes': drawStripes(ctx, r); break;
    case 'hex': drawHex(ctx, r); break;
    case 'snowflake': drawSnowflake(ctx, r); break;
    case 'sunburst': drawSunburst(ctx, r); break;
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = bey.colors.bit;
  ctx.fill();
  ctx.restore();
}
function drawSpiral(ctx, r) {
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.02) {
    const a = t * 2.2 * Math.PI * 2, rad = t * r * 0.78;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineWidth = r * 0.12; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
}
function drawFlame(ctx, r, dark) {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.7);
  ctx.bezierCurveTo(r * 0.55, r * 0.25, r * 0.32, -r * 0.4, 0, -r * 0.75);
  ctx.bezierCurveTo(-r * 0.32, -r * 0.4, -r * 0.55, r * 0.25, 0, r * 0.7);
  ctx.closePath();
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.5)';
  ctx.fill();
  if (dark) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.75); ctx.lineTo(r * 0.18, -r * 0.3); ctx.lineTo(-r * 0.18, -r * 0.3);
    ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();
  }
}
function drawStripes(ctx, r) {
  ctx.save(); ctx.rotate(-0.5);
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.rect(i * r * 0.32 - r * 0.08, -r * 0.7, r * 0.16, r * 1.4);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
  }
  ctx.restore();
}
function drawHex(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 - Math.PI / 2;
    const x = Math.cos(a) * r * 0.65, y = Math.sin(a) * r * 0.65;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineWidth = r * 0.1; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
}
function drawSnowflake(ctx, r) {
  for (let i = 0; i < 3; i++) {
    ctx.save(); ctx.rotate(i * Math.PI / 3);
    ctx.beginPath(); ctx.moveTo(0, -r * 0.72); ctx.lineTo(0, r * 0.72);
    ctx.lineWidth = r * 0.1; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.18, -r * 0.46); ctx.lineTo(r * 0.18, -r * 0.46);
    ctx.moveTo(-r * 0.18, r * 0.46); ctx.lineTo(r * 0.18, r * 0.46);
    ctx.lineWidth = r * 0.07; ctx.stroke();
    ctx.restore();
  }
}
function drawSunburst(ctx, r) {
  for (let i = 0; i < 8; i++) {
    ctx.save(); ctx.rotate(i * Math.PI / 4);
    ctx.beginPath(); ctx.moveTo(0, -r * 0.3); ctx.lineTo(0, -r * 0.78);
    ctx.lineWidth = r * 0.1; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineCap = 'round';
    ctx.stroke(); ctx.restore();
  }
}

// ---------------------------------------------------------------
// Selection screen
// ---------------------------------------------------------------
const GAME = {
  mode: 'tournament',          // 'tournament' | 'single'
  selectionPhase: 'player',    // for single battle: 'player' then 'opponent'
  selectedId: null,
  playerBeyId: null,
  opponentBeyId: null,
  round: 1,
  totalRounds: 3,
  matches: [],
  pendingMatch: null,
  playerPath: [],
  singleMatch: null
};

let carouselIndex = 0;
function renderCarousel() {
  const bey = BEY_ROSTER[carouselIndex];
  GAME.selectedId = bey.id;
  $('carousel-name').textContent = bey.name;
  $('carousel-element').textContent = `${bey.element} · ${TYPE_LABEL[bey.type] || 'Balance'} Type`;
  drawBeyIcon($('carousel-icon').getContext('2d'), bey, 70, 70, 58, 0);
  $('carousel-dots').innerHTML = BEY_ROSTER
    .map((_, i) => `<span class="dot${i === carouselIndex ? ' active' : ''}"></span>`)
    .join('');
}
function cycleCarousel(dir) {
  carouselIndex = (carouselIndex + dir + BEY_ROSTER.length) % BEY_ROSTER.length;
  renderCarousel();
}
const TYPE_LABEL = { attack: 'Attack', defense: 'Defense', stamina: 'Stamina', balance: 'Balance' };

// ---------------------------------------------------------------
// Tournament bracket (single elimination, each match best-of-3)
// ---------------------------------------------------------------
function buildFirstRound(list) {
  const shuffled = shuffle(list);
  const n = shuffled.length;
  let pow2 = 1;
  while (pow2 < n) pow2 *= 2;
  const byes = pow2 - n;
  const matches = [];
  let idx = 0;
  for (let i = 0; i < byes; i++) { matches.push(newMatch(shuffled[idx], null)); idx++; }
  while (idx < n) { matches.push(newMatch(shuffled[idx], shuffled[idx + 1])); idx += 2; }
  return matches;
}
function newMatch(a, b) {
  const score = {};
  score[a.id] = 0;
  if (b) score[b.id] = 0;
  return { a, b, winner: null, done: false, score };
}
function pairRound(winners) {
  const matches = [];
  for (let i = 0; i < winners.length; i += 2) matches.push(newMatch(winners[i], winners[i + 1]));
  return matches;
}

function simulateCpuMatch(a, b) {
  const pa = beyPowerScore(a) + (Math.random() * 6 - 3);
  const pb = beyPowerScore(b) + (Math.random() * 6 - 3);
  return pa >= pb ? a : b;
}
function simulateSet(a, b) {
  const wins = {}; wins[a.id] = 0; wins[b.id] = 0;
  while (wins[a.id] < 2 && wins[b.id] < 2) wins[simulateCpuMatch(a, b).id]++;
  return wins[a.id] > wins[b.id] ? a : b;
}

function resolveAutoMatches() {
  GAME.pendingMatch = null;
  GAME.matches.forEach((m) => {
    if (m.done) return;
    if (m.b === null) { m.winner = m.a; m.done = true; return; }
    if (m.a.id === GAME.playerBeyId || m.b.id === GAME.playerBeyId) { GAME.pendingMatch = m; return; }
    m.winner = simulateSet(m.a, m.b);
    m.done = true;
  });
}

function startTournament(playerBeyId) {
  GAME.mode = 'tournament';
  GAME.playerBeyId = playerBeyId;
  GAME.round = 1;
  GAME.totalRounds = Math.ceil(Math.log2(BEY_ROSTER.length));
  GAME.matches = buildFirstRound(BEY_ROSTER);
  GAME.playerPath = [];
  resolveAutoMatches();
  showScreen('bracket');
  renderBracketScreen();
}

// --- Mode + selection flow ---
function enterMode(mode) {
  GAME.mode = mode;
  GAME.selectionPhase = 'player';
  carouselIndex = 0;
  updateSelectScreenForPhase();
  renderCarousel();
  showScreen('select');
}

function updateSelectScreenForPhase() {
  if (GAME.mode === 'tournament') {
    $('select-title').textContent = 'Choose your Bey';
    $('btn-confirm-select').textContent = 'Enter Tournament';
  } else if (GAME.selectionPhase === 'player') {
    $('select-title').textContent = 'Choose your Bey';
    $('btn-confirm-select').textContent = 'Next: Pick Opponent';
  } else {
    $('select-title').textContent = 'Choose your Opponent';
    $('btn-confirm-select').textContent = 'Start Battle';
  }
}

function confirmSelection() {
  if (!GAME.selectedId) return;
  if (GAME.mode === 'tournament') {
    startTournament(GAME.selectedId);
    return;
  }
  // Single battle: two-phase pick.
  if (GAME.selectionPhase === 'player') {
    GAME.playerBeyId = GAME.selectedId;
    GAME.selectionPhase = 'opponent';
    // Default the opponent carousel to a different bey.
    carouselIndex = (carouselIndex + 1) % BEY_ROSTER.length;
    updateSelectScreenForPhase();
    renderCarousel();
  } else {
    GAME.opponentBeyId = GAME.selectedId;
    startSingleBattle();
  }
}

function startSingleBattle() {
  const playerBey = BEY_ROSTER.find((b) => b.id === GAME.playerBeyId);
  const oppBey = BEY_ROSTER.find((b) => b.id === GAME.opponentBeyId);
  GAME.singleMatch = newMatch(playerBey, oppBey);
  GAME.pendingMatch = GAME.singleMatch;
  beginBattleForMatch(GAME.singleMatch);
}

function renderBracketScreen() {
  $('path-list').innerHTML = GAME.playerPath
    .map((p) => `<div class="path-item">✔ Beat <b>${p.opponent}</b> (${p.score})</div>`)
    .join('');

  const matchCount = GAME.matches.length;
  $('round-label').textContent = matchCount === 1 ? 'Final' : matchCount === 2 ? 'Semifinal' : `Round ${GAME.round}`;

  const list = $('bracket-list');
  list.innerHTML = '';
  GAME.matches.forEach((m) => {
    const row = document.createElement('div');
    const involvesPlayer = (m.a && m.a.id === GAME.playerBeyId) || (m.b && m.b.id === GAME.playerBeyId);
    row.className = 'bracket-match' + (involvesPlayer && !m.done ? ' is-player' : '') + (m.done ? ' done' : '');
    let html = `<span>${m.a.name}</span>`;
    if (m.b) {
      html += `<span class="bracket-vs">vs</span><span>${m.b.name}</span>`;
      if (m.done) html += `<span class="bracket-vs">· ${m.winner.name} wins</span>`;
    } else {
      html += `<span class="bracket-bye">bye</span>`;
    }
    row.innerHTML = html;
    list.appendChild(row);
  });

  const btn = $('btn-start-match');
  if (GAME.pendingMatch) {
    btn.textContent = 'Battle';
    btn.onclick = () => beginBattleForMatch(GAME.pendingMatch);
  } else {
    btn.textContent = GAME.matches.length === 1 ? 'See champion' : 'Continue';
    btn.onclick = () => proceedAfterRound();
  }
}

function proceedAfterRound() {
  const winners = GAME.matches.map((m) => m.winner);
  if (winners.length === 1) { showChampionScreen(winners[0]); return; }
  GAME.round++;
  GAME.matches = pairRound(winners);
  resolveAutoMatches();
  showScreen('bracket');
  renderBracketScreen();
}

function finishRemainingSilently() {
  let winners = GAME.matches.map((m) => m.winner);
  while (winners.length > 1) {
    const ms = pairRound(winners);
    ms.forEach((m) => { m.winner = simulateSet(m.a, m.b); m.done = true; });
    winners = ms.map((m) => m.winner);
  }
  showChampionScreen(winners[0]);
}

function finalizeMatch(winnerBey, playerWon, reasonText) {
  if (GAME.mode === 'single') {
    GAME.pendingMatch = null;
    const title = playerWon ? 'You win!' : 'You lose';
    showResultScreen(title, reasonText, () => {
      // Rematch the same pairing.
      GAME.singleMatch = newMatch(
        BEY_ROSTER.find((b) => b.id === GAME.playerBeyId),
        BEY_ROSTER.find((b) => b.id === GAME.opponentBeyId)
      );
      GAME.pendingMatch = GAME.singleMatch;
      beginBattleForMatch(GAME.singleMatch);
    }, 'Rematch');
    return;
  }
  GAME.pendingMatch.winner = winnerBey;
  GAME.pendingMatch.done = true;
  GAME.pendingMatch = null;
  if (playerWon) {
    showResultScreen('Matchup won!', reasonText, () => proceedAfterRound());
  } else {
    showResultScreen('Eliminated', reasonText, () => finishRemainingSilently());
  }
}

// ---------------------------------------------------------------
// Screen management
// ---------------------------------------------------------------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
}
function showResultScreen(title, text, onContinue, continueLabel) {
  $('result-title').textContent = title;
  $('result-text').textContent = text;
  $('btn-continue').textContent = continueLabel || 'Continue';
  $('btn-continue').onclick = onContinue;
  showScreen('result');
}
function showChampionScreen(championBey) {
  const wrapper = $('champion-card');
  wrapper.innerHTML = `<canvas width="96" height="96" id="champion-icon"></canvas>
    <div class="bey-card-name">${championBey.name}</div>
    <div class="bey-card-element">${championBey.element}</div>`;
  const note = document.createElement('p');
  note.className = 'result-text';
  note.textContent = championBey.id === GAME.playerBeyId ? 'You won the tournament!' : `${championBey.name} takes the tournament.`;
  wrapper.appendChild(note);
  showScreen('champion');
  requestAnimationFrame(() => {
    const cv = $('champion-icon');
    if (cv) drawBeyIcon(cv.getContext('2d'), championBey, 48, 48, 42, 0);
  });
}

// ---------------------------------------------------------------
// Three.js arena + bey models
// ---------------------------------------------------------------
let renderer3d = null, scene3d = null, camera3d = null;
let meshA = null, meshB = null;

function initThree() {
  if (typeof THREE === 'undefined') {
    console.warn('Three.js failed to load (internet connection required).');
    const errEl = $('three-error');
    if (errEl) errEl.style.display = 'flex';
    return;
  }
  const canvas = $('arena');
  renderer3d = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  // Cap the pixel ratio. At full retina (2-3x) there are far more pixels to shade,
  // and phones need that headroom for the move effects and the glow.
  renderer3d.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer3d.shadowMap.enabled = true;
  renderer3d.shadowMap.type = THREE.PCFShadowMap;

  scene3d = new THREE.Scene();
  camera3d = new THREE.PerspectiveCamera(40, 360 / 480, 1, 2000);
  camera3d.position.set(0, ARENA.r * 1.85, ARENA.r * 1.55);
  camera3d.lookAt(0, 0, -ARENA.r * 0.18);

  const ambient = new THREE.AmbientLight(0xaab4d0, 0.95);
  scene3d.add(ambient);
  const dir = new THREE.DirectionalLight(0xfff4e2, 1.1);
  dir.position.set(ARENA.r * 0.4, ARENA.r * 1.6, ARENA.r * 0.6);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near = 50;
  dir.shadow.camera.far = 900;
  dir.shadow.camera.left = -ARENA.r * 1.4;
  dir.shadow.camera.right = ARENA.r * 1.4;
  dir.shadow.camera.top = ARENA.r * 1.4;
  dir.shadow.camera.bottom = -ARENA.r * 1.4;
  dir.shadow.bias = -0.0012;
  scene3d.add(dir);
  const rim = new THREE.DirectionalLight(0x6688ff, 0.3);
  rim.position.set(-ARENA.r * 0.5, ARENA.r * 0.4, -ARENA.r * 0.4);
  scene3d.add(rim);

  buildStadium();
  if (window.FX) FX.init(renderer3d, scene3d, camera3d, { ambient, dir, ambientBase: 0.95, dirBase: 1.1 });

  resizeRendererToCanvas();
  window.addEventListener('resize', resizeRendererToCanvas);
}

// KO pockets: the gaps in the wall where a bey can be knocked out.
const POCKET_ANGLES = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
const POCKET_HALF_WIDTH = Math.PI / 7.5;
const WALL_RADIUS = ARENA.r;                  // inner face of the wall ring
const PLATFORM_RADIUS = () => ARENA.r * 1.33; // outer marble platform
const WALL_HEIGHT = 34;

function isAtPocketAngle(angle, tol = 1) {
  for (const p of POCKET_ANGLES) {
    let d = ((angle - p) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    if (Math.abs(d) <= POCKET_HALF_WIDTH * tol) return true;
  }
  return false;
}

function buildStadium() {
  // Outer platform: the light tiled ring the stadium sits on.
  const platform = new THREE.Mesh(
    new THREE.CircleGeometry(PLATFORM_RADIUS(), 80),
    new THREE.MeshStandardMaterial({ color: 0xcfccc2, roughness: 0.7, metalness: 0.05 })
  );
  platform.rotation.x = -Math.PI / 2;
  platform.position.y = -0.4;
  platform.receiveShadow = true;
  scene3d.add(platform);

  // The battle floor: flat and dark, with a soft radial gradient.
  const dish = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA.r + 4, 80),
    new THREE.MeshStandardMaterial({ map: makeDishTexture(), roughness: 0.85, metalness: 0.12 })
  );
  dish.rotation.x = -Math.PI / 2;
  dish.position.y = 0;
  dish.receiveShadow = true;
  scene3d.add(dish);

  // Metal lip where the floor meets the walls.
  const lip = new THREE.Mesh(
    new THREE.RingGeometry(ARENA.r + 1, ARENA.r + 5, 80),
    new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.5, roughness: 0.3 })
  );
  lip.rotation.x = -Math.PI / 2;
  lip.position.y = 0.3;
  scene3d.add(lip);

  // Raised navy wall blocks along each stretch between the KO pockets.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x27325a, metalness: 0.4, roughness: 0.36, emissive: 0x0b1430, emissiveIntensity: 0.15
  });
  const wallR = ARENA.r + 6;
  for (let i = 0; i < POCKET_ANGLES.length; i++) {
    const pocketStart = POCKET_ANGLES[i];
    const pocketEnd = POCKET_ANGLES[(i + 1) % POCKET_ANGLES.length];
    let wallStart = pocketStart + POCKET_HALF_WIDTH;
    let wallEnd = pocketEnd - POCKET_HALF_WIDTH;
    if (wallEnd < wallStart) wallEnd += Math.PI * 2;
    const span = wallEnd - wallStart;
    const segments = 14;
    const segDepth = (span * wallR / segments) * 1.3;
    for (let j = 0; j <= segments; j++) {
      const angle = wallStart + (span * j) / segments;
      const block = new THREE.Mesh(new THREE.BoxGeometry(14, WALL_HEIGHT, segDepth), wallMat);
      block.position.set(Math.cos(angle) * wallR, WALL_HEIGHT * 0.5 - 2, Math.sin(angle) * wallR);
      block.rotation.y = -angle;
      block.castShadow = true;
      block.receiveShadow = true;
      scene3d.add(block);
    }
  }
}

function makeDishTexture() {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size * 0.42, size * 0.05, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#43464d');
  g.addColorStop(0.7, '#393c42');
  g.addColorStop(1, '#2c2f35');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function resizeRendererToCanvas() {
  if (!renderer3d) return;
  const canvas = renderer3d.domElement;
  const w = canvas.clientWidth || 360, h = canvas.clientHeight || 480;
  renderer3d.setSize(w, h, false);
  camera3d.aspect = w / h;
  camera3d.updateProjectionMatrix();
  if (window.FX && FX.ready) FX.resize();
}

const EMBLEM_FIN_COUNT = { spiral: 3, flame: 3, 'flame-dark': 4, stripes: 3, hex: 6, snowflake: 6, sunburst: 8 };

function buildBeyMesh(bey) {
  const group = new THREE.Group();
  // The body uses the bey's main color, with a slightly darker disc on top.
  // The cap in the middle is the bit chip, with its own color.
  const bodyMat = new THREE.MeshStandardMaterial({ color: bey.colors.primary, metalness: 0.45, roughness: 0.4 });
  const discMat = new THREE.MeshStandardMaterial({ color: bey.colors.secondary, metalness: 0.4, roughness: 0.45 });
  const bitMat = new THREE.MeshStandardMaterial({ color: bey.colors.bit, metalness: 0.3, roughness: 0.4, emissive: bey.colors.bit, emissiveIntensity: 0.18 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.3 });

  // The ring sits just above the tip, which touches the floor at y=0.
  const RING_H = 10, TIP_H = 12;
  const ringY = TIP_H + RING_H / 2; // center of the ring

  const ring = new THREE.Mesh(new THREE.CylinderGeometry(BEY_R, BEY_R * 1.05, RING_H, 28), bodyMat);
  ring.position.y = ringY;
  ring.castShadow = true;
  group.add(ring);

  // Darker upper disc, to give the body two tones.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(BEY_R * 0.8, BEY_R * 0.8, 3, 24), discMat);
  disc.position.y = ringY + RING_H / 2 + 1;
  disc.castShadow = true;
  group.add(disc);

  // Bit chip in the middle.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(BEY_R * 0.4, BEY_R * 0.4, 4, 24), bitMat);
  cap.position.y = ringY + RING_H / 2 + 3;
  cap.castShadow = true;
  group.add(cap);

  // The tip points down and touches the floor (y=0).
  const tip = new THREE.Mesh(new THREE.ConeGeometry(BEY_R * 0.3, TIP_H, 16), tipMat);
  tip.position.y = TIP_H / 2;
  tip.rotation.x = Math.PI; // point it down
  group.add(tip);

  const finCount = EMBLEM_FIN_COUNT[bey.emblem] || 4;
  for (let i = 0; i < finCount; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(3, 6, BEY_R * 0.5), bodyMat);
    const a = (i / finCount) * Math.PI * 2;
    fin.position.set(Math.cos(a) * BEY_R * 0.75, ringY, Math.sin(a) * BEY_R * 0.75);
    fin.rotation.y = -a;
    fin.castShadow = true;
    group.add(fin);
  }
  group.userData.bodyCenterY = ringY; // pivot height for leaning and toppling

  // --- Special-move glow ---
  // When a special starts, the bit chip lights up: a bright core, a small halo and a
  // short beam of light rising out of it, like the bit-beast coming out in the show.
  // The body itself stays unlit. It all starts switched off.
  const bitColor = new THREE.Color(bey.colors.bit);
  const bitTopY = ringY + RING_H / 2 + 3; // the cap (bit) sits here

  // Small additive halo around the bit chip only.
  const haloMat = new THREE.MeshBasicMaterial({
    color: bitColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(BEY_R * 0.5, 16, 12), haloMat);
  halo.position.y = bitTopY;
  group.add(halo);

  // A soft beam rising out of the bit: narrow at the bottom, wider as it goes up,
  // and kept short. Its base sits right on the bit.
  const beamMat = new THREE.MeshBasicMaterial({
    color: bitColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide
  });
  const BEAM_H = BEY_R * 1.4;              // keep it short
  const beam = new THREE.Mesh(new THREE.ConeGeometry(BEY_R * 0.8, BEAM_H, 18, 1, true), beamMat);
  beam.rotation.x = Math.PI;              // flip it: narrow at the bottom, wide at the top
  beam.position.y = bitTopY + BEAM_H / 2; // the base of the cone sits on the bit
  group.add(beam);

  // A point light on the bit, so the light on the floor seems to come from it.
  const glowLight = new THREE.PointLight(bitColor, 0, BEY_R * 5);
  glowLight.position.y = bitTopY + 2;
  group.add(glowLight);

  group.userData.glow = {
    halo, haloMat, beam, beamMat, light: glowLight, bitMat,
    baseEmissive: 0.18, // how much the bit glows normally
  };
  return group;
}

// Sets the special-move glow. `level` goes from 0 (off) to 1 (full). A slight pulse
// makes it shimmer.
function setBeyGlow(mesh, level, timeSec) {
  if (!mesh || !mesh.userData.glow) return;
  const g = mesh.userData.glow;
  const pulse = 0.82 + 0.18 * Math.sin(timeSec * 10); // slight flicker
  const lvl = Math.max(0, Math.min(1, level));
  const v = lvl * pulse;
  g.bitMat.emissiveIntensity = g.baseEmissive + 2.6 * v; // the bit lights up
  g.haloMat.opacity = 0.55 * v;                          // halo around the bit
  g.beamMat.opacity = 0.35 * v;                          // beam of light
  g.light.intensity = 1.2 * v;                           // light cast by the bit
  // The beam grows a little with the pulse too.
  const s = 0.9 + 0.25 * lvl + 0.08 * Math.sin(timeSec * 7);
  g.beam.scale.set(s, 1, s);
}

const WOBBLE_SPIN_START = 0.12;  // the bey only starts wobbling below 12% spin
const TIP_OVER_RAD = Math.PI / 2 - 0.08; // angle when it's lying on its side
const _qPre = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);

function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// Orientation of a spinning top: precession, then lean, then spin. The tip is at the
// group's origin (y=0), so leaning the group pivots it on the tip and it never sinks
// into the floor.
function applyTopOrientation(mesh, spinYaw, precessionDir, tiltRad) {
  _qPre.setFromAxisAngle(_axisY, precessionDir);
  _qTilt.setFromAxisAngle(_axisX, tiltRad);
  _qSpin.setFromAxisAngle(_axisY, spinYaw);
  mesh.quaternion.copy(_qPre).multiply(_qTilt).multiply(_qSpin);
}

function updateMeshFromFighter(mesh, f) {
  if (!mesh) return;
  const spinPct = f.spin;

  // Knocked out: tip over and slide. It's lifted as it leans so the body ends up
  // resting on the floor instead of going through it.
  if (f.out) {
    const tilt = Math.min(TIP_OVER_RAD, f.ringOutTimer * 4);
    if (f.precession == null) f.precession = Math.random() * Math.PI * 2;
    f.spinYaw = (f.spinYaw || 0) + 18 * (1 / 60);
    mesh.position.set(f.x, tipLift(tilt), f.y);
    applyTopOrientation(mesh, f.spinYaw, f.precession, tilt);
    return;
  }

  // Out of spin: topple over onto its side in about a second.
  if (spinPct <= 0.001) {
    if (f.deathT == null) { f.deathT = 0; f.precession = f.precession ?? Math.random() * Math.PI * 2; f.tipAngle = f.precession; }
    f.deathT += 1 / 60;
    const animDur = 1.0;
    const animT = Math.min(f.deathT, animDur);
    const tipStart = animDur * 0.45, tipEnd = animDur * 0.97;
    const tipGrow = easeInOutCubic(clamp01((animT - tipStart) / (tipEnd - tipStart)));
    const wobbleFade = animT < animDur * 0.82 ? 1 - clamp01(animT / (animDur * 0.82)) : 0;
    f.precession += (0.7 + wobbleFade * 2.8) * (1 - tipGrow * 0.55) * (1 / 60);
    f.spinYaw = (f.spinYaw || 0) + 20 * (1 - tipGrow * 0.88) * (1 / 60);
    const tiltRad = (f.lastWobble || 0.38) * wobbleFade + TIP_OVER_RAD * tipGrow;
    mesh.position.set(f.x, tipLift(tiltRad), f.y);
    applyTopOrientation(mesh, f.spinYaw, f.precession, tiltRad);
    return;
  } else {
    f.deathT = null;
  }

  // Spinning normally, on its tip (or in the air during a dive or a tornado).
  f.liftVis += ((f.liftTarget || 0) - f.liftVis) * 0.12;
  const yOff = (f.height || 0) + f.liftVis * 24 + (f.liftVis > 0.01 ? Math.sin(performance.now() / 90) * 2 * f.liftVis : 0);
  mesh.position.set(f.x, yOff, f.y);
  // Below 12% spin it starts to wobble, more and more as it slows down.
  if (!(f.frozen > 0)) f.spinYaw = (f.spinYaw || 0) + (3 + f.bey.stats.speed * 0.4) * (1 / 60);
  if (spinPct <= WOBBLE_SPIN_START) {
    if (f.precession == null) f.precession = Math.random() * Math.PI * 2;
    const t = clamp01(1 - spinPct / WOBBLE_SPIN_START);
    const build = Math.pow(t, 3.15);
    f.precession += (0.85 + build * 3.2) * (1 + build * 1.4) * (1 / 60);
    const tiltRad = build * 0.38;
    f.lastWobble = tiltRad;
    mesh.position.y = yOff + tipLift(tiltRad);
    applyTopOrientation(mesh, f.spinYaw, f.precession, tiltRad);
  } else if (f.liftVis > 0.05 || (f.height || 0) > 1) {
    // In the air (tornado or dive): a tilted, swaying spin makes that clear.
    if (f.precession == null) f.precession = 0;
    f.precession += 6 * (1 / 60);
    applyTopOrientation(mesh, f.spinYaw, f.precession, 0.32 * Math.max(f.liftVis, f.height > 1 ? 0.6 : 0));
  } else {
    f.precession = null;
    mesh.rotation.set(0, f.spinYaw, 0);
  }
}

// How much to raise a leaning bey so its body stays above the floor. Lying flat,
// that's about its radius.
function tipLift(tilt) {
  return Math.sin(tilt) * BEY_R * 0.95;
}

const camLook = { x: 0, y: 0, z: 0, ready: false };
function updateCamera() {
  if (!camera3d || !BATTLE) return;
  const a = BATTLE.a, b = BATTLE.b;
  const player = a.isPlayer ? a : b;
  const ai = a.isPlayer ? b : a;

  // Keep the beys in view; if one is falling out, follow it.
  const falling = (a.out ? a : null) || (b.out ? b : null);
  let focusX, focusZ, targetCamY, targetCamZ, lookY;
  if (falling) {
    focusX = falling.x; focusZ = falling.y;
    targetCamY = ARENA.r * 1.3;
    targetCamZ = ARENA.r * 1.5;
    lookY = -ARENA.r * 0.2;
  } else {
    // Lean the framing toward the player's bey a bit more than the rival's.
    focusX = player.x * 0.62 + ai.x * 0.38;
    focusZ = player.y * 0.62 + ai.y * 0.38;
    targetCamY = ARENA.r * 1.85;   // higher and further back, to see more of the stadium
    targetCamZ = ARENA.r * 1.55;
    lookY = 0;
  }

  const lerp = falling ? 0.04 : 0.07;
  // The camera stays mostly centered on the stadium and only drifts a little,
  // so the whole floor stays in frame.
  camera3d.position.x += (focusX * 0.28 - camera3d.position.x) * lerp;
  camera3d.position.y += (targetCamY - camera3d.position.y) * lerp;
  camera3d.position.z += (focusZ * 0.28 + targetCamZ - camera3d.position.z) * lerp;

  if (!camLook.ready) { camLook.x = focusX * 0.3; camLook.z = focusZ * 0.3; camLook.y = lookY; camLook.ready = true; }
  camLook.x += (focusX * 0.3 - camLook.x) * lerp;
  camLook.z += (focusZ * 0.3 - camLook.z) * lerp;
  camLook.y += (lookY - camLook.y) * lerp;
  camera3d.lookAt(camLook.x, camLook.y, camLook.z);
}

// ---------------------------------------------------------------
// Sound. The clash sound (hit.mp3) goes through the Web Audio API: phones silently
// block <audio> elements that weren't started by a tap, but once an AudioContext
// has been unlocked by a tap it can play whenever it wants.
// ---------------------------------------------------------------
let audioCtx = null, hitBuffer = null, audioLoading = false;
const hitAudio = new Audio('hit.mp3');   // used if Web Audio isn't available
hitAudio.preload = 'auto';

function loadHitBuffer() {
  if (!audioCtx || hitBuffer || audioLoading) return;
  audioLoading = true;
  fetch('hit.mp3').then((r) => r.arrayBuffer())
    .then((data) => new Promise((ok, fail) => audioCtx.decodeAudioData(data, ok, fail)))
    .then((buf) => { hitBuffer = buf; })
    .catch(() => {})
    .finally(() => { audioLoading = false; });
}
// Has to run inside a tap or click: creates or resumes the audio context.
function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !audioCtx) audioCtx = new AC();
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      // Playing one silent sample during the tap unlocks audio on iOS for good.
      const b = audioCtx.createBuffer(1, 1, 22050);
      const s = audioCtx.createBufferSource();
      s.buffer = b; s.connect(audioCtx.destination); s.start(0);
      loadHitBuffer();
    }
  } catch (e) { /* ignore */ }
}
// volume 0..1; rate below 1 sounds heavier, above 1 sharper
function playHitSound(volume, rate) {
  const vol = volume == null ? 0.9 : volume;
  try {
    if (audioCtx && hitBuffer) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const src = audioCtx.createBufferSource();
      src.buffer = hitBuffer;
      src.playbackRate.value = rate || 1;
      const g = audioCtx.createGain();
      g.gain.value = vol;
      src.connect(g); g.connect(audioCtx.destination);
      src.start(0);
      return;
    }
    const a = hitAudio.cloneNode();
    a.volume = vol;
    a.play().catch(() => {});
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------
// Battle engine
// ---------------------------------------------------------------
let BATTLE = null;
let joystickVector = { x: 0, y: 0 };
let joystickActive = false;
// Tilt steering.
let tiltEnabled = false;
let tiltVector = { x: 0, y: 0 };        // -1..1 on each axis, same as the joystick
let gravCalib = { roll: 0, pitch: 0 };  // the lean that counts as "neutral", set when calibrating
let gravRaw = { x: 0, y: 0, z: 0 };     // last gravity reading from the phone
let tiltHasReading = false;
let tiltListening = false;
const TILT_DEAD = 0.06;                 // dead zone, so the bey doesn't drift when you hold still
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');

function createFighterState(bey, x, y, vx, vy, isPlayer) {
  return {
    bey, x, y, vx, vy,
    spin: MAX_SPIN_LIFE,        // health, from 1 down to 0
    boostTimer: 0, boostMultiplier: 1, boostSource: null,
    // Each move needs its `charge` time before the first use, then `cooldown`
    // after every use.
    baseTimer: bey.moves.base.charge,
    specialTimer: bey.moves.special.charge,
    out: false, isPlayer, dashTimer: 0,
    fallY: 0, fallVel: 0, ringOutTimer: 0,
    spinYaw: 0, precession: null, lastWobble: 0.38, deathT: null, glow: 0, baseGlow: 0,
    special: null,              // the special currently running, if any
    input: { x: 0, y: 0 },      // where it wants to go this frame (stick, tilt or CPU)
    skill: 0.6,                 // CPU skill 0..1 (reactions, aim, timing)
    // Status effects (seconds left, unless noted)
    ctrlLock: 0, stun: 0, slow: 0, frozen: 0, iceSlide: 0,
    airborne: false, height: 0, anchored: false,
    steerMul: 1, liftTarget: 0, liftVis: 0, inMaelstrom: false,
    // State for each bey's moves
    guardTimer: 0, guardAge: 0,                         // Draciel shell
    mirror: 0, mirrorStore: 0, mirrorStoreT: 0,         // Zeus mirror
    pounceLeft: 0, pounceWindow: 0,                     // Driger double pounce
    arc: null,                                          // Dranzer curved dash
    lungeT: 0, clawBonus: 0,                            // Driger claw lunges
    aiCd: 0, aiThreatT: 0, dodgeT: 0, dodgeSide: 1, dodgeCool: 0
  };
}

function beginBattleForMatch(match) {
  if (match.score[match.a.id] === undefined) match.score[match.a.id] = 0;
  if (match.score[match.b.id] === undefined) match.score[match.b.id] = 0;
  const playerIsA = match.a.id === GAME.playerBeyId;
  unlockAudio();
  requestFullscreen();
  if (window.matchMedia('(pointer: coarse)').matches) {
    requestTiltPermission();
    startTiltListening();
  }
  initBattleState(match.a, match.b, playerIsA);
  $('set-score').textContent = `${match.score[match.a.id]} - ${match.score[match.b.id]}`;
  showScreen('battle');
  requestAnimationFrame(() => { resizeRendererToCanvas(); resetJoystick(); });
  startBattleLoop();
}

// opts.sim: used by the balance tests. No graphics, no page, CPU on both sides.
function initBattleState(beyA, beyB, playerIsA, opts) {
  const sim = !!(opts && opts.sim);
  BATTLE = {
    a: createFighterState(beyA, -ARENA.r * 0.32, -ARENA.r * 0.18, 30, -45, playerIsA),
    b: createFighterState(beyB, ARENA.r * 0.32, ARENA.r * 0.18, -30, 45, !playerIsA),
    elapsed: 0, ended: false, lastT: 0, rafId: 0, ringOutPending: null, spinOutPending: null,
    spinOutWinner: null, spinOutTimer: 0, impactCooldown: 0, launchGrace: 1.0,
    trails: [], waves: [], events: [], sim, result: null, hitStop: 0
  };
  BATTLE.a.skill = BATTLE.b.skill = AI_SKILL;
  if (sim) return;
  camLook.ready = false;
  if (camera3d) {
    camera3d.position.set(0, ARENA.r * 1.85, ARENA.r * 1.55);
    camera3d.lookAt(0, 0, -ARENA.r * 0.18);
  }
  if (scene3d) {
    // free the old models' geometry (materials stay, so their shaders stay compiled)
    [meshA, meshB].forEach((m) => { if (!m) return; scene3d.remove(m); m.traverse((n) => { if (n.geometry) n.geometry.dispose(); }); });
    meshA = buildBeyMesh(beyA);
    meshB = buildBeyMesh(beyB);
    scene3d.add(meshA);
    scene3d.add(meshB);
    if (window.FX) FX.setupBattle(BATTLE);
  }
  // The left HUD always shows the player, the right one the rival.
  const playerBey = playerIsA ? beyA : beyB;
  const rivalBey = playerIsA ? beyB : beyA;
  $('hud-name-a').textContent = playerBey.name;
  $('hud-name-b').textContent = rivalBey.name;
  $('hud-stamina-a').style.width = '100%';
  $('hud-stamina-b').style.width = '100%';
  $('hud-pct-a').textContent = '100%';
  $('hud-pct-b').textContent = '100%';
  $('base-name').textContent = 'Base';
  $('special-name').textContent = 'Special';
  $('base-cooldown').style.setProperty('--cd', 1);
  $('special-cooldown').style.setProperty('--cd', 1);
  $('btn-base').disabled = true;
  $('btn-special').disabled = true;
  resetJoystick();
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  $('joystick').style.display = isTouch ? 'none' : 'block';
}

let battleRafId = 0;
let battleGen = 0; // goes up every battle, so an old loop knows it should stop
function startBattleLoop() {
  cancelAnimationFrame(battleRafId);
  const myGen = ++battleGen;
  BATTLE.lastT = performance.now();
  const step = (t) => {
    if (myGen !== battleGen || !BATTLE || BATTLE.ended) return;
    const dt = Math.min(0.05, (t - BATTLE.lastT) / 1000);
    BATTLE.lastT = t;
    if (BATTLE.hitStop > 0) { BATTLE.hitStop -= dt; renderBattle(dt * 0.15); }
    else {
      BATTLE.elapsed += dt;
      updateBattle(dt);
      if (!BATTLE.ended) renderBattle(dt);
    }
    if (myGen === battleGen && !BATTLE.ended) battleRafId = requestAnimationFrame(step);
  };
  battleRafId = requestAnimationFrame(step);
}

// ---------------------------------------------------------------
// Small helpers shared by moves and AI
// ---------------------------------------------------------------
const GAME_VERSION = 'v45'; // shown on the start screen, handy to check an update went live
const AI_SKILL = 0.55; // the CPU's skill in normal play (0 = sloppy, 1 = sharp)
let AI_STYLE_OVERRIDE = null; // for testing: force the same movement style on every CPU
// Every event gets a sound too: clashes and walls use hit.mp3, the moves use
// the synthesized sounds in sfx.js.
function emit(type, data) {
  if (!BATTLE || BATTLE.sim) return;
  BATTLE.events.push(Object.assign({ type }, data));
  if (type === 'wall') playHitSound(0.3, 1.15);
  else if (type === 'base' && window.SFX) {
    let key = data.kind;
    if (key === 'zeus') key = data.f.mirror > 0 ? 'zeusMirror' : 'zeusRelease';
    SFX.base(key);
  } else if (type !== 'special' && window.SFX) SFX.event(type, data);
  if (type === 'diveHit') BATTLE.hitStop = 0.09;   // freeze for a split second so the hit feels heavy
}
function foeOf(f) { return f === BATTLE.a ? BATTLE.b : BATTLE.a; }
function distOf(p, q) { return Math.hypot(q.x - p.x, q.y - p.y); }
function aimDir(f, o, err) {
  const ang = Math.atan2(o.y - f.y, o.x - f.x) + (err || 0);
  return { x: Math.cos(ang), y: Math.sin(ang), ang };
}
function gauss() { return Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random()); }
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
// Direction from a point to the nearest KO pocket (used when throwing a bey).
function pocketDir(p) {
  let best = null, bestD = Infinity;
  for (const pa of POCKET_ANGLES) {
    const px = Math.cos(pa) * ARENA.r, py = Math.sin(pa) * ARENA.r;
    const d = Math.hypot(px - p.x, py - p.y);
    if (d < bestD) { bestD = d; best = { x: (px - p.x) / d, y: (py - p.y) / d }; }
  }
  return best;
}
function canAct(f) {
  return BATTLE && !f.out && f.spin > 0 && !f.airborne && !(f.frozen > 0) && !(f.stun > 0) &&
    !BATTLE.spinOutPending && BATTLE.launchGrace <= 0;
}
// All damage from moves and collisions goes through here, so Zeus's Dark Dimension
// can send part of it back.
function dealDamage(from, to, amount, kind) {
  if (!(amount > 0) || BATTLE.spinOutPending || to.out) return 0;
  if (to.special && to.special.kind === 'dimension' && to.special.t > 0.2 && from && from !== to) {
    // Dark Dimension: half goes back to the attacker, Zeus takes the other half.
    const back = amount * 0.5;
    from.spin = Math.max(0, from.spin - back);
    emit('reflect', { x: to.x, y: to.y, amount: back });
    if (BATTLE.dmgLog) { logDmg(to, 'reflect', back); logDmg(from, 'TAKEN', back); }
    amount *= 0.5;
    to.spin = Math.max(0, to.spin - amount);
    if (BATTLE.dmgLog) logDmg(to, 'TAKEN', amount);
    return amount;
  }
  to.spin = Math.max(0, to.spin - amount);
  if (BATTLE.dmgLog && from) { logDmg(from, kind, amount); logDmg(to, 'TAKEN', amount); }
  return amount;
}
function logDmg(f, kind, amount) {
  const L = BATTLE.dmgLog, k = f.bey.id;
  L[k] = L[k] || {}; L[k][kind] = (L[k][kind] || 0) + amount;
}
function dash(f, dir, speed, power, dur) {
  f.vx += dir.x * speed;
  f.vy += dir.y * speed;
  f.boostTimer = dur || f.bey.moves.base.duration;
  f.boostMultiplier = power;
  f.boostSource = 'base';
}

// ---------------------------------------------------------------
// CPU opponent: where it steers (personality, dodging) and when it uses its moves.
// Both depend on its skill level.
// ---------------------------------------------------------------
function aiIntent(f, o, dt) {
  const sk = f.skill;
  const dx = o.x - f.x, dy = o.y - f.y;
  const d = Math.hypot(dx, dy) || 1;
  const dc = Math.hypot(f.x - ARENA.cx, f.y - ARENA.cy) || 1;
  let ix = 0, iy = 0;
  const own = f.special;
  if (own && (own.kind === 'tornado' || own.kind === 'blizzard' || own.kind === 'claw')) {
    ix = dx / d; iy = dy / d;                      // drag the effect onto the rival
  } else {
    switch (AI_STYLE_OVERRIDE || f.bey.type) {
      case 'attack': ix = dx / d; iy = dy / d; break;
      case 'defense': {
        ix = -(f.x - ARENA.cx) / dc * Math.min(1, dc / (ARENA.r * 0.3));
        iy = -(f.y - ARENA.cy) / dc * Math.min(1, dc / (ARENA.r * 0.3));
        if (d < 110) { ix += dx / d * 0.5; iy += dy / d * 0.5; }
        break;
      }
      case 'stamina': {
        const pull = (dc - ARENA.r * 0.2) / (ARENA.r * 0.3);
        ix = -(f.x - ARENA.cx) / dc * pull; iy = -(f.y - ARENA.cy) / dc * pull;
        if (d < 85) { ix -= dx / d * 0.45; iy -= dy / d * 0.45; }
        break;
      }
      default: ix = dx / d * 0.95; iy = dy / d * 0.95;
    }
  }
  // If the rival is charging straight at us, step aside and hit it from the side
  // instead. Better CPUs do this more often.
  {
    const rApp = (o.vx * (f.x - o.x) + o.vy * (f.y - o.y)) / d;     // rival speed toward us
    const mine = (f.vx * dx + f.vy * dy) / d;                     // our speed toward it
    const boosted = o.boostTimer > 0 && !o.special;
    if (f.dodgeT <= 0 && f.dodgeCool <= 0 && d < (boosted ? 170 : 105) && rApp > (boosted ? 60 : 85) && rApp > mine * 0.8) {
      if (Math.random() < (boosted ? 0.85 : 0.6) * sk) {
        f.dodgeT = boosted ? 0.28 : 0.2;
        // step toward the center, not toward the wall
        const cx = -(f.x - ARENA.cx), cy = -(f.y - ARENA.cy);
        f.dodgeSide = ((-dy / d) * cx + (dx / d) * cy) >= 0 ? 1 : -1;
      }
      f.dodgeCool = 0.5;
    }
    if (f.dodgeCool > 0) f.dodgeCool -= dt;
  }
  if (f.dodgeT > 0) {
    f.dodgeT -= dt;
    const tx = -dy / d * f.dodgeSide, ty = dx / d * f.dodgeSide;
    ix = ix * 0.15 + tx * 1.6; iy = iy * 0.15 + ty * 1.6;
  }
  // Don't ram a raised shell or an active mirror; circle around and wait.
  if ((o.guardTimer > 0 || o.mirror > 0) && d < 140 && Math.random() < sk) {
    const tx = -dy / d, ty = dx / d;              // circle around instead of ramming
    ix = ix * 0.2 + tx * 0.7 - dx / d * 0.3; iy = iy * 0.2 + ty * 0.7 - dy / d * 0.3;
  }
  // Dodge the rival's specials, after a reaction time that depends on skill.
  const rs = o.special;
  const react = 0.12 + (1 - sk) * 0.45;
  const away = (px, py, w) => {
    const ax = f.x - px, ay = f.y - py, ad = Math.hypot(ax, ay) || 1;
    ix += ax / ad * w; iy += ay / ad * w;
  };
  if (rs && rs.t > react) {
    if (rs.kind === 'tornado' && Math.hypot(f.x - rs.x, f.y - rs.y) < rs.R * 1.3) away(rs.x, rs.y, 1.4 * sk);
    if (rs.kind === 'dive' && Math.hypot(f.x - rs.tx, f.y - rs.ty) < 90) {
      if (rs.phase === 'aim') away(rs.tx, rs.ty, 1.0 * sk);
      if ((rs.phase === 'lock' && rs.pt > react * 0.7) || rs.phase === 'dive') away(rs.tx, rs.ty, 2.2 * sk);
    }
    if (rs.kind === 'maelstrom' && d < rs.R * 1.3) away(o.x, o.y, 1.3 * sk);
    if (rs.kind === 'eclipse' && d < rs.R * 1.4) away(o.x, o.y, 1.1 * sk);
    if (rs.kind === 'dimension') {
      if (d < 170) { ix *= (1 - sk); iy *= (1 - sk); away(o.x, o.y, 1.2 * sk); }
      for (const b of rs.bolts) if (!b.struck && b.t > react * 0.6 && Math.hypot(f.x - b.x, f.y - b.y) < 46) away(b.x, b.y, 1.7 * sk);
    }
    if (rs.kind === 'blizzard' && d < 120) away(o.x, o.y, 0.8 * sk);
  }
  // Stay away from the wall.
  const rimStart = ARENA.r * 0.68;
  if (dc > rimStart) {
    const over = (dc - rimStart) / (ARENA.r - rimStart);
    ix -= (f.x - ARENA.cx) / dc * (0.35 + over * 1.4);
    iy -= (f.y - ARENA.cy) / dc * (0.35 + over * 1.4);
  }
  ix += (Math.random() - 0.5) * (0.1 + (1 - sk) * 0.3);
  iy += (Math.random() - 0.5) * (0.1 + (1 - sk) * 0.3);
  const m = Math.hypot(ix, iy);
  if (m > 1) { ix /= m; iy /= m; }
  return { x: ix, y: iy };
}

function aiMoves(f, o, dt) {
  if (!canAct(f)) return;
  f.aiCd -= dt;
  if (f.aiCd > 0) return;
  const sk = f.skill;
  f.aiCd = 0.07 + (1 - sk) * 0.2;            // better CPUs think more often
  const d = distOf(f, o);
  const id = f.bey.id;
  // Aim with some error, and the better the CPU, the more it aims ahead of the rival.
  const tLead = d / 260;
  const px = o.x + o.vx * tLead * sk, py = o.y + o.vy * tLead * sk;
  const leadOff = angleDiff(Math.atan2(py - f.y, px - f.x), Math.atan2(o.y - f.y, o.x - f.x));
  const err = leadOff + gauss() * (0.03 + (1 - sk) * 0.32);
  // Time until contact if the rival keeps coming (to time the shell or the mirror).
  const nx = (f.x - o.x) / (d || 1), ny = (f.y - o.y) / (d || 1);
  const approach = (o.vx - f.vx) * nx + (o.vy - f.vy) * ny;  // positive means it's getting closer
  const tti = approach > 30 ? (d - BEY_R * 2) / approach : Infinity;

  const inDim = !!(o.special && o.special.kind === 'dimension');
  if (f.specialTimer <= 0 && !f.special) {
    const want = { dragoon: d < 100, dranzer: d < 320, blackdranzer: d < 105, driger: d < 140,
                   draciel: d < 150, wolborg: d < 170, zeus: d < 140 }[id];
    const holdOff = inDim && id !== 'draciel' && id !== 'wolborg' && Math.random() < sk;
    if (want && !holdOff && Math.random() < 0.35 + 0.55 * sk) { triggerSpecialMove(f, o); return; }
  }
  if (id === 'driger' && f.pounceLeft > 0) {
    if (f.pounceWindow < 0.62 && Math.random() < 0.5 + 0.4 * sk) triggerBaseMove(f, o, err);
    return;
  }
  if (f.baseTimer > 0) return;
  const walled = (o.guardTimer > 0 || o.mirror > 0 || inDim) && Math.random() < 0.3 + 0.7 * sk;
  switch (id) {
    case 'draciel': {
      // A good CPU raises the shell right before the hit (parry), a weaker one too early.
      const lead = 0.18 + (1 - sk) * 0.45;
      if (tti < lead && Math.random() < 0.45 + 0.5 * sk) triggerBaseMove(f, o, 0);
      break;
    }
    case 'zeus':
      if (f.mirrorStore > 0) { if (!walled && d < 170 && Math.random() < 0.5 + 0.4 * sk) triggerBaseMove(f, o, err); }
      else if ((tti < 0.25 + (1 - sk) * 0.4 || d < 120) && Math.random() < 0.4 + 0.5 * sk) triggerBaseMove(f, o, 0);
      break;
    case 'wolborg':
      if (!walled && d < 150 && Math.random() < 0.3 + 0.5 * sk) triggerBaseMove(f, o, err);
      break;
    default:
      if (!walled && d < 190 && d > 36 && Math.random() < 0.25 + 0.5 * sk) triggerBaseMove(f, o, err);
  }
}

// Turns the steering input into acceleration, taking status effects into account.
function applySteer(f, v, dt) {
  if (f.out || f.spin <= 0) return;
  if (f.airborne) {
    // While Dranzer is aiming its dive, the stick moves the target instead of the bey.
    const s = f.special;
    if (s && s.kind === 'dive' && s.phase === 'aim' && (f.isPlayer && !BATTLE.sim)) {
      s.tx += v.x * 330 * dt; s.ty += v.y * 330 * dt;
    }
    return;
  }
  if (f.frozen > 0 || f.stun > 0 || f.ctrlLock > 0 || f.anchored) return;
  let mul = f.steerMul;
  if (f.slow > 0) mul *= 0.6;
  if (f.iceSlide > 0) mul *= 0.4;
  const acc = steerAccel(f) * mul;
  f.vx += v.x * acc * dt;
  f.vy += v.y * acc * dt;
}

function updateBattle(dt) {
  const { a, b } = BATTLE;
  const player = a.isPlayer ? a : b;
  const ai = a.isPlayer ? b : a;

  if (BATTLE.impactCooldown > 0) BATTLE.impactCooldown = Math.max(0, BATTLE.impactCooldown - dt);
  const inGrace = BATTLE.launchGrace > 0;
  if (inGrace) BATTLE.launchGrace = Math.max(0, BATTLE.launchGrace - dt);

  if (!inGrace) {
    if (!BATTLE.sim && tiltEnabled) updateTiltVector();
    const pv = BATTLE.sim ? aiIntent(player, ai, dt) : (tiltEnabled ? tiltVector : joystickVector);
    player.input = { x: pv.x, y: pv.y };
    ai.input = aiIntent(ai, player, dt);
    applySteer(player, player.input, dt);
    applySteer(ai, ai.input, dt);
  }

  [a, b].forEach((f) => {
    if (f.out) return;
    // Status timers
    if (f.ctrlLock > 0) f.ctrlLock = Math.max(0, f.ctrlLock - dt);
    if (f.stun > 0) f.stun = Math.max(0, f.stun - dt);
    if (f.slow > 0) f.slow = Math.max(0, f.slow - dt);
    if (f.frozen > 0) f.frozen = Math.max(0, f.frozen - dt);
    if (f.iceSlide > 0) f.iceSlide = Math.max(0, f.iceSlide - dt);
    if (f.guardTimer > 0) { f.guardTimer = Math.max(0, f.guardTimer - dt); f.guardAge += dt; }
    if (f.mirror > 0) {
      f.mirror = Math.max(0, f.mirror - dt);
      if (f.mirror === 0 && f.mirrorStore <= 0) {   // nothing absorbed, so the release is just a dash
        f.mirrorStore = 0.001; f.mirrorStoreT = 4;
        f.baseTimer = Math.min(f.baseTimer, 0.35);
      }
    }
    if (f.mirrorStoreT > 0) { f.mirrorStoreT -= dt; if (f.mirrorStoreT <= 0) f.mirrorStore = 0; }
    if (f.pounceLeft > 0) {
      f.pounceWindow -= dt;
      if (f.pounceWindow <= 0) { f.pounceLeft = 0; f.baseTimer = f.bey.moves.base.cooldown - 0.9; }
    }
    if (f.boostTimer > 0) {
      f.boostTimer = Math.max(0, f.boostTimer - dt);
      if (f.boostTimer === 0 && f.darkClawPending) {   // Dark Claw missed: it costs some spin
        f.darkClawPending = false;
        f.spin = Math.max(0.01, f.spin - 0.03);
        emit('clawMiss', { x: f.x, y: f.y });
      }
    }
    if (!inGrace) {
      // Spin slowly drops on its own: gently above STABLE_SPIN, faster below it.
      // Stamina slows it down a bit.
      const m = staMult(f.bey.stats.stamina);
      const rate = f.spin > STABLE_SPIN ? SPIN_DECAY * 0.5 * m : SPIN_DECAY * 2.4 * m;
      f.spin = Math.max(0, f.spin - rate * dt);
      if (BATTLE.dmgLog) logDmg(f, 'DECAY', rate * dt);
      if (f.baseTimer > 0) f.baseTimer = Math.max(0, f.baseTimer - dt);
      if (f.specialTimer > 0 && !f.special) f.specialTimer = Math.max(0, f.specialTimer - dt);
    }
    if (f.airborne) { f.vx = 0; f.vy = 0; return; }   // in the air

    // Dranzer's Flame Arc curves toward the point it was aimed at.
    if (f.arc) {
      f.arc.t -= dt;
      const ax = f.arc.tx - f.x, ay = f.arc.ty - f.y, ad = Math.hypot(ax, ay) || 1;
      f.vx += ax / ad * 1100 * dt; f.vy += ay / ad * 1100 * dt;
      if (f.arc.t <= 0) f.arc = null;
    }
    // Driger's claw lunge follows the rival for a moment.
    if (f.lungeT > 0) {
      f.lungeT -= dt;
      const o = foeOf(f);
      const ax = o.x - f.x, ay = o.y - f.y, ad = Math.hypot(ax, ay) || 1;
      f.vx += ax / ad * 450 * dt; f.vy += ay / ad * 450 * dt;
    }
    if (f.frozen > 0 || f.anchored) { const k = Math.max(0, 1 - 12 * dt); f.vx *= k; f.vy *= k; }

    let maxSpeed = maxSpeedOf(f) * (f.slow > 0 ? 0.65 : 1) * (f.inMaelstrom ? 0.7 : 1);
    if (f.boostTimer > 0 || f.ctrlLock > 0) maxSpeed = Math.max(maxSpeed, 430); // dashes and throws can go faster
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > maxSpeed) { f.vx = (f.vx / sp) * maxSpeed; f.vy = (f.vy / sp) * maxSpeed; }
    let dragK = 0.42 - (f.bey.stats.stamina - 5.5) * 0.012;
    if (f.iceSlide > 0) dragK *= 0.15;
    const drag = 1 - dragK * dt;
    f.vx *= Math.max(0, drag);
    f.vy *= Math.max(0, drag);
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    const d = Math.hypot(f.x - ARENA.cx, f.y - ARENA.cy) || 0.0001;
    const nx = (f.x - ARENA.cx) / d, ny = (f.y - ARENA.cy) / d;
    const angle = Math.atan2(f.y - ARENA.cy, f.x - ARENA.cx);
    const wallContact = ARENA.r - BEY_R;
    const pocketExitR = ARENA.r + BEY_R * 0.5;
    const inPocket = isAtPocketAngle(angle);
    if (d > wallContact) {
      if (inPocket && !inGrace) {
        if (d > pocketExitR) {
          f.out = true;
          f.fallVel = 0;
          f.ringOutTimer = 0;
          BATTLE.ringOutPending = f;
          if (f.special) endSpecial(f);
        }
      } else {
        f.x = ARENA.cx + nx * wallContact;
        f.y = ARENA.cy + ny * wallContact;
        const vDotN = f.vx * nx + f.vy * ny;
        if (vDotN > 0) {
          f.vx -= 1.8 * vDotN * nx;
          f.vy -= 1.8 * vDotN * ny;
          const speed = Math.hypot(f.vx, f.vy);
          const loss = WALL_SPIN_LOSS_MIN + clamp01(speed / 220) * (WALL_SPIN_LOSS_MAX - WALL_SPIN_LOSS_MIN);
          if (!BATTLE.spinOutPending) { f.spin = Math.max(0, f.spin - loss); if (BATTLE.dmgLog) logDmg(f, 'WALL', loss); }
          if (speed > 90) emit('wall', { x: f.x, y: f.y, power: loss });
        }
      }
    }
  });

  [a, b].forEach((f) => {
    if (!f.out) return;
    f.ringOutTimer += dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
  });

  const cdx = b.x - a.x, cdy = b.y - a.y;
  const cdist = Math.hypot(cdx, cdy);
  if (!a.out && !b.out && cdist < BEY_R * 2 && cdist > 0.001) {
    resolveCollision(a, b, cdx, cdy, cdist, !!BATTLE.spinOutPending);
  }

  updateTrails(dt);
  updateWaves(dt);

  // Specials: clear last frame's effects, then update both beys.
  [a, b].forEach((f) => { f.steerMul = 1; f.liftTarget = 0; f.inMaelstrom = false; });
  if (!BATTLE.spinOutPending) { stepSpecial(a, dt); stepSpecial(b, dt); }

  if (!inGrace && !BATTLE.spinOutPending) {
    if (BATTLE.sim) aiMoves(player, ai, dt);
    aiMoves(ai, player, dt);
  }

  if (!BATTLE.sim) updateBattleHud(player);
  if (BATTLE.sim) BATTLE.events.length = 0;

  // Ring-out: wait a moment so you can see it fall out, then end the game.
  if (BATTLE.ringOutPending) {
    if (BATTLE.ringOutPending.ringOutTimer > 0.5) {
      const loser = BATTLE.ringOutPending;
      endBattle(loser === a ? b : a, loser, 'ringout');
    }
    return;
  }
  // Spin-out: the winner is decided the moment a bey reaches 0.
  if (!BATTLE.spinOutPending) {
    let loser = null;
    if (a.spin <= 0 && b.spin <= 0) loser = (a.spin <= b.spin) ? a : b;
    else if (a.spin <= 0) loser = a;
    else if (b.spin <= 0) loser = b;
    if (loser) {
      BATTLE.spinOutPending = loser;
      BATTLE.spinOutWinner = (loser === a) ? b : a;
      BATTLE.spinOutTimer = 0;
      endSpecial(a); endSpecial(b);
    }
  }
  if (BATTLE.spinOutPending) {
    const loser = BATTLE.spinOutPending;
    BATTLE.spinOutTimer += dt;
    loser.vx *= 0.9; loser.vy *= 0.9;
    if (BATTLE.spinOutTimer > 1.2) endBattle(BATTLE.spinOutWinner, loser, 'spinout');
    return;
  }
  if (BATTLE.elapsed > MATCH_TIME_LIMIT) {
    const winner = a.spin >= b.spin ? a : b;
    endBattle(winner, winner === a ? b : a, 'timeout');
  }
}

// HUD: spin bars and button cooldowns.
function updateBattleHud(player) {
  const { a, b } = BATTLE;
  const rival = player === a ? b : a;
  const pPct = Math.round(player.spin * 100), rPct = Math.round(rival.spin * 100);
  $('hud-stamina-a').style.width = pPct + '%';
  $('hud-stamina-b').style.width = rPct + '%';
  $('hud-pct-a').textContent = pPct + '%';
  $('hud-pct-b').textContent = rPct + '%';
  const s = player.special;
  const pounce = player.pounceLeft > 0;
  const clawOpen = !!(s && s.kind === 'claw' && s.count < 3);
  const baseReady = (player.baseTimer <= 0 || pounce) && canAct(player);
  const specialReady = (player.specialTimer <= 0 && !player.special && canAct(player)) || clawOpen;
  const baseDen = Math.max(player.bey.moves.base.charge, player.bey.moves.base.cooldown);
  const specialDen = Math.max(player.bey.moves.special.charge, player.bey.moves.special.cooldown);
  $('base-cooldown').style.setProperty('--cd', pounce ? 0 : clamp01(player.baseTimer / baseDen));
  $('btn-base').disabled = !baseReady;
  $('special-cooldown').style.setProperty('--cd', (player.special || clawOpen) ? (clawOpen ? 0 : 1) : clamp01(player.specialTimer / specialDen));
  $('btn-special').disabled = !specialReady;
}

function resolveCollision(a, b, dx, dy, dist, noDamage) {
  if (a.airborne || b.airborne) return;
  const nx = dx / dist, ny = dy / dist;         // direction from a to b
  const heavyA = a.anchored || a.frozen > 0, heavyB = b.anchored || b.frozen > 0;
  let massA = stat100(a.bey.stats.defense) + 40, massB = stat100(b.bey.stats.defense) + 40;
  if (heavyA) massA *= 25;
  if (heavyB) massB *= 25;
  const shareA = massB / (massA + massB), shareB = massA / (massA + massB);
  const overlap = BEY_R * 2 - dist;
  a.x -= nx * overlap * shareA; a.y -= ny * overlap * shareA;
  b.x += nx * overlap * shareB; b.y += ny * overlap * shareB;

  // Who drove into whom. This has to be measured before the bounce changes the speeds.
  const aIn = Math.max(0, a.vx * nx + a.vy * ny);
  const bIn = Math.max(0, -(b.vx * nx + b.vy * ny));
  const relVx = a.vx - b.vx, relVy = a.vy - b.vy;
  const closing = Math.max(0, relVx * nx + relVy * ny);   // how fast they hit each other

  // Knockback: attack pushes, defense resists.
  const baseImpulse = Math.max(MIN_KNOCKBACK, closing * KNOCKBACK_SCALE);
  const boostA = a.boostTimer > 0 ? a.boostMultiplier : 1;
  const boostB = b.boostTimer > 0 ? b.boostMultiplier : 1;
  let impulseA = baseImpulse * pushMult(b.bey.stats.attack) * boostB / defMult(a.bey.stats.defense);
  let impulseB = baseImpulse * pushMult(a.bey.stats.attack) * boostA / defMult(b.bey.stats.defense);
  if (heavyA) impulseA *= 0.05;
  if (heavyB) impulseB *= 0.05;
  a.vx -= nx * impulseA; a.vy -= ny * impulseA;
  b.vx += nx * impulseB; b.vy += ny * impulseB;
  // Always push them apart a little, so clashes look like bounces instead of grinding.
  const MIN_SEPARATION_SPEED = 55;
  const sepA = a.vx * -nx + a.vy * -ny;
  const sepB = b.vx * nx + b.vy * ny;
  if (!heavyA && sepA < MIN_SEPARATION_SPEED) { const add = MIN_SEPARATION_SPEED - sepA; a.vx -= nx * add; a.vy -= ny * add; }
  if (!heavyB && sepB < MIN_SEPARATION_SPEED) { const add = MIN_SEPARATION_SPEED - sepB; b.vx += nx * add; b.vy += ny * add; }

  if (BATTLE.impactCooldown > 0) return;
  BATTLE.impactCooldown = IMPACT_COOLDOWN;
  if (noDamage) { if (!BATTLE.sim) playHitSound(0.5); return; }

  // Damage: impact speed decides how much, and the bey that drove in deals most of it.
  const raw = impactLoss(closing);
  const sum = aIn + bIn;
  const aShare = sum > 1 ? aIn / sum : 0.5;
  const bShare = 1 - aShare;
  let lossToB = raw * (0.3 + 0.7 * aShare) * boostA * atkCombatMult(a.bey.stats.attack) / spinDefMult(b.bey.stats.defense);
  let lossToA = raw * (0.3 + 0.7 * bShare) * boostB * atkCombatMult(b.bey.stats.attack) / spinDefMult(a.bey.stats.defense);
  lossToA = Math.min(MAX_SPIN_LOSS, lossToA);
  lossToB = Math.min(MAX_SPIN_LOSS, lossToB);

  const baseHitA = a.boostTimer > 0 && (a.boostSource === 'base' || a.boostSource === 'release');
  const baseHitB = b.boostTimer > 0 && (b.boostSource === 'base' || b.boostSource === 'release');
  if (baseHitA) lossToB += scaled(a, b, SMASH);
  if (baseHitB) lossToA += scaled(b, a, SMASH);
  if (a.boostTimer > 0 && a.boostSource === 'claw') lossToB += a.clawBonus;
  if (b.boostTimer > 0 && b.boostSource === 'claw') lossToA += b.clawBonus;
  if (a.boostTimer > 0 && a.boostSource === 'release' && a.mirrorStore > 0) { lossToB += a.mirrorStore; a.mirrorStore = 0; emit('release', { x: b.x, y: b.y }); }
  if (b.boostTimer > 0 && b.boostSource === 'release' && b.mirrorStore > 0) { lossToA += b.mirrorStore; b.mirrorStore = 0; emit('release', { x: a.x, y: a.y }); }

  // Effects of specials that work on contact.
  lossToB += contactSpecial(a, b);
  lossToA += contactSpecial(b, a);

  // Defenses: Draciel's shell (block or parry) and Zeus's mirror.
  const n = { x: nx, y: ny };
  lossToA = defendHit(a, b, lossToA, n, bIn);
  lossToB = defendHit(b, a, lossToB, { x: -nx, y: -ny }, aIn);

  const kindA = a.boostTimer > 0 ? 'hit:' + a.boostSource : 'hit:plain';
  const kindB = b.boostTimer > 0 ? 'hit:' + b.boostSource : 'hit:plain';
  const gotB = dealDamage(a, b, lossToB, kindA);
  const gotA = dealDamage(b, a, lossToA, kindB);
  if (baseHitA && gotB > 0 && a.specialTimer > 0) a.specialTimer = Math.max(0, a.specialTimer - SPECIAL_CD_REFUND);
  if (baseHitB && gotA > 0 && b.specialTimer > 0) b.specialTimer = Math.max(0, b.specialTimer - SPECIAL_CD_REFUND);

  emit('impact', {
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, nx, ny,
    power: Math.max(gotA, gotB), base: baseHitA || baseHitB,
    colorA: a.bey.colors.bit, colorB: b.bey.colors.bit
  });
  a.boostTimer = 0;
  b.boostTimer = 0;
  a.darkClawPending = false;   // a Dark Claw that hits costs nothing
  b.darkClawPending = false;
  if (!BATTLE.sim) {
    const p = Math.min(1, Math.max(gotA, gotB) / 0.08);
    playHitSound(0.35 + 0.6 * p, (baseHitA || baseHitB) ? 0.85 : 1);
  }
}

// What happens when `f` touches `o` while one of f's specials is active.
function contactSpecial(f, o) {
  const s = f.special;
  if (!s) return 0;
  if (s.lastContact != null && s.t - s.lastContact < 0.4) return 0;
  s.lastContact = s.t;
  if (s.kind === 'eclipse' && s.t > 0.3) {
    const amt = scaled(f, o, 0.035);
    f.spin = Math.min(1, f.spin + amt * 0.5);
    emit('drain', { x: o.x, y: o.y });
    return amt;
  }
  if (s.kind === 'maelstrom' && s.t > s.wind) return scaled(f, o, 0.03);
  if (s.kind === 'blizzard' && !s.froze && s.t > 0.3) {
    s.froze = true;
    o.frozen = 1.0;
    o.vx = 0; o.vy = 0;
    emit('freeze', { x: o.x, y: o.y });
    return scaled(f, o, 0.1);
  }
  return 0;
}

// Draciel's shell and Zeus's mirror. `n` points from the defender to the attacker.
function defendHit(def, att, loss, n, attackerDrive) {
  if (loss <= 0) return loss;
  if (def.guardTimer > 0) {
    const meaningful = attackerDrive > 45 || att.boostTimer > 0;
    if (def.guardAge <= PARRY_WINDOW && meaningful) {
      // Parry: the hit goes back to the attacker.
      dealDamage(def, att, loss + 0.02, 'parry');
      att.vx += n.x * 260; att.vy += n.y * 260;
      att.ctrlLock = 0.25;
      def.guardTimer = 0;
      emit('parry', { x: def.x + n.x * BEY_R, y: def.y + n.y * BEY_R });
      return 0;
    }
    att.vx += n.x * 140; att.vy += n.y * 140;
    emit('block', { x: def.x + n.x * BEY_R, y: def.y + n.y * BEY_R });
    return loss * 0.3;
  }
  if (def.mirror > 0) {
    // Mirror Guard: absorbs 60% of the hit and keeps some of it for the release dash.
    if (BATTLE.dmgLog) logDmg(def, 'ABSORBED', loss * 0.6);
    def.mirrorStore = Math.min(0.06, loss * 0.6);
    def.mirrorStoreT = 4;
    def.mirror = 0;
    def.baseTimer = Math.min(def.baseTimer, 0.35);
    emit('absorb', { x: def.x, y: def.y });
    return loss * 0.4;
  }
  return loss;
}

// Dragoon's Gale Trail: whoever crosses it gets blown sideways.
function updateTrails(dt) {
  if (!BATTLE.trails.length) return;
  for (const tr of BATTLE.trails) {
    tr.age += dt;
    const owner = tr.owner;
    if (tr.age < tr.record && !owner.out && tr.pts.length < 40) tr.pts.push({ x: owner.x, y: owner.y });
    const o = foeOf(owner);
    if (tr.used || tr.age < 0.06 || o.out || o.airborne) continue;
    for (const p of tr.pts) {
      if (Math.hypot(o.x - p.x, o.y - p.y) < BEY_R * 1.4) {
        const side = (tr.dir.x * (o.y - p.y) - tr.dir.y * (o.x - p.x)) >= 0 ? 1 : -1;
        const px = -tr.dir.y * side, py = tr.dir.x * side;
        o.vx += px * 230; o.vy += py * 230;
        o.ctrlLock = Math.max(o.ctrlLock, 0.22);
        dealDamage(owner, o, scaled(owner, o, 0.012), 'gust');
        tr.used = true;
        emit('gust', { x: o.x, y: o.y, dx: px, dy: py });
        break;
      }
    }
  }
  BATTLE.trails = BATTLE.trails.filter((t) => t.age < t.life);
}

// Wolborg's Frost Howl: a cone of frost that spreads out.
function updateWaves(dt) {
  if (!BATTLE.waves.length) return;
  for (const w of BATTLE.waves) {
    w.t += dt;
    const o = foeOf(w.owner);
    if (w.hit || o.out || o.airborne) continue;
    const front = w.len * Math.min(1, w.t / w.dur);
    const rx = o.x - w.x, ry = o.y - w.y, rd = Math.hypot(rx, ry);
    if (rd <= front + BEY_R && Math.abs(angleDiff(Math.atan2(ry, rx), w.ang)) <= w.half + 0.15) {
      w.hit = true;
      if (o.guardTimer > 0) { emit('block', { x: o.x, y: o.y }); continue; }
      if (o.mirror > 0) { defendHit(o, w.owner, scaled(w.owner, o, 0.03), { x: -rx / rd, y: -ry / rd }, 0); continue; }
      dealDamage(w.owner, o, scaled(w.owner, o, 0.035), 'howl');
      o.slow = 0.9;
      o.vx += Math.cos(w.ang) * 70; o.vy += Math.sin(w.ang) * 70;
      if (w.owner.specialTimer > 0) w.owner.specialTimer = Math.max(0, w.owner.specialTimer - 1.2);
      emit('howlHit', { x: o.x, y: o.y });
    }
  }
  BATTLE.waves = BATTLE.waves.filter((w) => w.t < w.dur + 0.3);
}

// ---------------------------------------------------------------
// Base moves. One per bey, aimed when you press the button, and they can miss.
// ---------------------------------------------------------------
function triggerBaseMove(f, o, aimErr) {
  if (!canAct(f)) return false;
  const base = f.bey.moves.base;
  const id = f.bey.id;
  // Driger: the second pounce, re-aimed, if pressed in time.
  if (id === 'driger' && f.pounceLeft > 0) {
    const d = aimDir(f, o, aimErr);
    dash(f, d, 235, base.power, 0.45);
    f.pounceLeft = 0; f.pounceWindow = 0;
    f.baseTimer = base.cooldown;
    emit('base', { f, kind: 'pounce2', dir: d });
    return true;
  }
  if (f.baseTimer > 0) return false;
  const d = aimDir(f, o, aimErr);
  switch (id) {
    case 'dragoon':   // Gale Trail: a dash that leaves a gust behind
      dash(f, d, 240, base.power);
      BATTLE.trails.push({ owner: f, pts: [{ x: f.x, y: f.y }], record: 0.42, life: 1.4, age: 0, dir: d, used: false });
      f.baseTimer = base.cooldown;
      break;
    case 'dranzer': { // Flame Arc: a dash that curves toward the target
      const side = ((f.vx * d.y - f.vy * d.x) >= 0) ? -1 : 1;
      const ang = d.ang + side * 0.5;
      dash(f, { x: Math.cos(ang), y: Math.sin(ang) }, 270, base.power, 0.6);
      f.arc = { tx: o.x, ty: o.y, t: 0.5 };
      f.baseTimer = base.cooldown;
      break;
    }
    case 'blackdranzer': // Dark Claw: the strongest dash, but a miss costs spin
      dash(f, d, 285, base.power);
      f.darkClawPending = true;
      f.baseTimer = base.cooldown;
      break;
    case 'driger':    // Twin Pounce: the first of two dashes
      dash(f, d, 215, base.power, 0.45);
      f.pounceLeft = 1; f.pounceWindow = 0.9;
      f.baseTimer = 0.18;
      break;
    case 'draciel':   // Iron Shell: blocks, or parries if raised just before the hit
      f.guardTimer = 1.2; f.guardAge = 0;
      f.baseTimer = base.cooldown;
      break;
    case 'wolborg':   // Frost Howl: a cone that slows the rival
      BATTLE.waves.push({ owner: f, x: f.x, y: f.y, ang: d.ang, t: 0, dur: 0.38, len: 165, half: 0.5, hit: false });
      f.baseTimer = base.cooldown;
      break;
    case 'zeus':      // Mirror Guard: absorbs a hit, then releases it with a dash
      if (f.mirrorStore > 0) {
        dash(f, d, 260, base.power);
        f.boostSource = 'release';
      } else {
        f.mirror = 0.6;
      }
      f.baseTimer = base.cooldown;
      break;
    default:
      dash(f, d, 230, base.power);
      f.baseTimer = base.cooldown;
  }
  emit('base', { f, kind: id, dir: d });
  return true;
}

// ---------------------------------------------------------------
// Special moves. Each one shows a warning and can be avoided. Landed in full, one is
// worth about 0.15 spin.
// ---------------------------------------------------------------
const SPECIAL_KIND = { dragoon: 'tornado', dranzer: 'dive', blackdranzer: 'eclipse', driger: 'claw',
                       draciel: 'maelstrom', wolborg: 'blizzard', zeus: 'dimension' };
function triggerSpecialMove(f, o) {
  if (!canAct(f) || f.specialTimer > 0 || f.special) return false;
  f.specialTimer = f.bey.moves.special.cooldown;
  const kind = SPECIAL_KIND[f.bey.id] || 'tornado';
  const s = { kind, t: 0, foe: o };
  switch (kind) {
    case 'tornado': Object.assign(s, { x: f.x, y: f.y, R: 105, wind: 0.35, dur: 2.1, flung: false }); break;
    case 'dive':
      Object.assign(s, { phase: 'rise', pt: 0, sx: f.x, sy: f.y, tx: o.x, ty: o.y, h: 0, hit: null });
      f.airborne = true; f.vx = 0; f.vy = 0; f.boostTimer = 0;
      break;
    case 'eclipse': Object.assign(s, { R: 90, dur: 2.4, linked: false }); break;
    case 'claw': Object.assign(s, { beat: 0.62, next: 0.62, count: 0, results: [], aiPressAt: null }); break;
    case 'maelstrom': Object.assign(s, { R: 104, wind: 0.35, dur: 2.6 }); f.anchored = true; break;
    case 'blizzard': Object.assign(s, { dur: 2.8, froze: false }); o.iceSlide = 2.8; break;
    case 'dimension': Object.assign(s, { dur: 2.8, bolts: [], nextBolt: 0.3 }); break;
  }
  f.special = s;
  if (!BATTLE.sim && window.SFX) s.snd = SFX.special(kind);   // start its sound (long specials keep a loop going)
  emit('special', { f, kind });
  return true;
}

function endSpecial(f) {
  const s = f.special;
  if (!s) return;
  if (s.snd) { s.snd.stop(); s.snd = null; }
  if (s.kind === 'dive') { f.airborne = false; f.height = 0; }
  if (s.kind === 'maelstrom') f.anchored = false;
  if (s.kind === 'blizzard' && s.foe) s.foe.iceSlide = 0;
  f.special = null;
}

// Driger's button presses during Thunder Claw, timed to the rhythm.
function clawPress(f) {
  const s = f.special;
  if (!s || s.kind !== 'claw' || s.count >= 3) return;
  const off = Math.abs(s.t - s.next);
  const q = off <= 0.11 ? 'perfect' : off <= 0.22 ? 'good' : 'miss';
  if (q !== 'miss') {
    const o = s.foe;
    const d = aimDir(f, o, 0);
    const speed = q === 'perfect' ? 300 : 210;
    f.vx = d.x * speed; f.vy = d.y * speed;
    f.boostTimer = 0.3;
    f.boostMultiplier = q === 'perfect' ? 1.25 : 1.05;
    f.boostSource = 'claw';
    f.clawBonus = scaled(f, o, q === 'perfect' ? 0.03 : 0.012);
    f.lungeT = 0.18;
  }
  s.results.push(q);
  emit('claw', { f, q, n: s.count });
  s.count++;
  s.next += s.beat;
  s.aiPressAt = null;
}

function stepSpecial(f, dt) {
  const s = f.special;
  if (!s) return;
  const o = s.foe;
  if (f.out || o.out) { endSpecial(f); return; }
  s.t += dt;
  const dx = o.x - f.x, dy = o.y - f.y;
  const d = Math.hypot(dx, dy) || 1;
  switch (s.kind) {
    case 'tornado': {
      // The tornado follows Dragoon with some delay, so you can drag it onto the rival.
      const follow = Math.min(1, 1.6 * dt);
      s.x += (f.x - s.x) * follow; s.y += (f.y - s.y) * follow;
      const rx = o.x - s.x, ry = o.y - s.y, rd = Math.hypot(rx, ry) || 1;
      const active = s.t > s.wind && s.t < s.dur;
      if (active && rd < s.R && !o.airborne) {
        const inward = 300 * (0.6 + 0.4 * rd / s.R);
        o.vx -= rx / rd * inward * dt; o.vy -= ry / rd * inward * dt;
        o.vx += -ry / rd * 260 * dt;   o.vy += rx / rd * 260 * dt;   // spin it around clockwise
        o.steerMul = 0.35;
        o.liftTarget = 1;
        dealDamage(f, o, scaled(f, o, 0.08) * dt, 'tornado');
      }
      if (s.t >= s.dur && !s.flung) {
        s.flung = true;
        if (rd < s.R * 1.15 && !o.airborne) {
          let fv;
          const inp = f.input;
          if (f.isPlayer && !BATTLE.sim && inp && Math.hypot(inp.x, inp.y) > 0.3) {
            const m = Math.hypot(inp.x, inp.y); fv = { x: inp.x / m, y: inp.y / m };
          } else if (f.isPlayer && !BATTLE.sim) {
            fv = { x: rx / rd, y: ry / rd };
          } else {
            fv = pocketDir(o);
            const e = gauss() * (0.05 + (1 - f.skill) * 0.4);
            const ang = Math.atan2(fv.y, fv.x) + e; fv = { x: Math.cos(ang), y: Math.sin(ang) };
          }
          o.vx = fv.x * 380; o.vy = fv.y * 380;
          o.ctrlLock = 0.3;
          dealDamage(f, o, scaled(f, o, 0.03), 'fling');
          emit('fling', { x: o.x, y: o.y, dx: fv.x, dy: fv.y });
        }
      }
      if (s.t >= s.dur + 0.35) endSpecial(f);
      break;
    }
    case 'dive': {
      const RISE = 0.45, AIM = 0.75, LOCK = 0.35, DIVE = 0.3, H = 85;
      const lim = ARENA.r - BEY_R - 6;
      if (!(f.isPlayer && !BATTLE.sim) && (s.phase === 'rise' || s.phase === 'aim')) {
        // The CPU aims the target at the rival, a little ahead; weaker CPUs lag behind.
        const sk = f.skill, lag = 2 + 6 * sk;
        const tx = o.x + o.vx * 0.5 * sk + gauss() * (1 - sk) * 6;
        const ty = o.y + o.vy * 0.5 * sk + gauss() * (1 - sk) * 6;
        s.tx += (tx - s.tx) * Math.min(1, lag * dt);
        s.ty += (ty - s.ty) * Math.min(1, lag * dt);
      }
      const tr = Math.hypot(s.tx, s.ty);
      if (tr > lim) { s.tx *= lim / tr; s.ty *= lim / tr; }
      s.pt += dt;
      if (s.phase === 'rise') {
        s.h = H * (1 - Math.pow(1 - Math.min(1, s.pt / RISE), 3));
        if (s.pt >= RISE) { s.phase = 'aim'; s.pt = 0; }
      } else if (s.phase === 'aim') {
        s.h = H + Math.sin(s.t * 6) * 3;
        if (s.pt >= AIM) { s.phase = 'lock'; s.pt = 0; emit('diveLock', { x: s.tx, y: s.ty }); }
      } else if (s.phase === 'lock') {
        s.h = H + 6 * (s.pt / LOCK);                 // rise a little before diving
        if (s.pt >= LOCK) { s.phase = 'dive'; s.pt = 0; s.fx = f.x; s.fy = f.y; }
      } else if (s.phase === 'dive') {
        const k = Math.min(1, s.pt / DIVE);
        f.x = s.fx + (s.tx - s.fx) * k;
        f.y = s.fy + (s.ty - s.fy) * k;
        s.h = H * (1 - k * k);
        if (k >= 1) {
          f.airborne = false; s.h = 0; s.phase = 'land'; s.pt = 0;
          const hd = Math.hypot(o.x - s.tx, o.y - s.ty);
          if (hd < 60 && !o.airborne) {
            const got = dealDamage(f, o, scaled(f, o, 0.17), 'dive');
            const kx = (o.x - s.tx) / (hd || 1), ky = (o.y - s.ty) / (hd || 1);
            o.vx += (hd > 1 ? kx : 1) * 380; o.vy += (hd > 1 ? ky : 0) * 380;
            o.ctrlLock = 0.3;
            s.hit = true;
            emit('diveHit', { x: s.tx, y: s.ty, power: got });
          } else {
            f.stun = 0.7;
            f.spin = Math.max(0.01, f.spin - 0.025);
            s.hit = false;
            emit('diveMiss', { x: s.tx, y: s.ty });
          }
        }
      } else if (s.phase === 'land') {
        if (s.pt > 0.5) endSpecial(f);
      }
      f.height = s.h;
      break;
    }
    case 'eclipse': {
      f.vx += dx / d * 260 * dt; f.vy += dy / d * 260 * dt;   // chase the rival
      s.linked = s.t > 0.3 && d < s.R && !o.airborne;
      if (s.linked) {
        const got = dealDamage(f, o, scaled(f, o, 0.065) * dt, 'eclipse');
        f.spin = Math.min(1, f.spin + got * 0.5);
      }
      if (s.t >= s.dur) endSpecial(f);
      break;
    }
    case 'claw': {
      if (!(f.lungeT > 0)) { f.vx += dx / d * 150 * dt; f.vy += dy / d * 150 * dt; }
      if (!(f.isPlayer && !BATTLE.sim) && s.count < 3) {
        if (s.aiPressAt == null) s.aiPressAt = s.next + gauss() * (0.03 + 0.16 * (1 - f.skill));
        const dimUp = o.special && o.special.kind === 'dimension';
        if (s.t >= s.aiPressAt && !(dimUp && Math.random() < f.skill)) clawPress(f);
        else if (s.t >= s.aiPressAt) s.aiPressAt = Infinity;
      }
      if (s.count < 3 && s.t >= s.next && s.tickedAt !== s.next) { s.tickedAt = s.next; emit('clawTick', {}); }  // beat sound
      if (s.count < 3 && s.t > s.next + 0.22) {     // the beat went by without a press
        s.results.push('miss');
        emit('claw', { f, q: 'miss', n: s.count });
        s.count++; s.next += s.beat; s.aiPressAt = null;
      }
      if (s.count >= 3 && s.t > s.next - s.beat + 0.4) endSpecial(f);
      break;
    }
    case 'maelstrom': {
      f.anchored = true;
      if (s.t > s.wind && d < s.R && !o.airborne) {
        o.vx -= dx / d * 215 * dt; o.vy -= dy / d * 215 * dt;
        o.vx += -dy / d * 170 * dt; o.vy += dx / d * 170 * dt;
        o.inMaelstrom = true;
        dealDamage(f, o, scaled(f, o, 0.055) * dt, 'maelstrom');
      }
      if (s.t >= s.dur) endSpecial(f);
      break;
    }
    case 'blizzard': {
      o.iceSlide = Math.max(o.iceSlide, 0.05);
      if (s.t > 0.4) dealDamage(f, o, scaled(f, o, 0.022) * dt, 'blizzard');
      if (s.t >= s.dur) endSpecial(f);
      break;
    }
    case 'dimension': {
      if (s.t >= s.nextBolt && s.t < s.dur - 0.55) {
        s.bolts.push({ x: o.x, y: o.y, t: 0, struck: false, hit: false });
        s.nextBolt += 0.6;
      }
      for (const b of s.bolts) {
        b.t += dt;
        if (!b.struck && b.t >= 0.55) {
          b.struck = true;
          if (Math.hypot(o.x - b.x, o.y - b.y) < 30 && !o.airborne) {
            dealDamage(f, o, scaled(f, o, 0.036), 'bolt');
            o.ctrlLock = Math.max(o.ctrlLock, 0.15);
            b.hit = true;
          }
          emit('bolt', { x: b.x, y: b.y, hit: b.hit });
        }
      }
      s.bolts = s.bolts.filter((b) => b.t < 1.0);
      if (s.t >= s.dur) endSpecial(f);
      break;
    }
  }
}

// ---------------------------------------------------------------
// Drawing: models, glow and the move effects from fx.js.
// ---------------------------------------------------------------
function renderBattle(dt) {
  updateMeshFromFighter(meshA, BATTLE.a);
  updateMeshFromFighter(meshB, BATTLE.b);
  const now = performance.now() / 1000;
  [[meshA, BATTLE.a], [meshB, BATTLE.b]].forEach(([mesh, f]) => {
    const target = f.special ? 1 : 0;
    f.glow += (target - f.glow) * 0.22;
    if (f.glow < 0.001) f.glow = 0;
    setBeyGlow(mesh, f.glow, now);
  });
  updateCamera();
  if (window.FX && FX.ready) {
    FX.update(BATTLE, dt || 1 / 60, now);
    FX.render();
  } else if (renderer3d) {
    renderer3d.render(scene3d, camera3d);
  }
  BATTLE.events.length = 0;
}

function endBattle(winnerF, loserF, reason) {
  BATTLE.ended = true;
  if (BATTLE.sim) { BATTLE.result = { winner: winnerF, reason }; return; }
  if (window.SFX) SFX.stopAll();
  battleGen++;                       // tells the running loop to stop
  cancelAnimationFrame(battleRafId);
  const winnerBey = winnerF.bey, loserBey = loserF.bey;
  const reasonText = reason === 'ringout'
    ? `${winnerBey.name} knocks ${loserBey.name} out of the stadium!`
    : reason === 'spinout'
      ? `${winnerBey.name} outspins ${loserBey.name}.`
      : `Time's up: ${winnerBey.name} wins with more spin left.`;
  handleGameEnd(winnerBey, reasonText);
}

function handleGameEnd(winnerBey, reasonText) {
  const match = GAME.pendingMatch;
  match.score[winnerBey.id] = (match.score[winnerBey.id] || 0) + 1;
  const scoreText = `${match.score[match.a.id]} - ${match.score[match.b.id]}`;
  const setOver = match.score[winnerBey.id] >= 2;
  const playerWonGame = winnerBey.id === GAME.playerBeyId;

  if (!setOver) {
    showResultScreen(
      playerWonGame ? 'Game won!' : 'Game lost',
      `${reasonText} Matchup score: ${scoreText}.`,
      () => beginBattleForMatch(match)
    );
    return;
  }

  if (playerWonGame) {
    const opponentName = match.a.id === GAME.playerBeyId ? match.b.name : match.a.name;
    GAME.playerPath.push({ opponent: opponentName, score: scoreText });
  }
  finalizeMatch(winnerBey, playerWonGame, `${reasonText} Wins the matchup ${scoreText}.`);
}

// ---------------------------------------------------------------
// Input: on-screen joystick (computer and phone).
// ---------------------------------------------------------------
function requestFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (fn) { try { const r = fn.call(el); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
  setTimeout(resizeRendererToCanvas, 300); // resize again once fullscreen kicks in
}

// ---- Tilt steering from the gravity reading (devicemotion) ----
// The raw accelerometer is noisy (shaky hands, vibration), so steering straight from it
// feels jittery. Smoothing the gravity reading a little fixes that.
let gravFilt = { x: 0, y: 0, z: 0 };   // smoothed gravity
let gravFiltInit = false;
const GRAV_ALPHA = 0.6;                // light smoothing: removes the jitter without adding lag
function screenAngleDeg() {
  if (screen.orientation && screen.orientation.angle != null) return screen.orientation.angle;
  return window.orientation || 0;
}
function onDeviceMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null) return;
  // iOS reports gravity with the opposite sign to Android.
  const s = IS_IOS ? -1 : 1;
  const rx = g.x * s, ry = g.y * s, rz = (g.z || 0) * s;
  // Blend the new reading into the previous one, which smooths out the jitter.
  if (!gravFiltInit) { gravFilt.x = rx; gravFilt.y = ry; gravFilt.z = rz; gravFiltInit = true; }
  else {
    gravFilt.x = GRAV_ALPHA * gravFilt.x + (1 - GRAV_ALPHA) * rx;
    gravFilt.y = GRAV_ALPHA * gravFilt.y + (1 - GRAV_ALPHA) * ry;
    gravFilt.z = GRAV_ALPHA * gravFilt.z + (1 - GRAV_ALPHA) * rz;
  }
  gravRaw.x = gravFilt.x; gravRaw.y = gravFilt.y; gravRaw.z = gravFilt.z;
  tiltHasReading = true;
}
// Works out the steering from the smoothed gravity. Runs every frame.
function updateTiltVector() {
  if (!tiltEnabled || !tiltHasReading) return;
  const gx = gravRaw.x, gy = gravRaw.y, gz = gravRaw.z;
  const roll = Math.atan2(gx, Math.sqrt(gy * gy + gz * gz));   // left/right lean
  const pitch = Math.atan2(gy, Math.sqrt(gx * gx + gz * gz));  // forward/back lean
  let dRoll = roll - gravCalib.roll;
  let dPitch = pitch - gravCalib.pitch;
  const ang = screenAngleDeg();
  let leanX, leanY; // in radians: + is right / up on screen
  if (ang === 90) { leanX = dPitch; leanY = dRoll; }
  else if (ang === -90 || ang === 270) { leanX = -dPitch; leanY = -dRoll; }
  else if (ang === 180) { leanX = -dRoll; leanY = -dPitch; }
  else { leanX = dRoll; leanY = dPitch; } // portrait
  const FULL = 10 * Math.PI / 180; // about 10 degrees of lean is full speed
  let nx = clamp(leanX / FULL, -1, 1);
  let ny = clamp(leanY / FULL, -1, 1);
  nx = Math.abs(nx) < TILT_DEAD ? 0 : nx;
  ny = Math.abs(ny) < TILT_DEAD ? 0 : ny;
  // No extra smoothing here: the gravity is already smoothed and more would only add lag.
  const TILT_Y_SIGN = 1;
  tiltVector.x = nx;
  tiltVector.y = TILT_Y_SIGN * ny;
}
function startTiltListening() {
  if (tiltListening) return;
  tiltListening = true;
  window.addEventListener('devicemotion', onDeviceMotion, true);
}
// Asks for permission to use the motion sensors (iOS needs a tap for this), then starts listening.
function requestTiltPermission() {
  let asked = false;
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    asked = true;
    DeviceMotionEvent.requestPermission().then((s) => { if (s === 'granted') startTiltListening(); }).catch(() => {});
  }
  if (!asked && (typeof DeviceMotionEvent !== 'undefined' || window.DeviceMotionEvent)) {
    startTiltListening();
  }
}
function calibrateTilt() {
  // Whatever the current lean is becomes the neutral position.
  const gx = gravRaw.x, gy = gravRaw.y, gz = gravRaw.z;
  gravCalib.roll = Math.atan2(gx, Math.sqrt(gy * gy + gz * gz));
  gravCalib.pitch = Math.atan2(gy, Math.sqrt(gx * gx + gz * gz));
  tiltVector.x = 0; tiltVector.y = 0;
}
// Used by the calibrate button. Makes sure the sensors are on, then takes the current
// position as neutral. If there's no reading yet, it keeps trying for a moment.
function doCalibrate(onDone) {
  requestTiltPermission();
  startTiltListening();
  let tries = 0;
  (function attempt() {
    if (tiltHasReading) {
      tiltEnabled = true;
      calibrateTilt();
      if (onDone) onDone(true);
      return;
    }
    if (tries++ < 30) { setTimeout(attempt, 50); return; } // give the sensors up to about 1.5s
    if (onDone) onDone(false); // no sensors on this device
  })();
}
function tiltUnavailableFallback() {
  tiltEnabled = false;
  $('joystick').style.display = 'block';
}

function knobRest() {
  const el = $('joystick'), knob = $('joystick-knob');
  return (el.clientWidth - knob.offsetWidth) / 2;
}
function resetJoystick() {
  joystickVector = { x: 0, y: 0 };
  const rest = knobRest();
  $('joystick-knob').style.left = rest + 'px';
  $('joystick-knob').style.top = rest + 'px';
}
function setupJoystick() {
  const el = $('joystick'), knob = $('joystick-knob');
  let activePointerId = null; // the finger that's using the joystick
  function center() {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width / 2 - knob.offsetWidth / 2 };
  }
  function update(e) {
    const c = center();
    const rest = knobRest();
    let dx = e.clientX - c.x, dy = e.clientY - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist > c.radius) { dx = (dx / dist) * c.radius; dy = (dy / dist) * c.radius; }
    knob.style.left = (rest + dx) + 'px';
    knob.style.top = (rest + dy) + 'px';
    joystickVector.x = clamp(dx / c.radius, -1, 1);
    joystickVector.y = clamp(dy / c.radius, -1, 1);
  }
  // Only the finger that touched the joystick first controls it, so pressing the move
  // buttons with the other hand doesn't mess it up.
  el.addEventListener('pointerdown', (e) => {
    if (activePointerId !== null) return; // another finger already has it
    activePointerId = e.pointerId;
    joystickActive = true;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    update(e);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointerId) return; // not our finger
    update(e);
  });
  function release(e) {
    if (e.pointerId !== activePointerId) return; // only let go when that same finger lifts
    activePointerId = null;
    joystickActive = false;
    resetJoystick();
  }
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initThree();
  // Ask for the motion sensors on the first tap anywhere (iOS needs a tap), so they're
  // already working by the time the player calibrates.
  document.addEventListener('pointerdown', () => { requestTiltPermission(); }, { once: true });
  // Every tap also wakes the audio up again (phones pause it in the background).
  document.addEventListener('pointerdown', () => { unlockAudio(); }, { passive: true });
  // Try to lock the phone in landscape. Most browsers only allow it in fullscreen,
  // so there's also a "rotate your phone" screen in the CSS.
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
  // When the phone rotates, resize the 3D view and recalibrate the tilt.
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { resizeRendererToCanvas(); if (tiltEnabled && tiltHasReading) calibrateTilt(); }, 300);
  });
  $('btn-mode-tournament').addEventListener('click', () => { unlockAudio(); requestFullscreen(); requestTiltPermission(); enterMode('tournament'); });
  $('btn-mode-single').addEventListener('click', () => { unlockAudio(); requestFullscreen(); requestTiltPermission(); enterMode('single'); });
  $('btn-select-back').addEventListener('click', () => {
    if (GAME.mode === 'single' && GAME.selectionPhase === 'opponent') {
      // Back to choosing the player's bey.
      GAME.selectionPhase = 'player';
      updateSelectScreenForPhase();
      renderCarousel();
    } else {
      showScreen('mode');
    }
  });
  $('carousel-prev').addEventListener('click', () => { unlockAudio(); cycleCarousel(-1); });
  $('carousel-next').addEventListener('click', () => { unlockAudio(); cycleCarousel(1); });
  let swipeStartX = null;
  const carouselCard = $('carousel-card');
  carouselCard.addEventListener('pointerdown', (e) => { swipeStartX = e.clientX; });
  carouselCard.addEventListener('pointerup', (e) => {
    if (swipeStartX === null) return;
    const dx = e.clientX - swipeStartX;
    if (dx > 40) cycleCarousel(-1);
    else if (dx < -40) cycleCarousel(1);
    swipeStartX = null;
  });
  $('btn-confirm-select').addEventListener('click', () => {
    unlockAudio();
    confirmSelection();
  });
  function fireBase(ev) {
    ev.preventDefault();
    if (!BATTLE || BATTLE.ended) return;
    if ($('btn-base').disabled) return;
    const player = BATTLE.a.isPlayer ? BATTLE.a : BATTLE.b;
    const ai = player === BATTLE.a ? BATTLE.b : BATTLE.a;
    triggerBaseMove(player, ai, 0);
  }
  function fireSpecial(ev) {
    ev.preventDefault();
    if (!BATTLE || BATTLE.ended) return;
    if ($('btn-special').disabled) return;
    const player = BATTLE.a.isPlayer ? BATTLE.a : BATTLE.b;
    const ai = player === BATTLE.a ? BATTLE.b : BATTLE.a;
    if (player.special && player.special.kind === 'claw') clawPress(player);
    else triggerSpecialMove(player, ai);
  }
  $('btn-base').addEventListener('pointerdown', fireBase);
  $('btn-special').addEventListener('pointerdown', fireSpecial);
  $('btn-restart').addEventListener('click', () => {
    // Reset without reloading the page (a reload would exit fullscreen) and go back to the menu.
    if (BATTLE) { BATTLE.ended = true; battleGen++; cancelAnimationFrame(battleRafId); }
    BATTLE = null;
    GAME.pendingMatch = null;
    GAME.matches = [];
    GAME.playerPath = [];
    GAME.singleMatch = null;
    showScreen('mode');
  });
  $('btn-back-select').addEventListener('click', () => {
    if (window.SFX) SFX.stopAll();
    if (BATTLE) { BATTLE.ended = true; battleGen++; cancelAnimationFrame(battleRafId); }
    BATTLE = null;
    GAME.pendingMatch = null;
    showScreen('mode');
  });
  function runCalibrate(btn, statusEl) {
    const prev = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Calibrating…';
    if (statusEl) statusEl.textContent = 'Reading motion sensors…';
    requestFullscreen();
    doCalibrate((ok) => {
      if (btn) btn.textContent = ok ? 'Calibrated ✓' : prev;
      if (statusEl) statusEl.textContent = ok ? 'Tilt ready — steer by tilting your phone.' : 'No motion sensors — the on-screen stick will be used.';
      if (!ok) tiltUnavailableFallback();
    });
  }
  $('btn-start').addEventListener('click', () => {
    unlockAudio();
    requestFullscreen();
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouch) { showScreen('mode'); return; }
    // On a phone: take the current position as neutral, once the sensors have a reading.
    const btn = $('btn-start');
    const st = $('start-tilt-status');
    btn.disabled = true;
    btn.textContent = 'Calibrating…';
    if (st) st.textContent = 'Hold the phone still… reading sensors.';
    requestTiltPermission();
    startTiltListening();
    let waited = 0;
    (function waitForReading() {
      if (tiltHasReading) {
        tiltEnabled = true;
        calibrateTilt();           // neutral = however you're holding it now
        btn.disabled = false;
        btn.textContent = 'Start';
        if (st) st.textContent = 'Calibrated ✓ — tilt to steer.';
        showScreen('mode');
        return;
      }
      waited += 60;
      if (waited < 2500) { setTimeout(waitForReading, 60); return; } // wait up to 2.5s
      // No sensors: use the on-screen joystick instead.
      btn.disabled = false;
      btn.textContent = 'Start';
      if (st) st.textContent = 'No motion sensors — the on-screen stick will be used.';
      tiltUnavailableFallback();
      showScreen('mode');
    })();
  });
  // On the start screen, show whether the sensors work and which way the bey would move.
  // Tilt is switched on and calibrated just for this preview.
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
  if (!isTouchDevice) $('start-tilt-status').textContent = GAME_VERSION;   // on a computer, show the version instead
  if (isTouchDevice) {
    requestTiltPermission();
    let previewCalibrated = false;
    setInterval(() => {
      const st = $('start-tilt-status');
      if (!st || !$('screen-start').classList.contains('active')) return;
      if (!tiltHasReading) { st.textContent = 'Tip: tap Start to enable motion controls.'; return; }
      // Switch tilt on and calibrate once, so the arrow follows the real tilt.
      if (!previewCalibrated) { tiltEnabled = true; calibrateTilt(); previewCalibrated = true; }
      updateTiltVector();
      const ax = tiltVector.x, ay = tiltVector.y;
      let arrow = '•';
      if (Math.hypot(ax, ay) > 0.18) {
        const dirs = ['→','↗','↑','↖','←','↙','↓','↘'];
        // Up on screen is -y in the game, so flip y for the arrow.
        const idx = Math.round((Math.atan2(-ay, ax) + Math.PI * 2) / (Math.PI / 4)) % 8;
        arrow = dirs[idx];
      }
      st.textContent = GAME_VERSION + ' · Motion ✓  ' + arrow + '   (tap Start)';
    }, 200);
  }
  $('btn-recalibrate').addEventListener('click', () => runCalibrate($('btn-recalibrate'), null));
  setupJoystick();
});
