// sfx.js: the move sounds.
// There are no audio files here: every sound is built on the fly with the Web Audio API,
// out of noise and oscillators shaped with filters and volume envelopes.
// The normal clash between two beys still uses hit.mp3 (see game.js).
(function () {
  'use strict';
  let ctx = null, out = null, noiseBuf = null, crackleBuf = null, boundTo = null;
  const live = new Set();          // loops that are playing (stopped when the battle ends)
  const lastAt = {};               // when each sound last played, so they don't stack up

  // ---------------------------------------------------------------
  // Setup: uses the game's AudioContext, or an OfflineAudioContext to record a preview
  // ---------------------------------------------------------------
  function bind(c, dest) {
    ctx = c;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    out = ctx.createGain(); out.gain.value = 0.85;
    out.connect(comp); comp.connect(dest || ctx.destination);
    noiseBuf = makeNoise(); crackleBuf = makeCrackle();
    boundTo = c;
  }
  function ensure() {
    if (typeof audioCtx === 'undefined' || !audioCtx) return false;   // game.js creates it on the first tap
    if (boundTo !== audioCtx) bind(audioCtx);
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return true;
  }
  function makeNoise() {
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Random clicks here and there: the crackle of fire and ice.
  function makeCrackle() {
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.0016) {
        const amp = (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1);
        const len = 20 + Math.floor(Math.random() * 90);
        for (let k = 0; k < len && i + k < n; k++) d[i + k] += amp * Math.exp(-k / (len * 0.25)) * (Math.random() * 2 - 1);
      }
    }
    return b;
  }

  // ---------------------------------------------------------------
  // Building blocks (t is the audio context's clock time)
  // ---------------------------------------------------------------
  function env(t, a, peak, d, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(dest || out);
    return g;
  }
  function src(buf, t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }
  function osc(type, f, t, dur) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function filt(type, f, q, t) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.setValueAtTime(f, t || ctx.currentTime);
    if (q != null) b.Q.value = q;
    return b;
  }
  function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

  // ---------------------------------------------------------------
  // One-shot sounds
  // ---------------------------------------------------------------
  // Rushing air: filtered noise that sweeps up and back down.
  function whoosh(t, v, f0, f1, f2, dur, q) {
    const n = src(noiseBuf, t, dur), bp = filt('bandpass', f0, q || 1.1, t);
    bp.frequency.linearRampToValueAtTime(f1, t + dur * 0.4);
    bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
    chain(n, bp, env(t, dur * 0.35, v, dur * 0.65));
  }
  // A low thud that drops in pitch.
  function thump(t, v, f0, f1, dur) {
    const o = osc('sine', f0, t, dur);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    chain(o, env(t, 0.006, v, dur));
  }
  function crack(t, v, dur, hp) {
    chain(src(crackleBuf, t, dur), filt('highpass', hp || 1500, 0.7, t), env(t, 0.01, v, dur));
  }
  // Bell or ringing metal (FM synthesis).
  function bell(t, v, f, dur) {
    const car = osc('sine', f, t, dur), mod = osc('sine', f * 1.41, t, dur), mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur);
    mod.connect(mg); mg.connect(car.frequency);
    chain(car, env(t, 0.004, v, dur));
    const p = osc('sine', f * 2.76, t, dur * 0.6);
    chain(p, env(t, 0.004, v * 0.3, dur * 0.6));
  }
  // Electric zap: a jittery sawtooth with some hiss.
  function zap(t, v, dur) {
    const o = osc('sawtooth', 900, t, dur);
    for (let k = 0.012; k < dur; k += 0.012 + Math.random() * 0.01) o.frequency.setValueAtTime(250 + Math.random() * 1700, t + k);
    chain(o, filt('bandpass', 1600, 1.4, t), env(t, 0.003, v * 0.55, dur));
    chain(src(noiseBuf, t, dur), filt('highpass', 3500, 0.7, t), env(t, 0.002, v * 0.35, dur * 0.8));
  }
  function thunder(t, v) {
    chain(src(noiseBuf, t, 0.15), filt('highpass', 2200, 0.7, t), env(t, 0.002, v, 0.12));
    chain(src(noiseBuf, t + 0.05, 0.1), filt('highpass', 1800, 0.7, t), env(t + 0.05, 0.002, v * 0.6, 0.08));
    const lp = filt('lowpass', 900, 0.6, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 1.6);
    chain(src(noiseBuf, t, 1.8), lp, env(t + 0.01, 0.03, v * 0.95, 1.6));
    thump(t, v * 0.9, 90, 32, 1.1);
  }
  function explosion(t, v) {
    thump(t, v, 150, 34, 0.9);
    const lp = filt('lowpass', 3200, 0.7, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 1.0);
    chain(src(noiseBuf, t, 1.1), lp, env(t, 0.006, v * 0.9, 1.0));
    crack(t + 0.05, v * 0.5, 1.2, 900);
  }
  function flameRoar(t, v, dur) {
    const lp = filt('lowpass', 700, 0.8, t);
    lp.frequency.linearRampToValueAtTime(1400, t + dur * 0.4);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    chain(src(noiseBuf, t, dur), lp, env(t, dur * 0.3, v, dur * 0.7));
    crack(t, v * 0.7, dur, 1200);
  }
  // Phoenix cry: a bright screech that glides up and down.
  function birdCry(t, v) {
    const o = osc('sawtooth', 900, t, 0.75);
    o.frequency.exponentialRampToValueAtTime(1750, t + 0.14);
    o.frequency.exponentialRampToValueAtTime(1250, t + 0.42);
    o.frequency.exponentialRampToValueAtTime(1480, t + 0.6);
    const vib = osc('sine', 11, t, 0.75), vg = ctx.createGain(); vg.gain.value = 40;
    vib.connect(vg); vg.connect(o.frequency);
    chain(o, filt('bandpass', 2000, 3, t), filt('lowpass', 4200, 0.7, t), env(t, 0.04, v, 0.68));
  }
  function whistleDown(t, v, dur) {
    const o = osc('triangle', 1900, t, dur);
    o.frequency.exponentialRampToValueAtTime(240, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.5, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    g.connect(out); o.connect(g);
    const bp = filt('bandpass', 3200, 1.5, t); bp.frequency.exponentialRampToValueAtTime(400, t + dur);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(v * 0.6, t + dur); g2.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    g2.connect(out); chain(src(noiseBuf, t, dur + 0.1), bp, g2);
  }
  // Wolf howl: two slightly detuned voices gliding through vowel-like filters.
  function howl(t, v) {
    const dur = 1.25;
    const f = (o) => {
      o.frequency.setValueAtTime(320, t);
      o.frequency.exponentialRampToValueAtTime(560, t + 0.38);
      o.frequency.linearRampToValueAtTime(540, t + 0.7);
      o.frequency.exponentialRampToValueAtTime(400, t + 1.1);
      o.frequency.exponentialRampToValueAtTime(350, t + dur);
    };
    const o1 = osc('sawtooth', 320, t, dur), o2 = osc('triangle', 322, t, dur);
    f(o1); f(o2); o2.detune.value = 9;
    const vib = osc('sine', 5.5, t, dur), vg = ctx.createGain();
    vg.gain.setValueAtTime(2, t); vg.gain.linearRampToValueAtTime(12, t + dur);
    vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    o1.connect(mix); o2.connect(mix);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.18);
    g.gain.setValueAtTime(v, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    const f1 = filt('bandpass', 850, 4, t), f2 = filt('bandpass', 1500, 5, t), lp = filt('lowpass', 2400, 0.7, t);
    mix.connect(f1); mix.connect(f2); f1.connect(lp); f2.connect(lp); lp.connect(g);
    chain(src(noiseBuf, t, dur), filt('bandpass', 1300, 1.5, t), env(t, 0.2, v * 0.12, dur - 0.2));
  }
  function iceCrack(t, v) {
    for (let i = 0; i < 6; i++) {
      const tt = t + i * (0.018 + Math.random() * 0.045);
      chain(src(noiseBuf, tt, 0.03), filt('highpass', 3500 + Math.random() * 2500, 0.8, tt), env(tt, 0.001, v * (0.5 + Math.random() * 0.5), 0.025));
    }
    for (let i = 0; i < 3; i++) {
      const tt = t + 0.02 + i * 0.05;
      chain(osc('sine', 2300 + Math.random() * 2200, tt, 0.35), env(tt, 0.002, v * 0.18, 0.32));
    }
    thump(t, v * 0.5, 230, 90, 0.15);
  }
  function blip(t, v, f) { chain(osc('sine', f, t, 0.07), env(t, 0.002, v, 0.06)); }
  function riser(t, v, dur, f0, f1, type) {
    const o = osc(type || 'sawtooth', f0, t, dur);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    chain(o, filt('bandpass', f1 * 0.8, 1.2, t), env(t, dur * 0.8, v, dur * 0.25));
  }

  // ---------------------------------------------------------------
  // Loops for the specials that last a while. They're scheduled for the whole duration,
  // and stop() fades them out early if the special ends sooner or the battle is over.
  // ---------------------------------------------------------------
  function loop(t, dur, build) {
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(1, t + 0.18);
    bus.gain.setValueAtTime(1, t + Math.max(0.2, dur - 0.35));
    bus.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    bus.connect(out);
    const nodes = [];
    build(bus, nodes);
    const h = {
      stop() {
        if (h.done) return; h.done = true; live.delete(h);
        try {
          const now = ctx.currentTime;
          bus.gain.cancelScheduledValues(now);
          bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
          bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
          nodes.forEach((n) => { try { n.stop(now + 0.3); } catch (e) { /* already stopped */ } });
        } catch (e) { /* ignore */ }
      }
    };
    live.add(h);
    return h;
  }
  function lfo(t, dur, rate, depth, param, nodes) {
    const o = osc('sine', rate, t, dur), g = ctx.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(param); nodes.push(o);
  }
  function windLoop(t, dur, v, lo, hi) {
    return loop(t, dur, (bus, nodes) => {
      const n = src(noiseBuf, t, dur); nodes.push(n);
      const bp = filt('bandpass', (lo + hi) / 2, 5, t);
      lfo(t, dur, 0.7, (hi - lo) / 2, bp.frequency, nodes);
      const whistle = filt('bandpass', hi * 1.6, 12, t);
      lfo(t, dur, 0.45, hi * 0.3, whistle.frequency, nodes);
      const rum = filt('lowpass', 160, 0.7, t);
      const g1 = ctx.createGain(); g1.gain.value = v;
      const g2 = ctx.createGain(); g2.gain.value = v * 0.6;
      const g3 = ctx.createGain(); g3.gain.value = v * 0.9;
      let pan = null;
      if (ctx.createStereoPanner) { pan = ctx.createStereoPanner(); lfo(t, dur, 0.9, 0.7, pan.pan, nodes); pan.connect(bus); }
      const dst = pan || bus;
      n.connect(bp); bp.connect(g1); g1.connect(dst);
      n.connect(whistle); whistle.connect(g2); g2.connect(dst);
      n.connect(rum); rum.connect(g3); g3.connect(bus);
    });
  }
  function waterLoop(t, dur, v) {
    return loop(t, dur, (bus, nodes) => {
      const n = src(noiseBuf, t, dur); nodes.push(n);
      const lp = filt('lowpass', 650, 0.9, t);
      const trem = ctx.createGain(); trem.gain.value = v * 0.7;
      lfo(t, dur, 3.5, v * 0.35, trem.gain, nodes);
      n.connect(lp); lp.connect(trem); trem.connect(bus);
      // bubbles: short rising "bloop" sounds
      for (let k = 0.1; k < dur - 0.1; k += 0.06 + Math.random() * 0.12) {
        const tt = t + k, f0 = 250 + Math.random() * 350;
        const o = osc('sine', f0, tt, 0.08); nodes.push(o);
        o.frequency.exponentialRampToValueAtTime(f0 * 2.6, tt + 0.07);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(v * (0.15 + Math.random() * 0.2), tt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.075);
        o.connect(g); g.connect(bus);
      }
    });
  }
  function droneLoop(t, dur, v, f, cutoff) {
    return loop(t, dur, (bus, nodes) => {
      const a = osc('sawtooth', f, t, dur), b = osc('sawtooth', f * 1.06, t, dur); nodes.push(a, b);
      const lp = filt('lowpass', cutoff, 5, t);
      lfo(t, dur, 0.6, cutoff * 0.45, lp.frequency, nodes);
      const g = ctx.createGain(); g.gain.value = v;
      a.connect(lp); b.connect(lp); lp.connect(g); g.connect(bus);
      const sub = osc('sine', f / 2, t, dur); nodes.push(sub);
      const sg = ctx.createGain(); sg.gain.value = v * 0.8; sub.connect(sg); sg.connect(bus);
    });
  }

  // ---------------------------------------------------------------
  // The sound of each move
  // ---------------------------------------------------------------
  const BASE = {
    dragoon: (t) => whoosh(t, 0.7, 500, 2400, 700, 0.62),
    dranzer: (t) => { whoosh(t, 0.5, 300, 1400, 450, 0.66); crack(t, 0.45, 0.65, 1500); },
    blackdranzer: (t) => { whoosh(t, 0.6, 180, 900, 260, 0.42); thump(t, 0.45, 95, 40, 0.35);
      chain(osc('sawtooth', 55, t, 0.35), filt('lowpass', 380, 3, t), env(t, 0.02, 0.25, 0.32)); },
    driger: (t) => { whoosh(t, 0.45, 600, 2600, 900, 0.45); zap(t, 0.5, 0.24); },
    pounce2: (t) => { whoosh(t, 0.45, 700, 3000, 1000, 0.4); zap(t, 0.5, 0.2); },
    draciel: (t) => { bell(t, 0.35, 520, 0.7); thump(t, 0.35, 170, 90, 0.2); },
    wolborg: (t) => { howl(t, 0.55); chain(src(noiseBuf, t, 0.5), filt('highpass', 4000, 0.7, t), env(t, 0.1, 0.12, 0.4)); },
    zeusMirror: (t) => { bell(t, 0.22, 1046, 0.6); bell(t + 0.04, 0.18, 1318, 0.6); },
    zeusRelease: (t) => { whoosh(t, 0.55, 400, 2200, 600, 0.35); zap(t, 0.35, 0.15); }
  };
  const SPECIAL = {
    tornado: (t) => { whoosh(t, 0.8, 200, 1600, 500, 0.7); thump(t, 0.4, 80, 40, 0.6); return windLoop(t + 0.15, 2.3, 0.55, 450, 1500); },
    dive: (t) => { flameRoar(t, 0.7, 0.9); birdCry(t + 0.05, 0.45); return null; },
    eclipse: (t) => { riser(t, 0.35, 0.5, 900, 110, 'sawtooth'); thump(t, 0.5, 70, 30, 0.8); return droneLoop(t + 0.1, 2.4, 0.12, 55, 380); },
    claw: (t) => { riser(t, 0.35, 0.45, 220, 1400); zap(t + 0.35, 0.5, 0.18); return null; },
    maelstrom: (t) => { whoosh(t, 0.5, 200, 900, 250, 0.6); return waterLoop(t + 0.1, 2.6, 0.55); },
    blizzard: (t) => { iceCrack(t, 0.5); return windLoop(t + 0.1, 2.8, 0.45, 900, 2400); },
    dimension: (t) => {
      const lp = filt('lowpass', 200, 1, t); lp.frequency.exponentialRampToValueAtTime(3000, t + 0.55);
      chain(src(noiseBuf, t, 0.6), lp, env(t, 0.5, 0.5, 0.08));
      thump(t + 0.55, 0.7, 110, 30, 0.9);
      return droneLoop(t + 0.5, 2.4, 0.11, 46, 300);
    }
  };
  const EVENTS = {
    diveLock: (t) => whistleDown(t, 0.6, 0.62),
    diveHit: (t) => explosion(t, 1),
    diveMiss: (t) => { thump(t, 0.6, 120, 50, 0.35); chain(src(noiseBuf, t, 0.4), filt('lowpass', 900, 0.7, t), env(t, 0.005, 0.35, 0.35)); },
    bolt: (t, e) => thunder(t, e.hit ? 0.8 : 0.6),
    parry: (t) => { bell(t, 0.5, 880, 0.9); bell(t, 0.35, 1320, 0.8); whoosh(t, 0.3, 800, 3000, 1200, 0.25); },
    block: (t) => { thump(t, 0.45, 160, 70, 0.22); chain(src(noiseBuf, t, 0.12), filt('lowpass', 700, 0.7, t), env(t, 0.003, 0.25, 0.1)); },
    freeze: (t) => { iceCrack(t, 0.9); iceCrack(t + 0.08, 0.6); },
    howlHit: (t) => iceCrack(t, 0.45),
    absorb: (t) => { bell(t, 0.3, 1046, 0.7); bell(t + 0.05, 0.25, 1568, 0.7); },
    release: (t) => { thump(t, 0.6, 140, 45, 0.4); zap(t, 0.45, 0.2); bell(t, 0.2, 784, 0.5); },
    reflect: (t) => { bell(t, 0.25, 700, 0.35); },
    fling: (t) => { whoosh(t, 0.8, 300, 2600, 500, 0.6); thump(t, 0.4, 110, 45, 0.3); },
    gust: (t) => whoosh(t, 0.45, 400, 1600, 500, 0.3),
    drain: (t) => { const o = osc('sine', 320, t, 0.22); o.frequency.exponentialRampToValueAtTime(110, t + 0.2); chain(o, env(t, 0.01, 0.2, 0.2)); },
    clawMiss: (t) => whoosh(t, 0.35, 150, 500, 120, 0.4),
    clawTick: (t) => blip(t, 0.28, 1760),
    claw: (t, e) => {
      if (e.q === 'perfect') { zap(t, 0.65, 0.22); whoosh(t, 0.5, 900, 3600, 1400, 0.22); bell(t, 0.22, 1568, 0.4); }
      else if (e.q === 'good') { zap(t, 0.45, 0.16); whoosh(t, 0.35, 700, 2600, 1000, 0.2); }
      else { chain(osc('square', 110, t, 0.18), filt('lowpass', 600, 1, t), env(t, 0.005, 0.18, 0.16)); }
    }
  };
  const RATE = { drain: 0.25, gust: 0.1, reflect: 0.12, block: 0.08, howlHit: 0.1 };

  const SFX = {
    bind,                                  // used to record a preview offline
    // Sound for a game event (see emit() in game.js).
    event(type, e) {
      if (!ensure()) return;
      const fn = EVENTS[type];
      if (!fn) return;
      const now = ctx.currentTime;
      if (RATE[type] && lastAt[type] != null && now - lastAt[type] < RATE[type]) return;
      lastAt[type] = now;
      try { fn(now + 0.005, e || {}); } catch (err) { /* a sound failing should never break the game */ }
    },
    // Base move sound for a bey id (plus 'pounce2', 'zeusMirror' and 'zeusRelease').
    base(key) {
      if (!ensure() || !BASE[key]) return;
      try { BASE[key](ctx.currentTime + 0.005); } catch (err) { /* ignore */ }
    },
    // Starts a special's sound. Returns something with .stop() for looping ones, or null.
    special(kind) {
      if (!ensure() || !SPECIAL[kind]) return null;
      try { return SPECIAL[kind](ctx.currentTime + 0.005); } catch (err) { return null; }
    },
    stopAll() { for (const h of Array.from(live)) h.stop(); },
    // For recording a preview offline
    _play(group, key, t, e) { const g = { base: BASE, special: SPECIAL, event: EVENTS }[group]; return g[key](t, e || {}); }
  };
  window.SFX = SFX;
})();
