// net.js - versus mode, phone vs phone
//
// host = who creates the room. It runs the actual game, the guest only sends input
// (stick/tilt + buttons) and draws the state the host sends back (30/s).
// connection is WebRTC through PeerJS, their free server just connects the phones
// (and relays if the network blocks a direct link).
// host gets the same input delay as the guest so it's fair

(function () {
  const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
  const ID_PREFIX = 'lobo-room-';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L
  const SNAPSHOT_HZ = 30;
  const INPUT_HZ = 30;
  const LOST_AFTER = 8000;        // ms without messages = connection lost
  const MAX_FAIR_DELAY = 120;     // ms, max delay added to the host

  const NET = {
    role: null,          // 'host' | 'guest' | null
    peer: null, conn: null, code: null,
    connected: false,
    rtt: 0,              // ping in ms
    remotePaused: false, // guest phone is upright
    myBey: null, theirBey: null,
    score: { me: 0, them: 0 },
    ready: { me: false, them: false },
    phase: 'idle',       // 'idle' | 'lobby' | 'pick' | 'battle' | 'result'
    seriesOver: false,
  };
  window.NET = NET;

  let lastHeard = 0, pingTimer = null, watchTimer = null;
  let snapAcc = 0, inputAcc = 0, outEvents = [];
  let delayLine = [];    // host input, played back with the delay
  let nextObjId = 1;

  // --- Small helpers ---
  const r2 = (v) => Math.round(v * 100) / 100;
  const beyById = (id) => BEY_ROSTER.find((b) => b.id === id);
  function setStatus(text, isError) {
    const el = $('online-status');
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }
  function randomCode() {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }
  function send(msg) {
    if (NET.conn && NET.conn.open) { try { NET.conn.send(msg); } catch (e) { /* ignore */ } }
  }
  function fairDelay() { return NET.role === 'host' ? Math.min(MAX_FAIR_DELAY, NET.rtt) : 0; }

  // only load PeerJS when needed
  let peerLibPromise = null;
  function loadPeerLib() {
    if (window.Peer) return Promise.resolve();
    if (peerLibPromise) return peerLibPromise;
    peerLibPromise = new Promise((ok, fail) => {
      const sc = document.createElement('script');
      sc.src = PEERJS_URL;
      sc.onload = () => (window.Peer ? ok() : fail(new Error('PeerJS missing')));
      sc.onerror = () => { peerLibPromise = null; fail(new Error('Could not load PeerJS')); };
      document.head.appendChild(sc);
    });
    return peerLibPromise;
  }
  // LOBO_PEER_CONFIG = local server for tests
  function peerOptions() { return Object.assign({ debug: 0 }, window.LOBO_PEER_CONFIG || {}); }

  // --- Lobby: create / join a room ---
  NET.openLobby = function () {
    cleanup();
    GAME.mode = 'online';
    NET.phase = 'lobby';
    $('online-menu').hidden = false;
    $('online-room').hidden = true;
    $('online-players').hidden = true;
    $('btn-online-create').disabled = false;
    $('btn-online-join').disabled = false;
    setStatus('');
    showScreen('online');
  };

  function createRoom(attempt) {
    attempt = attempt || 0;
    $('btn-online-create').disabled = true;
    $('btn-online-join').disabled = true;
    setStatus('Creating room…');
    loadPeerLib().then(() => {
      const code = randomCode();
      const peer = new Peer(ID_PREFIX + code, peerOptions());
      NET.peer = peer; NET.role = 'host'; NET.code = code;
      peer.on('open', () => {
        $('online-menu').hidden = true;
        $('online-room').hidden = false;
        $('online-room-code').textContent = code;
        setStatus('Waiting for your friend…');
      });
      peer.on('connection', (conn) => {
        if (NET.conn) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
        attachConnection(conn);
      });
      peer.on('error', (err) => {
        if (err && err.type === 'unavailable-id' && attempt < 5) { cleanup(); createRoom(attempt + 1); return; }
        onPeerError(err);
      });
      peer.on('disconnected', () => { if (!NET.connected && NET.peer === peer) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
    }).catch(() => { failLobby('Can\'t go online. Check your connection'); });
  }

  function joinRoom() {
    const code = ($('online-code').value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { setStatus('Enter the 4-letter code', true); return; }
    $('btn-online-create').disabled = true;
    $('btn-online-join').disabled = true;
    setStatus('Connecting…');
    loadPeerLib().then(() => {
      const peer = new Peer(peerOptions());
      NET.peer = peer; NET.role = 'guest'; NET.code = code;
      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
        attachConnection(conn);
        setTimeout(() => { if (!NET.connected && NET.conn === conn) failLobby('Couldn\'t connect. Check the code or try another network'); }, 15000);
      });
      peer.on('error', onPeerError);
    }).catch(() => { failLobby('Can\'t go online. Check your connection'); });
  }

  function onPeerError(err) {
    const type = err && err.type;
    if (type === 'peer-unavailable') failLobby('Room not found. Check the code');
    else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      if (NET.connected) return;   // already connected, the server isn't needed anymore
      failLobby('Can\'t reach the server. Check your connection');
    } else if (!NET.connected) failLobby('Connection problem, try again');
  }

  function failLobby(text) {
    if (NET.phase === 'battle' || NET.phase === 'result' || NET.phase === 'pick') { connectionLost(); return; }
    cleanup();
    GAME.mode = 'online';
    NET.phase = 'lobby';
    $('online-menu').hidden = false;
    $('online-room').hidden = true;
    $('online-players').hidden = true;
    $('btn-online-create').disabled = false;
    $('btn-online-join').disabled = false;
    setStatus(text, true);
    showScreen('online');
  }

  function attachConnection(conn) {
    NET.conn = conn;
    conn.on('open', () => {
      NET.connected = true;
      lastHeard = performance.now();
      send({ t: 'hello', v: GAME_VERSION });
      startTimers();
      goToPick();
    });
    conn.on('data', onMessage);
    conn.on('close', () => { if (NET.connected) connectionLost(); });
    conn.on('error', () => { if (NET.connected) connectionLost(); });
  }

  function startTimers() {
    stopTimers();
    pingTimer = setInterval(() => { send({ t: 'ping', ts: performance.now(), rtt: NET.rtt }); }, 1000);
    watchTimer = setInterval(() => {
      if (NET.connected && performance.now() - lastHeard > LOST_AFTER) connectionLost();
    }, 1000);
  }
  function stopTimers() {
    if (pingTimer) clearInterval(pingTimer);
    if (watchTimer) clearInterval(watchTimer);
    pingTimer = watchTimer = null;
  }

  // --- Picking the beys ---
  function goToPick() {
    NET.phase = 'pick';
    NET.myBey = null; NET.theirBey = null;
    NET.ready.me = NET.ready.them = false;
    GAME.mode = 'online';
    enterMode('online');
  }

  NET.pick = function (beyId) {
    NET.myBey = beyId;
    send({ t: 'pick', bey: beyId });
    showWaiting();
    maybeStart();
  };

  function showWaiting() {
    $('online-menu').hidden = true;
    $('online-room').hidden = true;
    $('online-players').hidden = false;
    $('online-me').textContent = NET.myBey ? beyById(NET.myBey).name : 'Picking…';
    $('online-them').textContent = NET.theirBey ? beyById(NET.theirBey).name : 'Picking…';
    setStatus(NET.theirBey ? 'Starting…' : 'Waiting for opponent…');
    showScreen('online');
  }

  // host starts when both picked
  function maybeStart() {
    if (NET.role !== 'host' || !NET.myBey || !NET.theirBey) return;
    NET.score = { me: 0, them: 0 };
    NET.seriesOver = false;
    startGame();
  }
  function startGame() {
    NET.ready.me = NET.ready.them = false;
    send({ t: 'start', host: NET.myBey, guest: NET.theirBey, score: [NET.score.me, NET.score.them] });
    beginOnlineBattle(NET.myBey, NET.theirBey);
  }

  // --- Battle ---
  function beginOnlineBattle(hostBeyId, guestBeyId) {
    NET.phase = 'battle';
    unlockAudio();
    requestFullscreen();
    if (window.matchMedia('(pointer: coarse)').matches) { requestTiltPermission(); startTiltListening(); }
    // host bey = a, guest bey = b
    initBattleState(beyById(hostBeyId), beyById(guestBeyId), NET.role === 'host');
    BATTLE.online = NET.role;
    if (NET.role === 'host') BATTLE.b.remote = { x: 0, y: 0 };
    snapAcc = inputAcc = 0; outEvents = []; delayLine = []; guestSpecials.clear(); guestObjs.clear();
    NET.remotePaused = false;
    $('set-score').textContent = `${NET.score.me} - ${NET.score.them}`;
    $('net-ping').textContent = '';
    showScreen('battle');
    requestAnimationFrame(() => { resizeRendererToCanvas(); resetJoystick(); });
    if (NET.role === 'host') startBattleLoop(); else startGuestLoop();
  }

  // host: grab the events every frame, send state at 30Hz
  NET.afterHostUpdate = function (dt) {
    for (const e of BATTLE.events) outEvents.push(packEvent(e));
    snapAcc += dt;
    if (snapAcc >= 1 / SNAPSHOT_HZ) { snapAcc = 0; sendSnapshot(); }
    $('net-ping').textContent = NET.rtt ? NET.rtt + ' ms' : '';
  };

  NET.delayedInput = function (v) {
    const d = fairDelay();
    if (!d) return v;
    const now = performance.now();
    delayLine.push({ t: now, x: v.x, y: v.y });
    let out = delayLine[0];
    while (delayLine.length > 1 && delayLine[1].t <= now - d) { delayLine.shift(); out = delayLine[0]; }
    return out.t <= now - d ? out : { x: 0, y: 0 };
  };
  NET.delayedAction = function (fn) {
    const d = fairDelay();
    if (d > 4) setTimeout(fn, d); else fn();
  };

  NET.sendButton = function (k) {
    const me = BATTLE && (BATTLE.a.isPlayer ? BATTLE.a : BATTLE.b);
    send({ t: 'btn', k, st: me && me.special ? r2(me.special.t) : null });
  };

  // fighter fields that get synced, the rest is fixed or render-only
  const F_FIELDS = ['x', 'y', 'vx', 'vy', 'spin', 'out', 'ringOutTimer', 'boostTimer', 'boostSource',
    'baseTimer', 'specialTimer', 'ctrlLock', 'stun', 'slow', 'frozen', 'iceSlide', 'airborne', 'height',
    'anchored', 'steerMul', 'liftTarget', 'inMaelstrom', 'guardTimer', 'guardAge', 'mirror', 'mirrorStore',
    'pounceLeft', 'pounceWindow', 'lungeT'];
  function packValue(v) {
    if (typeof v === 'number') return r2(v);
    if (Array.isArray(v)) return v.map(packValue);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = packValue(v[k]); return o; }
    return v;
  }
  function packFighter(f) {
    const o = {};
    for (const k of F_FIELDS) { const v = f[k]; o[k] = typeof v === 'number' ? r2(v) : v; }
    const s = f.special;
    if (s) {
      if (!s.id) s.id = nextObjId++;
      const sp = {};
      for (const k in s) if (k !== 'foe' && k !== 'snd') sp[k] = packValue(s[k]);
      o.sp = sp;
    } else o.sp = null;
    return o;
  }
  const side = (f) => (f === BATTLE.a ? 'a' : 'b');
  function packEvent(e) {
    const o = {};
    for (const k in e) o[k] = k === 'f' ? side(e.f) : packValue(e[k]);
    return o;
  }
  function packList(list) {
    return list.map((it) => {
      if (!it.id) it.id = nextObjId++;
      const o = {};
      for (const k in it) o[k] = k === 'owner' ? side(it.owner) : packValue(it[k]);
      return o;
    });
  }
  function sendSnapshot() {
    send({
      t: 's', e: r2(BATTLE.elapsed), lg: r2(BATTLE.launchGrace), so: BATTLE.spinOutPending ? 1 : 0,
      a: packFighter(BATTLE.a), b: packFighter(BATTLE.b),
      tr: packList(BATTLE.trails), wv: packList(BATTLE.waves), ev: outEvents,
    });
    outEvents = [];
  }

  // host: round over
  NET.onBattleEnd = function (winnerF, loserF, reason) {
    sendSnapshot();
    const hostWon = winnerF === BATTLE.a;
    if (hostWon) NET.score.me++; else NET.score.them++;
    NET.seriesOver = NET.score.me >= 2 || NET.score.them >= 2;
    send({ t: 'end', w: hostWon ? 'host' : 'guest', reason, score: [NET.score.me, NET.score.them] });
    showGameResult(hostWon, reason, winnerF.bey, loserF.bey);
  };

  // --- Guest: draw what the host sends ---
  const guestSpecials = new Map();   // side -> special id
  const guestObjs = new Map();       // trail/wave id -> object
  let guestLast = 0;

  function startGuestLoop() {
    cancelAnimationFrame(battleRafId);
    const myGen = ++battleGen;
    guestLast = performance.now();
    const step = (t) => {
      if (myGen !== battleGen || !BATTLE || BATTLE.ended) return;
      const dt = Math.min(0.05, (t - guestLast) / 1000);
      guestLast = t;
      const me = BATTLE.b;
      // send input (+ upright = pause)
      const upright = phoneUpright();
      if (tiltEnabled) updateTiltVector();
      const v = upright ? { x: 0, y: 0 } : (tiltEnabled ? tiltVector : joystickVector);
      inputAcc += dt;
      if (inputAcc >= 1 / INPUT_HZ) { inputAcc = 0; send({ t: 'i', x: r2(v.x), y: r2(v.y), p: upright ? 1 : 0 }); }
      guestAdvance(dt);
      if (BATTLE.hitStop > 0) { BATTLE.hitStop -= dt; renderBattle(dt * 0.15); } else renderBattle(dt);
      updateBattleHud(me);
      $('net-ping').textContent = NET.rtt ? NET.rtt + ' ms' : '';
      battleRafId = requestAnimationFrame(step);
    };
    battleRafId = requestAnimationFrame(step);
  }

  // between snapshots: keep moving with the last speed, then ease back to the host values
  function guestAdvance(dt) {
    for (const f of [BATTLE.a, BATTLE.b]) {
      if (f._tx == null) continue;
      if (!f.airborne) { f._tx += f.vx * dt; f._ty += f.vy * dt; }
      const k = Math.min(1, dt * 18);
      f.x += (f._tx - f.x) * k; f.y += (f._ty - f.y) * k;
      const s = f.special;
      if (s) {
        s.t += dt;
        if (s.pt != null) s.pt += dt;
        if (s.bolts) for (const b of s.bolts) b.t += dt;
      }
    }
    for (const tr of BATTLE.trails) tr.age += dt;
    for (const w of BATTLE.waves) w.t += dt;
  }

  function applySnapshot(m) {
    if (!BATTLE || BATTLE.online !== 'guest' || BATTLE.ended) return;
    BATTLE.elapsed = m.e;
    BATTLE.launchGrace = m.lg;            // buttons stay off until this hits 0
    BATTLE.spinOutPending = m.so ? true : null;
    applyFighter(BATTLE.a, m.a, 'a');
    applyFighter(BATTLE.b, m.b, 'b');
    BATTLE.trails = syncList(m.tr);
    BATTLE.waves = syncList(m.wv);
    for (const e of m.ev || []) {
      if (e.f) e.f = BATTLE[e.f];
      BATTLE.events.push(e);
      guestEventSound(e);
    }
  }

  function applyFighter(f, d, key) {
    const jump = f._tx == null || Math.hypot(d.x - f.x, d.y - f.y) > 80 || d.airborne || d.out;
    for (const k of F_FIELDS) if (k !== 'x' && k !== 'y') f[k] = d[k];
    f._tx = d.x; f._ty = d.y;
    if (jump) { f.x = d.x; f.y = d.y; }
    const other = f === BATTLE.a ? BATTLE.b : BATTLE.a;
    if (!d.sp) {
      if (f.special) { if (f.special.snd) f.special.snd.stop(); f.special = null; }
      guestSpecials.delete(key);
      return;
    }
    if (!f.special || guestSpecials.get(key) !== d.sp.id) {
      if (f.special && f.special.snd) f.special.snd.stop();
      f.special = { foe: other };
      guestSpecials.set(key, d.sp.id);
      if (window.SFX) f.special.snd = SFX.special(d.sp.kind);
    }
    Object.assign(f.special, d.sp);
  }

  // keep the same objects, fx.js tracks trails/waves by reference
  function syncList(list) {
    const out = [];
    for (const d of list || []) {
      let o = guestObjs.get(d.id);
      if (!o) { o = {}; guestObjs.set(d.id, o); }
      Object.assign(o, d);
      o.owner = BATTLE[d.owner];
      out.push(o);
    }
    if (guestObjs.size > 200) {
      const keep = new Set(out.map((o) => o.id));
      for (const id of guestObjs.keys()) if (!keep.has(id)) guestObjs.delete(id);
    }
    return out;
  }

  function guestEventSound(e) {
    if (e.type === 'impact') {
      const p = Math.min(1, (e.power || 0) / 0.08);
      playHitSound(0.35 + 0.6 * p, e.base ? 0.85 : 1);
    } else eventSound(e.type, e);
    if (e.type === 'diveHit') BATTLE.hitStop = 0.09;
  }

  // --- Messages ---
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    lastHeard = performance.now();
    switch (m.t) {
      case 'hello':
        if (m.v !== GAME_VERSION) {
          const warn = `Different versions (you ${GAME_VERSION}, them ${m.v}). Reload the game on both phones`;
          setStatus(warn, true);
          $('select-note').textContent = warn;
        }
        break;
      case 'full':
        connectionLost('Room is full');
        break;
      case 'ping':
        send({ t: 'pong', ts: m.ts });
        if (NET.role === 'guest' && m.rtt) NET.rtt = m.rtt;
        break;
      case 'pong':
        NET.rtt = Math.round(performance.now() - m.ts);
        break;
      case 'pick':
        NET.theirBey = m.bey;
        if (NET.phase === 'pick' && NET.myBey) showWaiting();
        maybeStart();
        break;
      case 'start':          // guest
        NET.score = { me: m.score[1], them: m.score[0] };
        NET.myBey = m.guest; NET.theirBey = m.host;
        beginOnlineBattle(m.host, m.guest);
        break;
      case 's':              // guest
        applySnapshot(m);
        break;
      case 'i':              // host
        if (BATTLE && BATTLE.online === 'host' && BATTLE.b.remote) {
          BATTLE.b.remote.x = m.x; BATTLE.b.remote.y = m.y;
          NET.remotePaused = !!m.p;
        }
        break;
      case 'btn':            // host
        hostRemoteButton(m);
        break;
      case 'end':            // guest
        guestGameOver(m);
        break;
      case 'ready':
        NET.ready.them = true;
        if (NET.role === 'host') maybeNextGame();
        break;
      case 'change':
        NET.ready.me = NET.ready.them = false;
        goToPick();
        break;
      case 'bye':
        connectionLost('Your opponent left');
        break;
    }
  }

  function hostRemoteButton(m) {
    if (!BATTLE || BATTLE.online !== 'host' || BATTLE.ended) return;
    const f = BATTLE.b, o = BATTLE.a;
    if (m.k === 'base') triggerBaseMove(f, o, 0);
    else if (m.k === 'special') {
      // st == null -> the guest pressed to start the special, not a claw beat
      if (f.special && f.special.kind === 'claw') { if (m.st != null) clawPress(f, m.st); }
      else triggerSpecialMove(f, o);
    }
  }

  // --- Between games ---
  const REASON = {
    ringout: (w, l) => `Ring out! ${w.name} knocks ${l.name} out.`,
    spinout: (w, l) => `${w.name} outspins ${l.name}.`,
    timeout: (w) => `Time's up! ${w.name} had more spin left.`,
  };

  function guestGameOver(m) {
    if (!BATTLE) return;
    BATTLE.ended = true;
    battleGen++;
    cancelAnimationFrame(battleRafId);
    if (window.SFX) SFX.stopAll();
    NET.score = { me: m.score[1], them: m.score[0] };
    NET.seriesOver = NET.score.me >= 2 || NET.score.them >= 2;
    const iWon = m.w === 'guest';
    const winnerBey = iWon ? BATTLE.b.bey : BATTLE.a.bey;
    const loserBey = iWon ? BATTLE.a.bey : BATTLE.b.bey;
    showGameResult(iWon, m.reason, winnerBey, loserBey);
  }

  function showGameResult(iWon, reason, winnerBey, loserBey) {
    NET.phase = 'result';
    NET.ready.me = NET.ready.them = false;
    const why = (REASON[reason] || REASON.timeout)(winnerBey, loserBey);
    const score = `${NET.score.me} - ${NET.score.them}`;
    let title, text, label;
    if (NET.seriesOver) {
      title = NET.score.me > NET.score.them ? 'Victory!' : 'Defeat';
      text = `${why} Final score: ${score}`;
      label = 'Rematch';
    } else {
      title = iWon ? 'Round won!' : 'Round lost';
      text = `${why} Score: ${score}`;
      label = 'Next Round';
    }
    showResultScreen(title, text, onReadyPressed, label);
    $('btn-continue').disabled = false;
    $('btn-online-change').hidden = !NET.seriesOver;
    $('btn-back-select').textContent = 'Leave';
  }

  function onReadyPressed() {
    NET.ready.me = true;
    $('btn-continue').disabled = true;
    $('btn-continue').textContent = 'Waiting for opponent…';
    send({ t: 'ready' });
    if (NET.role === 'host') maybeNextGame();
  }

  function maybeNextGame() {
    if (!(NET.ready.me && NET.ready.them)) return;
    if (NET.seriesOver) { NET.score = { me: 0, them: 0 }; NET.seriesOver = false; }
    startGame();
  }

  function changeBey() {
    send({ t: 'change' });
    goToPick();
  }

  // --- Leaving and losing the connection ---
  function stopBattle() {
    if (BATTLE) { BATTLE.ended = true; battleGen++; cancelAnimationFrame(battleRafId); }
    if (window.SFX) SFX.stopAll();
  }

  function connectionLost(text) {
    const wasConnected = NET.connected;
    stopBattle();
    cleanup();
    if (!wasConnected && !text) return;
    GAME.mode = 'online';
    NET.phase = 'lobby';
    $('online-menu').hidden = false;
    $('online-room').hidden = true;
    $('online-players').hidden = true;
    $('btn-online-create').disabled = false;
    $('btn-online-join').disabled = false;
    setStatus(text || 'Connection lost', true);
    showScreen('online');
  }

  function cleanup() {
    stopTimers();
    NET.connected = false;
    if (NET.conn) { try { NET.conn.close(); } catch (e) { /* ignore */ } }
    if (NET.peer) { try { NET.peer.destroy(); } catch (e) { /* ignore */ } }
    NET.conn = null; NET.peer = null; NET.role = null; NET.code = null;
    NET.remotePaused = false;
    $('btn-online-change').hidden = true;
    $('btn-back-select').textContent = 'Menu';
    $('select-note').textContent = '';
  }

  NET.leave = function () {
    send({ t: 'bye' });
    NET.connected = false;      // otherwise the close shows up as "connection lost"
    stopBattle();
    setTimeout(cleanup, 150);   // let the bye go out first
    BATTLE = null;
    NET.phase = 'idle';
    GAME.mode = 'single';
    $('btn-online-change').hidden = true;
    $('btn-back-select').textContent = 'Menu';
    showScreen('mode');
  };

  // --- Buttons ---
  document.addEventListener('DOMContentLoaded', () => {
    $('btn-online-create').addEventListener('click', () => { unlockAudio(); createRoom(0); });
    $('btn-online-join').addEventListener('click', () => { unlockAudio(); joinRoom(); });
    $('online-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('online-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
    $('btn-online-back').addEventListener('click', () => { NET.leave(); });
    $('btn-online-change').addEventListener('click', () => { changeBey(); });
  });
})();
