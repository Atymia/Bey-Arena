// game.js — Bey Arena game logic.

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

// --- Combat tuning copied from the reference project (BeyWeb/js/config.js) ---
// Spin (life) is a 0..1 value. It decays over time; rate depends on stamina stat.
const MAX_SPIN_LIFE = 1.0;
const SPIN_DECAY = 0.038;           // base decay per second
const STABLE_SPIN = 0.10;           // above this, decay is gentle; below, it speeds up
const KNOCKBACK_SCALE = 2.2;
const MIN_KNOCKBACK = 3.0;
const SPIN_LOSS_SCALE = 0.011;      // closing speed -> spin loss
const MIN_SPIN_LOSS = 0.003;
const MAX_SPIN_LOSS = 0.11;         // cap per hit (no one-shot kills)
const IMPACT_COOLDOWN = 0.08;       // seconds between damaging hits while in contact
const WALL_SPIN_LOSS_MIN = 0.03;
const WALL_SPIN_LOSS_MAX = 0.07;

// Convert my 1-10 stats to the reference's 0-100 scale.
function stat100(v) { return v * 10; }
// staMult: high stamina -> slower decay (1.5 at sta=0 .. 0.5 at sta=100).
function staMult(sta) { return 1.5 - stat100(sta) / 100; }
// atkCombatMult / defMult: 0.5 .. 1.5 ; spinDefMult ramps faster with defense.
function atkCombatMult(atk) { return 0.5 + stat100(atk) / 100; }
function defMult(def) { return 0.5 + stat100(def) / 100; }
function spinDefMult(def) { return 0.5 + stat100(def) / 58; }


// ---------------------------------------------------------------
// Flat placeholder icon art — used only for the small 2D cards
// (selection screen + champion screen), NOT for the live 3D arena.
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
  renderer3d = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer3d.setPixelRatio(window.devicePixelRatio || 1);
  renderer3d.shadowMap.enabled = true;
  renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;

  scene3d = new THREE.Scene();
  camera3d = new THREE.PerspectiveCamera(40, 360 / 480, 1, 2000);
  camera3d.position.set(0, ARENA.r * 1.85, ARENA.r * 1.55);
  camera3d.lookAt(0, 0, -ARENA.r * 0.18);

  scene3d.add(new THREE.AmbientLight(0xaab4d0, 0.95));
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

  resizeRendererToCanvas();
  window.addEventListener('resize', resizeRendererToCanvas);
}

// KO pocket gaps: angles where the wall has a gap and a bey can be knocked out.
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
  // Outer platform — a light tiled ring the stadium sits on.
  const platform = new THREE.Mesh(
    new THREE.CircleGeometry(PLATFORM_RADIUS(), 80),
    new THREE.MeshStandardMaterial({ color: 0xcfccc2, roughness: 0.7, metalness: 0.05 })
  );
  platform.rotation.x = -Math.PI / 2;
  platform.position.y = -0.4;
  platform.receiveShadow = true;
  scene3d.add(platform);

  // Battle dish — flat, dark, with a soft radial gradient like the reference shot.
  const dish = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA.r + 4, 80),
    new THREE.MeshStandardMaterial({ map: makeDishTexture(), roughness: 0.85, metalness: 0.12 })
  );
  dish.rotation.x = -Math.PI / 2;
  dish.position.y = 0;
  dish.receiveShadow = true;
  scene3d.add(dish);

  // Metallic lip where dish meets the walls.
  const lip = new THREE.Mesh(
    new THREE.RingGeometry(ARENA.r + 1, ARENA.r + 5, 80),
    new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.5, roughness: 0.3 })
  );
  lip.rotation.x = -Math.PI / 2;
  lip.position.y = 0.3;
  scene3d.add(lip);

  // Navy raised wall blocks following each arc between the KO pockets.
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
}

const EMBLEM_FIN_COUNT = { spiral: 3, flame: 3, 'flame-dark': 4, stripes: 3, hex: 6, snowflake: 6, sunburst: 8 };

function buildBeyMesh(bey) {
  const group = new THREE.Group();
  // Body = the bey's main color (primary), with a slightly darker upper disc (secondary).
  // The center cap is the "bit" chip and uses its own bit color.
  const bodyMat = new THREE.MeshStandardMaterial({ color: bey.colors.primary, metalness: 0.45, roughness: 0.4 });
  const discMat = new THREE.MeshStandardMaterial({ color: bey.colors.secondary, metalness: 0.4, roughness: 0.45 });
  const bitMat = new THREE.MeshStandardMaterial({ color: bey.colors.bit, metalness: 0.3, roughness: 0.4, emissive: bey.colors.bit, emissiveIntensity: 0.18 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.3 });

  // Body rests with its underside at y=0. Ring is 10 tall, sitting just above the tip.
  const RING_H = 10, TIP_H = 12;
  const ringY = TIP_H + RING_H / 2; // ring center sits above the tip

  const ring = new THREE.Mesh(new THREE.CylinderGeometry(BEY_R, BEY_R * 1.05, RING_H, 28), bodyMat);
  ring.position.y = ringY;
  ring.castShadow = true;
  group.add(ring);

  // Upper disc ring (darker shade of the body) for a bit of two-tone definition.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(BEY_R * 0.8, BEY_R * 0.8, 3, 24), discMat);
  disc.position.y = ringY + RING_H / 2 + 1;
  disc.castShadow = true;
  group.add(disc);

  // Center bit chip.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(BEY_R * 0.4, BEY_R * 0.4, 4, 24), bitMat);
  cap.position.y = ringY + RING_H / 2 + 3;
  cap.castShadow = true;
  group.add(cap);

  // Spinning tip points down, its point touching the floor (y=0).
  const tip = new THREE.Mesh(new THREE.ConeGeometry(BEY_R * 0.3, TIP_H, 16), tipMat);
  tip.position.y = TIP_H / 2;
  tip.rotation.x = Math.PI; // point downward
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
  group.userData.bodyCenterY = ringY; // pivot height for tilting/toppling
  return group;
}

const WOBBLE_SPIN_START = 0.12;  // wobble begins only below 12% life (matches reference)
const TIP_OVER_RAD = Math.PI / 2 - 0.08; // final lie-down angle
const _qPre = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);

function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// Spinning-top orientation: precession (yaw) -> tilt (lean) -> spin (yaw), like the
// reference. The mesh is built with its tip at the group origin (y=0), so leaning the
// whole group tilts it around the tip and it never sinks into the floor.
function applyTopOrientation(mesh, spinYaw, precessionDir, tiltRad) {
  _qPre.setFromAxisAngle(_axisY, precessionDir);
  _qTilt.setFromAxisAngle(_axisX, tiltRad);
  _qSpin.setFromAxisAngle(_axisY, spinYaw);
  mesh.quaternion.copy(_qPre).multiply(_qTilt).multiply(_qSpin);
}

function updateMeshFromFighter(mesh, f) {
  if (!mesh) return;
  const spinPct = f.spin;

  // Knocked out of the ring: tip over and slide; lift with the tilt so the body
  // rests on the floor (never rotating down through it).
  if (f.out) {
    const tilt = Math.min(TIP_OVER_RAD, f.ringOutTimer * 4);
    if (f.precession == null) f.precession = Math.random() * Math.PI * 2;
    f.spinYaw = (f.spinYaw || 0) + 18 * (1 / 60);
    mesh.position.set(f.x, tipLift(tilt), f.y);
    applyTopOrientation(mesh, f.spinYaw, f.precession, tilt);
    return;
  }

  // Dead (0 life): play the topple animation over ~1s, leaning onto its side.
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

  // Spinning normally — tip planted on the floor, no lift.
  mesh.position.set(f.x, 0, f.y);
  // Wobble ONLY once life drops below 12%, growing with a cubic curve.
  f.spinYaw = (f.spinYaw || 0) + (3 + f.bey.stats.speed * 0.4) * (1 / 60);
  if (spinPct <= WOBBLE_SPIN_START) {
    if (f.precession == null) f.precession = Math.random() * Math.PI * 2;
    const t = clamp01(1 - spinPct / WOBBLE_SPIN_START);
    const build = Math.pow(t, 3.15);
    f.precession += (0.85 + build * 3.2) * (1 + build * 1.4) * (1 / 60);
    const tiltRad = build * 0.38;
    f.lastWobble = tiltRad;
    mesh.position.y = tipLift(tiltRad);
    applyTopOrientation(mesh, f.spinYaw, f.precession, tiltRad);
  } else {
    f.precession = null;
    mesh.rotation.set(0, f.spinYaw, 0);
  }
}

// As the bey leans by `tilt`, raise its origin so the body rests on the floor instead
// of rotating into it. At full tip-over it sits at roughly its body radius.
function tipLift(tilt) {
  return Math.sin(tilt) * BEY_R * 0.95;
}

const camLook = { x: 0, y: 0, z: 0, ready: false };
function updateCamera() {
  if (!camera3d || !BATTLE) return;
  const a = BATTLE.a, b = BATTLE.b;
  const player = a.isPlayer ? a : b;
  const ai = a.isPlayer ? b : a;

  // Focus on the surviving/active beys; if one is falling out, follow it down.
  const falling = (a.out ? a : null) || (b.out ? b : null);
  let focusX, focusZ, targetCamY, targetCamZ, lookY;
  if (falling) {
    focusX = falling.x; focusZ = falling.y;
    targetCamY = ARENA.r * 1.3;
    targetCamZ = ARENA.r * 1.5;
    lookY = -ARENA.r * 0.2;
  } else {
    // Weight the focus toward the PLAYER's bey (0.62) so it stays the visual anchor,
    // not the opponent.
    focusX = player.x * 0.62 + ai.x * 0.38;
    focusZ = player.y * 0.62 + ai.y * 0.38;
    targetCamY = ARENA.r * 1.85;   // higher + further back = more of the field visible
    targetCamZ = ARENA.r * 1.55;
    lookY = 0;
  }

  const lerp = falling ? 0.04 : 0.07;
  // Keep the camera mostly centered on the arena, drifting only slightly with the focus,
  // so the whole dish stays in frame.
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
// Sound — a single collision sound (your uploaded clip), nothing else.
// Simple HTML Audio, like the first working version.
// ---------------------------------------------------------------
const hitAudio = new Audio('hit.mp3');
hitAudio.preload = 'auto';

function unlockAudio() {
  // Some browsers need a play() during a user gesture to allow later playback.
  // Do it SILENTLY so the unlock tap (e.g. "Battle") doesn't play an audible hit.
  const prevVol = hitAudio.volume;
  hitAudio.volume = 0;
  hitAudio.play().then(() => {
    hitAudio.pause();
    hitAudio.currentTime = 0;
    hitAudio.volume = prevVol;
  }).catch(() => { hitAudio.volume = prevVol; });
}

function playHitSound() {
  try {
    const a = hitAudio.cloneNode();
    a.volume = 0.9;
    a.play().catch(() => {});
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------
// Battle engine
// ---------------------------------------------------------------
let BATTLE = null;
let tiltEnabled = false;
let tiltVector = { x: 0, y: 0 };
let tiltBase = { beta: null, gamma: null };
let joystickVector = { x: 0, y: 0 };
let joystickActive = false;

function createFighterState(bey, x, y, vx, vy, isPlayer) {
  return {
    bey, x, y, vx, vy,
    spin: MAX_SPIN_LIFE,        // life: 1.0 -> 0
    boostTimer: 0, boostMultiplier: 1,
    // Move slots: each starts needing its full `charge` time before first use,
    // then `cooldown` after each use. `ready` is derived each frame.
    baseTimer: bey.moves.base.charge,       // seconds remaining until ready
    specialTimer: bey.moves.special.charge,
    out: false, isPlayer, dashTimer: 0,
    fallY: 0, fallVel: 0, ringOutTimer: 0,
    spinYaw: 0, precession: null, lastWobble: 0.38, deathT: null
  };
}

function beginBattleForMatch(match) {
  if (match.score[match.a.id] === undefined) match.score[match.a.id] = 0;
  if (match.score[match.b.id] === undefined) match.score[match.b.id] = 0;
  const playerIsA = match.a.id === GAME.playerBeyId;
  unlockAudio();
  initBattleState(match.a, match.b, playerIsA);
  $('set-score').textContent = `${match.score[match.a.id]} - ${match.score[match.b.id]}`;
  showScreen('battle');
  // Let the layout settle (fullscreen on mobile landscape), then fit the renderer.
  requestAnimationFrame(() => { resizeRendererToCanvas(); });
  startBattleLoop();
}

function initBattleState(beyA, beyB, playerIsA) {
  BATTLE = {
    a: createFighterState(beyA, -ARENA.r * 0.32, -ARENA.r * 0.18, 30, -45, playerIsA),
    b: createFighterState(beyB, ARENA.r * 0.32, ARENA.r * 0.18, -30, 45, !playerIsA),
    elapsed: 0, ended: false, lastT: 0, rafId: 0, ringOutPending: null, spinOutPending: null, spinOutTimer: 0, impactCooldown: 0, launchGrace: 1.0, activeSpecial: null
  };
  camLook.ready = false;
  if (camera3d) {
    camera3d.position.set(0, ARENA.r * 1.85, ARENA.r * 1.55);
    camera3d.lookAt(0, 0, -ARENA.r * 0.18);
  }
  if (scene3d) {
    if (meshA) scene3d.remove(meshA);
    if (meshB) scene3d.remove(meshB);
    meshA = buildBeyMesh(beyA);
    meshB = buildBeyMesh(beyB);
    scene3d.add(meshA);
    scene3d.add(meshB);
  }
  $('hud-name-a').textContent = beyA.name;
  $('hud-name-b').textContent = beyB.name;
  $('hud-stamina-a').style.width = '100%';
  $('hud-stamina-b').style.width = '100%';
  $('hud-pct-a').textContent = '100%';
  $('hud-pct-b').textContent = '100%';
  const playerFighter = playerIsA ? BATTLE.a : BATTLE.b;
  // Keep the round-button labels short; the full move name isn't shown anymore.
  $('base-name').textContent = 'Base';
  $('special-name').textContent = 'Special';
  $('base-cooldown').style.setProperty('--cd', 1);
  $('special-cooldown').style.setProperty('--cd', 1);
  $('btn-base').disabled = true;
  $('btn-special').disabled = true;
  resetJoystick();
  // On touch devices we steer by tilt (after calibration); hide the desktop joystick.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  $('joystick').style.display = isTouch ? 'none' : 'block';
  $('tilt-gate').style.display = tiltEnabled ? 'none' : (isTouch ? 'block' : 'none');
}

function startBattleLoop() {
  BATTLE.lastT = performance.now();
  cancelAnimationFrame(BATTLE.rafId);
  BATTLE.rafId = requestAnimationFrame(battleLoop);
}
function battleLoop(t) {
  if (!BATTLE || BATTLE.ended) return;
  const dt = Math.min(0.05, (t - BATTLE.lastT) / 1000);
  BATTLE.lastT = t;
  BATTLE.elapsed += dt;
  updateBattle(dt);
  renderBattle();
  if (!BATTLE.ended) BATTLE.rafId = requestAnimationFrame(battleLoop);
}

function aiSteer(ai, player, dt) {
  const dx = player.x - ai.x, dy = player.y - ai.y;
  const dist = Math.hypot(dx, dy) || 1;
  const baseForce = 110 + ai.bey.stats.speed * 8;
  let fx = 0, fy = 0;

  switch (ai.bey.type) {
    case 'attack':
      fx = (dx / dist) * baseForce * 1.3;
      fy = (dy / dist) * baseForce * 1.3;
      ai.dashTimer -= dt;
      if (ai.dashTimer <= 0 && Math.hypot(ai.x - ARENA.cx, ai.y - ARENA.cy) < ARENA.r * 0.55) {
        ai.vx += (dx / dist) * 120;
        ai.vy += (dy / dist) * 120;
        ai.dashTimer = 1.6 + Math.random() * 0.8;
      }
      break;
    case 'defense': {
      const toCenter = Math.hypot(ai.x - ARENA.cx, ai.y - ARENA.cy) || 1;
      fx += -((ai.x - ARENA.cx) / toCenter) * 40;
      fy += -((ai.y - ARENA.cy) / toCenter) * 40;
      if (dist < 95) { fx += (dx / dist) * baseForce * 0.6; fy += (dy / dist) * baseForce * 0.6; }
      break;
    }
    case 'stamina': {
      const angleNow = Math.atan2(ai.y - ARENA.cy, ai.x - ARENA.cx);
      const orbitR = ARENA.r * 0.62;
      const tx = ARENA.cx + Math.cos(angleNow + 0.6) * orbitR;
      const ty = ARENA.cy + Math.sin(angleNow + 0.6) * orbitR;
      const odx = tx - ai.x, ody = ty - ai.y;
      const od = Math.hypot(odx, ody) || 1;
      fx = (odx / od) * baseForce * 0.7;
      fy = (ody / od) * baseForce * 0.7;
      break;
    }
    default: // balance
      fx = (dx / dist) * baseForce * 0.85;
      fy = (dy / dist) * baseForce * 0.85;
  }
  fx += (Math.random() - 0.5) * 30;
  fy += (Math.random() - 0.5) * 30;
  ai.vx += fx * dt;
  ai.vy += fy * dt;
}

function updateBattle(dt) {
  const { a, b } = BATTLE;
  const player = a.isPlayer ? a : b;
  const ai = a.isPlayer ? b : a;

  if (BATTLE.impactCooldown > 0) BATTLE.impactCooldown = Math.max(0, BATTLE.impactCooldown - dt);

  const inGrace = BATTLE.launchGrace > 0;
  if (inGrace) BATTLE.launchGrace = Math.max(0, BATTLE.launchGrace - dt);

  if (!inGrace) {
    const inputVec = tiltEnabled ? tiltVector : joystickVector;
    const steerForce = tiltEnabled ? 210 : 260; // tilt is a touch gentler for control
    player.vx += inputVec.x * steerForce * dt;
    player.vy += inputVec.y * steerForce * dt;
    aiSteer(ai, player, dt);
  }

  [a, b].forEach((f) => {
    if (f.out) return; // already knocked out; handled by fall animation below
    const maxSpeed = 90 + f.bey.stats.speed * 10;
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > maxSpeed) { f.vx = (f.vx / sp) * maxSpeed; f.vy = (f.vy / sp) * maxSpeed; }
    const drag = 1 - (0.55 - f.bey.stats.stamina * 0.03) * dt;
    f.vx *= Math.max(0, drag);
    f.vy *= Math.max(0, drag);
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (!inGrace) {
      // Spin decay (reference formula): gentle above STABLE_SPIN, 2.4x faster below,
      // scaled by stamina stat. A high-stamina bey lasts much longer.
      const m = staMult(f.bey.stats.stamina);
      const rate = f.spin > STABLE_SPIN ? SPIN_DECAY * 0.5 * m : SPIN_DECAY * 2.4 * m;
      f.spin = Math.max(0, f.spin - rate * dt);
      // Move charge / cooldown timers tick down only after the launch grace.
      if (f.baseTimer > 0) f.baseTimer = Math.max(0, f.baseTimer - dt);
      if (f.specialTimer > 0) f.specialTimer = Math.max(0, f.specialTimer - dt);
    }
    if (f.boostTimer > 0) f.boostTimer = Math.max(0, f.boostTimer - dt);

    const d = Math.hypot(f.x - ARENA.cx, f.y - ARENA.cy) || 0.0001;
    const nx = (f.x - ARENA.cx) / d, ny = (f.y - ARENA.cy) / d;
    const angle = Math.atan2(f.y - ARENA.cy, f.x - ARENA.cx);
    const wallContact = ARENA.r - BEY_R;
    const pocketExitR = ARENA.r + BEY_R * 0.5; // center must clear this to fall out
    const inPocket = isAtPocketAngle(angle);

    if (d > wallContact) {
      if (inPocket && !inGrace) {
        // Pocket gap: only a light rim graze; the bey can keep sliding outward.
        if (d > pocketExitR) {
          f.out = true;
          f.fallVel = 0;
          f.ringOutTimer = 0;
          BATTLE.ringOutPending = f;
        }
      } else {
        // Solid wall (or any wall during launch grace) — clamp to the wall face and
        // bounce inward. Applies on EVERY frame past the contact line, so a bey can
        // never tunnel through a wall.
        f.x = ARENA.cx + nx * wallContact;
        f.y = ARENA.cy + ny * wallContact;
        const vDotN = f.vx * nx + f.vy * ny;
        if (vDotN > 0) {
          f.vx -= 1.8 * vDotN * nx;
          f.vy -= 1.8 * vDotN * ny;
          // Wall impact costs spin, scaled to how hard it hit (reference range).
          const speed = Math.hypot(f.vx, f.vy);
          const loss = WALL_SPIN_LOSS_MIN + clamp01(speed / 180) * (WALL_SPIN_LOSS_MAX - WALL_SPIN_LOSS_MIN);
          f.spin = Math.max(0, f.spin - loss);
        }
      }
    }
  });

  // Brief slide-out for a knocked-out bey so the exit reads clearly, then resolve.
  // No void-fall: the bey just leaves the stadium floor and the game ends.
  [a, b].forEach((f) => {
    if (!f.out) return;
    f.ringOutTimer += dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
  });

  const cdx = b.x - a.x, cdy = b.y - a.y;
  const cdist = Math.hypot(cdx, cdy);
  if (!a.out && !b.out && cdist < BEY_R * 2 && cdist > 0.001) resolveCollision(a, b, cdx, cdy, cdist);

  // HUD: spin shown as a percentage (1.0 -> "100%"), bar width = spin fraction.
  const aPct = Math.round(a.spin * 100), bPct = Math.round(b.spin * 100);
  $('hud-stamina-a').style.width = aPct + '%';
  $('hud-stamina-b').style.width = bPct + '%';
  $('hud-pct-a').textContent = aPct + '%';
  $('hud-pct-b').textContent = bPct + '%';

  // Move readiness: ready when the timer hits 0. The conic overlay (--cd) shows the
  // remaining cooldown as a shrinking dark wedge (0 = ready, 1 = just used).
  const baseReady = player.baseTimer <= 0;
  const specialReady = player.specialTimer <= 0;
  const baseDen = Math.max(player.bey.moves.base.charge, player.bey.moves.base.cooldown);
  const specialDen = Math.max(player.bey.moves.special.charge, player.bey.moves.special.cooldown);
  $('base-cooldown').style.setProperty('--cd', clamp01(player.baseTimer / baseDen));
  $('btn-base').disabled = !baseReady;
  $('special-cooldown').style.setProperty('--cd', clamp01(player.specialTimer / specialDen));
  $('btn-special').disabled = !specialReady;

  // AI fires moves when ready (prefers special), with a little randomness so it
  // doesn't fire the instant it charges.
  if (ai.specialTimer <= 0 && Math.random() < 0.9 * dt * 2) triggerSpecialMove(ai, player);
  else if (ai.baseTimer <= 0 && Math.random() < 1.2 * dt * 2) triggerBaseMove(ai, player);

  updateActiveSpecial(dt);

  // Ring-out: a short readable beat after the bey leaves, then resolve the game.
  if (BATTLE.ringOutPending) {
    if (BATTLE.ringOutPending.ringOutTimer > 0.5) {
      const loser = BATTLE.ringOutPending;
      const winner = loser === a ? b : a;
      endBattle(winner, loser, 'ringout');
    }
    return;
  }
  // Spin-out: when a bey's spin hits 0 it wobbles and topples; wait for that to
  // settle (~1.4s) before showing the result, matching the reference death animation.
  const drained = a.spin <= 0 ? a : b.spin <= 0 ? b : null;
  if (drained) {
    if (BATTLE.spinOutPending !== drained) { BATTLE.spinOutPending = drained; BATTLE.spinOutTimer = 0; }
    BATTLE.spinOutTimer += dt;
    drained.vx *= 0.9; drained.vy *= 0.9; // skid to a halt
    if (BATTLE.spinOutTimer > 1.4) {
      endBattle(drained === a ? b : a, drained, 'spinout');
    }
    return;
  }
  if (BATTLE.elapsed > MATCH_TIME_LIMIT) {
    const winner = a.spin >= b.spin ? a : b;
    endBattle(winner, winner === a ? b : a, 'timeout');
  }
}

function resolveCollision(a, b, dx, dy, dist) {
  const nx = dx / dist, ny = dy / dist;
  // Reduced-mass-style sharing based on defense (heavier/defensive beys move less).
  const massA = stat100(a.bey.stats.defense) + 40, massB = stat100(b.bey.stats.defense) + 40;
  const shareA = massB / (massA + massB), shareB = massA / (massA + massB);
  const overlap = BEY_R * 2 - dist;

  // Always separate so the discs never visually overlap.
  a.x -= nx * overlap * shareA; a.y -= ny * overlap * shareA;
  b.x += nx * overlap * shareB; b.y += ny * overlap * shareB;

  // Closing speed = how fast they move INTO each other along the contact normal.
  const relVx = a.vx - b.vx, relVy = a.vy - b.vy;
  const closing = Math.max(0, -(relVx * nx + relVy * ny));

  // Knockback impulse (reference: closingSpeed * KNOCKBACK_SCALE, min MIN_KNOCKBACK),
  // modulated by attacker's attack and defender's defense.
  const baseImpulse = Math.max(MIN_KNOCKBACK, closing * KNOCKBACK_SCALE);
  const boostA = a.boostTimer > 0 ? a.boostMultiplier : 1;
  const boostB = b.boostTimer > 0 ? b.boostMultiplier : 1;
  const impulseA = baseImpulse * atkCombatMult(b.bey.stats.attack) * boostB / defMult(a.bey.stats.defense);
  const impulseB = baseImpulse * atkCombatMult(a.bey.stats.attack) * boostA / defMult(b.bey.stats.defense);
  a.vx -= nx * impulseA; a.vy -= ny * impulseA;
  b.vx += nx * impulseB; b.vy += ny * impulseB;

  // Guaranteed separation pop: after any contact, ensure the two beys are actually
  // moving APART along the normal by at least a minimum speed. This makes collisions
  // read as real bounces (like real beys ricocheting) instead of grinding/sticking.
  const MIN_SEPARATION_SPEED = 55;
  const sepA = a.vx * -nx + a.vy * -ny; // a's speed along the away direction
  const sepB = b.vx * nx + b.vy * ny;   // b's speed along the away direction
  if (sepA < MIN_SEPARATION_SPEED) {
    const add = MIN_SEPARATION_SPEED - sepA;
    a.vx -= nx * add; a.vy -= ny * add;
  }
  if (sepB < MIN_SEPARATION_SPEED) {
    const add = MIN_SEPARATION_SPEED - sepB;
    b.vx += nx * add; b.vy += ny * add;
  }

  // Damage (spin loss) + sound only once per cooldown window — staying in contact
  // keeps them touching but does NOT re-apply a hit every frame.
  if (BATTLE.impactCooldown > 0) return;
  BATTLE.impactCooldown = IMPACT_COOLDOWN;

  // Base spin loss from closing speed, clamped to the reference range, then modulated
  // by attacker attack (boosted by an active move) and defender spin-defense.
  const baseSpinLoss = Math.min(MAX_SPIN_LOSS, Math.max(MIN_SPIN_LOSS, closing * SPIN_LOSS_SCALE));
  const lossToA = Math.min(MAX_SPIN_LOSS, baseSpinLoss * atkCombatMult(b.bey.stats.attack) * boostB / spinDefMult(a.bey.stats.defense));
  const lossToB = Math.min(MAX_SPIN_LOSS, baseSpinLoss * atkCombatMult(a.bey.stats.attack) * boostA / spinDefMult(b.bey.stats.defense));
  a.spin = Math.max(0, a.spin - lossToA);
  b.spin = Math.max(0, b.spin - lossToB);

  a.boostTimer = 0;
  b.boostTimer = 0;
  playHitSound(); // every registered impact (gated by the cooldown above)
}

// Base move: a committed dash toward where the opponent IS RIGHT NOW. It fires in
// that fixed direction, so if the opponent moves in the moment you press it, you can
// miss. A direct spin hit lands only if the opponent is actually in the dash path
// when the move goes off (an immediate aim check); otherwise it's just a lunge and
// damage falls to the normal collision system.
// Base move: a forward thrust in the direction the bey is ALREADY moving (no auto-aim
// Base move: a dash launched toward WHERE THE OPPONENT IS at the instant you press it.
// The direction is locked at that moment — it does NOT track the opponent. So if they
// move out of the way before contact, you miss. Damage is dealt by the normal (boosted)
// collision if the dash actually connects. The opponent never auto-dodges.
function triggerBaseMove(attacker, defender) {
  if (attacker.baseTimer > 0) return; // not ready
  // Aim at the opponent's current position, then commit to that fixed direction.
  const dx = defender.x - attacker.x, dy = defender.y - attacker.y;
  const dist = Math.hypot(dx, dy) || 1;
  const dirX = dx / dist, dirY = dy / dist;
  attacker.vx += dirX * 230;
  attacker.vy += dirY * 230;
  attacker.boostTimer = attacker.bey.moves.base.duration;
  attacker.boostMultiplier = attacker.bey.moves.base.power;
  attacker.baseTimer = attacker.bey.moves.base.cooldown; // start cooldown
}

// Special move: GUARANTEED to affect the opponent. The attacker locks onto the
// opponent (homing) and an active effect drains the opponent's spin steadily for the
// whole duration — like Leone's tornado / Libra's sand field in the reference. The
// per-bey flavor (pull to center, vortex, etc.) can be layered on visually later.
function triggerSpecialMove(attacker, defender) {
  if (attacker.specialTimer > 0) return; // not ready
  attacker.specialTimer = attacker.bey.moves.special.cooldown; // start cooldown
  attacker.boostMultiplier = attacker.bey.moves.special.power;
  // Start an active special effect tied to this attacker.
  BATTLE.activeSpecial = {
    attacker, defender,
    timeLeft: attacker.bey.moves.special.duration,
    duration: attacker.bey.moves.special.duration,
    power: attacker.bey.moves.special.power
  };
}

// Runs every frame while a special is active: homing + guaranteed steady spin drain.
function updateActiveSpecial(dt) {
  const s = BATTLE.activeSpecial;
  if (!s) return;
  const { attacker, defender } = s;
  if (attacker.out || defender.out) { BATTLE.activeSpecial = null; return; }

  // Home the attacker toward the opponent so the move connects.
  const dx = defender.x - attacker.x, dy = defender.y - attacker.y;
  const dist = Math.hypot(dx, dy) || 1;
  attacker.vx += (dx / dist) * 320 * dt;
  attacker.vy += (dy / dist) * 320 * dt;

  // Guaranteed drain on the opponent for the whole duration. Total drain scales with
  // the move's power and the attack/defense matchup, spread across the duration.
  const totalDrain = 0.10 * s.power * atkCombatMult(attacker.bey.stats.attack) / spinDefMult(defender.bey.stats.defense);
  defender.spin = Math.max(0, defender.spin - (totalDrain / s.duration) * dt);

  // Keep the attacker boosted (extra collision damage) for the duration too.
  attacker.boostTimer = Math.max(attacker.boostTimer, 0.05);
  attacker.boostMultiplier = s.power;

  s.timeLeft -= dt;
  if (s.timeLeft <= 0) BATTLE.activeSpecial = null;
}

function renderBattle() {
  updateMeshFromFighter(meshA, BATTLE.a);
  updateMeshFromFighter(meshB, BATTLE.b);
  updateCamera();
  if (renderer3d) renderer3d.render(scene3d, camera3d);
}

function endBattle(winnerF, loserF, reason) {
  BATTLE.ended = true;
  cancelAnimationFrame(BATTLE.rafId);
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
// Input: device tilt (with calibration) + virtual joystick fallback.
// ---------------------------------------------------------------
let tiltRecalibrate = false;
function onTilt(e) {
  if (e.beta == null || e.gamma == null) return;
  // In landscape the device's gamma/beta map to screen X/Y differently than portrait.
  // screen.orientation.angle: 90 or -90 in landscape. We swap/sign axes accordingly.
  const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let sx, sy; // raw tilt mapped to screen right(+x) / down(+y)
  if (angle === 90) { sx = e.beta; sy = -e.gamma; }
  else if (angle === -90) { sx = -e.beta; sy = e.gamma; }
  else if (angle === 180) { sx = -e.gamma; sy = -e.beta; }
  else { sx = e.gamma; sy = e.beta; } // portrait

  if (tiltRecalibrate || tiltBase.beta === null) {
    tiltBase.x = sx; tiltBase.y = sy; tiltBase.beta = 0; // beta!=null marks calibrated
    tiltRecalibrate = false;
    tiltVector.x = 0; tiltVector.y = 0;
    return;
  }
  let dx = sx - tiltBase.x;
  let dy = sy - tiltBase.y;
  // Small dead zone so resting the phone doesn't drift the bey.
  const DEAD = 3; // degrees
  dx = Math.abs(dx) < DEAD ? 0 : dx - Math.sign(dx) * DEAD;
  dy = Math.abs(dy) < DEAD ? 0 : dy - Math.sign(dy) * DEAD;
  // Lower sensitivity: a full ~45° tilt reaches max steer, so normal play is gentle
  // and the bey no longer flies straight out of the stadium.
  tiltVector.x = clamp(dx / 45, -1, 1);
  tiltVector.y = clamp(dy / 45, -1, 1);
}
function enableTilt() {
  function attach() {
    tiltBase = { beta: null, x: 0, y: 0 };
    tiltRecalibrate = true; // next reading sets the neutral baseline
    window.removeEventListener('deviceorientation', onTilt);
    window.addEventListener('deviceorientation', onTilt);
    tiltEnabled = true;
    tiltVector = { x: 0, y: 0 };
    $('tilt-gate').style.display = 'none';
  }
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then((res) => { if (res === 'granted') attach(); else fallbackToStick(); }).catch(() => fallbackToStick());
  } else if (window.DeviceOrientationEvent) {
    attach();
  } else {
    fallbackToStick();
  }
}
function fallbackToStick() {
  // No motion sensors: reveal the joystick as a fallback even on touch.
  $('joystick').style.display = 'block';
  $('tilt-gate').style.display = 'none';
  alert('Motion sensors unavailable — use the on-screen stick to steer.');
}

function resetJoystick() {
  joystickVector = { x: 0, y: 0 };
  $('joystick-knob').style.left = '25px';
  $('joystick-knob').style.top = '25px';
}
function setupJoystick() {
  const el = $('joystick'), knob = $('joystick-knob');
  function center() {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width / 2 - 18 };
  }
  function update(e) {
    const c = center();
    let dx = e.clientX - c.x, dy = e.clientY - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist > c.radius) { dx = (dx / dist) * c.radius; dy = (dy / dist) * c.radius; }
    knob.style.left = (25 + dx) + 'px';
    knob.style.top = (25 + dy) + 'px';
    joystickVector.x = clamp(dx / c.radius, -1, 1);
    joystickVector.y = clamp(dy / c.radius, -1, 1);
  }
  el.addEventListener('pointerdown', (e) => { joystickActive = true; el.setPointerCapture(e.pointerId); update(e); });
  el.addEventListener('pointermove', (e) => { if (joystickActive) update(e); });
  window.addEventListener('pointerup', () => { if (joystickActive) { joystickActive = false; resetJoystick(); } });
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initThree();
  // Try to lock to landscape on mobile (best-effort; browsers may ignore unless in
  // fullscreen). The CSS overlay still prompts the user to rotate if not landscape.
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
  // When the device rotates, re-set the tilt neutral baseline so steering stays correct.
  window.addEventListener('orientationchange', () => {
    if (tiltEnabled) tiltRecalibrate = true;
    setTimeout(resizeRendererToCanvas, 250);
  });
  $('btn-mode-tournament').addEventListener('click', () => { unlockAudio(); enterMode('tournament'); });
  $('btn-mode-single').addEventListener('click', () => { unlockAudio(); enterMode('single'); });
  $('btn-select-back').addEventListener('click', () => {
    if (GAME.mode === 'single' && GAME.selectionPhase === 'opponent') {
      // Go back to picking the player's bey.
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
  $('btn-enable-tilt').addEventListener('click', enableTilt);
  $('btn-base').addEventListener('click', () => {
    if (!BATTLE || BATTLE.ended) return;
    const player = BATTLE.a.isPlayer ? BATTLE.a : BATTLE.b;
    const ai = player === BATTLE.a ? BATTLE.b : BATTLE.a;
    triggerBaseMove(player, ai);
  });
  $('btn-special').addEventListener('click', () => {
    if (!BATTLE || BATTLE.ended) return;
    const player = BATTLE.a.isPlayer ? BATTLE.a : BATTLE.b;
    const ai = player === BATTLE.a ? BATTLE.b : BATTLE.a;
    triggerSpecialMove(player, ai);
  });
  $('btn-restart').addEventListener('click', () => window.location.reload());
  $('btn-back-select').addEventListener('click', () => {
    if (BATTLE) { BATTLE.ended = true; cancelAnimationFrame(BATTLE.rafId); }
    BATTLE = null;
    GAME.pendingMatch = null;
    showScreen('mode');
  });
  setupJoystick();
});
