/* =====================================================================
   DARK SCHOOL — game.js
   A complete 3D third-person horror game for the browser (Three.js).
   Sections:
    0  Utilities / storage / settings / i18n helpers
    1  Audio engine (100% procedural WebAudio)
    2  Renderer, quality manager, procedural textures & materials
    3  Collision world, spatial hash, line-of-sight, navigation grid (A*)
    4  School level builder (walls, doors, rooms, furniture, props)
    5  Characters: rigged students / professor + AnimationMixer clips
    6  Player controller + third-person camera
    7  Professor AI (patrol / investigate / chase / search / return)
    8  Game logic: items, puzzles, quests, scares, hiding, endings
    9  UI: HUD, menus, modals, journal/map, touch controls
   10  Main loop and boot
   ===================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANGS, EXTRA_LANGS, LEGEND_STRINGS, dirOf } from './i18n.js';

/* =====================================================================
   0. UTILITIES
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const angleDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const fmtTime = (s) => { s = Math.floor(s); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches;

const Store = {
  get(k, def) { try { const v = localStorage.getItem('darkschool.' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem('darkschool.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem('darkschool.' + k); } catch (e) { /* ignore */ } },
};

/* ---------- settings ---------- */
const QUALITY = {
  low:    { pr: 0.85, shadow: 0,    lights: 2, fog: 0.085, far: 38, lambert: true,  tex: 128, aa: false },
  medium: { pr: 1.0,  shadow: 512,  lights: 3, fog: 0.07,  far: 48, lambert: false, tex: 256, aa: true },
  high:   { pr: 1.5,  shadow: 1024, lights: 4, fog: 0.06,  far: 58, lambert: false, tex: 256, aa: true },
  ultra:  { pr: 2.0,  shadow: 2048, lights: 4, fog: 0.05,  far: 66, lambert: false, tex: 512, aa: true },
};
function defaultSettings() {
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  let q = 'medium';
  if (IS_TOUCH || mem <= 2 || cores <= 2) q = 'low'; else if (cores >= 8 && mem >= 8) q = 'high';
  return {
    lang: 'en',
    quality: q, shadow: 'auto', res: 100, fov: 72, autoQ: true, grain: !IS_TOUCH, fps: false,
    master: 80, music: 65, sfx: 90, voice: true,
    diff: 'normal', sens: 100, invert: false, subs: true, touch: IS_TOUCH, safe: false, pad: true,
  };
}
const S = Object.assign(defaultSettings(), Store.get('settings', {}));
if (!QUALITY[S.quality]) S.quality = 'medium';
const saveSettings = () => Store.set('settings', S);
const BOOT_Q = QUALITY[S.quality];      // texture size / material type are fixed at boot (reload to change)

const DIFF = {
  easy:   { speed: 0.88, vision: 0.8,  hear: 0.8,  dmg: 34, battery: 0.75, regen: 1.4 },
  normal: { speed: 1.0,  vision: 1.0,  hear: 1.0,  dmg: 50, battery: 1.0,  regen: 1.0 },
  hard:   { speed: 1.1,  vision: 1.2,  hear: 1.25, dmg: 70, battery: 1.3,  regen: 0.7 },
  legend: { speed: 1.2,  vision: 1.42, hear: 1.45, dmg: 90, battery: 1.55, regen: 0.45 },
};

/* ---------- i18n ---------- */
const LANG_CODES = LANGS.map((l) => l.code);
let LANG = LANG_CODES.includes(S.lang) ? S.lang : 'en';
let STR = {};   // filled in the dictionary section at the bottom of this file
function t(key, vars) {
  let s = (STR[LANG] && STR[LANG][key]);
  if (s === undefined) s = STR.en && STR.en[key];
  if (s === undefined) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}
function applyStaticI18n() {
  const root = document.documentElement;
  root.lang = LANG; root.dir = dirOf(LANG);
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  const li = LANGS.find((l) => l.code === LANG) || LANGS[0];
  $$('.lang-current-label').forEach((e) => { e.textContent = li.flag + ' ' + li.native; });
  if ($('#btn-lang')) $('#btn-lang').textContent = li.flag + ' ' + li.native;
  if ($('#set-lang')) $('#set-lang').textContent = li.flag + ' ' + li.native;
  $$('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === LANG));
}

/* =====================================================================
   1. AUDIO ENGINE — procedural WebAudio (no external files needed)
   ===================================================================== */
class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.vol = { master: 0.8, music: 0.65, sfx: 0.9 }; this.tension = 0; this._hb = 0; this._amb = 4; this._lull = 0; this._lullI = 0; this.lullabyOn = 0; this.zone = 'school'; this.alarmNodes = null; this.staticNodes = null; }

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -16; this.comp.ratio.value = 6;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.musicBus = c.createGain(); this.sfxBus = c.createGain(); this.ambBus = c.createGain();
    this.musicBus.connect(this.master); this.sfxBus.connect(this.master); this.ambBus.connect(this.master);
    const len = c.sampleRate * 2;
    this.white = c.createBuffer(1, len, c.sampleRate);
    const d = this.white.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // shaper curve for distortion
    this.curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; this.curve[i] = Math.tanh(x * 4); }
    this.setVolumes(S);
    this._startAmbient(); this._startChaseLayer();
    this.ready = true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  setVolumes(s) {
    this.vol = { master: s.master / 100, music: s.music / 100, sfx: s.sfx / 100 };
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, now, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music, now, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.music, now, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, now, 0.05);
  }

  /* ---- continuous layers ---- */
  _startAmbient() {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.16;
    const mk = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.connect(g); o.start(); return o; };
    mk('sine', 48); mk('sine', 48.8); mk('triangle', 72.4);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 0.07; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    g.connect(this.ambBus);
    const n = c.createBufferSource(); n.buffer = this.brown; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.9;
    const wg = c.createGain(); wg.gain.value = 0.22;
    n.connect(bp); bp.connect(wg); wg.connect(this.ambBus); n.start();
    const l2 = c.createOscillator(); l2.frequency.value = 0.11; const l2g = c.createGain(); l2g.gain.value = 190; l2.connect(l2g); l2g.connect(bp.frequency); l2.start();
    this.windGain = wg; this.droneGain = g;
  }
  _startChaseLayer() {
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0; out.connect(this.musicBus);
    const pulse = c.createGain(); pulse.gain.value = 0.5; pulse.connect(out);
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 2.4; const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(pulse.gain); lfo.start();
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.connect(pulse);
    const mk = (type, fr, v = 1) => { const o = c.createOscillator(); o.type = type; o.frequency.value = fr; const gg = c.createGain(); gg.gain.value = v; o.connect(gg); gg.connect(f); o.start(); };
    mk('sawtooth', 110, 0.6); mk('sawtooth', 116.5, 0.6); mk('square', 55, 0.9); mk('sawtooth', 155.6, 0.3);
    const sh = c.createOscillator(); sh.type = 'sine'; sh.frequency.value = 1480; const v = c.createOscillator(); v.frequency.value = 5.5; const vg = c.createGain(); vg.gain.value = 40; v.connect(vg); vg.connect(sh.frequency); v.start();
    const shg = c.createGain(); shg.gain.value = 0.05; sh.connect(shg); shg.connect(out); sh.start();
    this.chaseOut = out;
  }

  /* ---- helpers ---- */
  _dest(pos, ref = 3) {
    if (!pos) return this.sfxBus;
    const p = this.ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = 1.5; p.maxDistance = 80;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.sfxBus); return p;
  }
  setListener(pos, fwd) {
    if (!this.ready) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = 0; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, 0, fwd.z, 0, 1, 0); }
  }
  blip(o) {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.3), t0 + (o.a || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node = osc;
    if (o.filter) { const f = c.createBiquadFilter(); f.type = o.filter.type; f.frequency.value = o.filter.f; f.Q.value = o.filter.q || 1; osc.connect(f); node = f; }
    node.connect(g); g.connect(this._dest(o.pos, o.ref));
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
    return osc;
  }
  noise(o) {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource(); src.buffer = o.brown ? this.brown : this.white;
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f || 800, t0); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur); f.Q.value = o.q || 1;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.3), t0 + (o.a || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(this._dest(o.pos, o.ref));
    src.start(t0, Math.random() * 1.2); src.stop(t0 + o.dur + 0.05);
  }

  /* ---- sound effects ---- */
  click() { this.blip({ type: 'square', f0: 1700, f1: 900, dur: 0.04, vol: 0.06 }); }
  pickup() { this.blip({ f0: 880, dur: 0.18, vol: 0.18 }); this.blip({ f0: 1320, dur: 0.3, vol: 0.14, delay: 0.09 }); }
  flash() { this.noise({ type: 'highpass', f: 3500, dur: 0.03, vol: 0.2 }); this.blip({ type: 'square', f0: 220, dur: 0.03, vol: 0.05 }); }
  step(kind, pos, vol = 1) {
    const run = kind === 'run', heavy = kind === 'heavy', cr = kind === 'crouch';
    const v = (heavy ? 0.5 : run ? 0.24 : cr ? 0.05 : 0.14) * vol;
    this.noise({ type: 'bandpass', f: heavy ? 260 : 700 + Math.random() * 300, q: 0.9, dur: heavy ? 0.16 : 0.07, vol: v, pos, ref: heavy ? 6 : 2.5 });
    this.blip({ f0: heavy ? 70 : 110, f1: 45, dur: heavy ? 0.2 : 0.09, vol: v * 0.9, pos, ref: heavy ? 6 : 2.5 });
  }
  doorOpen(pos) { this.blip({ type: 'sawtooth', f0: 85, f1: 160, dur: 0.75, vol: 0.05, a: 0.1, pos, filter: { type: 'bandpass', f: 520, q: 9 } }); this.noise({ type: 'lowpass', f: 300, dur: 0.15, vol: 0.12, pos }); }
  doorClose(pos) { this.blip({ type: 'sawtooth', f0: 150, f1: 80, dur: 0.45, vol: 0.04, pos, filter: { type: 'bandpass', f: 600, q: 8 } }); this.noise({ type: 'lowpass', f: 400, dur: 0.12, vol: 0.4, delay: 0.4, pos }); this.blip({ f0: 90, f1: 40, dur: 0.2, vol: 0.4, delay: 0.4, pos }); }
  doorSlam(pos) { this.noise({ type: 'lowpass', f: 500, dur: 0.35, vol: 0.9, pos, ref: 8 }); this.blip({ f0: 80, f1: 30, dur: 0.5, vol: 0.9, pos, ref: 8 }); }
  locked(pos) { for (let i = 0; i < 3; i++) { this.noise({ type: 'bandpass', f: 1500, q: 4, dur: 0.05, vol: 0.2, delay: i * 0.09, pos }); this.blip({ type: 'square', f0: 140, dur: 0.04, vol: 0.06, delay: i * 0.09, pos }); } }
  unlock(pos) { this.blip({ type: 'square', f0: 600, dur: 0.05, vol: 0.08, pos }); this.blip({ type: 'square', f0: 900, dur: 0.07, vol: 0.08, delay: 0.1, pos }); this.noise({ type: 'bandpass', f: 2500, dur: 0.1, vol: 0.12, delay: 0.1, pos }); }
  bang(pos) { this.noise({ type: 'lowpass', f: 700, dur: 0.4, vol: 0.9, pos, ref: 8 }); this.blip({ f0: 120, f1: 35, dur: 0.6, vol: 0.9, pos, ref: 8 }); }
  glass(pos) { for (let i = 0; i < 8; i++) this.noise({ type: 'highpass', f: 3000 + Math.random() * 3000, dur: 0.08, vol: 0.25, delay: i * 0.05 + Math.random() * 0.03, pos, ref: 6 }); }
  drip(pos) { const f = 900 + Math.random() * 600; this.blip({ f0: f, f1: f * 0.55, dur: 0.12, vol: 0.12, pos, ref: 2 }); this.blip({ f0: f * 1.5, f1: f * 0.8, dur: 0.1, vol: 0.05, delay: 0.14, pos, ref: 2 }); }
  creak(pos) { this.blip({ type: 'sawtooth', f0: 70 + Math.random() * 40, f1: 110 + Math.random() * 60, dur: 1.2, vol: 0.04, a: 0.3, pos, filter: { type: 'bandpass', f: 400 + Math.random() * 300, q: 12 } }); }
  hurt() { this.blip({ type: 'sawtooth', f0: 220, f1: 70, dur: 0.4, vol: 0.3, filter: { type: 'lowpass', f: 900 } }); this.noise({ type: 'lowpass', f: 600, dur: 0.3, vol: 0.5 }); this.blip({ f0: 60, f1: 30, dur: 0.5, vol: 0.7 }); }
  growl(pos) {
    if (!this.ready) return; const c = this.ctx, t0 = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(62, t0); o.frequency.linearRampToValueAtTime(48, t0 + 1.4);
    const lfo = c.createOscillator(); lfo.frequency.value = 26; const lg = c.createGain(); lg.gain.value = 14; lfo.connect(lg); lg.connect(o.frequency);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(380, t0); f.frequency.linearRampToValueAtTime(220, t0 + 1.4); f.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
    o.connect(f); f.connect(g); g.connect(this._dest(pos, 6)); o.start(t0); lfo.start(t0); o.stop(t0 + 1.6); lfo.stop(t0 + 1.6);
  }
  shriek(pos) {
    if (!this.ready) return; const c = this.ctx, t0 = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(500, t0); o.frequency.exponentialRampToValueAtTime(1700, t0 + 0.35); o.frequency.exponentialRampToValueAtTime(700, t0 + 0.9);
    const sh = c.createWaveShaper(); sh.curve = this.curve;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1);
    o.connect(sh); sh.connect(f); f.connect(g); g.connect(this._dest(pos, 8)); o.start(t0); o.stop(t0 + 1.05);
  }
  stinger(power = 1) {
    [220, 233.1, 349.2, 370, 554.4].forEach((f, i) => this.blip({ type: 'sawtooth', f0: f * (1 + Math.random() * 0.01), f1: f * 0.92, dur: 1.4, vol: 0.09 * power, a: 0.02, filter: { type: 'lowpass', f: 1800 } , delay: i * 0.004 }));
    this.noise({ type: 'bandpass', f: 1200, q: 0.6, dur: 0.7, vol: 0.5 * power });
    this.blip({ f0: 70, f1: 30, dur: 1.2, vol: 0.8 * power });
  }
  whisper(pos) {
    for (let i = 0; i < 5; i++) this.noise({ type: 'bandpass', f: 2200 + Math.random() * 1800, f1: 1800 + Math.random() * 1500, q: 3, dur: 0.2 + Math.random() * 0.2, vol: 0.08 + Math.random() * 0.06, delay: i * (0.22 + Math.random() * 0.18), a: 0.06, pos, ref: 2 });
  }
  staticBurst(dur = 1.5) { this.noise({ type: 'highpass', f: 1500, dur, vol: 0.18, a: 0.05 }); this.blip({ type: 'square', f0: 120, f1: 90, dur, vol: 0.02 }); }
  breath(pos) { this.noise({ type: 'bandpass', f: 600, q: 0.7, dur: 0.9, vol: 0.12, a: 0.3, pos, ref: 2, brown: true }); }
  startAlarm() {
    if (!this.ready || this.alarmNodes) return; const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 700; const l = c.createOscillator(); l.type = 'triangle'; l.frequency.value = 1.1; const lg = c.createGain(); lg.gain.value = 220; l.connect(lg); lg.connect(o.frequency);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; const g = c.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.09, c.currentTime, 0.2);
    o.connect(f); f.connect(g); g.connect(this.sfxBus); o.start(); l.start(); this.alarmNodes = { o, l, g };
  }
  stopAlarm() { if (!this.alarmNodes) return; const { o, l, g } = this.alarmNodes; g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2); setTimeout(() => { try { o.stop(); l.stop(); } catch (e) { /* ignore */ } }, 900); this.alarmNodes = null; }
  thunder() {
    this.noise({ type: 'lowpass', f: 340, f1: 55, dur: 3.4, vol: 0.6, a: 0.02, brown: true }); this.noise({ type: 'highpass', f: 1400, f1: 400, dur: 0.5, vol: 0.12, a: 0.005 });
    this.blip({ f0: 52, f1: 24, dur: 2.8, vol: 0.5, a: 0.03 }); for (let i = 0; i < 3; i++) this.blip({ f0: 70 + rand(0, 30), f1: 30, dur: 1.6, vol: 0.18, delay: 0.25 + i * 0.4 });
  }
  explosion() { this.noise({ type: 'lowpass', f: 900, f1: 80, dur: 2.5, vol: 1, brown: true }); this.blip({ f0: 90, f1: 20, dur: 2, vol: 1 }); }

  /* ---- per-frame: heartbeat, random ambience, music box ---- */
  update(dt, st) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const tension = clamp(st.tension, 0, 1);
    this.tension = damp(this.tension, tension, 3, dt);
    this.chaseOut.gain.setTargetAtTime(st.chase ? 0.2 : this.tension * 0.07, now, 0.35);
    this.droneGain.gain.setTargetAtTime(0.13 + this.tension * 0.12, now, 0.5);
    // heartbeat
    this._hb -= dt;
    if (this.tension > 0.1 && st.playing) {
      if (this._hb <= 0) {
        const bpm = 62 + this.tension * 100; this._hb = 60 / bpm;
        const v = 0.1 + this.tension * 0.55;
        this.blip({ f0: 62, f1: 38, dur: 0.14, vol: v }); this.blip({ f0: 55, f1: 35, dur: 0.14, vol: v * 0.65, delay: 0.17 });
      }
    }
    // random ambience
    this._amb -= dt;
    if (this._amb <= 0 && st.playing) {
      this._amb = rand(5, 14);
      const p = st.pos; const around = () => ({ x: p.x + rand(-14, 14), y: p.y + 1.2, z: p.z + rand(-14, 14) });
      const r = Math.random();
      if (st.zone === 'basement' && r < 0.5) { this.drip(around()); }
      else if (r < 0.35) this.creak(around());
      else if (r < 0.55) this.noise({ type: 'bandpass', f: 300, q: 2, dur: 1.4, vol: 0.12, a: 0.4, pos: around(), brown: true });
      else if (r < 0.75) this.drip(around());
      else if (r < 0.9) this.blip({ type: 'sine', f0: 90, f1: 60, dur: 0.5, vol: 0.2, pos: around(), ref: 5 });
      else if (r < 0.98) this.whisper(around());
    }
    // music box lullaby (secret rooms)
    if (this.lullabyOn > 0.01) {
      this._lull -= dt;
      if (this._lull <= 0) {
        const mel = [659.25, 783.99, 880, 783.99, 659.25, 587.33, 523.25, 587.33, 659.25, 659.25, 587.33, 523.25, 440, 523.25, 587.33, 0];
        const f = mel[this._lullI++ % mel.length]; this._lull = 0.5;
        if (f) { this.blip({ f0: f, dur: 1.6, vol: 0.12 * this.lullabyOn, a: 0.004 }); this.blip({ f0: f * 2.01, dur: 0.8, vol: 0.04 * this.lullabyOn, a: 0.004 }); }
      }
    }
    this.windGain.gain.setTargetAtTime(st.zone === 'basement' ? 0.08 : 0.2, now, 1);
  }
  stopLoops() { this.stopAlarm(); this.lullabyOn = 0; if (this.chaseOut) this.chaseOut.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); }
}
const audio = new AudioEngine();

/* ---- optional creepy speech (browser speechSynthesis; skipped when no matching voice) ---- */
function speak(text) {
  if (!S.voice || !('speechSynthesis' in window)) return;
  try {
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(LANG));
    if (!v) return;
    const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = v.lang; u.pitch = 0.1; u.rate = 0.72; u.volume = clamp(S.master / 100 * S.sfx / 100, 0, 1);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

/* =====================================================================
   2. RENDERER, QUALITY MANAGER, PROCEDURAL TEXTURES & MATERIALS
   ===================================================================== */
const canvasEl = $('#gl');
let renderer = null, scene = null, camera = null;
let flashlight = null, flashTarget = null, hemi = null, monsterLight = null;
const poolLights = [];
let dynScale = 1;                         // dynamic-resolution multiplier (auto quality)
let reloadNeeded = false;

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: BOOT_Q.aa, powerPreference: 'high-performance', stencil: false, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);
  scene.fog = new THREE.FogExp2(0x03040a, BOOT_Q.fog);
  camera = new THREE.PerspectiveCamera(S.fov, 1, 0.08, BOOT_Q.far);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
}
function resize() {
  if (!renderer) return;
  const q = QUALITY[S.quality];
  const pr = Math.max(0.4, Math.min(window.devicePixelRatio || 1, q.pr) * (S.res / 100) * dynScale);
  renderer.setPixelRatio(pr);
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const portrait = h > w * 1.05;
  $('#rotate-warning').classList.toggle('hidden', !(IS_TOUCH && portrait));
}
function applyQuality() {
  if (!renderer) return;
  const q = QUALITY[S.quality];
  scene.fog.density = q.fog; camera.far = q.far; camera.fov = S.fov; camera.updateProjectionMatrix();
  resize();
  const size = S.shadow === 'auto' ? q.shadow : +S.shadow;
  if (flashlight) {
    const on = size > 0;
    if (flashlight.castShadow !== on) flashlight.castShadow = on;
    if (on && flashlight.shadow.mapSize.x !== size) {
      flashlight.shadow.mapSize.set(size, size);
      if (flashlight.shadow.map) { flashlight.shadow.map.dispose(); flashlight.shadow.map = null; }
    }
  }
  $('#fx-grain').style.display = S.grain && S.quality !== 'low' ? 'block' : 'none';
  reloadNeeded = (QUALITY[S.quality].lambert !== BOOT_Q.lambert) || (QUALITY[S.quality].tex !== BOOT_Q.tex);
  const rh = $('#reload-hint'); if (rh) rh.style.opacity = reloadNeeded ? '1' : '0.45';
}
function setupLights() {
  hemi = new THREE.HemisphereLight(0x55648a, 0x221a14, 1.25);
  scene.add(hemi);
  flashlight = new THREE.SpotLight(0xfff0d0, 0, 30, 0.46, 0.55, 1.6);
  flashlight.shadow.camera.near = 0.3; flashlight.shadow.camera.far = 30;
  flashlight.shadow.bias = -0.0004; flashlight.shadow.normalBias = 0.03;
  flashTarget = new THREE.Object3D();
  scene.add(flashlight); scene.add(flashTarget); flashlight.target = flashTarget;
  for (let i = 0; i < BOOT_Q.lights; i++) {
    const l = new THREE.PointLight(0xffe2b0, 0, 11, 1.7);
    l.userData.cur = 0; l.userData.tgt = 0; l.userData.fix = null;
    scene.add(l); poolLights.push(l);
  }
  monsterLight = new THREE.PointLight(0xff3a22, 0, 8, 1.8);
  scene.add(monsterLight);
}

/* ---------- procedural canvas textures ---------- */
const T = {};
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); draw(x, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.userData = { canvas: c, ctx: x };
  return tex;
}
const speckle = (x, w, h, n, a0, a1, rgb, s = 1) => { for (let i = 0; i < n; i++) { x.fillStyle = `rgba(${rgb},${rand(a0, a1)})`; x.fillRect(Math.random() * w, Math.random() * h, s, s); } };
const blotches = (x, w, h, n, rgb, a, rmin, rmax) => {
  for (let i = 0; i < n; i++) {
    const px = Math.random() * w, py = Math.random() * h, r = rand(rmin, rmax);
    const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
};
const streaks = (x, w, h, n, rgb, a) => { for (let i = 0; i < n; i++) { const px = Math.random() * w, len = rand(h * 0.2, h * 0.9); const g = x.createLinearGradient(0, 0, 0, len); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = g; x.fillRect(px, 0, rand(1, 4), len); } };
const cracks = (x, w, h, n) => { x.strokeStyle = 'rgba(20,18,14,0.55)'; x.lineWidth = 1; for (let i = 0; i < n; i++) { let px = Math.random() * w, py = Math.random() * h * 0.6; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 7; k++) { px += rand(-10, 10); py += rand(4, 16); x.lineTo(px, py); } x.stroke(); } };

function buildTextures() {
  const Z = BOOT_Q.tex;
  T.wall = canvasTex(Z, Z, (x, w, h) => {
    x.fillStyle = '#8f9684'; x.fillRect(0, 0, w, h);
    blotches(x, w, h, 26, '70,66,52', 0.12, w * 0.08, w * 0.3);
    x.fillStyle = '#34514a'; x.fillRect(0, h * 0.62, w, h * 0.38);
    blotches(x, w, h, 14, '10,20,18', 0.18, w * 0.06, w * 0.2);
    x.fillStyle = '#1b2a26'; x.fillRect(0, h * 0.62 - 3, w, 6); x.fillStyle = 'rgba(255,255,255,0.1)'; x.fillRect(0, h * 0.62 - 6, w, 2);
    streaks(x, w, h * 0.7, 14, '40,32,20', 0.16); cracks(x, w, h, 2); speckle(x, w, h, Z * 6, 0.03, 0.12, '0,0,0', 1.5);
  });
  T.wallBase = canvasTex(Z, Z, (x, w, h) => {
    x.fillStyle = '#595c5c'; x.fillRect(0, 0, w, h);
    blotches(x, w, h, 40, '30,30,30', 0.2, w * 0.05, w * 0.25); blotches(x, w, h, 10, '120,60,25', 0.16, w * 0.05, w * 0.2);
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 2; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(0, h * i / 4); x.lineTo(w, h * i / 4); x.stroke(); }
    streaks(x, w, h, 14, '90,45,20', 0.22); cracks(x, w, h, 3); speckle(x, w, h, Z * 8, 0.05, 0.2, '0,0,0', 2);
  });
  T.wallWood = canvasTex(Z, Z, (x, w, h) => {
    x.fillStyle = '#4a3322'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { x.fillStyle = `rgba(${i % 2 ? '0,0,0' : '255,220,170'},0.07)`; x.fillRect(i * w / 8, 0, w / 8, h); x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(i * w / 8, 0, 2, h); }
    streaks(x, w, h, 40, '20,10,5', 0.3); speckle(x, w, h, Z * 4, 0.05, 0.2, '0,0,0', 1);
  });
  T.floorTile = canvasTex(Z, Z, (x, w, h) => {
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? '#a7aa98' : '#7d8379'; x.fillRect(i * s, j * s, s, s); }
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2; for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, h); x.stroke(); x.beginPath(); x.moveTo(0, i * s); x.lineTo(w, i * s); x.stroke(); }
    blotches(x, w, h, 22, '30,25,15', 0.18, w * 0.05, w * 0.22); speckle(x, w, h, Z * 8, 0.04, 0.16, '0,0,0', 1.5);
  });
  T.floorTile2 = canvasTex(Z, Z, (x, w, h) => {
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? '#3a4a4d' : '#2a3538'; x.fillRect(i * s, j * s, s, s); }
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 2; for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, h); x.stroke(); x.beginPath(); x.moveTo(0, i * s); x.lineTo(w, i * s); x.stroke(); }
    blotches(x, w, h, 16, '90,10,10', 0.12, w * 0.04, w * 0.14); speckle(x, w, h, Z * 6, 0.04, 0.16, '0,0,0', 1.5);
  });
  T.floorWood = canvasTex(Z, Z, (x, w, h) => {
    const n = 6, s = h / n;
    for (let j = 0; j < n; j++) { x.fillStyle = `hsl(25,${38 + (j % 3) * 4}%,${18 + (j * 7 % 9)}%)`; x.fillRect(0, j * s, w, s); x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, j * s, w, 2); const off = (j * 37) % w; x.fillRect(off, j * s, 2, s); }
    streaks(x, w, h, 30, '0,0,0', 0.25); blotches(x, w, h, 12, '0,0,0', 0.2, w * 0.05, w * 0.2); speckle(x, w, h, Z * 4, 0.05, 0.2, '0,0,0', 1);
  });
  T.floorConc = canvasTex(Z, Z, (x, w, h) => {
    x.fillStyle = '#4a4c4d'; x.fillRect(0, 0, w, h); blotches(x, w, h, 40, '20,20,20', 0.2, w * 0.05, w * 0.3); blotches(x, w, h, 12, '25,45,60', 0.2, w * 0.05, w * 0.2);
    x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h); cracks(x, w, h, 3); speckle(x, w, h, Z * 10, 0.05, 0.22, '0,0,0', 2);
  });
  T.ceil = canvasTex(Z, Z, (x, w, h) => {
    x.fillStyle = '#7d7f76'; x.fillRect(0, 0, w, h); const s = w / 2;
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 3; x.strokeRect(0, 0, s, s); x.strokeRect(s, 0, s, s); x.strokeRect(0, s, s, s); x.strokeRect(s, s, s, s);
    speckle(x, w, h, Z * 12, 0.1, 0.4, '30,30,30', 2); blotches(x, w, h, 10, '70,50,20', 0.22, w * 0.05, w * 0.2);
  });
  T.wood = canvasTex(Z / 2, Z / 2, (x, w, h) => {
    x.fillStyle = '#7b5532'; x.fillRect(0, 0, w, h); streaks(x, w, h, 26, '40,20,5', 0.3); streaks(x, w, h, 14, '255,210,150', 0.1);
    speckle(x, w, h, 400, 0.05, 0.2, '0,0,0', 1);
  });
  T.woodDark = canvasTex(Z / 2, Z / 2, (x, w, h) => { x.fillStyle = '#3f2a1b'; x.fillRect(0, 0, w, h); streaks(x, w, h, 26, '0,0,0', 0.35); speckle(x, w, h, 300, 0.05, 0.2, '0,0,0', 1); });
  T.metal = canvasTex(Z / 2, Z / 2, (x, w, h) => {
    x.fillStyle = '#4f6672'; x.fillRect(0, 0, w, h); streaks(x, w, h, 20, '0,0,0', 0.2); blotches(x, w, h, 12, '110,60,20', 0.25, 6, 24);
    x.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 4; i++) x.fillRect(w * 0.2, h * (0.08 + i * 0.035), w * 0.6, h * 0.012);
    x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(w * 0.78, h * 0.5, w * 0.05, h * 0.1);
    speckle(x, w, h, 300, 0.05, 0.2, '0,0,0', 1);
  });
  T.rust = canvasTex(Z / 2, Z / 2, (x, w, h) => { x.fillStyle = '#5b3a2a'; x.fillRect(0, 0, w, h); blotches(x, w, h, 40, '30,15,5', 0.4, 5, 30); blotches(x, w, h, 30, '150,80,30', 0.3, 5, 25); streaks(x, w, h, 20, '20,10,0', 0.3); });
  T.door = canvasTex(Z / 2, Z / 2, (x, w, h) => {
    x.fillStyle = '#5d4026'; x.fillRect(0, 0, w, h); streaks(x, w, h, 20, '0,0,0', 0.25);
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 3; x.strokeRect(w * 0.12, h * 0.08, w * 0.76, h * 0.38); x.strokeRect(w * 0.12, h * 0.54, w * 0.76, h * 0.38);
    speckle(x, w, h, 300, 0.05, 0.2, '0,0,0', 1);
  });
  T.books = canvasTex(Z, Z, (x, w, h) => {
    x.fillStyle = '#2b1d12'; x.fillRect(0, 0, w, h); const rows = 5, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let px = 3; while (px < w - 8) { const bw = rand(7, 16), bh = rh * rand(0.62, 0.92); x.fillStyle = `hsl(${(Math.random() * 360) | 0},${rand(20, 55)}%,${rand(14, 34)}%)`; x.fillRect(px, (r + 1) * rh - 5 - bh, bw, bh); x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(px, (r + 1) * rh - 5 - bh, 1.5, bh); px += bw + rand(0, 1.5); }
      x.fillStyle = '#1a1009'; x.fillRect(0, (r + 1) * rh - 5, w, 5);
    }
    blotches(x, w, h, 10, '0,0,0', 0.3, 20, 60);
  }, false);
  T.board = canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = '#1b2a24'; x.fillRect(0, 0, w, h); blotches(x, w, h, 30, '200,210,200', 0.05, 20, 80);
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2; x.font = '26px "Special Elite", monospace'; x.fillStyle = 'rgba(255,255,255,0.5)';
    x.fillText('x² + y² = r²', 30, 60); x.fillText('E = mc²', 30, 110); x.fillText('3 × 14 = ?', 300, 80); x.strokeRect(290, 130, 180, 90);
    x.beginPath(); x.moveTo(40, 190); x.lineTo(240, 150); x.stroke();
  }, false);
  T.paper = canvasTex(64, 64, (x, w, h) => { x.fillStyle = '#d8cfae'; x.fillRect(0, 0, w, h); speckle(x, w, h, 80, 0.05, 0.2, '60,40,10', 1); x.fillStyle = 'rgba(40,30,20,0.55)'; for (let i = 0; i < 6; i++) x.fillRect(6, 8 + i * 9, rand(30, 52), 2); }, false);
  T.clock = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#d9d3bd'; x.beginPath(); x.arc(64, 64, 62, 0, TAU); x.fill(); x.strokeStyle = '#2a1d10'; x.lineWidth = 6; x.stroke();
    x.fillStyle = '#222'; x.font = 'bold 14px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) { const a = i / 12 * TAU - Math.PI / 2; x.fillText(String(i), 64 + Math.cos(a) * 48, 64 + Math.sin(a) * 48); }
    const hand = (ang, len, wd) => { x.strokeStyle = '#111'; x.lineWidth = wd; x.lineCap = 'round'; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.sin(ang) * len, 64 - Math.cos(ang) * len); x.stroke(); };
    const hr = 3, mn = 47; hand((hr + mn / 60) / 12 * TAU, 30, 5); hand(mn / 60 * TAU, 45, 3);   // stopped at 3:47
    x.fillStyle = '#8a1010'; x.beginPath(); x.arc(64, 64, 4, 0, TAU); x.fill(); blotches(x, w, h, 6, '50,30,10', 0.3, 8, 25);
  }, false);
  T.glow = canvasTex(64, 64, (x, w, h) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, false);
  T.blob = canvasTex(64, 64, (x, w, h) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, false);
  T.blood = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = 'rgba(110,5,8,0.85)';
    for (let i = 0; i < 5; i++) { const px = 20 + i * 18, py = 30 + (i % 2) * 16; x.beginPath(); x.ellipse(px, py + 28, 10, 14, 0, 0, TAU); x.fill(); for (let f = 0; f < 4; f++) { x.beginPath(); x.ellipse(px - 12 + f * 8, py + 6, 3, 10, (f - 1.5) * 0.12, 0, TAU); x.fill(); } x.fillRect(px - 2, py + 36, 3, rand(20, 50)); }
  }, false);
  T.poster = (title, bg) => canvasTex(128, 192, (x, w, h) => {
    x.fillStyle = bg; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4);
    x.fillStyle = 'rgba(0,0,0,0.65)'; x.font = 'bold 20px "Special Elite", Georgia, serif'; x.textAlign = 'center'; x.fillText(title, w / 2, 34);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(18, 56, w - 36, 70); for (let i = 0; i < 4; i++) x.fillRect(18, 138 + i * 11, rand(50, w - 36), 4);
    blotches(x, w, h, 5, '60,40,10', 0.3, 10, 40);
  }, false);
  T.missing = canvasTex(128, 192, (x, w, h) => {
    x.fillStyle = '#d6d0bc'; x.fillRect(0, 0, w, h); x.fillStyle = '#7a0d10'; x.font = 'bold 24px Georgia'; x.textAlign = 'center'; x.fillText('MISSING', w / 2, 30);
    x.fillStyle = '#56504a'; x.beginPath(); x.arc(w / 2, 78, 28, 0, TAU); x.fill(); x.fillStyle = '#3a342f'; x.beginPath(); x.arc(w / 2, 150, 34, Math.PI, TAU); x.fill();
    x.fillStyle = '#222'; x.font = 'bold 16px Georgia'; x.fillText('LAYLA', w / 2, 125); x.font = '11px Georgia'; x.fillText('Last seen — 3:47', w / 2, 178); blotches(x, w, h, 6, '50,30,10', 0.3, 8, 30);
  }, false);
  T.portrait = canvasTex(128, 160, (x, w, h) => {
    x.fillStyle = '#2a2018'; x.fillRect(0, 0, w, h); const g = x.createRadialGradient(64, 70, 10, 64, 80, 80); g.addColorStop(0, '#6b5a48'); g.addColorStop(1, '#17110c'); x.fillStyle = g; x.fillRect(8, 8, w - 16, h - 16);
    x.fillStyle = '#9d8268'; x.beginPath(); x.ellipse(64, 66, 22, 28, 0, 0, TAU); x.fill();
    x.fillStyle = '#1c130c'; x.beginPath(); x.ellipse(64, 50, 26, 22, 0, Math.PI, TAU); x.fill(); x.fillRect(38, 50, 8, 60); x.fillRect(82, 50, 8, 60);
    x.fillStyle = '#4a3a3a'; x.beginPath(); x.ellipse(64, 138, 38, 28, 0, Math.PI, TAU); x.fill();
    x.fillStyle = '#2a1a14'; x.fillRect(53, 62, 6, 3); x.fillRect(70, 62, 6, 3); x.fillStyle = '#7a2a2a'; x.fillRect(58, 82, 12, 3);
  }, false);
}

/* ---------- materials ---------- */
const MAT = {};
const clean = (o) => { for (const k in o) if (o[k] === undefined) delete o[k]; return o; };
function mkMat(color, map, o = {}) {
  const p = { color, map: map || undefined, emissive: o.emissive || 0x000000, side: o.side, transparent: o.transparent, opacity: o.opacity === undefined ? 1 : o.opacity, alphaTest: o.alphaTest || 0 };
  if (BOOT_Q.lambert) return new THREE.MeshLambertMaterial(clean(p));
  p.roughness = o.roughness === undefined ? 0.92 : o.roughness; p.metalness = o.metalness || 0;
  return new THREE.MeshStandardMaterial(clean(p));
}
function buildMaterials() {
  MAT.wall = mkMat(0xffffff, T.wall); MAT.wallBase = mkMat(0xffffff, T.wallBase); MAT.wallWood = mkMat(0xffffff, T.wallWood);
  MAT.floorTile = mkMat(0xffffff, T.floorTile, { roughness: 0.6 }); MAT.floorTile2 = mkMat(0xffffff, T.floorTile2, { roughness: 0.5 });
  MAT.floorWood = mkMat(0xffffff, T.floorWood, { roughness: 0.7 }); MAT.floorConc = mkMat(0xffffff, T.floorConc);
  MAT.ceil = mkMat(0xffffff, T.ceil); MAT.wood = mkMat(0xffffff, T.wood); MAT.woodDark = mkMat(0xffffff, T.woodDark);
  MAT.metal = mkMat(0xffffff, T.metal, { roughness: 0.55, metalness: 0.4 }); MAT.rust = mkMat(0xffffff, T.rust, { roughness: 0.8, metalness: 0.35 });
  MAT.door = mkMat(0xffffff, T.door); MAT.books = mkMat(0xffffff, T.books); MAT.black = mkMat(0x151515, null, { roughness: 0.6 });
  MAT.white = mkMat(0xb8b8b0, null); MAT.chair = mkMat(0x2c4a63, null, { roughness: 0.6 }); MAT.chair2 = mkMat(0x7a3a2a, null, { roughness: 0.6 });
  MAT.pipe = mkMat(0x6a6c6e, null, { roughness: 0.5, metalness: 0.6 }); MAT.cloth = mkMat(0x6a1a1a, null); MAT.glass = mkMat(0x88aacc, null, { transparent: true, opacity: 0.22, roughness: 0.1 });
  MAT.sheet = mkMat(0x9a9a92, null); MAT.crate = mkMat(0x6d5233, T.wood); MAT.paper = mkMat(0xffffff, T.paper); MAT.blood = mkMat(0xffffff, T.blood, { transparent: true, side: THREE.DoubleSide });
  MAT.chalk = mkMat(0xffffff, null);
  MAT.portrait = mkMat(0xffffff, T.portrait, { side: THREE.DoubleSide, roughness: 0.8 }); MAT.missing = mkMat(0xffffff, T.missing, { side: THREE.DoubleSide, roughness: 0.8 });
  MAT.fixOn = new THREE.MeshBasicMaterial({ color: 0xfff1c9, fog: false });
  MAT.fixOff = mkMat(0x2a2a2a, null);
  MAT.window = new THREE.MeshBasicMaterial({ color: 0x1b2d52 });
  MAT.exitSign = new THREE.MeshBasicMaterial({ color: 0x20c060 });
  MAT.glow = new THREE.SpriteMaterial({ map: T.glow, color: 0xffd98a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  MAT.blob = new THREE.MeshBasicMaterial({ map: T.blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

/* =====================================================================
   3. COLLISION WORLD, LINE OF SIGHT, NAVIGATION GRID (A*)
   ===================================================================== */
const STEP_H = 0.42;                        // max height a character can step up
const World = { boxes: [], cells: new Map(), CS: 4, rooms: [], doors: [], hides: [], zones: [], ramps: [], items: [], interact: [], fixtures: [], bounds: { x0: -4, z0: -12, x1: 112, z1: 44 } };
let _stamp = 1;
const _qres = [];
const cellKey = (i, j) => (i + 64) * 256 + (j + 64);

function addCollider(x0, z0, x1, z1, y0, y1, kind = 'wall', extra = null) {
  const b = Object.assign({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1, fh: y1 - y0, kind, off: false, q: 0 }, extra || {});
  World.boxes.push(b);
  const CS = World.CS;
  const i0 = Math.floor(b.x0 / CS), i1 = Math.floor(b.x1 / CS), j0 = Math.floor(b.z0 / CS), j1 = Math.floor(b.z1 / CS);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = cellKey(i, j); let a = World.cells.get(k); if (!a) { a = []; World.cells.set(k, a); } a.push(b);
  }
  return b;
}
function query(x0, z0, x1, z1) {
  _qres.length = 0; _stamp++;
  const CS = World.CS;
  const i0 = Math.floor(x0 / CS), i1 = Math.floor(x1 / CS), j0 = Math.floor(z0 / CS), j1 = Math.floor(z1 / CS);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const a = World.cells.get(cellKey(i, j)); if (!a) continue;
    for (let n = 0; n < a.length; n++) { const b = a[n]; if (b.q !== _stamp) { b.q = _stamp; _qres.push(b); } }
  }
  return _qres;
}

/* push a circle (p.x,p.z) out of every solid box that overlaps vertically with the body */
function resolveCircle(p, r, feetY, bodyH, opts) {
  let hit = false;
  for (let it = 0; it < 3; it++) {
    const list = query(p.x - r - 0.1, p.z - r - 0.1, p.x + r + 0.1, p.z + r + 0.1);
    let moved = false;
    for (let n = 0; n < list.length; n++) {
      const b = list[n];
      if (b.off || b.y1 <= feetY + STEP_H || b.y0 >= feetY + bodyH) continue;
      if (opts && opts.npc && b.door && !b.door.locked && !b.door.secret) continue;
      const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
      else {
        const l = p.x - b.x0, rr = b.x1 - p.x, tt = p.z - b.z0, bb = b.z1 - p.z, m = Math.min(l, rr, tt, bb);
        if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === tt) p.z = b.z0 - r; else p.z = b.z1 + r;
      }
      hit = true; moved = true;
    }
    if (!moved) break;
  }
  return hit;
}
/* height of the surface a character can stand on (floor zones, ramps/stairs, top of low furniture) */
function groundAt(x, z, feetY, r = 0.18, npc = false) {
  let best = -Infinity;
  for (const zn of World.zones) {
    if (x < zn.x0 || x > zn.x1 || z < zn.z0 || z > zn.z1) continue;
    if (zn.holes) { let inHole = false; for (const h of zn.holes) if (x >= h[0] && x <= h[2] && z >= h[1] && z <= h[3]) { inHole = true; break; } if (inHole) continue; }
    if (zn.y <= feetY + 0.6 && zn.y > best) best = zn.y;
  }
  for (const rp of World.ramps) {
    if (x < rp.x0 || x > rp.x1 || z < rp.z0 || z > rp.z1) continue;
    const y = lerp(rp.y0, rp.y1, clamp((x - rp.x0) / (rp.x1 - rp.x0), 0, 1));
    if (y <= feetY + 0.6 && y > best) best = y;
  }
  if (!npc) {
    const list = query(x - r, z - r, x + r, z + r);
    for (let n = 0; n < list.length; n++) {
      const b = list[n];
      if (b.off || b.kind !== 'furn') continue;
      if (x >= b.x0 - r * 0.6 && x <= b.x1 + r * 0.6 && z >= b.z0 - r * 0.6 && z <= b.z1 + r * 0.6 && b.y1 <= feetY + STEP_H + 0.05 && b.y1 > best) best = b.y1;
    }
  }
  return best === -Infinity ? feetY : best;
}
let _t0 = 0, _t1 = 1;
function segBox2D(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < 1e-9) { if (ax < b.x0 || ax > b.x1) return false; }
  else { let ta = (b.x0 - ax) / dx, tb = (b.x1 - ax) / dx; if (ta > tb) { const s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return false; }
  if (Math.abs(dz) < 1e-9) { if (az < b.z0 || az > b.z1) return false; }
  else { let ta = (b.z0 - az) / dz, tb = (b.z1 - az) / dz; if (ta > tb) { const s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return false; }
  _t0 = t0; _t1 = t1; return true;
}
/* true when nothing solid sits between the two 3D points (heights are respected) */
function losClear(ax, ay, az, bx, by, bz) {
  const list = query(Math.min(ax, bx) - 0.05, Math.min(az, bz) - 0.05, Math.max(ax, bx) + 0.05, Math.max(az, bz) + 0.05);
  for (let n = 0; n < list.length; n++) {
    const b = list[n]; if (b.off || b.see === false) continue;
    if (!segBox2D(ax, az, bx, bz, b)) continue;
    const ya = ay + (by - ay) * _t0, yb = ay + (by - ay) * _t1;
    if (Math.min(ya, yb) < b.y1 && Math.max(ya, yb) > b.y0) return false;
  }
  return true;
}
/* 3D ray vs boxes → distance of first hit (or maxD). Used for camera collision and flashlight aim. */
function rayBoxes(ox, oy, oz, dx, dy, dz, maxD, pad = 0, camMode = false) {
  let best = maxD;
  const ex = ox + dx * maxD, ez = oz + dz * maxD;
  const list = query(Math.min(ox, ex) - pad - 0.1, Math.min(oz, ez) - pad - 0.1, Math.max(ox, ex) + pad + 0.1, Math.max(oz, ez) + pad + 0.1);
  for (let n = 0; n < list.length; n++) {
    const b = list[n]; if (b.off) continue;
    if (camMode && b.kind === 'furn' && b.fh < 1.15) continue;
    let t0 = 0, t1 = best;
    const slab = (o, d, mn, mx) => {
      if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
      let ta = (mn - o) / d, tb = (mx - o) / d; if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; return t0 <= t1;
    };
    if (!slab(ox, dx, b.x0 - pad, b.x1 + pad)) continue;
    if (!slab(oy, dy, b.y0 - pad, b.y1 + pad)) continue;
    if (!slab(oz, dz, b.z0 - pad, b.z1 + pad)) continue;
    if (t0 < best) best = Math.max(0, t0);
  }
  return best;
}
let _lastRoom = null;
function roomAt(x, z) {
  const r0 = _lastRoom; if (r0 && x >= r0.x0 && x <= r0.x1 && z >= r0.z0 && z <= r0.z1) return r0;
  for (const r of World.rooms) if (x >= r.x0 - 0.15 && x <= r.x1 + 0.15 && z >= r.z0 - 0.15 && z <= r.z1 + 0.15) { _lastRoom = r; return r; }
  return null;
}

/* ---------- navigation grid (0.5 m cells) ---------- */
const NAV = { cs: 0.5, x0: -4, z0: -12, w: 232, h: 112, blocked: null, g: null, parent: null, stamp: null, st: 1 };
NAV.blocked = new Uint8Array(NAV.w * NAV.h);
NAV.g = new Float32Array(NAV.w * NAV.h); NAV.parent = new Int32Array(NAV.w * NAV.h); NAV.stamp = new Uint32Array(NAV.w * NAV.h);
const navIdx = (x, z) => { const i = Math.floor((x - NAV.x0) / NAV.cs), j = Math.floor((z - NAV.z0) / NAV.cs); return (i < 0 || j < 0 || i >= NAV.w || j >= NAV.h) ? -1 : j * NAV.w + i; };
const navX = (idx) => NAV.x0 + ((idx % NAV.w) + 0.5) * NAV.cs;
const navZ = (idx) => NAV.z0 + (Math.floor(idx / NAV.w) + 0.5) * NAV.cs;
function buildNav() {
  NAV.blocked.fill(0);
  const inf = 0.4;
  for (const b of World.boxes) {
    if (b.nonav) continue;
    if (b.kind === 'door') { if (!(b.door.locked || b.door.secret || b.door.barricaded) || b.off) continue; }
    else if (b.off) continue;
    else if (b.kind === 'furn' && b.fh < 0.55) continue;
    const i0 = Math.max(0, Math.floor((b.x0 - inf - NAV.x0) / NAV.cs)), i1 = Math.min(NAV.w - 1, Math.floor((b.x1 + inf - NAV.x0) / NAV.cs));
    const j0 = Math.max(0, Math.floor((b.z0 - inf - NAV.z0) / NAV.cs)), j1 = Math.min(NAV.h - 1, Math.floor((b.z1 + inf - NAV.z0) / NAV.cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = NAV.x0 + (i + 0.5) * NAV.cs, cz = NAV.z0 + (j + 0.5) * NAV.cs;
      if (cx > b.x0 - inf && cx < b.x1 + inf && cz > b.z0 - inf && cz < b.z1 + inf) NAV.blocked[j * NAV.w + i] = 1;
    }
  }
}
function navNearestFree(idx) {
  if (idx < 0) return -1; if (!NAV.blocked[idx]) return idx;
  const ci = idx % NAV.w, cj = (idx / NAV.w) | 0;
  for (let r = 1; r < 10; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= NAV.w || j >= NAV.h) continue;
    if (!NAV.blocked[j * NAV.w + i]) return j * NAV.w + i;
  }
  return -1;
}
function navLine(a, b) {   // conservative grid line-of-walk (also checks lateral neighbours so corners are not clipped)
  const W = NAV.w, H = NAV.h;
  let x0 = a % W, y0 = (a / W) | 0; const x1 = b % W, y1 = (b / W) | 0, xs = x0, ys = y0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx - dy;
  const bl = (x, y) => x < 0 || y < 0 || x >= W || y >= H || NAV.blocked[y * W + x] === 1;
  for (let n = 0; n < 500; n++) {
    if (bl(x0, y0)) return false;
    const nearEnd = (Math.abs(x0 - xs) <= 1 && Math.abs(y0 - ys) <= 1) || (Math.abs(x0 - x1) <= 1 && Math.abs(y0 - y1) <= 1);
    if (!nearEnd) { if (dx >= dy) { if (bl(x0, y0 - 1) || bl(x0, y0 + 1)) return false; } else if (bl(x0 - 1, y0) || bl(x0 + 1, y0)) return false; }
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; if (bl(x0, y0)) return false; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return false;
}
const _hF = [], _hI = [];
function heapPush(f, i) { let n = _hF.length; _hF.push(f); _hI.push(i); while (n > 0) { const p = (n - 1) >> 1; if (_hF[p] <= f) break; _hF[n] = _hF[p]; _hI[n] = _hI[p]; n = p; } _hF[n] = f; _hI[n] = i; }
function heapPop() {
  const top = _hI[0], lf = _hF.pop(), li = _hI.pop(); const len = _hF.length;
  if (len > 0) { let n = 0; for (;;) { let c = 2 * n + 1; if (c >= len) break; if (c + 1 < len && _hF[c + 1] < _hF[c]) c++; if (_hF[c] >= lf) break; _hF[n] = _hF[c]; _hI[n] = _hI[c]; n = c; } _hF[n] = lf; _hI[n] = li; }
  return top;
}
/* A* with octile heuristic + string-pulling smoothing. Returns [{x,z},...] or null. */
function findPath(sx, sz, gx, gz) {
  const s = navNearestFree(navIdx(sx, sz)), g = navNearestFree(navIdx(gx, gz));
  if (s < 0 || g < 0) return null;
  if (s === g) return [{ x: gx, z: gz }];
  NAV.st++; const st = NAV.st; _hF.length = 0; _hI.length = 0;
  const W = NAV.w, gi = g % W, gj = (g / W) | 0;
  NAV.g[s] = 0; NAV.parent[s] = -1; NAV.stamp[s] = st; heapPush(0, s);
  const closed = new Set(); let found = false, iter = 0;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
  while (_hF.length && iter++ < 30000) {
    const cur = heapPop(); if (closed.has(cur)) continue; closed.add(cur);
    if (cur === g) { found = true; break; }
    const ci = cur % W, cj = (cur / W) | 0;
    for (let k = 0; k < 8; k++) {
      const ni = ci + DX[k], nj = cj + DZ[k]; if (ni < 0 || nj < 0 || ni >= W || nj >= NAV.h) continue;
      const nb = nj * W + ni; if (NAV.blocked[nb]) continue;
      if (k >= 4 && (NAV.blocked[cj * W + ni] || NAV.blocked[nj * W + ci])) continue;
      const ng = NAV.g[cur] + (k >= 4 ? 1.414 : 1);
      if (NAV.stamp[nb] !== st || ng < NAV.g[nb]) {
        NAV.stamp[nb] = st; NAV.g[nb] = ng; NAV.parent[nb] = cur;
        const hx = Math.abs(ni - gi), hz = Math.abs(nj - gj); heapPush(ng + (hx + hz) + (1.414 - 2) * Math.min(hx, hz), nb);
      }
    }
  }
  if (!found) return null;
  const cells = []; for (let c = g; c !== -1; c = NAV.parent[c]) cells.push(c); cells.reverse();
  const out = []; let anchor = 0;
  while (anchor < cells.length - 1) {
    let far = anchor + 1;
    for (let k = cells.length - 1; k > anchor + 1; k--) { if (navLine(cells[anchor], cells[k])) { far = k; break; } }
    out.push({ x: navX(cells[far]), z: navZ(cells[far]) }); anchor = far;
  }
  if (out.length) { const last = out[out.length - 1]; if (!NAV.blocked[navIdx(gx, gz)] && navIdx(gx, gz) >= 0) { last.x = gx; last.z = gz; } }
  return out;
}

/* =====================================================================
   4. SCHOOL LEVEL BUILDER
   Geometry is merged per material per 16 m chunk (few draw calls, frustum-culled).
   ===================================================================== */
const levelGroup = new THREE.Group();
const dynGroup = new THREE.Group();            // items, doors, lockers (animated / toggled)
const batches = new Map();
const WALL_H = 3.2;

function planeGeo(w, d, tile, up) {
  const g = new THREE.PlaneGeometry(w, d); const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); return g;
}
function boxGeo(w, h, d, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
  const tu = o.tile || 2, tv = o.tileV || tu, v0 = o.v0 || 0;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const idx = f * 4 + i; const vert = f < 2 || f > 3;
    uv.setXY(idx, uv.getX(idx) * dims[f][0] / tu, uv.getY(idx) * dims[f][1] / tv + (vert ? v0 : 0));
  }
  return g;
}
function addGeo(mat, g, cx, cz) {
  const key = mat + '|' + Math.floor(cx / 16) + '|' + Math.floor(cz / 16);
  let b = batches.get(key); if (!b) { b = { mat, geos: [] }; batches.set(key, b); }
  b.geos.push(g);
}
/* center-based box: o.col = 'wall' | 'furn' adds a collider, o.ry rotates the visual */
function addBox(mat, cx, cy, cz, w, h, d, o = {}) {
  cy += BASE_Y;
  const g = boxGeo(w, h, d, o); if (o.ry) g.rotateY(o.ry); g.translate(cx, cy, cz);
  addGeo(mat, g, cx, cz);
  if (o.col) return addCollider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, cy - h / 2, cy + h / 2, o.col, o.extra);
  return null;
}
function addCyl(mat, cx, cy, cz, rt, rb, h, seg = 12, o = {}) {
  cy += BASE_Y;
  const g = new THREE.CylinderGeometry(rt, rb, h, seg); if (o.rx) g.rotateX(o.rx); if (o.rz) g.rotateZ(o.rz); g.translate(cx, cy, cz);
  addGeo(mat, g, cx, cz);
  if (o.col) { const r = Math.max(rt, rb); return addCollider(cx - r, cz - r, cx + r, cz + r, cy - h / 2, cy + h / 2, o.col); }
  return null;
}
function flushBatches() {
  for (const b of batches.values()) {
    const g = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false); if (!g) continue;
    const m = new THREE.Mesh(g, MAT[b.mat]);
    m.castShadow = !/^(floor|ceil|glass|blood|paper|window|portrait|missing)/.test(b.mat); m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    levelGroup.add(m);
    if (b.geos.length > 1) b.geos.forEach((x) => x.dispose());
  }
  batches.clear();
}

/* ---------- room & opening definitions (all meters, integer coordinates) ---------- */
// lights: on | some | off | flicker | dim | broken | candle
const ROOM_DEFS = [
  { id: 'class1a', x0: 0, z0: 0, x1: 12, z1: 11, floor: 'floorTile', wall: 'wall', lights: 'flicker' },
  { id: 'class2b', x0: 12, z0: 0, x1: 24, z1: 11, floor: 'floorTile', wall: 'wall', lights: 'some' },
  { id: 'class3c', x0: 24, z0: 0, x1: 36, z1: 11, floor: 'floorTile', wall: 'wall', lights: 'broken' },
  { id: 'library', x0: 36, z0: 0, x1: 52, z1: 11, floor: 'floorWood', wall: 'wallWood', lights: 'broken' },
  { id: 'lab', x0: 52, z0: 0, x1: 64, z1: 11, floor: 'floorTile2', wall: 'wall', lights: 'flicker' },
  { id: 'corridor1', x0: 0, z0: 11, x1: 64, z1: 15, floor: 'floorTile', wall: 'wall', lights: 'some', corridor: true },
  { id: 'hall', x0: 0, z0: 15, x1: 14, z1: 40, floor: 'floorTile', wall: 'wall', lights: 'some' },
  { id: 'lounge', x0: 14, z0: 15, x1: 26, z1: 25, floor: 'floorWood', wall: 'wall', lights: 'dim' },
  { id: 'office', x0: 26, z0: 15, x1: 36, z1: 25, floor: 'floorWood', wall: 'wallWood', lights: 'dim' },
  { id: 'nurse', x0: 36, z0: 15, x1: 44, z1: 25, floor: 'floorTile', wall: 'wall', lights: 'on' },
  { id: 'janitor', x0: 44, z0: 15, x1: 52, z1: 25, floor: 'floorConc', wall: 'wallBase', lights: 'off' },
  { id: 'stairs', x0: 52, z0: 15, x1: 64, z1: 21, y: -4, h: 7.2, floor: false, wall: 'wallBase', lights: 'dim', stairs: true },
  { id: 'corridor2', x0: 14, z0: 25, x1: 64, z1: 29, floor: 'floorTile', wall: 'wall', lights: 'some', corridor: true },
  { id: 'cafeteria', x0: 14, z0: 29, x1: 38, z1: 40, floor: 'floorTile', wall: 'wall', lights: 'broken' },
  { id: 'restroom', x0: 38, z0: 29, x1: 46, z1: 40, floor: 'floorTile2', wall: 'wall', lights: 'flicker' },
  { id: 'music', x0: 46, z0: 29, x1: 55, z1: 40, floor: 'floorWood', wall: 'wall', lights: 'off' },
  { id: 'art', x0: 55, z0: 29, x1: 64, z1: 40, floor: 'floorWood', wall: 'wall', lights: 'dim' },
  { id: 'secret1', x0: 40, z0: -8, x1: 48, z1: 0, floor: 'floorWood', wall: 'wallWood', lights: 'candle', secret: true },
  // ---- basement (y = -4) ----
  { id: 'bcorr', x0: 64, z0: 16, x1: 104, z1: 20, y: -4, h: 3, floor: 'floorConc', wall: 'wallBase', ceil: 'ceil', lights: 'some', basement: true, corridor: true },
  { id: 'electrical', x0: 66, z0: 8, x1: 76, z1: 16, y: -4, h: 3, floor: 'floorConc', wall: 'wallBase', lights: 'broken', basement: true },
  { id: 'boiler', x0: 76, z0: 8, x1: 92, z1: 16, y: -4, h: 3.4, floor: 'floorConc', wall: 'wallBase', lights: 'flicker', basement: true },
  { id: 'archive', x0: 92, z0: 8, x1: 104, z1: 16, y: -4, h: 3, floor: 'floorConc', wall: 'wallBase', lights: 'off', basement: true },
  { id: 'storage', x0: 66, z0: 20, x1: 80, z1: 30, y: -4, h: 3, floor: 'floorConc', wall: 'wallBase', lights: 'dim', basement: true },
  { id: 'maint', x0: 80, z0: 20, x1: 92, z1: 30, y: -4, h: 3, floor: 'floorConc', wall: 'wallBase', lights: 'off', basement: true },
  { id: 'shrine', x0: 92, z0: 20, x1: 104, z1: 30, y: -4, h: 3, floor: 'floorWood', wall: 'wallWood', lights: 'candle', basement: true, secret: true },
];
// type: door | arch | secret | exit ; y = sill height ; top = opening height
const OPENINGS = [
  { id: 'd_1a', axis: 'h', at: 11, c: 9, type: 'door' },
  { id: 'd_2b', axis: 'h', at: 11, c: 21, type: 'door' },
  { id: 'd_3c', axis: 'h', at: 11, c: 27, type: 'door' },
  { id: 'd_library', axis: 'h', at: 11, c: 40, type: 'door', lock: 'library_key' },
  { id: 'd_lab', axis: 'h', at: 11, c: 58, type: 'door', lock: 'lab_key' },
  { id: 'a_hall', axis: 'h', at: 15, c: 7, w: 8, top: 3.2, type: 'arch' },
  { id: 'd_lounge_n', axis: 'h', at: 15, c: 20, type: 'door' },
  { id: 'd_office', axis: 'h', at: 15, c: 31, type: 'door', lock: 'code' },
  { id: 'd_nurse_n', axis: 'h', at: 15, c: 40, type: 'door' },
  { id: 'd_janitor', axis: 'h', at: 15, c: 48, type: 'door' },
  { id: 'd_stairs', axis: 'h', at: 15, c: 53, type: 'door', lock: 'basement_key' },
  { id: 'd_lounge_s', axis: 'h', at: 25, c: 17, type: 'door' },
  { id: 'd_nurse_s', axis: 'h', at: 25, c: 40, type: 'door' },
  { id: 'a_hall2', axis: 'v', at: 14, c: 27, w: 4, top: 3.2, type: 'arch' },
  { id: 'd_cafe1', axis: 'h', at: 29, c: 20, type: 'door' },
  { id: 'd_cafe2', axis: 'h', at: 29, c: 32, type: 'door' },
  { id: 'd_restroom', axis: 'h', at: 29, c: 42, type: 'door' },
  { id: 'd_music', axis: 'h', at: 29, c: 50, type: 'door' },
  { id: 'd_art', axis: 'h', at: 29, c: 60, type: 'door' },
  { id: 'd_exit', axis: 'h', at: 40, c: 7, w: 3, type: 'exit', lock: 'main_key' },
  { id: 'd_secret1', axis: 'h', at: 0, c: 44, w: 1.8, type: 'secret' },
  // basement
  { id: 'a_bstairs', axis: 'v', at: 64, c: 18, w: 4, y: -4, top: 2.6, type: 'arch' },
  { id: 'd_electrical', axis: 'h', at: 16, c: 70, y: -4, type: 'door' },
  { id: 'd_boiler', axis: 'h', at: 16, c: 84, y: -4, type: 'door' },
  { id: 'd_archive', axis: 'h', at: 16, c: 98, y: -4, type: 'door' },
  { id: 'd_storage', axis: 'h', at: 20, c: 72, y: -4, type: 'door' },
  { id: 'd_maint', axis: 'h', at: 20, c: 86, y: -4, type: 'door' },
  { id: 'd_shrine', axis: 'h', at: 20, c: 98, y: -4, type: 'door', lock: 'power' },
  { id: 'd_elec_boil', axis: 'v', at: 76, c: 12, y: -4, type: 'door' },
  { id: 'd_boil_arch', axis: 'v', at: 92, c: 12, y: -4, type: 'door' },
  { id: 'd_stor_maint', axis: 'v', at: 80, c: 25, y: -4, type: 'door' },
];
const DOOR_W = 1.6, DOOR_H = 2.4;

function buildShell(r) {
  const t = 0.15, y0 = r.y, yTop = r.y + r.h, w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  if (r.floor) { const g = planeGeo(w, d, 2, true); g.translate(cx, r.y, cz); addGeo(r.floor, g, cx, cz); }
  if (r.ceil !== false) { const g = planeGeo(w, d, 2, false); g.translate(cx, yTop, cz); addGeo(r.ceilMat || 'ceil', g, cx, cz); }
  const ops = OPENINGS.map((o) => Object.assign({ w: DOOR_W, top: DOOR_H, y: 0 }, o));
  const run = (axis, at, a, b, inw) => {
    const list = ops.filter((o) => o.axis === axis && Math.abs(o.at - at) < 0.01 && o.c >= a - 0.01 && o.c <= b + 0.01).sort((p, q) => p.c - q.c);
    const piece = (p, q, ya, yb, nonav) => {
      if (q - p < 0.03 || yb - ya < 0.03) return;
      const len = q - p, mid = (p + q) / 2, my = (ya + yb) / 2, off = at + inw * t / 2;
      const opt = { tile: 2, tileV: 3.2, v0: (ya - r.y) / 3.2, col: 'wall', extra: nonav ? { nonav: true } : null };
      if (axis === 'h') addBox(r.wall, mid, my, off, len, yb - ya, t, opt); else addBox(r.wall, off, my, mid, t, yb - ya, len, opt);
    };
    let cur = a;
    for (const o of list) {
      const s = Math.max(a, o.c - o.w / 2), e = Math.min(b, o.c + o.w / 2);
      piece(cur, s, y0, yTop);
      if (o.y > y0 + 0.01) piece(s, e, y0, o.y, true);
      if (o.y + o.top < yTop - 0.01) piece(s, e, o.y + o.top, yTop, true);
      cur = e;
    }
    piece(cur, b, y0, yTop);
  };
  run('h', r.z0, r.x0, r.x1, 1); run('h', r.z1, r.x0, r.x1, -1);
  run('v', r.x0, r.z0 + t, r.z1 - t, 1); run('v', r.x1, r.z0 + t, r.z1 - t, -1);
}

/* ---------- doors ---------- */
class Door {
  constructor(o) {
    Object.assign(this, { w: DOOR_W, top: DOOR_H, y: 0, hinge: -1, lock: null }, o);
    this.initialLock = this.lock; this.locked = !!this.lock; this.open = false; this.angle = 0; this.target = 0; this.sound = 0; this.t = 0;
    this.secret = this.type === 'secret'; this.exit = this.type === 'exit';
    const horiz = this.axis === 'h';
    this.cx = horiz ? this.c : this.at; this.cz = horiz ? this.at : this.c;
    this.root = new THREE.Group(); this.pivot = new THREE.Group(); this.root.add(this.pivot);
    const hx = horiz ? this.c + this.hinge * this.w / 2 : this.at, hz = horiz ? this.at : this.c + this.hinge * this.w / 2;
    this.root.position.set(hx, this.y, hz); this.root.rotation.y = horiz ? 0 : -Math.PI / 2;
    this.dx = this.hinge === -1 ? 1 : -1;
    const lw = this.w - 0.05;
    let mesh;
    if (this.secret) {
      mesh = new THREE.Mesh(boxGeo(lw, 2.5, 0.34, { tile: 1.2 }), [MAT.wallWood, MAT.wallWood, MAT.wallWood, MAT.wallWood, MAT.books, MAT.wood]);
      mesh.position.set(this.dx * this.w / 2, 1.25, 0);
    } else {
      mesh = new THREE.Mesh(boxGeo(lw, this.top - 0.05, 0.07, { tile: 1.2 }), MAT.door);
      mesh.position.set(this.dx * this.w / 2, (this.top - 0.05) / 2 + 0.02, 0);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), MAT.pipe); knob.position.set(this.dx * (this.w - 0.15), 1.05, 0.06); this.pivot.add(knob);
      const knob2 = knob.clone(); knob2.position.z = -0.06; this.pivot.add(knob2);
      if (this.exit) {   // heavy chained double door
        for (let i = 0; i < 2; i++) { const ch = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.035, 6, 16), MAT.pipe); ch.rotation.y = 0; ch.position.set(this.dx * this.w / 2, 0.9 + i * 0.5, 0.06); ch.scale.set(1.2, 0.18, 1); this.pivot.add(ch); this.chain = this.chain || []; this.chain.push(ch); }
      }
    }
    mesh.castShadow = true; mesh.receiveShadow = true; this.pivot.add(mesh); this.leaf = mesh;
    dynGroup.add(this.root);
    const boxH = this.secret ? 2.5 : this.top;
    this.box = this.axis === 'h'
      ? addCollider(this.c - this.w / 2, this.at - 0.12, this.c + this.w / 2, this.at + 0.12, this.y, this.y + boxH, 'door', { door: this })
      : addCollider(this.at - 0.12, this.c - this.w / 2, this.at + 0.12, this.c + this.w / 2, this.y, this.y + boxH, 'door', { door: this });
    this.pos = new THREE.Vector3(this.cx, this.y + 1.1, this.cz);
    // frame trim (visual only)
    if (!this.secret) {
      const fw = 0.1, th = 0.34;
      if (horiz) { addBox('woodDark', this.c - this.w / 2 - fw / 2, this.y + this.top / 2, this.at, fw, this.top, th); addBox('woodDark', this.c + this.w / 2 + fw / 2, this.y + this.top / 2, this.at, fw, this.top, th); addBox('woodDark', this.c, this.y + this.top + fw / 2, this.at, this.w + fw * 2, fw, th); }
      else { addBox('woodDark', this.at, this.y + this.top / 2, this.c - this.w / 2 - fw / 2, th, this.top, fw); addBox('woodDark', this.at, this.y + this.top / 2, this.c + this.w / 2 + fw / 2, th, this.top, fw); addBox('woodDark', this.at, this.y + this.top + fw / 2, this.c, th, fw, this.w + fw * 2); }
    }
    this.updateVisual();
  }
  reset() { this.locked = !!this.initialLock; this.lock = this.initialLock; this.open = false; this.angle = 0; this.target = 0; this.box.off = false; this.setBarricade(false); this.breakT = 0; this.updateVisual(); }
  setBarricade(on) {
    this.barricaded = !!on;
    if (on && !this.barMesh) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), MAT.chair2); seat.position.y = 0.46; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.45, 0.05), MAT.chair2); back.position.set(0, 0.68, -0.2); g.add(back);
      for (const a of [-1, 1]) for (const b of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), MAT.pipe); l.position.set(a * 0.18, 0.23, b * 0.18); g.add(l); }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.rotation.y = (this.axis === 'h' ? 0 : Math.PI / 2) + 0.35; g.rotation.z = 0.22;
      g.position.set(this.cx, this.y + 0.06, this.cz);
      dynGroup.add(g); this.barMesh = g;
    }
    if (this.barMesh) this.barMesh.visible = this.barricaded;
  }
  setLocked(v) { this.locked = v; this.updateChains(); }
  updateChains() { if (this.chain) this.chain.forEach((c) => { c.visible = this.locked; }); }
  /* side: +1 / -1 chooses which way the leaf swings (away from the opener) */
  toggle(openerPos, silent) {
    if (this.locked || this.barricaded) return false;
    if (this.secret) { this.open = !this.open; this.target = this.open ? 1 : 0; if (!silent) audio.blip({ type: 'sawtooth', f0: 60, f1: 40, dur: 1.6, vol: 0.25, pos: this.pos, filter: { type: 'lowpass', f: 300 } }); return true; }
    if (!this.open) {
      let side = 1;
      if (openerPos) { const lp = this.root.worldToLocal(new THREE.Vector3(openerPos.x, 0, openerPos.z)); side = lp.z >= 0 ? 1 : -1; }
      this.target = this.dx * side * 1.75; this.open = true; this.box.off = true;
      if (!silent) audio.doorOpen(this.pos);
    } else { this.target = 0; this.open = false; this.closing = true; if (!silent) audio.doorClose(this.pos); }
    return true;
  }
  forceClose(slam) { this.open = false; this.target = 0; this.angle = this.angle * 0.5; this.closing = true; if (slam) audio.doorSlam(this.pos); }
  update(dt) {
    if (this.secret) {
      const a = damp(this.angle, this.target, 2.4, dt); this.angle = a;
      this.leaf.position.x = this.dx * this.w / 2 + this.dx * a * (this.w + 0.1) ;
      const off = a > 0.55; if (off !== this.box.off) { this.box.off = off; buildNav(); } return;
    }
    if (Math.abs(this.angle - this.target) > 0.002) {
      this.angle = damp(this.angle, this.target, 5.2, dt);
      this.pivot.rotation.y = this.angle;
      if (this.closing && Math.abs(this.angle) < 0.3) { this.box.off = false; this.closing = false; }
    }
  }
  updateVisual() { this.pivot.rotation.y = this.angle; if (this.secret) this.leaf.position.x = this.dx * this.w / 2; this.updateChains(); }
}

/* ---------- light fixtures ---------- */
const fixGeo = new THREE.BoxGeometry(1.3, 0.05, 0.32);
const FIX = { list: [], mesh: null, dirty: false }, COL_ON = new THREE.Color(0xfff1c9), COL_OFF = new THREE.Color(0x2a2a2a);
function buildFixtureMesh() {
  const n = FIX.list.length, m = new THREE.InstancedMesh(fixGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), Math.max(1, n)), m4 = new THREE.Matrix4();
  FIX.list.forEach((f, i) => { m4.identity(); m4.setPosition(f.x, f.y, f.z); m.setMatrixAt(i, m4); m.setColorAt(i, f.on ? COL_ON : COL_OFF); });
  m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; levelGroup.add(m); FIX.mesh = m;
}
function buildFixtures(r) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0, yTop = r.y + r.h;
  const spots = [];
  if (r.lights === 'candle') (r.candles || []).forEach(([x, y, z]) => spots.push({ x, y, z, candle: true }));
  else if (r.stairs) [[53, 2.7, 18], [57, 0.9, 16.3], [61, -1.2, 19.7]].forEach(([x, y, z]) => spots.push({ x, y, z, wall: true }));
  else {
    const nx = Math.max(1, Math.round(w / (r.corridor ? 7 : 5.5))), nz = r.corridor ? 1 : Math.max(1, Math.round(d / 5.5));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) spots.push({ x: r.x0 + w * (i + 0.5) / nx, y: yTop - 0.35, z: r.z0 + d * (j + 0.5) / nz });
  }
  spots.forEach((p, idx) => {
    const f = { x: p.x, y: p.y, z: p.z, room: r, on: true, flick: false, base: 1, color: r.basement ? 0xd8e0c0 : 0xffe3b5, phase: hash1(p.x * 3.1 + p.z * 1.7), mesh: null, cur: 0, candle: !!p.candle };
    switch (r.lights) {
      case 'off': f.on = false; break;
      case 'some': f.on = idx % 2 === 0; f.flick = idx % 4 === 2 ? false : idx % 3 === 0; f.base = 0.8; break;
      case 'flicker': f.flick = true; f.base = 0.95; break;
      case 'dim': f.base = 0.5; break;
      case 'broken': f.on = idx % 2 === 0; f.flick = true; f.base = 0.7; break;
      case 'candle': f.base = 0.5; f.color = 0xff9a4a; break;
      default: break;
    }
    if (f.candle) {
      const sp = new THREE.Sprite(MAT.glow.clone()); sp.material.color.set(0xff9a4a); sp.scale.set(0.45, 0.45, 0.45); sp.position.set(p.x, p.y + 0.06, p.z); dynGroup.add(sp); f.sprite = sp;
      addCyl('white', p.x, p.y - 0.04, p.z, 0.035, 0.035, 0.12, 8);
    } else {
      f.idx = FIX.list.length; f.lit = null; FIX.list.push({ x: p.x, y: p.wall ? p.y + 0.3 : yTop - 0.03, z: p.z, on: f.on });
    }
    World.fixtures.push(f);
  });
}
function fixBright(f, tm) {
  if (!f.on) return 0;
  let b = f.base;
  if (S.safe) {   // photosensitivity: steady light, no strobing
    b *= 0.9 * G.blackout;
    if (f.candle) b *= 0.9;
    if (f.room.basement && !G.flags.power && !f.candle) b *= 0.6;
    return b;
  }
  if (f.flick) {
    const n = hash1(Math.floor(tm * 13) + f.phase * 100); b *= n > 0.32 ? 1 : (n > 0.12 ? 0.3 : 0);
    if (hash1(Math.floor(tm * 0.6) + f.phase * 9) > 0.94) b = 0;
  }
  if (f.candle) b *= 0.8 + 0.2 * Math.sin(tm * 9 + f.phase * 20) * Math.sin(tm * 3.1 + f.phase * 5);
  b *= G.blackout;
  if (f.room.basement && !G.flags.power && !f.candle) b *= 0.6;
  if (G.fireTimer > 0) b *= 0.55 + 0.45 * Math.sin(tm * 14 + f.phase * 10);
  if (prof && prof.active && prof.visible) {
    const dx = f.x - prof.pos.x, dz = f.z - prof.pos.z, d2 = dx * dx + dz * dz;
    if (d2 < 81 && Math.abs(f.y - prof.pos.y) < 6) { const k = hash1(Math.floor(tm * 17) + f.phase * 50); if (k < 0.65 * (1 - d2 / 81)) b *= 0.1; }
  }
  return b;
}
const _poolTimer = { t: 0 };
const _cands = [];
/* real PointLights are expensive → a small pool follows the best fixtures around the player */
function updatePooledLights(dt, tm, focus) {
  // update fixture panel visuals (cheap) every frame for near ones
  for (const f of World.fixtures) {
    const dx = f.x - focus.x, dz = f.z - focus.z; f.near = dx * dx + dz * dz < 40 * 40;
    if (!f.near) continue;
    f.cur = fixBright(f, tm);
    if (f.idx !== undefined && FIX.mesh) { const lit = f.cur > 0.45; if (lit !== f.lit) { f.lit = lit; FIX.mesh.setColorAt(f.idx, lit ? COL_ON : COL_OFF); FIX.dirty = true; } }
    if (f.sprite) { f.sprite.visible = f.on; f.sprite.material.opacity = f.cur; }
  }
  if (FIX.dirty && FIX.mesh) { FIX.mesh.instanceColor.needsUpdate = true; FIX.dirty = false; }
  _poolTimer.t -= dt;
  if (_poolTimer.t <= 0) {
    _poolTimer.t = 0.12; _cands.length = 0;
    const eyeY = focus.y + 1.2;
    for (const f of World.fixtures) {
      if (!f.on || !f.near) continue;
      const dx = f.x - focus.x, dz = f.z - focus.z, dy = f.y - focus.y; const d2 = dx * dx + dz * dz;
      if (d2 > 13 * 13 || Math.abs(dy) > 5) continue;
      if (d2 > 2.5 && !losClear(f.x, f.y, f.z, focus.x, eyeY, focus.z)) continue;
      _cands.push({ f, d2 });
    }
    _cands.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < poolLights.length; i++) { const l = poolLights[i], c = _cands[i]; l.userData.nf = c ? c.f : null; }
  }
  const nAllowed = Math.min(QUALITY[S.quality].lights, poolLights.length);
  for (let i = 0; i < poolLights.length; i++) {
    const l = poolLights[i]; const f = l.userData.nf;
    if (i >= nAllowed || !f) { l.userData.cur = damp(l.userData.cur, 0, 10, dt); l.intensity = l.userData.cur; continue; }
    if (l.userData.fix !== f) { l.userData.fix = f; l.position.set(f.x, f.y - 0.2, f.z); l.color.setHex(f.color); l.distance = f.candle ? 7 : 11; l.userData.cur = 0; }
    const tgt = f.cur * (f.candle ? 9 : 17) * (G.fireTimer > 0 ? 1.1 : 1);
    l.userData.cur = damp(l.userData.cur, tgt, 14, dt); l.intensity = l.userData.cur;
  }
}

/* ---------- furniture & props ---------- */
const R = {};                       // rooms by id
const boards = {};                  // writable blackboards by room id
const FACE = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

function pbox(mat, ox, oz, rot, lx, ly, lz, w, h, d, col, o) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const x = ox + lx * c + lz * s, z = oz - lx * s + lz * c;
  const quarter = Math.abs(Math.sin(2 * rot)) < 0.02, swap = quarter && Math.abs(Math.sin(rot)) > 0.7;
  return addBox(mat, x, ly, z, swap ? d : w, h, swap ? w : d, Object.assign({ col: quarter ? col : null, ry: quarter ? 0 : rot, tile: 1 }, o || {}));
}
function pcol(ox, oz, rot, lx, lz, w, d, y0, y1, kind = 'furn', extra) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const x = ox + lx * c + lz * s, z = oz - lx * s + lz * c;
  const swap = Math.abs(Math.sin(rot)) > 0.7;
  const W = swap ? d : w, D = swap ? w : d;
  return addCollider(x - W / 2, z - D / 2, x + W / 2, z + D / 2, y0 + BASE_Y, y1 + BASE_Y, kind, extra);
}
function chairAt(x, z, rot, mat = 'chair') {
  pbox(mat, x, z, rot, 0, 0.45, 0, 0.42, 0.04, 0.42);
  pbox(mat, x, z, rot, 0, 0.7, 0.2, 0.42, 0.42, 0.04);
  pbox('pipe', x, z, rot, -0.17, 0.22, 0, 0.03, 0.44, 0.36); pbox('pipe', x, z, rot, 0.17, 0.22, 0, 0.03, 0.44, 0.36);
}
function deskSet(x, z, rot) {
  pbox('wood', x, z, rot, 0, 0.76, 0, 0.8, 0.04, 0.5);
  pbox('pipe', x, z, rot, -0.36, 0.37, 0, 0.04, 0.74, 0.44); pbox('pipe', x, z, rot, 0.36, 0.37, 0, 0.04, 0.74, 0.44);
  pbox('wood', x, z, rot, 0, 0.5, -0.2, 0.7, 0.2, 0.03);
  pcol(x, z, rot, 0, 0, 0.8, 0.5, 0, 0.78);
  const jz = rand(0.55, 0.78), jr = rand(-0.3, 0.3), c = Math.cos(rot), s = Math.sin(rot);
  chairAt(x + jz * s, z + jz * c, rot + jr);
}
function teacherDesk(x, z, rot) {
  pbox('woodDark', x, z, rot, 0, 0.76, 0, 1.7, 0.05, 0.85);
  pbox('wood', x, z, rot, -0.55, 0.37, 0, 0.5, 0.72, 0.8); pbox('wood', x, z, rot, 0.8, 0.37, 0, 0.05, 0.72, 0.8); pbox('wood', x, z, rot, 0.1, 0.37, -0.38, 1.2, 0.72, 0.05);
  pcol(x, z, rot, 0, 0, 1.7, 0.85, 0, 0.8);
  const c = Math.cos(rot), s = Math.sin(rot); chairAt(x - 0.9 * s, z - 0.9 * c, rot + Math.PI + 0.2, 'chair2');
}
function bookshelf(x, z, rot, w = 2.0, h = 2.2) {
  pbox('woodDark', x, z, rot, 0, h / 2, 0, w, h, 0.4, null);
  pbox('books', x, z, rot, 0, h / 2, 0.21, w - 0.1, h - 0.1, 0.02, null, { tile: 2 });
  pcol(x, z, rot, 0, 0, w, 0.4, 0, h);
}
function cabinet(x, z, rot, w = 1.0, h = 1.9) { pbox('metal', x, z, rot, 0, h / 2, 0, w, h, 0.5, 'furn', { tile: 1.2 }); }
function table(x, z, w, d, h = 0.76, mat = 'wood', rot = 0) {
  pbox(mat, x, z, rot, 0, h, 0, w, 0.05, d); const lx = w / 2 - 0.08, lz = d / 2 - 0.08;
  for (const a of [-1, 1]) for (const b of [-1, 1]) pbox('pipe', x, z, rot, a * lx, h / 2, b * lz, 0.05, h, 0.05);
  pcol(x, z, rot, 0, 0, w, d, 0, h + 0.03);
}
function bench(x, z, w, rot = 0, h = 0.45) { pbox('wood', x, z, rot, 0, h, 0, w, 0.05, 0.32); pbox('pipe', x, z, rot, -w / 2 + 0.1, h / 2, 0, 0.05, h, 0.28); pbox('pipe', x, z, rot, w / 2 - 0.1, h / 2, 0, 0.05, h, 0.28); pcol(x, z, rot, 0, 0, w, 0.34, 0, h + 0.03); }
function crate(x, z, s = 0.8, y0 = 0, rot = 0) { addBox('crate', x, y0 + s / 2, z, s, s, s, { col: 'furn', ry: rot, tile: 0.8 }); }
function bed(x, z, rot) {
  pbox('metal', x, z, rot, 0, 0.35, 0, 0.9, 0.08, 2.0, null); pbox('sheet', x, z, rot, 0, 0.5, 0.05, 0.86, 0.2, 1.8, null); pbox('white', x, z, rot, 0, 0.64, -0.75, 0.5, 0.1, 0.3, null);
  pbox('pipe', x, z, rot, 0, 0.7, -1.0, 0.9, 0.7, 0.04, null); pcol(x, z, rot, 0, 0, 0.9, 2.0, 0, 0.75);
}
function sofa(x, z, rot) {
  pbox('cloth', x, z, rot, 0, 0.3, 0, 2.0, 0.4, 0.85, null); pbox('cloth', x, z, rot, 0, 0.7, -0.38, 2.0, 0.5, 0.2, null);
  pbox('cloth', x, z, rot, -0.95, 0.5, 0, 0.14, 0.4, 0.85, null); pbox('cloth', x, z, rot, 0.95, 0.5, 0, 0.14, 0.4, 0.85, null); pcol(x, z, rot, 0, 0, 2.0, 0.85, 0, 0.6);
}
function shelfUnit(x, z, rot, w = 1.6, d = 0.45, h = 2.0, mat = 'metal') {
  for (const lx of [-w / 2, w / 2]) pbox('pipe', x, z, rot, lx, h / 2, 0, 0.05, h, d, null);
  for (let i = 0; i < 4; i++) pbox(mat, x, z, rot, 0, 0.15 + i * (h - 0.2) / 3, 0, w, 0.04, d, null);
  pcol(x, z, rot, 0, 0, w, d, 0, h);
}
function labTable(x, z, rot = 0) {
  pbox('black', x, z, rot, 0, 0.92, 0, 2.4, 0.06, 0.9); pbox('wood', x, z, rot, 0, 0.45, 0, 2.3, 0.88, 0.8); pcol(x, z, rot, 0, 0, 2.4, 0.9, 0, 0.95);
  const bw = [0xaa3333, 0x3a8a55, 0x3a5aa0, 0xc0a030];
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 8), new THREE.MeshStandardMaterial({ color: bw[i], transparent: true, opacity: 0.55, roughness: 0.2 })); m.position.set(x + (i - 1.5) * 0.45 * Math.cos(rot), 1.03, z - (i - 1.5) * 0.45 * Math.sin(rot) + 0.1); levelGroup.add(m); }
}
function pipeRun(x0, y, z0, x1, z1, r = 0.1, mat = 'pipe') {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const g = new THREE.CylinderGeometry(r, r, len, 8); g.rotateZ(Math.PI / 2); g.rotateY(-Math.atan2(dz, dx)); g.translate((x0 + x1) / 2, y + BASE_Y, (z0 + z1) / 2);
  addGeo(mat, g, (x0 + x1) / 2, (z0 + z1) / 2);
}
function wallDecal(room, side, along, y, w, h, tex, opts = {}) {
  const o = 0.17; let x, z, ry;
  if (side === 'N') { x = along; z = room.z0 + o; ry = 0; } else if (side === 'S') { x = along; z = room.z1 - o; ry = Math.PI; }
  else if (side === 'W') { x = room.x0 + o; z = along; ry = Math.PI / 2; } else { x = room.x1 - o; z = along; ry = -Math.PI / 2; }
  const bk = opts.batch || (tex === T.portrait ? 'portrait' : tex === T.missing ? 'missing' : (tex === T.blood ? 'blood' : null));
  if (bk) { const g = new THREE.PlaneGeometry(w, h); g.rotateY(ry); g.translate(x, y + BASE_Y, z); addGeo(bk, g, x, z); return null; }
  const mat = opts.mat || mkMat(0xffffff, tex, { transparent: !!opts.transparent, side: THREE.DoubleSide, roughness: 0.8 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y + BASE_Y, z); m.rotation.y = ry; m.receiveShadow = true; levelGroup.add(m); return m;
}
function windowAt(room, side, along, y = 1.9) {
  wallDecal(room, side, along, y, 1.5, 1.2, null, { batch: 'window' });
  const f = FACE[side === 'N' ? 'S' : side === 'S' ? 'N' : side === 'W' ? 'E' : 'W'];   // inward normal
  const o = 0.2; let px, pz;
  if (side === 'N') { px = along; pz = room.z0 + o; } else if (side === 'S') { px = along; pz = room.z1 - o; } else if (side === 'W') { px = room.x0 + o; pz = along; } else { px = room.x1 - o; pz = along; }
  const horiz = side === 'N' || side === 'S';
  addBox('black', px, y, pz, horiz ? 1.56 : 0.05, 0.05, horiz ? 0.05 : 1.56); addBox('black', px, y, pz, horiz ? 0.05 : 0.05, 1.26, horiz ? 0.05 : 0.05);
  addBox('black', px, y - 0.62, pz, horiz ? 1.6 : 0.1, 0.06, horiz ? 0.1 : 1.6);
  for (let i = -2; i <= 2; i++) { if (horiz) addBox('black', px + i * 0.3, y, pz, 0.02, 1.2, 0.02); else addBox('black', px, y, pz + i * 0.3, 0.02, 1.2, 0.02); }
  return f;
}
function makeBoard(room, side, along, w = 5, y = 1.75, h = 1.25) {
  const tex = canvasTex(1024, 256, () => {}, false); const ctx = tex.userData.ctx; const cv = tex.userData.canvas;
  const b = { tex, write(lines, red) {
    ctx.fillStyle = '#1b2a24'; ctx.fillRect(0, 0, 1024, 256); blotches(ctx, 1024, 256, 40, '210,220,210', 0.05, 20, 90);
    ctx.fillStyle = 'rgba(240,240,230,0.5)'; ctx.font = '28px "Special Elite", monospace'; ctx.textAlign = 'left';
    if (!lines) { ctx.fillText('x² + y² = r²', 40, 70); ctx.fillText('E = mc²', 40, 130); ctx.fillText('3 × 14 = ?', 600, 90); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.strokeRect(590, 130, 300, 90); }
    else { ctx.textAlign = 'center'; ctx.font = 'bold 54px Cairo, "Special Elite", sans-serif'; ctx.fillStyle = red ? 'rgba(200,20,20,0.92)' : 'rgba(240,240,230,0.85)'; lines.forEach((l, i) => ctx.fillText(l, 512, 110 + i * 70)); }
    tex.needsUpdate = true;
  } };
  b.write(null);
  const m = wallDecal(room, side, along, y, w, h, tex); b.mesh = m;
  const horiz = side === 'N' || side === 'S'; const o = 0.18; let px, pz;
  if (side === 'N') { px = along; pz = room.z0 + o; } else if (side === 'S') { px = along; pz = room.z1 - o; } else if (side === 'W') { px = room.x0 + o; pz = along; } else { px = room.x1 - o; pz = along; }
  addBox('woodDark', px, y + h / 2 + 0.04, pz, horiz ? w + 0.2 : 0.06, 0.08, horiz ? 0.06 : w + 0.2); addBox('woodDark', px, y - h / 2 - 0.04, pz, horiz ? w + 0.2 : 0.1, 0.08, horiz ? 0.1 : w + 0.2);
  boards[room.id] = b; return b;
}
function scatterPapers(room, n) {
  for (let i = 0; i < n; i++) addBox('paper', rand(room.x0 + 0.8, room.x1 - 0.8), room.y + 0.012, rand(room.z0 + 0.8, room.z1 - 0.8), 0.24, 0.006, 0.32, { ry: rand(0, TAU), tile: 0.3 });
}
function bloodMark(room, side, along, y, s = 1.2) { return wallDecal(room, side, along, y, s, s, T.blood, { transparent: true }); }

/* ---------- lockers & hiding places ---------- */
function addLocker(x, z, face, hide, room) {
  const f = FACE[face], yawF = Math.atan2(f[0], f[1]);
  const alongX = face === 'N' || face === 'S';
  const hw = alongX ? 0.275 : 0.25, hd = alongX ? 0.25 : 0.275, y0 = room.y;
  addBox('metal', x, y0 + 0.95, z, hw * 2, 1.9, hd * 2, { col: 'furn', tile: 1.2 });
  addBox('black', x, y0 + 1.93, z, hw * 2 + 0.02, 0.05, hd * 2 + 0.02);
  if (!hide) { addBox('metal', x + f[0] * 0.27, y0 + 0.97, z + f[1] * 0.27, alongX ? 0.5 : 0.025, 1.78, alongX ? 0.025 : 0.5, { tile: 1.2 }); return null; }
  const root = new THREE.Group(); root.position.set(x + f[0] * 0.255, y0 + 0.08, z + f[1] * 0.255); root.rotation.y = yawF;
  const pivot = new THREE.Group(); pivot.position.set(-0.25, 0, 0); root.add(pivot);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.78, 0.025), MAT.metal); leaf.position.set(0.25, 0.89, 0); leaf.castShadow = true; leaf.receiveShadow = true; pivot.add(leaf);
  dynGroup.add(root);
  const spot = { id: 'hide_' + World.hides.length, x, z, y: y0, fx: f[0], fz: f[1], yaw: yawF, pivot, amt: 0, tgt: 0, occupied: false, room, pos: new THREE.Vector3(x + f[0] * 0.75, y0 + 1, z + f[1] * 0.75), stand: new THREE.Vector3(x + f[0] * 0.8, y0, z + f[1] * 0.8) };
  World.hides.push(spot); return spot;
}
/* crawl space under a desk / bed / table: no door, low camera, wider view */
function addUnderSpot(x, z, room, face = 'S', h = 0.62) {
  const f = FACE[face];
  const spot = { id: 'under_' + World.hides.length, x, z, y: room.y, fx: f[0], fz: f[1], yaw: Math.atan2(f[0], f[1]), pivot: null, under: true, camY: 0.42, amt: 0, tgt: 0, occupied: false, room,
    pos: new THREE.Vector3(x, room.y + 0.35, z), stand: new THREE.Vector3(x + f[0] * 1.05, room.y, z + f[1] * 1.05) };
  void h; World.hides.push(spot); return spot;
}
function lockerBank(x, z, face, n, hideIdx, room) {
  const alongX = face === 'N' || face === 'S';
  for (let i = 0; i < n; i++) addLocker(alongX ? x + i * 0.56 : x, alongX ? z : z + i * 0.56, face, hideIdx.includes(i), room);
}

/* ---------- collectible items ---------- */
const ITEM_COL = { library_key: 0xd9b44a, lab_key: 0x4fc3d8, basement_key: 0xd04a4a, main_key: 0xeeeeee };
function makeItemMesh(def) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const metal = (c, e = 0.3) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.8, roughness: 0.3, emissive: c, emissiveIntensity: e });
  switch (def.type) {
    case 'key': { const m = metal(ITEM_COL[def.key] || 0xffd060); const r = add(new THREE.TorusGeometry(0.045, 0.014, 6, 14), m, -0.09, 0.03, 0); r.rotation.x = Math.PI / 2; add(new THREE.BoxGeometry(0.15, 0.016, 0.016), m, 0.0, 0.03, 0); add(new THREE.BoxGeometry(0.016, 0.016, 0.04), m, 0.06, 0.03, 0.02); add(new THREE.BoxGeometry(0.016, 0.016, 0.03), m, 0.035, 0.03, 0.015); g.scale.setScalar(1.5); break; }
    case 'battery': { add(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0x2d9d3a, metalness: 0.4, roughness: 0.4, emissive: 0x0a3a10 }), 0, 0.06, 0).rotation.z = Math.PI / 2; add(new THREE.CylinderGeometry(0.015, 0.015, 0.02, 8), new THREE.MeshStandardMaterial({ color: 0xcccccc }), 0.07, 0.06, 0).rotation.z = Math.PI / 2; g.scale.setScalar(1.4); break; }
    case 'fuse': { add(new THREE.CylinderGeometry(0.025, 0.025, 0.11, 10), new THREE.MeshStandardMaterial({ color: 0xffcc66, transparent: true, opacity: 0.75, emissive: 0x553300 }), 0, 0.07, 0); add(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), metal(0xb0b0b0, 0.1), 0, 0.13, 0); add(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), metal(0xb0b0b0, 0.1), 0, 0.01, 0); g.scale.setScalar(1.5); break; }
    case 'flashlight': { const m = metal(0x2a2a30, 0.1); const b = add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), m, 0, 0.04, 0); b.rotation.z = Math.PI / 2; const h = add(new THREE.CylinderGeometry(0.05, 0.035, 0.07, 10), metal(0xbbbbbb, 0.2), 0.13, 0.04, 0); h.rotation.z = -Math.PI / 2; g.scale.setScalar(1.3); break; }
    case 'note': { add(new THREE.BoxGeometry(0.22, 0.006, 0.3), new THREE.MeshStandardMaterial({ map: T.paper, emissive: 0x3a3320, roughness: 0.9 }), 0, 0.01, 0); g.rotation.y = rand(0, TAU); break; }
    case 'medkit': { add(new THREE.BoxGeometry(0.28, 0.11, 0.2), new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0x222222 }), 0, 0.055, 0); const red = new THREE.MeshStandardMaterial({ color: 0xcc1111, emissive: 0x440000 }); add(new THREE.BoxGeometry(0.1, 0.005, 0.03), red, 0, 0.113, 0); add(new THREE.BoxGeometry(0.03, 0.005, 0.1), red, 0, 0.113, 0); break; }
    case 'throwable': {
      if (def.kind === 'chalk') {
        const m = new THREE.MeshStandardMaterial({ color: 0xf2eede, roughness: 0.9, emissive: 0x2a2a26 });
        for (let i = 0; i < 3; i++) { const c = add(new THREE.CylinderGeometry(0.012, 0.012, 0.075, 7), m, (i - 1) * 0.03, 0.013, i * 0.012); c.rotation.z = Math.PI / 2; c.rotation.y = i * 0.3; }
        g.scale.setScalar(1.6);
      } else {
        add(new THREE.CylinderGeometry(0.035, 0.042, 0.17, 10), new THREE.MeshStandardMaterial({ color: 0x3f7a4a, transparent: true, opacity: 0.68, roughness: 0.18, emissive: 0x102a16 }), 0, 0.085, 0);
        add(new THREE.CylinderGeometry(0.016, 0.03, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0x3f7a4a, transparent: true, opacity: 0.68, roughness: 0.18 }), 0, 0.2, 0);
        g.scale.setScalar(1.25);
      }
      break;
    }
    case 'relic': {
      if (def.relic === 'box') { const m = metal(0x8a5a22, 0.25), dk = metal(0x3a2410, 0.1); add(new THREE.BoxGeometry(0.24, 0.12, 0.16), m, 0, 0.06, 0); add(new THREE.BoxGeometry(0.25, 0.015, 0.17), dk, 0, 0.127, 0); add(new THREE.TorusGeometry(0.03, 0.007, 6, 12), metal(0xd8b45a, 0.5), 0.15, 0.06, 0).rotation.y = Math.PI / 2; add(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 6), dk, 0.15, 0.11, 0.02); add(new THREE.SphereGeometry(0.022, 8, 6), metal(0xe6c874, 0.7), 0, 0.15, 0); g.scale.setScalar(1.5); }
      else if (def.relic === 'locket') { const m = metal(0xd8b45a, 0.55); const r = add(new THREE.TorusGeometry(0.038, 0.011, 6, 16), m, 0, 0.06, 0); r.rotation.x = Math.PI / 2; add(new THREE.SphereGeometry(0.028, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc23a4a, emissive: 0x7a1020, emissiveIntensity: 0.7, roughness: 0.25 }), 0, 0.06, 0); add(new THREE.TorusGeometry(0.012, 0.004, 6, 10), m, 0, 0.11, 0); g.scale.setScalar(2.0); }
      else { const gold = metal(0xc9a24a, 0.3); add(new THREE.BoxGeometry(0.26, 0.19, 0.012), gold, 0, 0.1, 0); add(new THREE.PlaneGeometry(0.21, 0.14), new THREE.MeshStandardMaterial({ map: T.portrait, roughness: 0.7, emissive: 0x332211, side: THREE.DoubleSide }), 0, 0.1, 0.008); add(new THREE.BoxGeometry(0.04, 0.03, 0.03), gold, 0.1, 0.2, 0); g.rotation.x = -0.25; g.scale.setScalar(1.35); }
      break;
    }
    case 'ring': { const m = metal(0xffd24a, 0.6); const r = add(new THREE.TorusGeometry(0.02, 0.006, 8, 14), m, 0, 0.03, 0); r.rotation.x = Math.PI / 2.4; add(new THREE.OctahedronGeometry(0.012), new THREE.MeshStandardMaterial({ color: 0xaaddff, emissive: 0x88bbff, emissiveIntensity: 1 }), 0, 0.055, 0.0); g.scale.setScalar(2.2); break; }
    default: add(new THREE.BoxGeometry(0.1, 0.1, 0.1), MAT.white);
  }
  const sp = new THREE.Sprite(MAT.glow.clone()); sp.scale.setScalar(def.type === 'note' ? 0.5 : 0.65); sp.position.y = 0.12; sp.material.opacity = 0.75; g.add(sp); g.userData.glow = sp;
  return g;
}
const ITEMS = [
  { id: 'flashlight', type: 'flashlight', x: 6.5, y: 0.8, z: 1.95 },
  { id: 'n_slip', type: 'note', note: 'slip', x: 2.2, y: 0.79, z: 8.6 },
  { id: 'bat1', type: 'battery', x: 10.0, y: 0.79, z: 4.6 },
  { id: 'k_library', type: 'key', key: 'library_key', x: 18.5, y: 0.81, z: 1.95 },
  { id: 'n_d1', type: 'note', note: 'd1', x: 19.4, y: 0.79, z: 6.6 },
  { id: 'bat2', type: 'battery', x: 34.0, y: 0.79, z: 4.6 },
  { id: 'n_d2', type: 'note', note: 'd2', x: 17.6, y: 0.5, z: 19.5 },
  { id: 'bat3', type: 'battery', x: 25.3, y: 0.93, z: 19.0 },
  { id: 'n_d3', type: 'note', note: 'd3', x: 48.5, y: 0.78, z: 9.0 },
  { id: 'n_d4', type: 'note', note: 'd4', x: 43.2, y: 0.79, z: -6.1 },
  { id: 'k_lab', type: 'key', key: 'lab_key', x: 44.5, y: 0.81, z: -6.0 },
  { id: 'fuse1', type: 'fuse', x: 58.0, y: 0.96, z: 3.0 },
  { id: 'n_d5', type: 'note', note: 'd5', x: 54.8, y: 0.96, z: 3.0 },
  { id: 'n_d6', type: 'note', note: 'd6', x: 30.4, y: 0.79, z: 19.6 },
  { id: 'k_basement', type: 'key', key: 'basement_key', x: 31.5, y: 0.81, z: 19.6 },
  { id: 'med1', type: 'medkit', x: 38.3, y: 0.78, z: 16.2 },
  { id: 'fuse2', type: 'fuse', x: 51.4, y: 1.37, z: 20.0 },
  { id: 'bat4', type: 'battery', x: 45.4, y: 0.92, z: 16.6 },
  { id: 'bat5', type: 'battery', x: 30.0, y: 0.78, z: 36.0 },
  { id: 'bat6', type: 'battery', x: 38.7, y: 0.93, z: 33.0 },
  { id: 'med2', type: 'medkit', x: 60.0, y: 0.78, z: 36.0 },
  { id: 'bat7', type: 'battery', x: 67.0, y: -3.0, z: 9.2 },
  { id: 'n_d7', type: 'note', note: 'd7', x: 102.4, y: -2.9, z: 14.6 },
  { id: 'bat8', type: 'battery', x: 78.8, y: -2.9, z: 28.5 },
  { id: 'med3', type: 'medkit', x: 66.9, y: -2.63, z: 25.0 },
  { id: 'k_main', type: 'key', key: 'main_key', x: 97.6, y: -3.08, z: 28.6 },
  { id: 'ring', type: 'ring', x: 98.9, y: -3.08, z: 28.6 },
  { id: 'n_d8', type: 'note', note: 'd8', x: 99.9, y: -3.1, z: 28.5 },
  { id: 'chalk1', type: 'throwable', kind: 'chalk', n: 3, x: 5.4, y: 0.79, z: 2.0 },
  { id: 'chalk2', type: 'throwable', kind: 'chalk', n: 3, x: 17.2, y: 0.79, z: 2.0 },
  { id: 'chalk3', type: 'throwable', kind: 'chalk', n: 3, x: 29.3, y: 0.79, z: 2.0 },
  { id: 'bottle1', type: 'throwable', kind: 'bottle', n: 2, x: 56.2, y: 0.98, z: 3.0 },
  { id: 'bottle2', type: 'throwable', kind: 'bottle', n: 2, x: 26.0, y: 1.03, z: 39.3 },
  { id: 'bottle3', type: 'throwable', kind: 'bottle', n: 2, x: 90.4, y: -3.0, z: 25.0 },
  { id: 'chalk4', type: 'throwable', kind: 'chalk', n: 4, x: 60.0, y: 0.79, z: 36.0 },
  { id: 'chalk5', type: 'throwable', kind: 'chalk', n: 3, x: 102.4, y: 1.16, z: 13.8 },
  { id: 'relic_box', type: 'relic', relic: 'box', x: 43.55, y: 0.86, z: -6.1 },
  { id: 'relic_locket', type: 'relic', relic: 'locket', x: 102.4, y: 1.16, z: 14.6 },
  { id: 'relic_photo', type: 'relic', relic: 'photo', x: 53.8, y: 1.18, z: 34.2 },
];

/* ---------- build whole level (async so the loading bar can animate) ---------- */
async function buildLevel(progress) {
  scene.add(levelGroup); scene.add(dynGroup);
  progress(0.05, 'load_rooms'); await nextFrame();
  for (const d of ROOM_DEFS) {
    const r = Object.assign({ y: 0, h: WALL_H, ceil: true }, d); r.cx = (r.x0 + r.x1) / 2; r.cz = (r.z0 + r.z1) / 2; r.area = (r.x1 - r.x0) * (r.z1 - r.z0);
    R[r.id] = r; World.rooms.push(r);
  }
  R.secret1.candles = [[43.6, 0.9, -6.4], [44.8, 0.9, -6.4], [41.0, 0.55, -1.2], [46.8, 0.55, -1.0]];
  R.shrine.candles = [[96.6, -2.98, 28.9], [99.4, -2.98, 28.9], [95.6, -3.9, 24], [100.8, -3.9, 24], [98, -3.9, 22]];
  for (const r of World.rooms) buildShell(r);
  // stairs (visual steps + collision ramp)
  addBox('floorConc', 53, -0.05, 18, 2, 0.1, 6, { tile: 2 });
  { const g = planeGeo(10, 6, 2, true); g.translate(59, -4, 18); addGeo('floorConc', g, 59, 18); }
  for (let i = 0; i < 20; i++) { const top = -0.2 * (i + 0.5); addBox('floorConc', 54.2 + 0.4 * i, (top - 4) / 2, 18, 0.4, top + 4, 6, { tile: 1 }); }
  World.zones.push({ x0: -4, z0: -12, x1: 64, z1: 44, y: 0, holes: [[54, 15, 64, 21]] }, { x0: 62, z0: 3, x1: 106, z1: 33, y: -4 });
  World.ramps.push({ x0: 54, z0: 15, x1: 62, z1: 21, y0: 0, y1: -4 });

  progress(0.2, 'load_doors'); await nextFrame();
  for (const o of OPENINGS) {
    if (o.type === 'arch') continue;
    const d = new Door(Object.assign({ w: DOOR_W, top: DOOR_H, y: 0 }, o)); World.doors.push(d);
    d.room = roomAt(d.cx, d.cz) || null;
  }
  World.doorById = {}; for (const d of World.doors) World.doorById[d.id] = d;

  progress(0.35, 'load_furniture'); await nextFrame();
  decorateRooms();
  progress(0.6, 'load_lights'); await nextFrame();
  for (const r of World.rooms) buildFixtures(r);
  buildFixtureMesh();
  flushBatches();

  progress(0.75, 'load_items'); await nextFrame();
  for (const def of ITEMS) {
    const mesh = makeItemMesh(def); mesh.position.set(def.x, def.y, def.z); dynGroup.add(mesh);
    const it = { def, mesh, picked: false, pos: new THREE.Vector3(def.x, def.y + 0.2, def.z) }; World.items.push(it);
  }
  progress(0.88, 'load_nav'); await nextFrame();
  buildNav();
  progress(1, 'load_done');
}

let BASE_Y = 0;     // vertical offset used while decorating basement rooms
function at(room, fn) { BASE_Y = room.y; try { fn(room); } finally { BASE_Y = 0; } }

function decorateRooms() {
  const PI = Math.PI;
  const classroom = (r, xs, zs, skip) => {
    makeBoard(r, 'N', r.cx, 5); teacherDesk(r.cx, r.z0 + 2.0, 0);
    xs.forEach((x, i) => zs.forEach((z, j) => { if (!skip || !skip.includes(i + ',' + j)) deskSet(x, z, 0); }));
    windowAt(r, 'N', r.x0 + 1.5); windowAt(r, 'N', r.x1 - 1.5); scatterPapers(r, 8);
  };
  /* ---- classrooms ---- */
  classroom(R.class1a, [2.2, 4.8, 7.4, 10.0], [4.6, 6.6, 8.6], ['2,2']);
  cabinet(0.42, 7.5, PI / 2, 1.2, 1.9); lockerBank(11.6, 2.0, 'W', 3, [1], R.class1a);
  wallDecal(R.class1a, 'W', 3.5, 1.8, 0.8, 1.2, T.poster('RULES', '#b7a57a'));
  classroom(R.class2b, [14.2, 16.8, 19.4, 22.0], [4.6, 6.6, 8.6]);
  bookshelf(23.6, 5.0, -PI / 2, 2.0); lockerBank(12.45, 1.5, 'E', 3, [0], R.class2b);
  wallDecal(R.class2b, 'S', 14, 1.8, 0.8, 1.2, T.poster('MATH', '#8fa3a0'));
  classroom(R.class3c, [26.2, 28.8, 31.4, 34.0], [4.6, 6.6, 8.6], ['1,1', '2,0']);
  lockerBank(35.6, 6.5, 'W', 3, [0, 2], R.class3c); cabinet(24.45, 3.0, PI / 2, 1.4, 1.9);
  bloodMark(R.class3c, 'N', 29.0, 1.3, 1.5);
  chairAt(29.6, 6.0, 1.7); chairAt(32.6, 7.7, 4.2);
  /* ---- library ---- */
  const lib = R.library;
  [37.2, 39.4, 41.6, 48.2, 50.4].forEach((x) => bookshelf(x, 0.37, 0, 2.0));
  [[38.8, 4.2], [41.2, 4.2], [38.8, 7.0], [41.2, 7.0], [48.0, 4.6], [50.4, 4.6], [48.0, 7.2]].forEach(([x, z]) => bookshelf(x, z, 0, 2.0));
  table(49.5, 9.0, 2.4, 1.0, 0.76, 'woodDark'); chairAt(49.0, 9.95, PI + 0.2); chairAt(50.4, 8.0, 0.1); table(45.2, 8.4, 1.6, 0.9, 0.76, 'woodDark');
  teacherDesk(38.0, 8.9, PI / 2); lockerBank(51.6, 1.6, 'W', 2, [0, 1], lib); scatterPapers(lib, 10);
  /* ---- secret study ---- */
  at(R.secret1, (r) => {
    table(44.0, -6.1, 2.0, 0.8, 0.78, 'woodDark'); chairAt(44.0, -5.0, PI + 0.3, 'chair2');
    bookshelf(40.4, -4.0, PI / 2, 3.0); bookshelf(47.6, -4.0, -PI / 2, 3.0);
    wallDecal(r, 'N', 44, 1.9, 0.9, 1.1, T.portrait); wallDecal(r, 'W', -1.5, 1.7, 0.5, 0.65, T.portrait);
    bed(41.5, -1.6, 0.0); scatterPapers(r, 6);
  });
  /* ---- laboratory ---- */
  [[54.8, 3.0], [58.0, 3.0], [61.2, 3.0], [54.8, 6.2], [61.2, 6.2]].forEach(([x, z]) => labTable(x, z));
  table(60, 0.75, 5, 0.6, 0.9, 'woodDark'); table(55, 0.75, 2.4, 0.6, 0.9, 'woodDark');
  lockerBank(63.6, 8.0, 'W', 2, [0, 1], R.lab); cabinet(52.45, 8.5, PI / 2, 1.2, 1.9);
  bloodMark(R.lab, 'E', 4.5, 1.1, 1.3); windowAt(R.lab, 'N', 63.0 - 4, 1.9); scatterPapers(R.lab, 6);
  /* ---- corridor 1 ---- */
  const c1 = R.corridor1;
  lockerBank(2.0, 11.4, 'S', 4, [1, 3], c1); lockerBank(12.5, 11.4, 'S', 4, [2], c1); lockerBank(29.5, 11.4, 'S', 4, [0, 3], c1);
  lockerBank(43.0, 11.4, 'S', 5, [2], c1); lockerBank(61.2, 11.4, 'S', 2, [1], c1);
  wallDecal(c1, 'S', 24.5, 2.3, 0.7, 0.7, T.clock);
  bench(16, 14.6, 1.8); bench(36.5, 14.6, 1.8);
  wallDecal(c1, 'N', 6, 1.7, 0.55, 0.85, T.missing); wallDecal(c1, 'N', 17, 1.7, 0.55, 0.85, T.missing); wallDecal(c1, 'N', 34.6, 1.7, 0.55, 0.85, T.poster('HALL', '#a09a80')); wallDecal(c1, 'N', 52, 1.7, 0.55, 0.85, T.missing);
  bloodMark(c1, 'N', 24.0, 1.3, 1.4); bloodMark(c1, 'N', 49.5, 1.2, 1.1); scatterPapers(c1, 12);
  /* ---- entrance hall ---- */
  const hall = R.hall;
  addBox('woodDark', 0.42, 1.0, 21, 0.5, 2.0, 2.6, { col: 'furn' }); addBox('glass', 0.7, 1.2, 21, 0.02, 1.2, 2.4);
  table(10.9, 19.5, 0.8, 3.0, 1.05, 'woodDark'); chairAt(12.3, 19.5, -PI / 2, 'chair2');
  bench(5.0, 33.5, 3.0, 0); bench(9.5, 33.5, 3.0, 0); lockerBank(0.4, 28.0, 'E', 4, [1, 2], hall); lockerBank(13.6, 34.0, 'W', 3, [1], hall);
  windowAt(hall, 'S', 2.2); windowAt(hall, 'S', 12.0); bloodMark(hall, 'S', 7.0, 1.1, 1.8);
  wallDecal(hall, 'E', 21.5, 1.8, 1.2, 0.9, T.poster('MAP', '#7d8f80')); wallDecal(hall, 'E', 38, 1.8, 0.55, 0.85, T.missing); scatterPapers(hall, 12);
  /* ---- lounge ---- */
  const lo = R.lounge;
  sofa(14.7, 20, PI / 2); table(17.6, 19.5, 1.0, 0.6, 0.45, 'woodDark'); table(25.4, 19, 0.6, 4, 0.9, 'woodDark'); cabinet(25.45, 22.8, -PI / 2, 0.9, 1.8);
  lockerBank(22.0, 15.4, 'S', 3, [1], lo); table(21, 21.6, 2.0, 1.0); chairAt(20.2, 22.7, 0); chairAt(21.8, 20.4, PI);
  wallDecal(lo, 'W', 16.5, 1.8, 0.8, 1.2, T.poster('STAFF', '#a79a7c'));
  /* ---- principal's office ---- */
  const of = R.office;
  teacherDesk(31, 19.6, PI); chairAt(30.4, 17.6, PI); chairAt(31.8, 17.5, PI - 0.3);
  [17.5, 19.7, 21.9].forEach((z) => bookshelf(26.4, z, PI / 2, 2.0)); cabinet(35.6, 16.5, -PI / 2, 1.0, 1.3); cabinet(35.6, 18.0, -PI / 2, 1.0, 1.3);
  wallDecal(of, 'E', 21.8, 1.9, 0.9, 1.1, T.portrait); addLocker(35.6, 23.8, 'W', true, of); scatterPapers(of, 8);
  /* ---- nurse ---- */
  const nu = R.nurse;
  bed(42.8, 17.8, 0); bed(42.8, 21.6, 0); table(38.3, 16.2, 1.0, 0.6, 0.75); cabinet(36.45, 20.5, PI / 2, 1.4, 1.9); addLocker(36.5, 23.5, 'E', true, nu);
  wallDecal(nu, 'N', 43.0, 1.8, 0.8, 1.2, T.poster('FIRST AID', '#b9c3bd'));
  /* ---- janitor ---- */
  const ja = R.janitor;
  shelfUnit(51.6, 20.0, PI / 2); shelfUnit(51.6, 22.8, PI / 2); crate(45.4, 16.6, 0.9); crate(46.4, 16.7, 0.7); crate(45.4, 17.7, 0.7); crate(45.4, 17.7, 0.7, 0.7);
  addCyl('pipe', 49, 0.2, 23.4, 0.22, 0.2, 0.4, 10, { col: 'furn' }); addBox('wood', 49.4, 0.9, 23.6, 0.04, 1.4, 0.04, { ry: 0.3 });
  addLocker(44.4, 23.5, 'E', true, ja); scatterPapers(ja, 4);
  /* ---- stairwell ---- */
  wallDecal(R.stairs, 'N', 60, 1.8 - 0.0, 0.8, 1.2, T.poster('CAUTION', '#c9a23a'));
  pipeRun(55, -1.8, 15.4, 63.8, 15.4, 0.1); pipeRun(55, -2.2, 20.6, 63.8, 20.6, 0.1);
  /* ---- corridor 2 ---- */
  const c2 = R.corridor2;
  lockerBank(22.0, 25.4, 'S', 3, [1], c2); lockerBank(55.0, 25.4, 'S', 4, [0, 2], c2);
  bench(26.5, 28.6, 2.0); bench(37.0, 28.6, 2.0); bench(46.0, 28.6, 2.0);
  wallDecal(c2, 'N', 30, 1.7, 0.55, 0.85, T.poster('LUNCH', '#9bb09a')); wallDecal(c2, 'N', 47, 1.7, 0.55, 0.85, T.missing);
  bloodMark(c2, 'S', 37.0, 1.3, 1.4); scatterPapers(c2, 8);
  /* ---- cafeteria ---- */
  const cf = R.cafeteria;
  [[20.5, 33.0], [30.0, 33.0], [20.5, 36.4], [30.0, 36.4]].forEach(([x, z]) => { table(x, z, 5.0, 0.9, 0.76, 'wood'); });
  [[20.5, 32.0], [30.0, 32.0], [20.5, 34.0], [30.0, 34.0], [20.5, 35.4], [30.0, 35.4], [20.5, 37.4], [30.0, 37.4]].forEach(([x, z]) => bench(x, z, 4.6, 0));
  table(26, 39.3, 10, 0.8, 1.0, 'metal'); cabinet(37.4, 31.0, -PI / 2, 1.0, 1.9); lockerBank(14.4, 37.0, 'E', 3, [1], cf);
  windowAt(cf, 'S', 18.5); windowAt(cf, 'S', 26.0); windowAt(cf, 'S', 34.0); scatterPapers(cf, 12); chairAt(24.5, 31.4, 2.0);
  /* ---- restroom ---- */
  const rr = R.restroom;
  table(38.6, 33.5, 0.5, 4.0, 0.9, 'white'); wallDecal(rr, 'W', 33.5, 1.75, 0.1, 1.0, null, { mat: new THREE.MeshBasicMaterial({ color: 0x0b1118 }) });
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.0), mkMat(0x3a4a58, null, { roughness: 0.15, metalness: 0.5 })); mirror.position.set(38.17, 1.9, 33.5); mirror.rotation.y = PI / 2; levelGroup.add(mirror);
  bloodMark(rr, 'W', 32.4, 1.9, 1.0);
  for (let i = 0; i < 4; i++) { addBox('woodDark', 40.2 + i * 1.5, 0.95, 39.15, 0.05, 1.7, 1.55, { col: 'furn' }); addBox('white', 40.2 + i * 1.5 + 0.7, 0.2, 39.5, 0.4, 0.4, 0.5); addBox('metal', 40.95 + i * 1.5, 0.85, 38.4, 0.7, 1.4, 0.04, { tile: 1 }); }
  addLocker(45.6, 31.0, 'W', true, rr);
  /* ---- music room ---- */
  const mu = R.music;
  pbox('black', 53.8, 34.5, 0, 0, 0.55, 0, 0.7, 1.1, 1.6, 'furn'); pbox('white', 53.4, 34.5, 0, 0, 0.95, 0, 0.2, 0.04, 1.4); bench(52.6, 34.5, 1.0, PI / 2);
  [[48.5, 32.5], [50.3, 33.1], [48.2, 35.6], [50.6, 36.2], [48.8, 38.0]].forEach(([x, z], i) => chairAt(x, z, 1.3 + i * 0.7));
  addLocker(46.4, 38.5, 'E', true, mu); scatterPapers(mu, 10); wallDecal(mu, 'N', 50.5, 1.7, 0.55, 0.85, T.poster('MUSIC', '#b4a07a'));
  /* ---- art room ---- */
  const ar = R.art;
  table(60, 36, 2.4, 1.0); [[57.2, 32.5], [60.5, 32.2], [62.5, 38.0]].forEach(([x, z], i) => { addBox('wood', x - 0.3, 0.55, z, 0.04, 1.1, 0.04, { ry: 0.3 }); addBox('wood', x + 0.3, 0.55, z, 0.04, 1.1, 0.04, { ry: -0.3 }); addBox('wood', x, 0.55, z - 0.3, 0.04, 1.1, 0.04); addBox('white', x, 1.2, z + 0.02, 0.8, 0.95, 0.03, { col: 'furn' }); });
  wallDecal(ar, 'E', 33.5, 1.8, 1.3, 1.6, T.portrait); wallDecal(ar, 'W', 35.0, 1.8, 0.8, 1.0, T.portrait); bloodMark(ar, 'E', 37.0, 1.2, 1.3);
  addLocker(63.6, 31.0, 'W', true, ar); scatterPapers(ar, 8);
  /* ---- basement ---- */
  at(R.bcorr, (r) => {
    pipeRun(64.5, 2.6, 16.35, 103.5, 16.35, 0.12); pipeRun(64.5, 2.4, 19.65, 103.5, 19.65, 0.09);
    for (let x = 68; x < 102; x += 6) addCyl('pipe', x, 1.3, 16.3, 0.07, 0.07, 2.6, 8);
    crate(65.3, 16.7, 0.9); crate(65.3, 19.2, 0.7);
  });
  lockerBank(74.4, 16.4, 'S', 3, [0, 2], R.bcorr); lockerBank(77.0, 19.6, 'N', 3, [1], R.bcorr);
  at(R.electrical, (r) => {
    addBox('metal', 71, 1.4, 8.3, 1.0, 1.3, 0.2, { tile: 1 }); addBox('black', 71, 1.5, 8.41, 0.8, 0.9, 0.02, { tile: 1 });
    addCyl('woodDark', 67.6, 0.4, 12, 0.5, 0.5, 0.8, 12, { col: 'furn' }); addCyl('woodDark', 67.9, 0.4, 14, 0.4, 0.4, 0.8, 12, { col: 'furn' });
    cabinet(75.6, 11, -PI / 2, 1.4, 1.9); crate(67.0, 9.2, 0.9); crate(67.0, 15.2, 0.8);
    pipeRun(66.2, 2.5, 8.4, 75.8, 8.4, 0.08);
  });
  at(R.boiler, (r) => {
    addCyl('rust', 84, 1.4, 11.5, 1.4, 1.4, 2.8, 18, { col: 'furn' }); addCyl('rust', 84, 3.05, 11.5, 0.9, 1.3, 0.5, 18); addCyl('pipe', 84, 3.5, 11.5, 0.3, 0.3, 1.0, 10);
    pipeRun(84, 3.3, 11.5, 84, 8.3, 0.25); pipeRun(82.6, 2.0, 11.5, 76.4, 11.5, 0.15); pipeRun(85.4, 2.0, 11.5, 91.6, 11.5, 0.15);
    [[78, 9.5], [78.8, 9.2], [90, 14.5], [89.2, 14.9]].forEach(([x, z]) => addCyl('rust', x, 0.45, z, 0.3, 0.3, 0.9, 10, { col: 'furn' }));
    crate(90.4, 9.2, 1.0); crate(79.0, 14.4, 0.9);
  });
  at(R.archive, (r) => {
    shelfUnit(97.5, 9.6, 0, 5.4, 0.5, 2.2, 'woodDark'); shelfUnit(98.0, 13.2, 0, 4.0, 0.5, 2.2, 'woodDark'); shelfUnit(94.2, 14.8, PI / 2, 2.2, 0.5, 2.2, 'woodDark');
    table(102.4, 14.6, 1.2, 0.8, 1.05, 'woodDark'); cabinet(102.7, 10.5, -PI / 2, 1.2, 1.6); scatterPapers(r, 10);
  });
  addLocker(103.6, 11.5, 'W', true, R.archive);
  at(R.storage, (r) => {
    crate(67, 21.5, 0.9); crate(68, 21.5, 0.9); crate(67.5, 21.5, 0.8, 0.9); crate(70, 24, 1.0); crate(70, 24, 0.8, 1.0); crate(78.8, 28.5, 1.1); crate(75.5, 21.4, 0.9); crate(76.4, 21.6, 0.7);
    shelfUnit(66.6, 25.0, PI / 2); shelfUnit(73, 29.6, 0, 3.0, 0.45, 2.0);
  });
  lockerBank(76.0, 29.6, 'N', 2, [0], R.storage);
  at(R.maint, (r) => {
    pbox('rust', 86, 26, 0, 0, 0.6, 0, 2.0, 1.2, 1.0, 'furn'); addCyl('pipe', 85.2, 1.5, 26, 0.18, 0.18, 0.7, 8); addCyl('pipe', 86.8, 1.5, 26, 0.18, 0.18, 0.7, 8);
    table(90.4, 25, 0.8, 3, 0.95, 'woodDark'); pipeRun(80.5, 2.5, 20.4, 91.5, 20.4, 0.08); crate(82, 22.5, 0.9);
  });
  lockerBank(88.0, 29.6, 'N', 2, [1], R.maint);
  at(R.shrine, (r) => {
    table(98, 28.9, 4.0, 0.9, 0.92, 'woodDark'); wallDecal(r, 'S', 98, 1.9, 1.1, 1.4, T.portrait); wallDecal(r, 'W', 25, 1.7, 0.5, 0.65, T.portrait); wallDecal(r, 'E', 25, 1.7, 0.5, 0.65, T.portrait);
    bed(93.4, 24.0, 0); chairAt(101.5, 23.0, -1.8, 'chair2'); pbox('cloth', 101.5, 23.0, 0, 0, 0.7, 0.26, 0.45, 0.5, 0.05); scatterPapers(r, 8);
    [[96.6, 28.9], [99.4, 28.9]].forEach(([x, z]) => addCyl('white', x, 1.0, z, 0.035, 0.035, 0.13, 8));
  });
  addLocker(103.6, 22.0, 'W', true, R.shrine);
  // crawl spaces under heavy furniture
  addUnderSpot(R.class1a.cx, R.class1a.z0 + 2.0, R.class1a, 'S');
  addUnderSpot(R.class3c.cx, R.class3c.z0 + 2.0, R.class3c, 'S');
  addUnderSpot(49.5, 9.0, R.library, 'S');
  addUnderSpot(31, 19.6, R.office, 'N');
  addUnderSpot(42.8, 17.8, R.nurse, 'E');
  addUnderSpot(42.8, 21.6, R.nurse, 'E');
  addUnderSpot(20.5, 33.0, R.cafeteria, 'S');
  addUnderSpot(30.0, 36.4, R.cafeteria, 'N');
  addUnderSpot(60, 36, R.art, 'S');
  addUnderSpot(90.4, 25, R.maint, 'W');
  addUnderSpot(93.4, 24.0, R.shrine, 'E');
  addUnderSpot(98, 28.9, R.shrine, 'N');
  // red book (secret lever) in the library
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.22), new THREE.MeshStandardMaterial({ color: 0x8a1111, emissive: 0x330000, roughness: 0.6 }));
  book.position.set(42.0, 1.3, 0.62); dynGroup.add(book); World.redBook = book;
}

/* =====================================================================
   5. CHARACTERS — articulated rigs (joint hierarchies) animated with
      THREE.AnimationMixer clips (keyframed quaternion + position tracks).
   ===================================================================== */
const JOINTS = ['hips', 'spine', 'neck', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR'];
const _qa = new THREE.Quaternion(), _ea = new THREE.Euler();
/* poseFn(phase 0..1) → { hipsY, <joint>: [rx, ry, rz] } sampled into looping keyframe tracks */
function makeClip(name, dur, hipsBase, poseFn, samples = 20) {
  const times = [], hv = [], jv = {}; JOINTS.forEach((j) => { jv[j] = []; });
  for (let i = 0; i <= samples; i++) {
    const ph = i / samples, p = poseFn(ph); times.push(ph * dur);
    hv.push(0, p.hipsY === undefined ? hipsBase : p.hipsY, 0);
    for (const j of JOINTS) { const e = p[j] || [0, 0, 0]; _qa.setFromEuler(_ea.set(e[0], e[1], e[2], 'XYZ')); jv[j].push(_qa.x, _qa.y, _qa.z, _qa.w); }
  }
  const tracks = [new THREE.VectorKeyframeTrack('hips.position', times, hv)];
  for (const j of JOINTS) tracks.push(new THREE.QuaternionKeyframeTrack(j + '.quaternion', times, jv[j]));
  return new THREE.AnimationClip(name, dur, tracks);
}
class AnimCtl {
  constructor(root, clips, base = 'idle') {
    this.mixer = new THREE.AnimationMixer(root); this.act = {}; this.w = {}; this.tw = {}; this.os = null;
    for (const n in clips) { const a = this.mixer.clipAction(clips[n]); a.play(); a.setEffectiveWeight(n === base ? 1 : 0); this.act[n] = a; this.w[n] = n === base ? 1 : 0; this.tw[n] = this.w[n]; }
  }
  set(weights) { let sum = 0; for (const n in weights) sum += weights[n]; sum = sum || 1; for (const n in this.act) this.tw[n] = (weights[n] || 0) / sum; }
  speed(n, ts) { if (this.act[n]) this.act[n].setEffectiveTimeScale(ts); }
  shot(name, dur) { const a = this.act[name]; if (!a) return; a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); this.os = { name, t: 0, dur }; }
  update(dt) {
    let osw = 0;
    if (this.os) { this.os.t += dt; const k = this.os.t / this.os.dur; osw = k < 0.12 ? k / 0.12 : (k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1); if (k >= 1) { this.os = null; osw = 0; } }
    for (const n in this.act) {
      const a = this.act[n];
      if (this.os && n === this.os.name) { a.setEffectiveWeight(osw); continue; }
      this.w[n] = damp(this.w[n], this.tw[n], 9, dt); a.setEffectiveWeight(this.w[n] * (1 - osw));
    }
    this.mixer.update(dt);
  }
}
const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const mx = Math.max;

function cMat(color, o = {}) {
  const em = o.em === undefined ? 0 : o.em;
  const c = new THREE.Color(color);
  const p = { color, map: o.map || undefined, emissive: c.clone().multiplyScalar(em) };
  if (BOOT_Q.lambert) return new THREE.MeshLambertMaterial(clean(p));
  p.roughness = o.rough === undefined ? 0.8 : o.rough; p.metalness = o.metal || 0;
  return new THREE.MeshStandardMaterial(clean(p));
}
function joint(name, parent, x, y, z) { const j = new THREE.Object3D(); j.name = name; j.position.set(x, y, z); parent.add(j); return j; }
function part(parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = shadow; m.receiveShadow = false; parent.add(m); return m;
}
const capsule = (r, len, seg = 6) => new THREE.CapsuleGeometry(r, len, 3, seg);
function limb(parent, mat, r, len, taper = 1) { const g = capsule(r, len, 7); g.translate(0, -(len / 2 + r), 0); if (taper !== 1) g.scale(1, 1, 1); return part(parent, g, mat); }

/* ---- face textures (equirectangular on a sphere: front = u 0.25) ---- */
function faceTexture(kind) {
  return canvasTex(512, 256, (x, w, h) => {
    const cx = 128;
    if (kind === 'prof') {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#9aa294'); g.addColorStop(1, '#7f8a7b'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      blotches(x, w, h, 40, '30,40,30', 0.2, 6, 28); speckle(x, w, h, 900, 0.05, 0.25, '20,10,10', 1.5);
      // hollow eye sockets
      for (const s of [-1, 1]) {
        const ex = cx + s * 22, ey = 112; const gr = x.createRadialGradient(ex, ey, 2, ex, ey, 22); gr.addColorStop(0, 'rgba(10,0,0,0.98)'); gr.addColorStop(0.6, 'rgba(25,8,8,0.85)'); gr.addColorStop(1, 'rgba(25,10,10,0)');
        x.fillStyle = gr; x.beginPath(); x.ellipse(ex, ey, 22, 20, 0, 0, TAU); x.fill();
        x.fillStyle = '#ff2a12'; x.beginPath(); x.arc(ex, ey + 1, 4.5, 0, TAU); x.fill(); x.fillStyle = '#ffd0a0'; x.beginPath(); x.arc(ex, ey + 1, 1.6, 0, TAU); x.fill();
        x.strokeStyle = 'rgba(15,5,5,0.9)'; x.lineWidth = 4; x.beginPath(); x.moveTo(ex - s * 20, ey - 20); x.lineTo(ex + s * 14, ey - 15); x.stroke();   // heavy brow
      }
      x.strokeStyle = 'rgba(40,15,15,0.7)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx - 3, 118); x.lineTo(cx - 6, 146); x.lineTo(cx + 5, 148); x.stroke();   // nose
      // gaping mouth + teeth + stitches
      x.fillStyle = '#120405'; x.beginPath(); x.ellipse(cx, 178, 26, 15, 0, 0, TAU); x.fill();
      x.fillStyle = '#c9c2a0'; for (let i = -5; i <= 5; i++) { x.fillRect(cx + i * 4.4 - 1.5, 164 + Math.abs(i) * 0.6, 3, 7); x.fillRect(cx + i * 4.4 - 1.5, 186 - Math.abs(i) * 0.6, 3, 6); }
      x.strokeStyle = 'rgba(20,5,5,0.85)'; x.lineWidth = 1.6; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(cx - 30 + i * 10, 162); x.lineTo(cx - 30 + i * 10 + 4, 196); x.stroke(); }
      x.strokeStyle = 'rgba(120,20,20,0.6)'; x.lineWidth = 1.2; for (let i = 0; i < 9; i++) { x.beginPath(); let px = cx + rand(-45, 45), py = rand(80, 200); x.moveTo(px, py); for (let k = 0; k < 4; k++) { px += rand(-8, 8); py += rand(-8, 8); x.lineTo(px, py); } x.stroke(); }
    } else {
      x.fillStyle = '#e0b08a'; x.fillRect(0, 0, w, h); blotches(x, w, h, 20, '150,90,60', 0.12, 8, 30);
      for (const s of [-1, 1]) {
        const ex = cx + s * 20, ey = 118;
        x.fillStyle = '#f4efe6'; x.beginPath(); x.ellipse(ex, ey, 11, 8, 0, 0, TAU); x.fill();
        x.fillStyle = '#2b1a10'; x.beginPath(); x.arc(ex + 1, ey, 5, 0, TAU); x.fill(); x.fillStyle = '#fff'; x.fillRect(ex + 2, ey - 3, 2, 2);
        x.strokeStyle = '#2b1a10'; x.lineWidth = 3; x.beginPath(); x.moveTo(ex - 12, ey - 15); x.lineTo(ex + 10, ey - 18 + s * 2); x.stroke();
      }
      x.strokeStyle = 'rgba(120,70,50,0.8)'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 2, 124); x.lineTo(cx - 5, 144); x.lineTo(cx + 4, 144); x.stroke();
      x.strokeStyle = '#8a3a30'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 12, 166); x.quadraticCurveTo(cx, 170, cx + 12, 166); x.stroke();
    }
  }, false);
}
let _faceStu = null, _faceProf = null;

/* ---------------------------- STUDENT ---------------------------- */
function buildStudent() {
  const root = new THREE.Group(); root.name = 'student';
  const body = new THREE.Group(); body.scale.setScalar(0.86); root.add(body);
  if (!_faceStu) _faceStu = faceTexture('stu');
  const skin = cMat(0xe0b08a, { em: 0.12 }), shirt = cMat(0xe8e6dc, { em: 0.2 }), vest = cMat(0x23314f, { em: 0.35 }), pants = cMat(0x2b2d36, { em: 0.35 }), shoe = cMat(0x16161a, { em: 0.2 });
  const hair = cMat(0x2a1a10, { em: 0.2 }), pack = cMat(0xd2701f, { em: 0.35 }), tie = cMat(0xa01820, { em: 0.2 }), face = cMat(0xffffff, { map: _faceStu, em: 0.0 });
  face.emissive = new THREE.Color(0x201510); if (face.emissiveMap !== undefined) face.emissiveMap = _faceStu;
  const j = {};
  j.hips = joint('hips', body, 0, 0.96, 0);
  const pel = capsule(0.1, 0.16); pel.rotateZ(Math.PI / 2); part(j.hips, pel, pants, 0, 0, 0, 1, 1, 0.85);
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    j['leg' + side] = joint('leg' + side, j.hips, 0.1 * sx, -0.02, 0); limb(j['leg' + side], pants, 0.075, 0.3);
    j['shin' + side] = joint('shin' + side, j['leg' + side], 0, -0.45, 0); limb(j['shin' + side], pants, 0.058, 0.3);
    part(j['shin' + side], new THREE.BoxGeometry(0.11, 0.075, 0.27), shoe, 0, -0.43, 0.06);
  }
  j.spine = joint('spine', j.hips, 0, 0.08, 0);
  part(j.spine, capsule(0.135, 0.26, 8), shirt, 0, 0.27, 0, 1.2, 1, 0.78);
  part(j.spine, capsule(0.14, 0.17, 8), vest, 0, 0.2, 0, 1.22, 1, 0.8);
  part(j.spine, new THREE.BoxGeometry(0.035, 0.22, 0.012), tie, 0, 0.36, 0.108);
  part(j.spine, new THREE.BoxGeometry(0.3, 0.38, 0.15), pack, 0, 0.3, -0.17);
  part(j.spine, new THREE.BoxGeometry(0.2, 0.12, 0.05), cMat(0x9a4a12, { em: 0.2 }), 0, 0.22, -0.26);
  j.neck = joint('neck', j.spine, 0, 0.52, 0); part(j.neck, new THREE.CylinderGeometry(0.04, 0.045, 0.1, 8), skin, 0, 0.04, 0);
  j.head = joint('head', j.neck, 0, 0.08, 0);
  part(j.head, new THREE.SphereGeometry(0.12, 18, 14), face, 0, 0.13, 0, 0.95, 1.1, 1.0);
  const cap = new THREE.SphereGeometry(0.128, 16, 10, 0, TAU, 0, Math.PI * 0.56); part(j.head, cap, hair, 0, 0.145, -0.012, 0.97, 1.1, 1.04);
  part(j.head, new THREE.SphereGeometry(0.034, 8, 6), skin, 0.116, 0.13, 0, 0.6, 1, 1); part(j.head, new THREE.SphereGeometry(0.034, 8, 6), skin, -0.116, 0.13, 0, 0.6, 1, 1);
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    j['arm' + side] = joint('arm' + side, j.spine, 0.19 * sx, 0.46, 0); part(j['arm' + side], new THREE.SphereGeometry(0.056, 8, 6), vest, 0, 0, 0);
    limb(j['arm' + side], vest, 0.048, 0.2);
    j['fore' + side] = joint('fore' + side, j['arm' + side], 0, -0.3, 0); limb(j['fore' + side], shirt, 0.04, 0.17); part(j['fore' + side], new THREE.SphereGeometry(0.045, 8, 6), skin, 0, -0.29, 0);
  }
  const hand = new THREE.Object3D(); hand.position.set(0, -0.3, 0.02); j.foreR.add(hand); j.hand = hand;
  // flashlight prop (visible lens glows when on)
  const fl = new THREE.Group(); fl.position.set(0, 0, 0.05); hand.add(fl);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), cMat(0x2a2a30, { metal: 0.6 })); cyl.rotation.x = Math.PI / 2; fl.add(cyl);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, 0.05, 10), new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false })); lens.rotation.x = Math.PI / 2; lens.position.z = 0.1; fl.add(lens);
  const clips = buildStudentClips();
  const anim = new AnimCtl(body, clips, 'idle');
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), MAT.blob); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.scale.setScalar(0.9); root.add(blob);
  body.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { root, body, j, anim, lens, flashProp: fl, blob, height: 1.62 };
}
function buildStudentClips() {
  const hb = 0.96, A = {};
  A.idle = makeClip('idle', 4, hb, (p) => { const a = p * TAU, s = Math.sin(a); return { hipsY: hb - 0.004 + 0.004 * s, spine: [0.03 + 0.02 * s, 0, 0], head: [0.02, 0.18 * Math.sin(a), 0], armL: [0.04 * s, 0, 0.07], foreL: [-0.18, 0, 0], armR: [-0.04 * s, 0, -0.07], foreR: [-0.18, 0, 0] }; });
  A.walk = makeClip('walk', 1.0, hb, (p) => {
    const a = p * TAU, s = Math.sin(a), c = Math.cos(a);
    return { hipsY: hb - 0.015 + 0.03 * Math.cos(2 * a), legL: [-s * 0.55, 0, 0], shinL: [0.1 + 0.75 * mx(0, c), 0, 0], legR: [s * 0.55, 0, 0], shinR: [0.1 + 0.75 * mx(0, -c), 0, 0],
      armL: [s * 0.5, 0, 0.08], foreL: [-0.35, 0, 0], armR: [-s * 0.5, 0, -0.08], foreR: [-0.35, 0, 0], spine: [0.06, c * 0.1, 0], head: [-0.03, -c * 0.08, 0] };
  });
  A.run = makeClip('run', 0.68, hb, (p) => {
    const a = p * TAU, s = Math.sin(a), c = Math.cos(a);
    return { hipsY: hb - 0.07 + 0.06 * Math.cos(2 * a), legL: [-s * 1.0, 0, 0], shinL: [0.25 + 1.3 * mx(0, c), 0, 0], legR: [s * 1.0, 0, 0], shinR: [0.25 + 1.3 * mx(0, -c), 0, 0],
      armL: [s * 1.0, 0, 0.12], foreL: [-1.3, 0, 0], armR: [-s * 1.0, 0, -0.12], foreR: [-1.3, 0, 0], spine: [0.3, c * 0.16, 0], head: [-0.22, -c * 0.1, 0] };
  });
  A.crouchIdle = makeClip('crouchIdle', 4, hb, (p) => { const a = p * TAU, s = Math.sin(a); return { hipsY: hb - 0.4 + 0.005 * s, legL: [-1.2, 0, 0.05], shinL: [2.05, 0, 0], legR: [-1.2, 0, -0.05], shinR: [2.05, 0, 0], spine: [0.6, 0, 0], neck: [-0.3, 0, 0], head: [-0.2, 0.2 * Math.sin(a), 0], armL: [-0.5, 0, 0.12], foreL: [-1.0, 0, 0], armR: [-0.5, 0, -0.12], foreR: [-1.0, 0, 0] }; });
  A.crouchWalk = makeClip('crouchWalk', 1.2, hb, (p) => {
    const a = p * TAU, s = Math.sin(a), c = Math.cos(a);
    return { hipsY: hb - 0.4 + 0.015 * Math.cos(2 * a), legL: [-1.15 - s * 0.38, 0, 0.05], shinL: [2.0 + 0.4 * c, 0, 0], legR: [-1.15 + s * 0.38, 0, -0.05], shinR: [2.0 - 0.4 * c, 0, 0], spine: [0.6, c * 0.08, 0], neck: [-0.3, 0, 0], head: [-0.2, 0, 0], armL: [-0.5 + s * 0.3, 0, 0.12], foreL: [-1.0, 0, 0], armR: [-0.5 - s * 0.3, 0, -0.12], foreR: [-1.0, 0, 0] };
  });
  A.jump = makeClip('jump', 1, hb, (p) => ({ hipsY: hb - 0.05, legL: [-0.95, 0, 0.05], shinL: [1.35, 0, 0], legR: [-0.55, 0, -0.05], shinR: [0.9, 0, 0], armL: [-2.5, 0, 0.45], armR: [-2.5, 0, -0.45], foreL: [-0.4, 0, 0], foreR: [-0.4, 0, 0], spine: [0.1, 0, 0], head: [-0.15, 0, 0] }), 4);
  A.hurt = makeClip('hurt', 0.6, hb, (p) => { const e = Math.sin(p * Math.PI); return { hipsY: hb - 0.1 * e, spine: [-0.55 * e, 0, 0.25 * e], head: [-0.55 * e, 0, 0.1 * e], armL: [-1.6 * e, 0, 0.6 * e], armR: [-1.6 * e, 0, -0.6 * e], foreL: [-0.8 * e, 0, 0], foreR: [-0.8 * e, 0, 0], legL: [-0.3 * e, 0, 0], legR: [0.2 * e, 0, 0] }; }, 12);
  return A;
}

/* ---------------------------- PROFESSOR ---------------------------- */
function buildProfessor() {
  const root = new THREE.Group(); root.name = 'professor';
  const body = new THREE.Group(); root.add(body);
  if (!_faceProf) _faceProf = faceTexture('prof');
  const skin = cMat(0x9aa294, { em: 0.18 }), suit = cMat(0x0d0d12, { em: 0.4, rough: 0.9 }), shirtM = cMat(0xb0aa94, { em: 0.2 }), pants = cMat(0x121216, { em: 0.4 });
  const hairM = cMat(0x8c8c88, { em: 0.2 }), tieM = cMat(0x5a0d10, { em: 0.2 }), shoeM = cMat(0x0a0a0a, { em: 0.2 }), wood = cMat(0x5a3b20, { em: 0.2 });
  const face = cMat(0xffffff, { map: _faceProf }); face.emissive = new THREE.Color(0x2a1a1a); if (face.emissiveMap !== undefined) face.emissiveMap = _faceProf;
  const j = {};
  j.hips = joint('hips', body, 0, 1.12, 0);
  const pel = capsule(0.09, 0.14); pel.rotateZ(Math.PI / 2); part(j.hips, pel, pants, 0, 0, 0, 1, 1, 0.8);
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    j['leg' + side] = joint('leg' + side, j.hips, 0.1 * sx, -0.02, 0); limb(j['leg' + side], pants, 0.068, 0.38);
    j['shin' + side] = joint('shin' + side, j['leg' + side], 0, -0.52, 0); limb(j['shin' + side], pants, 0.052, 0.4);
    part(j['shin' + side], new THREE.BoxGeometry(0.1, 0.07, 0.3), shoeM, 0, -0.5, 0.07);
  }
  j.spine = joint('spine', j.hips, 0, 0.08, 0);
  part(j.spine, capsule(0.125, 0.36, 8), suit, 0, 0.36, 0, 1.12, 1, 0.74);
  part(j.spine, new THREE.BoxGeometry(0.1, 0.46, 0.012), shirtM, 0, 0.42, 0.098);
  part(j.spine, new THREE.BoxGeometry(0.03, 0.34, 0.012), tieM, 0.01, 0.38, 0.106).rotation.z = 0.08;
  // tattered coat tails (swayed procedurally)
  j.coatL = joint('coatL', j.hips, 0.09, -0.04, -0.06); part(j.coatL, new THREE.BoxGeometry(0.14, 0.62, 0.025), suit, 0, -0.31, 0);
  j.coatR = joint('coatR', j.hips, -0.09, -0.04, -0.06); part(j.coatR, new THREE.BoxGeometry(0.14, 0.55, 0.025), suit, 0, -0.275, 0);
  j.neck = joint('neck', j.spine, 0, 0.62, 0); part(j.neck, new THREE.CylinderGeometry(0.035, 0.045, 0.14, 8), skin, 0, 0.05, 0);
  j.head = joint('head', j.neck, 0, 0.1, 0);
  part(j.head, new THREE.SphereGeometry(0.13, 20, 16), face, 0, 0.17, 0, 0.85, 1.3, 0.95);
  for (let i = 0; i < 12; i++) {   // wild grey hair spikes
    const a = rand(0, TAU), el = rand(0.1, 1.1), r = 0.13;
    const sp = part(j.head, new THREE.ConeGeometry(0.018, rand(0.1, 0.2), 4), hairM, Math.cos(a) * Math.cos(el) * r * 0.95, 0.2 + Math.sin(el) * r * 1.5 - 0.02, Math.sin(a) * Math.cos(el) * r - 0.02, 1, 1, 1);
    sp.lookAt(sp.position.clone().multiplyScalar(2)); sp.rotateX(Math.PI / 2);
  }
  // broken round glasses
  for (const s of [-1, 1]) { const g = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, 6, 14), new THREE.MeshBasicMaterial({ color: 0x151515 })); g.position.set(s * 0.045, 0.2, 0.116); j.head.add(g); }
  // glowing eyes (always visible in the dark)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a14, fog: false }); const eyes = [];
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), eyeMat); e.position.set(s * 0.045, 0.2, 0.113); j.head.add(e); eyes.push(e); }
  const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: 0xff2200, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.85 }));
  eyeGlow.scale.set(0.5, 0.2, 1); eyeGlow.position.set(0, 0.2, 0.13); j.head.add(eyeGlow);
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    j['arm' + side] = joint('arm' + side, j.spine, 0.2 * sx, 0.56, 0); part(j['arm' + side], new THREE.SphereGeometry(0.052, 8, 6), suit, 0, 0, 0);
    limb(j['arm' + side], suit, 0.044, 0.36);
    j['fore' + side] = joint('fore' + side, j['arm' + side], 0, -0.46, 0); limb(j['fore' + side], suit, 0.038, 0.36);
    const palm = part(j['fore' + side], new THREE.BoxGeometry(0.075, 0.1, 0.03), skin, 0, -0.5, 0);
    for (let f = 0; f < 4; f++) { const fg = capsule(0.009, 0.1, 4); fg.translate(0, -0.06, 0); part(j['fore' + side], fg, skin, (f - 1.5) * 0.02, -0.55, 0.0, 1, 1, 1).rotation.x = -0.15 - f * 0.03; }
  }
  const hand = new THREE.Object3D(); hand.position.set(0, -0.52, 0.02); j.foreR.add(hand); j.hand = hand;
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 1.25, 6), wood); stick.position.set(0, -0.12, 0.45); stick.rotation.x = Math.PI / 2 + 0.2; stick.castShadow = true; hand.add(stick);
  const clips = buildProfessorClips();
  const anim = new AnimCtl(body, clips, 'idle');
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), MAT.blob); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.scale.setScalar(1.3); root.add(blob);
  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { root, body, j, anim, eyes, eyeGlow, blob, height: 2.25 };
}
function buildProfessorClips() {
  const hb = 1.12, A = {};
  A.idle = makeClip('idle', 4, hb, (p) => { const a = p * TAU, s = Math.sin(a); return { hipsY: hb - 0.01 + 0.006 * s, spine: [0.3 + 0.02 * s, 0, 0.04 * Math.sin(a * 2)], neck: [0.22, 0, 0], head: [0.1, 0.45 * s, 0.14 * Math.sin(a * 3)], armL: [0.1, 0, 0.12 + 0.03 * s], armR: [0.1, 0, -0.12 - 0.03 * s], foreL: [-0.25, 0, 0], foreR: [-0.25, 0, 0], legL: [0, 0, 0.03], legR: [0, 0, -0.03] }; });
  A.walk = makeClip('walk', 1.5, hb, (p) => {
    const a = p * TAU, s = Math.sin(a), c = Math.cos(a);
    return { hipsY: hb - 0.03 + 0.035 * Math.cos(2 * a), legL: [-s * 0.48, 0, 0.03], shinL: [0.1 + 0.6 * mx(0, c), 0, 0], legR: [s * 0.48, 0, -0.03], shinR: [0.1 + 0.6 * mx(0, -c), 0, 0],
      armL: [s * 0.3 + 0.1, 0, 0.14], foreL: [-0.25 - 0.1 * s, 0, 0], armR: [-s * 0.3 + 0.1, 0, -0.14], foreR: [-0.25 + 0.1 * s, 0, 0], spine: [0.32, c * 0.15, 0.07 * s], neck: [0.25, 0, 0], head: [0.08, -c * 0.22, 0.16 * s] };
  });
  A.run = makeClip('run', 0.78, hb, (p) => {
    const a = p * TAU, s = Math.sin(a), c = Math.cos(a);
    return { hipsY: hb - 0.12 + 0.07 * Math.cos(2 * a), legL: [-s * 1.0, 0, 0.03], shinL: [0.3 + 1.4 * mx(0, c), 0, 0], legR: [s * 1.0, 0, -0.03], shinR: [0.3 + 1.4 * mx(0, -c), 0, 0],
      armL: [-0.9 + s * 0.7, 0, 0.25], foreL: [-0.6 - 0.4 * s, 0, 0], armR: [-0.9 - s * 0.7, 0, -0.25], foreR: [-0.6 + 0.4 * s, 0, 0], spine: [0.68, c * 0.2, 0], neck: [0.3, 0, 0], head: [-0.25, -c * 0.12, 0.1 * s] };
  });
  A.search = makeClip('search', 3.2, hb, (p) => { const a = p * TAU, s = Math.sin(a); return { hipsY: hb - 0.05, spine: [0.38, 0.5 * s, 0.05], neck: [0.2, 0, 0], head: [0.12, 0.85 * Math.sin(a + 0.6), 0.25 * Math.sin(a * 2)], armL: [-0.2, 0, 0.18], armR: [-0.2, 0, -0.18], foreL: [-0.45, 0, 0], foreR: [-0.45, 0, 0], legL: [-0.1, 0, 0.04], legR: [0.06, 0, -0.04] }; });
  A.attack = makeClip('attack', 1.0, hb, (p) => {
    const wind = sm(p / 0.35), slam = sm((p - 0.35) / 0.12), rec = sm((p - 0.55) / 0.45);
    const raise = wind * (1 - slam) + slam * 0; const r = (1 - rec);
    return { hipsY: hb - 0.05 * slam, armR: [(-2.9 * wind + 3.0 * slam) * r, 0, -0.25 * r], foreR: [-0.5 * wind * r, 0, 0], armL: [(-1.6 * wind + 1.7 * slam) * r, 0, 0.3 * r], foreL: [-0.4 * wind * r, 0, 0],
      spine: [(0.3 - 0.35 * wind + 1.0 * slam) * r + 0.3 * rec, 0, 0], head: [(-0.3 * wind + 0.4 * slam) * r, 0, 0], legL: [-0.3 * slam, 0, 0], legR: [0.25 * slam, 0, 0], neck: [0.15 * raise, 0, 0] };
  }, 24);
  A.scream = makeClip('scream', 1.6, hb, (p) => { const e = Math.sin(p * Math.PI), tr = 0.03 * Math.sin(p * 60); return { hipsY: hb - 0.04 * e, spine: [-0.15 * e, tr, 0], neck: [-0.3 * e, 0, 0], head: [-0.75 * e, tr * 2, 0], armL: [-0.3 * e, 0, 1.35 * e], armR: [-0.3 * e, 0, -1.35 * e], foreL: [-0.6 * e, 0, 0], foreR: [-0.6 * e, 0, 0] }; }, 30);
  return A;
}

/* =====================================================================
   6. GAME STATE, INPUT, PLAYER CONTROLLER + THIRD-PERSON CAMERA
   ===================================================================== */
const G = {
  state: 'loading',            // loading | menu | intro | playing | paused | dead | ending
  time: 0, playTime: 0, flags: {}, inv: new Set(), pages: new Set(), picked: new Set(), doorState: {},
  blackout: 1, fireTimer: 0, tension: 0, chase: false, modal: null, scared: new Set(), checkpoint: null,
  endings: Store.get('endings', []), slot: Store.get('lastSlot', 1), deaths: 0, lastLockLoss: 0, safeTime: 0, batteriesUsed: 0, shake: 0, endingPending: false,
  sanity: 100, relics: new Set(), throwables: { chalk: 0, bottle: 0 }, barricades: [], padName: '', tookDamage: false, chaseTime: 0, altarDone: false, legendSeen: false, whispersT: 20, safeNotice: 0, phase: 1,
};
/* ---------------- achievements (persisted) ---------------- */
const ACH_LIST = ['first_light', 'hidden', 'thrower', 'barricade', 'librarian', 'secret', 'power', 'truth', 'relics', 'escape', 'peace', 'fire', 'hunted', 'untouched', 'nightmare', 'legend'];
const Codex = {
  relics: new Set(Store.get('foundRelics', [])), pages: new Set(Store.get('foundPages', [])),
  addRelic(k) { this.relics.add(k); Store.set('foundRelics', [...this.relics]); },
  addPage(p) { this.pages.add(p); Store.set('foundPages', [...this.pages]); },
};
const Achv = {
  set: new Set(Store.get('achv', [])),
  unlock(id) {
    if (!id || this.set.has(id)) return false;
    this.set.add(id); Store.set('achv', [...this.set]);
    try { audio.pickup(); audio.blip({ f0: 1320, dur: 0.5, vol: 0.12, delay: 0.12 }); UI.toast('🏆 ' + t('ach_'+id+'_t') + ' — ' + t('ach_unlocked'), 'good'); } catch (e) { /* before UI */ }
    UI.achSig = '';
    return true;
  },
  has(id) { return this.set.has(id); },
};
let prof = null, player = null;

const Input = {
  keys: new Set(), pressed: new Set(), lookDX: 0, lookDY: 0, joyX: 0, joyY: 0, joyActive: false, touchRun: false, touchBreath: false, dragging: false,
  consume(a) { if (this.pressed.has(a)) { this.pressed.delete(a); return true; } return false; },
  press(a) { this.pressed.add(a); },
  get runHeld() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun; },
  get breathHeld() { return this.keys.has('Space') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun || this.touchBreath; },
  clear() { this.keys.clear(); this.pressed.clear(); this.lookDX = this.lookDY = 0; this.joyX = this.joyY = 0; this.touchRun = false; this.touchBreath = false; },
};
const KEYMAP = { KeyE: 'interact', Enter: 'interact', Space: 'jump', KeyC: 'crouch', ControlLeft: 'crouch', KeyF: 'flash', KeyQ: 'throw', KeyR: 'barricade', Tab: 'journal', KeyJ: 'journal', KeyM: 'map', Escape: 'pause', KeyP: 'pause' };
function requestLock() {
  if (IS_TOUCH && S.touch) return;
  if (document.pointerLockElement === canvasEl || !canvasEl.requestPointerLock) return;
  try { const p = canvasEl.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
}
function releaseLock() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ } }
function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.code !== 'Escape') return;
    const act = KEYMAP[e.code];
    if (act === 'journal' || e.code === 'Space' || e.code === 'Tab') { if (G.state === 'playing' || G.modal) e.preventDefault(); }
    if (e.repeat) return;
    Input.keys.add(e.code);
    if (act) {
      if (act === 'pause') {
        if (G.state === 'paused') {
          if ($('#settings').classList.contains('active') || $('#controls').classList.contains('active') || $('#language').classList.contains('active') || $('#archive').classList.contains('active')) { UI.close('settings'); UI.close('controls'); UI.close('language'); UI.close('archive'); }
          else UI.pause(false);
          return;
        }
        if (performance.now() - G.lastLockLoss < 300) return;
      }
      Input.press(act);
    }
  });
  window.addEventListener('keyup', (e) => { Input.keys.delete(e.code); });
  window.addEventListener('blur', () => { Input.keys.clear(); if (G.state === 'playing' && !G.modal) UI.pause(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { audio.suspend(); if (G.state === 'playing' && !G.modal) UI.pause(true); } else if (G.state !== 'paused') audio.resume(); });
  document.addEventListener('mousemove', (e) => {
    if (G.state !== 'playing' || G.modal) return;
    if (document.pointerLockElement === canvasEl) { Input.lookDX += e.movementX || 0; Input.lookDY += e.movementY || 0; }
    else if (Input.dragging) { Input.lookDX += e.movementX || 0; Input.lookDY += e.movementY || 0; }
  });
  canvasEl.addEventListener('mousedown', (e) => {
    if (G.state !== 'playing' || G.modal || e.button !== 0) return;
    if (!document.pointerLockElement) { Input.dragging = true; requestLock(); }
  });
  window.addEventListener('mouseup', () => { Input.dragging = false; });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && G.state === 'playing' && !G.modal) { G.lastLockLoss = performance.now(); UI.pause(true); }
  });
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

class Player {
  constructor() {
    this.char = buildStudent(); scene.add(this.char.root);
    this.pos = new THREE.Vector3(6.1, 0, 10.0); this.vel = new THREE.Vector3(); this.vy = 0; this.onGround = true;
    this.yaw = Math.PI; this.pitch = 0.28; this.bodyYaw = Math.PI; this.crouch = false; this.running = false; this.speed = 0;
    this.health = 100; this.stamina = 100; this.exhausted = false; this.staminaDelay = 0; this.battery = 100; this.flash = false; this.flashI = 0; this.hasFlash = false;
    this.stun = 0; this.stepAcc = 0; this.noise = 0; this.hidden = null; this.breath = 100; this.holding = false; this.breathLock = false; this.hideTime = 0;
    this.camDist = 3.1; this.camCur = 3.1; this.camPos = new THREE.Vector3(); this.camFwd = new THREE.Vector3(0, 0, 1); this.fov = S.fov;
    this.aim = new THREE.Vector3(0, 0, 1); this.handPos = new THREE.Vector3(); this.idleTime = 0; this.eye = new THREE.Vector3(); this.lastHit = -10; this.moveDir = new THREE.Vector3();
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(1.5, 7, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beam.geometry.translate(0, -3.5, 0); this.beam.geometry.rotateX(-Math.PI / 2); this.beam.visible = false; this.beam.renderOrder = 5; scene.add(this.beam);
    this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
  }
  get height() { return this.crouch ? 1.0 : 1.62; }
  get headY() { return this.pos.y + this.height - 0.1; }
  reset(x, y, z, yaw) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.vy = 0; this.onGround = true; this.yaw = yaw; this.bodyYaw = yaw; this.pitch = 0.28; this.crouch = false; this.hidden = null;
    this.stun = 0; this.char.root.visible = true; this.exhausted = false; this.stamina = 100; this.breath = 100; this.flashI = 0;
  }
  /* sound made by the player; the professor listens */
  makeNoise(radius, kind) { if (prof) prof.hear(this.pos, radius, kind); }

  hurt(amount) {
    if (G.state !== 'playing' || this.hidden) return;
    this.health -= amount; this.lastHit = G.time; G.safeTime = 0; G.shake = 1; G.tookDamage = true;
    this.char.anim.shot('hurt', 0.6); this.stun = 0.85; audio.hurt(); UI.damageFlash();
    if (this.health <= 0) { this.health = 0; Game.die('caught'); }
  }
  toggleFlash() {
    if (!this.hasFlash) { UI.toast(t('no_flash'), 'warn'); return; }
    if (!this.flash && this.battery <= 0) { UI.toast(t('no_battery'), 'warn'); audio.click(); return; }
    this.flash = !this.flash; audio.flash();
  }
  addBattery(v) { this.battery = Math.min(100, this.battery + v); }

  update(dt) {
    const dm = DIFF[S.diff] || DIFF.normal;
    // look
    const sens = 0.0022 * (S.sens / 100) * (IS_TOUCH && S.touch ? 1.15 : 1);
    this.yaw -= Input.lookDX * sens; this.pitch = clamp(this.pitch + Input.lookDY * sens * (S.invert ? -1 : 1), -0.7, 1.05);
    Input.lookDX = 0; Input.lookDY = 0;
    // flashlight battery
    if (this.flash) {
      this.battery -= dt * 0.5 * dm.battery;
      if (this.battery <= 0) { this.battery = 0; this.flash = false; audio.flash(); UI.toast(t('battery_dead'), 'warn'); }
    }
    if (Input.consume('flash')) this.toggleFlash();
    if (this.hidden) { this.updateHidden(dt); this.updateCamera(dt); this.updateFlash(dt); return; }
    // stamina
    const ix = (Input.keys.has('KeyD') || Input.keys.has('ArrowRight') ? 1 : 0) - (Input.keys.has('KeyA') || Input.keys.has('ArrowLeft') ? 1 : 0) + Input.joyX;
    const iy = (Input.keys.has('KeyW') || Input.keys.has('ArrowUp') ? 1 : 0) - (Input.keys.has('KeyS') || Input.keys.has('ArrowDown') ? 1 : 0) + Input.joyY;
    let il = Math.hypot(ix, iy); const moving = il > 0.12 && this.stun <= 0;
    if (Input.consume('crouch')) { this.crouch = !this.crouch; }
    const wantRun = Input.runHeld && moving && !this.crouch && !this.exhausted && this.stamina > 0;
    this.running = wantRun;
    if (wantRun) { this.stamina -= 17 * dt; this.staminaDelay = 1.0; if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; } }
    else { this.staminaDelay -= dt; if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + 16 * dt); if (this.exhausted && this.stamina > 28) this.exhausted = false; }
    // wish velocity
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    let wx = fx * iy + rx * ix, wz = fz * iy + rz * ix; const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const maxSp = this.crouch ? 1.35 : (wantRun ? 4.7 : (this.exhausted ? 2.1 : 2.55));
    const mag = moving ? Math.min(1, wl) : 0;
    const tx = wx * maxSp * (moving ? 1 : 0), tz = wz * maxSp * (moving ? 1 : 0); void mag;
    const acc = this.onGround ? 13 : 3.5;
    this.vel.x = damp(this.vel.x, tx, acc, dt); this.vel.z = damp(this.vel.z, tz, acc, dt);
    this.stun = Math.max(0, this.stun - dt);
    if (this.stun > 0) { this.vel.x *= 0.9; this.vel.z *= 0.9; }
    // jump
    if (Input.consume('jump') && this.onGround && !this.crouch && this.stun <= 0 && this.stamina > 8) {
      this.vy = 5.4; this.onGround = false; this.stamina -= 7; this.staminaDelay = 0.8; this.makeNoise(7, 'jump');
    }
    // integrate with sub-steps + collision
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vel.x, this.vel.z) * dt / 0.18));
    const hgt = this.height + 0.05;
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * dt / steps; this.pos.z += this.vel.z * dt / steps;
      resolveCircle(this.pos, 0.31, this.pos.y, hgt);
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // vertical
    const gy = groundAt(this.pos.x, this.pos.z, this.pos.y, 0.2);
    if (this.onGround) {
      if (gy > this.pos.y) this.pos.y = gy;
      else if (this.pos.y - gy > 0.7) { this.onGround = false; this.vy = 0; }
      else if (this.pos.y - gy > 0.002) this.pos.y = Math.max(gy, this.pos.y - 9 * dt);
    }
    if (!this.onGround) {
      this.vy -= 15 * dt; this.pos.y += this.vy * dt;
      if (this.pos.y <= gy && this.vy <= 0) {
        const hard = this.vy < -4.2; this.pos.y = gy; this.onGround = true;
        if (hard) { this.makeNoise(9, 'land'); audio.step('run', null, 1.2); }
        this.vy = 0;
      }
    }
    // noise + footsteps
    if (this.onGround && this.speed > 0.5) {
      this.stepAcc += this.speed * dt; const stride = this.running ? 1.55 : (this.crouch ? 1.0 : 1.15);
      if (this.stepAcc >= stride) {
        this.stepAcc = 0; const k = this.running ? 'run' : (this.crouch ? 'crouch' : 'walk');
        audio.step(k, null, 0.9); this.makeNoise(this.running ? 15 : (this.crouch ? 2.5 : 6.5), k);
      }
      this.noise = this.running ? 15 : (this.crouch ? 2.5 : 6.5);
    } else this.noise = this.onGround ? 0 : 5;
    // facing
    if (this.speed > 0.35) { this.bodyYaw = lerpAngle(this.bodyYaw, Math.atan2(this.vel.x, this.vel.z), 1 - Math.exp(-11 * dt)); this.idleTime = 0; }
    else { this.idleTime += dt; if (this.flash && this.idleTime > 0.15) this.bodyYaw = lerpAngle(this.bodyYaw, this.yaw, 1 - Math.exp(-4 * dt)); }
    // character visual + animation weights
    const c = this.char; c.root.position.copy(this.pos); c.root.rotation.y = this.bodyYaw;
    const s = this.speed, ad = c.anim;
    if (!this.onGround && this.vy !== 0 && this.pos.y - gy > 0.15) ad.set({ jump: 1 });
    else if (this.crouch) { const w = clamp(s / 1.1, 0, 1); ad.set({ crouchWalk: w, crouchIdle: 1 - w }); ad.speed('crouchWalk', clamp(s / 1.2, 0.5, 1.4)); }
    else { const wr = clamp((s - 2.8) / 1.6, 0, 1), ww = clamp(s / 1.8, 0, 1) * (1 - wr); ad.set({ run: wr, walk: ww, idle: Math.max(0, 1 - wr - ww) }); ad.speed('walk', clamp(s / 2.1, 0.5, 1.4)); ad.speed('run', clamp(s / 4.6, 0.8, 1.25)); }
    ad.update(dt);
    c.blob.visible = true;
    this.updateCamera(dt);
    this.updateFlash(dt);
    // safe time / regen
    G.safeTime += dt;
    if (G.safeTime > 9 && this.health < 100) this.health = Math.min(100, this.health + 1.8 * dm.regen * dt);
  }

  updateCamera(dt) {
    const hid = this.hidden;
    if (hid) {   // hidden: fixed first-person view with a limited look range
      const base = Math.atan2(hid.fx, hid.fz);
      const lim = hid.under ? 1.15 : 0.55;
      const yawOff = clamp(angleDiff(base, this.yaw), -lim, lim); this.yaw = base + yawOff;
      this.pitch = hid.under ? clamp(this.pitch, -0.15, 0.55) : clamp(this.pitch, -0.35, 0.4);
      this.camPos.set(hid.x + hid.fx * 0.08, hid.y + (hid.under ? 0.42 : 1.5), hid.z + hid.fz * 0.08);
      camera.position.copy(this.camPos); camera.rotation.set(-this.pitch, this.yaw + Math.PI, 0);
      this.camFwd.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      return;
    }
    const cy = this.yaw, cp = this.pitch, cosP = Math.cos(cp);
    const fx = Math.sin(cy) * cosP, fy = -Math.sin(cp), fz = Math.cos(cy) * cosP;
    this.camFwd.set(fx, fy, fz);
    const px = this.pos.x + (-Math.cos(cy)) * 0.42, pz = this.pos.z + Math.sin(cy) * 0.42;
    const py = this.pos.y + (this.crouch ? 0.95 : 1.42);
    const want = this.camDist;
    let hit = rayBoxes(px, py, pz, -fx, -fy, -fz, want + 0.2, 0.2, true);
    // keep camera inside the room's vertical limits
    const room = roomAt(this.pos.x, this.pos.z); const ceil = room ? room.y + room.h - 0.12 : py + 3;
    if (-fy > 0.01) { const dyMax = ceil - py; if (dyMax > 0) hit = Math.min(hit, dyMax / -fy); else hit = Math.min(hit, 0.3); }
    const floorY = this.pos.y + 0.18; if (fy > 0.01) { const dyMax = py - floorY; hit = Math.min(hit, Math.max(0.3, dyMax / fy)); }
    const target = clamp(hit - 0.08, 0.35, want);
    this.camCur = target < this.camCur ? target : damp(this.camCur, target, 5, dt);
    this.camPos.set(px - fx * this.camCur, py - fy * this.camCur, pz - fz * this.camCur);
    // screen shake
    let sx = 0, sy = 0;
    if (S.safe) G.shake = 0;
    if (G.shake > 0.01) { sx = (Math.random() - 0.5) * 0.12 * G.shake; sy = (Math.random() - 0.5) * 0.12 * G.shake; G.shake = Math.max(0, G.shake - dt * 2.2); }
    camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
    camera.rotation.set(-cp, cy + Math.PI, 0);
    const wantFov = S.fov + (this.running ? 6 : 0) + (this.crouch ? -3 : 0) + G.tension * 3;
    this.fov = damp(this.fov, wantFov, 5, dt); if (Math.abs(camera.fov - this.fov) > 0.05) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
    this.char.root.visible = this.camCur > 0.75;
    // aim point (flashlight follows the camera crosshair)
    const dHit = rayBoxes(this.camPos.x, this.camPos.y, this.camPos.z, fx, fy, fz, 30, 0.02, true);
    const dAim = Math.max(dHit, this.camCur + 2.2);
    this.aim.set(this.camPos.x + fx * dAim, this.camPos.y + fy * dAim, this.camPos.z + fz * dAim);
  }

  updateFlash(dt) {
    const c = this.char;
    // 1) pose the right arm toward the aim point (uses last frame's hand position)
    let dir = this._v.copy(this.aim).sub(this.handPos).normalize();
    if (!this.hidden && (this.flash || this.flashI > 0.05)) {
      const w = this.flashI * 0.9;
      const aimQ = this._q.setFromEuler(_ea.set(-Math.PI / 2 - clamp(Math.asin(clamp(dir.y, -1, 1)), -0.9, 0.9) * 0.9, -0.1, -0.12, 'XYZ'));
      c.j.armR.quaternion.slerp(aimQ, w);
      c.j.foreR.quaternion.slerp(_qa.setFromEuler(_ea.set(-0.15, 0, 0)), w);
    }
    // 2) world matrices → hand position → light + beam
    c.root.updateMatrixWorld(true);
    c.j.hand.getWorldPosition(this.handPos);
    if (this.hidden) this.handPos.set(this.camPos.x, this.camPos.y - 0.2, this.camPos.z);
    dir = this._v.copy(this.aim).sub(this.handPos).normalize();
    let target = this.flash ? 1 : 0;
    if (this.flash && this.battery < 18) { const n = hash1(Math.floor(G.time * 9)); target = n > 0.55 ? 1 : (n > 0.3 ? 0.35 : 0.0); }
    this.flashI = damp(this.flashI, target, 30, dt);
    const on = this.flashI > 0.02 && !this.hidden;
    flashlight.visible = on; flashlight.intensity = 190 * this.flashI;
    flashlight.position.copy(this.handPos).addScaledVector(dir, 0.12); flashTarget.position.copy(this.handPos).addScaledVector(dir, 6);
    flashTarget.updateMatrixWorld();
    this.beam.visible = on;
    if (on) {
      this.beam.position.copy(this.handPos); this._m.lookAt(this._v2.set(0, 0, 0), dir, THREE.Object3D.DEFAULT_UP); this.beam.quaternion.setFromRotationMatrix(this._m);
      this.beam.material.opacity = 0.045 * this.flashI;
    }
    c.lens.visible = this.flashI > 0.1;
  }

  updateHidden(dt) {
    this.hideTime += dt;
    const want = Input.breathHeld;
    if (want && !this.breathLock && this.breath > 0) { this.holding = true; this.breath -= 11 * dt; if (this.breath <= 0) { this.breath = 0; this.breathLock = true; this.holding = false; audio.breath(null); } }
    else { this.holding = false; this.breath = Math.min(100, this.breath + 16 * dt); if (this.breathLock && this.breath > 30) this.breathLock = false; }
    this.noise = 0;
  }
}

/* =====================================================================
   7. PROFESSOR AI
      dormant → patrol → (suspicious) → investigate noise → chase (sees player)
      → search last-known position + check hiding spots → return to patrol
   ===================================================================== */
const PATROL_POINTS = [
  [6, 6], [18, 6], [30, 6], [44, 6], [58, 6], [10, 13], [30, 13], [50, 13], [7, 28], [7, 20], [20, 20], [40, 20], [48, 20], [25, 27], [45, 27], [60, 27],
  [26, 35], [42, 34], [50, 34], [60, 34], [31, 20, 'office'],
  [70, 18, 'base'], [90, 18, 'base'], [100, 18, 'base'], [71, 12, 'base'], [84, 13, 'base'], [98, 12, 'base'], [73, 25, 'base'], [86, 25, 'base'], [98, 25, 'shrine'],
];
const PROF_LINES = ['pl_1', 'pl_2', 'pl_3', 'pl_4', 'pl_5', 'pl_6'], CHASE_LINES = ['pc_1', 'pc_2', 'pc_3', 'pc_4'], LOST_LINES = ['pf_1', 'pf_2', 'pf_3'];

class Professor {
  constructor() {
    this.char = buildProfessor(); scene.add(this.char.root);
    this.pos = new THREE.Vector3(30, 0, 27); this.yaw = 0; this.state = 'dormant'; this.active = false; this.visible = false; this.char.root.visible = false;
    this.path = []; this.pi = 0; this.repath = 0; this.speed = 0; this.awareness = 0; this.lastKnown = new THREE.Vector3(); this.hasLast = false;
    this.target = new THREE.Vector3(); this.timer = 0; this.losT = 0; this.canSee = false; this.senseT = 0; this.stuckT = 0; this.stuckPos = new THREE.Vector3();
    this.cool = 0; this.rage = false; this.stepAcc = 0; this.voiceT = rand(25, 45); this.growlT = 0; this.pause = 0; this.attackT = -1; this.suspicious = 0;
    this.spots = []; this.spot = null; this.spotT = 0; this.holdFail = 0; this.ambushSpot = null; this.lastPatrol = -1; this.knowsHidden = false; this.dirT = 0; this.noticeHold = 0;
    this.curSpeed = 0; this.phase = 1; this.phaseMul = 1;
  }
  get dm() {
    const b = DIFF[S.diff] || DIFF.normal, k = this.phase - 1;
    return Object.assign({}, b, { speed: b.speed * (1 + k * 0.075), vision: b.vision * (1 + k * 0.1), hear: b.hear * (1 + k * 0.13) });
  }
  setVisible(v) { this.visible = v; this.char.root.visible = v; }
  placeAt(x, z) { this.pos.set(x, groundAt(x, z, 0.5, 0.2, true), z); this.char.root.position.copy(this.pos); this.path = []; this.pi = 0; this.stuckPos.copy(this.pos); }
  activate(x, z, state = 'patrol') { this.active = true; this.phase = 1 + (G.pages.size >= 3 ? 1 : 0) + (G.pages.size >= 6 ? 1 : 0); this.setVisible(true); this.placeAt(x, z); this.setState(state); this.awareness = 0; }
  deactivate() { this.active = false; this.state = 'dormant'; this.setVisible(false); this.path = []; this.awareness = 0; monsterLight.intensity = 0; }
  setState(s) { this.state = s; this.timer = 0; if (s !== 'chase') this.noticeHold = 0; }
  setRage(v) { this.rage = v; }

  tension() {
    if (!this.active) return 0;
    const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) + Math.abs(player.pos.y - this.pos.y) * 2;
    if (['chase', 'attack', 'ambush'].includes(this.state)) return 1;
    if (['investigate', 'suspicious', 'search', 'check'].includes(this.state)) return clamp(1 - d / 24, 0, 0.8);
    return clamp(1 - d / 14, 0, 0.45);
  }
  /* ---------- perception ---------- */
  hear(p, radius, kind) {
    if (!this.active || this.state === 'dormant' || this.state === 'attack' || player.hidden) return;
    radius *= this.dm.hear * (this.rage ? 1.4 : 1) * (G.sanity < 30 ? 1.22 : 1);
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z) + Math.abs(p.y - this.pos.y) * 1.5;
    if (d > radius) return;
    if (!losClear(this.pos.x, this.pos.y + 1.6, this.pos.z, p.x, p.y + 1.0, p.z) && d > radius * 0.62) return;
    if (this.state === 'chase' || this.state === 'ambush') { this.lastKnown.copy(p); this.hasLast = true; return; }
    this.investigate(p, d < radius * 0.4);
  }
  investigate(p, close) {
    if (['chase', 'attack', 'ambush'].includes(this.state)) return;
    this.target.copy(p); this.setState('investigate'); this.timer = 0; this.repath = 0;
    if (!this.pathTo(p.x, p.z)) { this.setState('search'); this.timer = 0; this.buildSpots(p); }
    if (close && Math.random() < 0.5) audio.growl(this.pos);
  }
  senseVision() {
    const pl = player; this.canSee = false;
    if (pl.hidden && !this.knowsHidden) return;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z, dy = pl.pos.y - this.pos.y, dist = Math.hypot(dx, dz);
    if (Math.abs(dy) > 3.2) return;
    const chasing = this.state === 'chase' || this.state === 'ambush';
    let range = pl.flash ? 21 : 9.5;
    if (pl.crouch) range *= 0.62; if (pl.running) range *= 1.3; if (chasing) range *= 1.4; if (this.rage) range *= 1.45;
    range *= this.dm.vision;
    if (dist > range) return;
    const fxv = Math.sin(this.yaw), fzv = Math.cos(this.yaw); const cosA = dist > 0.01 ? (dx * fxv + dz * fzv) / dist : 1;
    const need = chasing ? -0.1 : (this.state === 'search' ? 0.1 : 0.42);
    if (dist > 2.8 && cosA < need) return;
    const th = pl.hidden ? 1.2 : (pl.crouch ? 0.85 : 1.4);
    if (!losClear(this.pos.x, this.pos.y + 2.0, this.pos.z, pl.pos.x, pl.pos.y + th, pl.pos.z)) return;
    this.canSee = true; this.seenDist = dist; this.seenRange = range;
  }

  /* ---------- navigation ---------- */
  pathTo(x, z) {
    const p = findPath(this.pos.x, this.pos.z, x, z);
    if (!p) { this.path = []; this.pi = 0; return false; }
    this.path = p; this.pi = 0; return true;
  }
  /* walk along the current path. returns true when finished */
  follow(dt, speed, turnRate = 6) {
    if (this.pi >= this.path.length) { this.curSpeed = damp(this.curSpeed, 0, 8, dt); return true; }
    const n = this.path[this.pi]; const dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.32) { this.pi++; return this.pi >= this.path.length; }
    this.steer(dx / d, dz / d, speed, dt, turnRate); return false;
  }
  steer(dirx, dirz, speed, dt, turnRate = 6) {
    this.yaw = lerpAngle(this.yaw, Math.atan2(dirx, dirz), 1 - Math.exp(-turnRate * dt));
    const al = Math.max(0, Math.cos(angleDiff(this.yaw, Math.atan2(dirx, dirz))));
    this.curSpeed = damp(this.curSpeed, speed * (0.35 + 0.65 * al), 7, dt);
    this.pos.x += dirx * this.curSpeed * dt; this.pos.z += dirz * this.curSpeed * dt;
    resolveCircle(this.pos, 0.4, this.pos.y, 2.0, { npc: true });
    const gy = groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.2, true); this.pos.y = damp(this.pos.y, gy, 12, dt);
  }
  openDoorsAhead() {
    if (this.pause > 0) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const d of World.doors) {
      if (d.open || d.locked || d.secret || d.exit) continue;
      const dx = d.cx - this.pos.x, dz = d.cz - this.pos.z, dd = Math.hypot(dx, dz);
      if (dd > 1.9 || Math.abs(d.pos.y - 1.1 - this.pos.y) > 1.5 || (dx * fx + dz * fz) <= -0.2) continue;
      if (d.barricaded) { Game.breakBarricade(d, this); this.pause = 0.55; return; }
      d.toggle(this.pos); this.pause = this.state === 'chase' ? 0.3 : 0.7; Game.onDoorByNpc(d); return;
    }
  }
  pickPatrol() {
    const pl = player; const cand = [];
    for (let i = 0; i < PATROL_POINTS.length; i++) {
      const [x, z, tag] = PATROL_POINTS[i];
      if (tag === 'office' && !G.flags.officeOpen) continue;
      if (tag === 'base' && !G.flags.stairsOpen) continue;
      if (tag === 'shrine' && !G.flags.power) continue;
      if (i === this.lastPatrol) continue;
      const d = Math.hypot(x - this.pos.x, z - this.pos.z); if (d < 6) continue;
      const dp = Math.hypot(x - pl.pos.x, z - pl.pos.z) + (Math.abs((tag === 'base' || tag === 'shrine' ? -4 : 0) - pl.pos.y) > 2 ? 30 : 0);
      let w = 1; if (dp < 40) w += 2.2; if (dp < 18) w += 1.5; if (dp < 6) w = 0.05;
      cand.push([i, w]);
    }
    let tot = cand.reduce((a, c) => a + c[1], 0), r = Math.random() * tot, pick = cand[0] && cand[0][0];
    for (const c of cand) { r -= c[1]; if (r <= 0) { pick = c[0]; break; } }
    if (pick === undefined) return false;
    this.lastPatrol = pick; const [x, z] = PATROL_POINTS[pick];
    return this.pathTo(x, z);
  }
  buildSpots(center) {
    this.spots = World.hides.filter((h) => Math.hypot(h.x - center.x, h.z - center.z) < 8 && Math.abs(h.y - center.y) < 2.5).sort((a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z)).slice(0, 3);
    if (player.hidden && !this.spots.includes(player.hidden) && Math.hypot(player.hidden.x - center.x, player.hidden.z - center.z) < 10) this.spots.unshift(player.hidden);
  }

  /* ---------- chase / attack ---------- */
  startChase(announce = true) {
    if (this.state === 'chase') return;
    this.setState('chase'); this.hasLast = true; this.lastKnown.copy(player.pos); this.losT = 0; this.repath = 0; this.awareness = 1; this.pause = 0;
    if (announce) {
      this.char.anim.shot('scream', 1.1); this.pause = 0.9; audio.shriek(this.pos); audio.growl(this.pos); audio.stinger(0.8);
      UI.prof(t(pick(CHASE_LINES))); G.shake = Math.max(G.shake, 0.5);
    }
  }
  ambush(spot) { this.ambushSpot = spot; this.setState('ambush'); this.repath = 0; }
  startAttack() { this.setState('attack'); this.attackT = 0; this.char.anim.shot('attack', 1.0); audio.growl(this.pos); }
  loseTrack() {
    this.setState('search'); this.timer = 0; this.buildSpots(this.lastKnown); this.awareness = 0.3; this.path = [];
    if (Math.random() < 0.8) UI.prof(t(pick(LOST_LINES)));
  }

  update(dt) {
    if (!this.active) { monsterLight.intensity = 0; this.updateVisual(dt, 0); return; }
    const pl = player; const dm = this.dm;
    const ph = 1 + (G.pages.size >= 3 ? 1 : 0) + (G.pages.size >= 6 ? 1 : 0);
    if (ph !== this.phase) {
      this.phase = ph; this.phaseMul = 1 + (ph - 1) * 0.075; G.phase = ph;
      if (this.active && ph > 1) { UI.sub(t(ph === 2 ? 'phase_up' : 'phase3'), 4200, 'prof'); audio.stinger(0.45); this.awareness = Math.min(1, this.awareness + 0.25); G.shake = Math.max(G.shake, 0.3); }
    }
    this.pause = Math.max(0, this.pause - dt); this.cool = Math.max(0, this.cool - dt);
    // sensing @ 10 Hz
    this.senseT -= dt;
    if (this.senseT <= 0) { this.senseT = 0.1; this.senseVision(); }
    const dPl = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    // awareness
    const st = this.state;
    if (this.canSee && !['attack'].includes(st)) {
      const gain = (0.9 + 1.7 * (1 - clamp(this.seenDist / this.seenRange, 0, 1))) * (this.rage ? 1.6 : 1);
      this.awareness = Math.min(1, this.awareness + gain * dt);
      if (this.seenDist < 3.2 && !pl.hidden) this.awareness = 1;
      this.lastKnown.copy(pl.pos); this.hasLast = true; this.losT = 0;
      if (this.awareness >= 1 && st !== 'chase' && st !== 'ambush') { this.knowsHidden = false; this.startChase(); }
      else if (this.awareness > 0.35 && ['patrol', 'return', 'idle'].includes(st)) { this.setState('suspicious'); }
    } else {
      this.awareness = Math.max(0, this.awareness - (st === 'chase' ? 0.05 : 0.3) * dt); this.losT += dt;
    }
    // stuck detection
    this.dirT -= dt;
    if (this.dirT <= 0) {
      this.dirT = 0.5;
      if (this.path.length && this.pi < this.path.length && this.curSpeed > 0.6 && this.pause <= 0) {
        if (Math.hypot(this.pos.x - this.stuckPos.x, this.pos.z - this.stuckPos.z) < 0.14) this.stuckT += 0.5; else this.stuckT = 0;
        if (this.stuckT >= 2) { this.repath = 0; this.pathTo(this.target.x || this.pos.x, this.target.z || this.pos.z); }
        if (this.stuckT >= 4) { const n = this.path[Math.min(this.pi, this.path.length - 1)]; if (n) { this.pos.x = n.x; this.pos.z = n.z; } this.stuckT = 0; }
      } else this.stuckT = 0;
      this.stuckPos.copy(this.pos);
    }
    let animWeights = null;
    switch (st) {
      case 'idle': animWeights = { idle: 1 }; this.curSpeed = damp(this.curSpeed, 0, 8, dt); break;
      case 'patrol': {
        if (this.pause > 0) { animWeights = { idle: 1 }; break; }
        this.openDoorsAhead();
        const done = this.pi >= this.path.length ? true : this.follow(dt, 1.65 * dm.speed, 5);
        if (done) { if (this.timer <= 0) this.timer = 0.01; this.timer += dt; this.curSpeed = damp(this.curSpeed, 0, 8, dt); animWeights = { search: 1 }; if (this.timer > rand(2.5, 4.5)) { this.timer = 0; if (!this.pickPatrol()) this.timer = -2; } }
        break;
      }
      case 'suspicious': {
        this.timer += dt; this.curSpeed = damp(this.curSpeed, 0, 8, dt); animWeights = { search: 1 };
        const ang = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z); if (this.canSee) this.yaw = lerpAngle(this.yaw, ang, 1 - Math.exp(-4 * dt));
        if (this.awareness < 0.2 || this.timer > 3) { if (this.hasLast && this.awareness > 0.2) { this.investigate(this.lastKnown, false); } else this.setState('return'); }
        break;
      }
      case 'investigate': {
        if (this.pause > 0) { animWeights = { idle: 1 }; break; }
        this.openDoorsAhead(); this.timer += dt;
        const done = this.follow(dt, 2.35 * dm.speed * (this.rage ? 1.12 : 1), 7);
        if (done || this.timer > 25) { this.setState('search'); this.timer = 0; this.buildSpots(this.target); }
        break;
      }
      case 'chase': {
        if (this.pause > 0) { animWeights = { idle: 1 }; this.curSpeed = 0; this.yaw = lerpAngle(this.yaw, Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z), 1 - Math.exp(-6 * dt)); break; }
        this.openDoorsAhead();
        const sp = 3.75 * dm.speed * (this.rage ? 1.12 : 1) * (this.cool > 0 ? 0.55 : 1);
        this.growlT -= dt; if (this.growlT <= 0) { this.growlT = rand(5, 9); audio.growl(this.pos); }
        if (this.canSee) {
          const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z, d = Math.hypot(dx, dz);
          if (d < 1.55 && Math.abs(pl.pos.y - this.pos.y) < 1.5 && this.cool <= 0 && !pl.hidden) { this.startAttack(); break; }
          if (d < 7 && losClear(this.pos.x, this.pos.y + 0.8, this.pos.z, pl.pos.x, pl.pos.y + 0.8, pl.pos.z)) { this.steer(dx / d, dz / d, sp, dt, 10); this.path = []; this.pi = 0; break; }
        }
        this.repath -= dt;
        if (this.repath <= 0) { this.repath = 0.35; this.target.copy(this.canSee ? pl.pos : this.lastKnown); if (!this.pathTo(this.target.x, this.target.z)) { const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz) || 1; this.steer(dx / d, dz / d, sp * 0.5, dt, 8); } }
        const arrived = this.follow(dt, sp, 10);
        if (!this.canSee && (this.losT > 3.2 || (arrived && this.losT > 0.8))) this.loseTrack();
        break;
      }
      case 'attack': {
        this.attackT += dt; this.curSpeed = damp(this.curSpeed, 0, 10, dt); animWeights = { idle: 1 };
        this.yaw = lerpAngle(this.yaw, Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z), 1 - Math.exp(-8 * dt));
        if (this.attackT > 0.42 && this.attackT - dt <= 0.42) {
          const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
          if (d < 2.1 && !pl.hidden && Math.abs(pl.pos.y - this.pos.y) < 1.8) { pl.hurt(dm.dmg); pl.vel.x += Math.sin(this.yaw) * 5; pl.vel.z += Math.cos(this.yaw) * 5; }
        }
        if (this.attackT > 1.0) { this.cool = 1.5; this.setState('chase'); this.pause = 0.2; }
        break;
      }
      case 'ambush': {
        const sp = this.ambushSpot; if (!sp) { this.loseTrack(); break; }
        this.openDoorsAhead(); this.repath -= dt;
        if (this.repath <= 0) { this.repath = 0.4; this.pathTo(sp.stand.x, sp.stand.z); }
        const d = Math.hypot(sp.stand.x - this.pos.x, sp.stand.z - this.pos.z);
        this.follow(dt, 4.0 * dm.speed, 10);
        if (d < 1.0) { this.spot = sp; this.spotT = 0; this.holdFail = 99; this.setState('check'); this.ambushSpot = null; }
        break;
      }
      case 'search': {
        this.timer += dt; this.curSpeed = damp(this.curSpeed, 0, 8, dt); animWeights = { search: 1 };
        if (this.pause > 0) break;
        if (this.timer > 4.5) { if (this.spots.length) { this.spot = this.spots.shift(); this.spotT = 0; this.holdFail = 0; this.setState('check'); this.pathTo(this.spot.stand.x, this.spot.stand.z); } else if (this.timer > 7) { this.setState('return'); this.pickPatrolNear(); } }
        break;
      }
      case 'check': {
        const sp = this.spot; if (!sp) { this.setState('search'); break; }
        const d = Math.hypot(sp.stand.x - this.pos.x, sp.stand.z - this.pos.z);
        if (d > 0.7 && this.spotT === 0) { this.openDoorsAhead(); if (this.follow(dt, 2.4 * dm.speed, 8)) this.spotT = 0.001; if (d < 0.7) this.spotT = 0.001; break; }
        this.spotT += dt; this.curSpeed = damp(this.curSpeed, 0, 8, dt); animWeights = { search: 1 };
        this.yaw = lerpAngle(this.yaw, Math.atan2(sp.x - this.pos.x, sp.z - this.pos.z), 1 - Math.exp(-8 * dt));
        if (this.spotT > 0.5 && !sp.under) sp.tgt = 1;
        if (sp.occupied && this.spotT > 0.8 && !pl.holding) this.holdFail += dt;
        if (sp.occupied && this.spotT > 0.8 && this.spotT < 0.85 && !this._flash) { this._flash = true; UI.toast(t('hold_breath_now'), 'warn'); }
        if (this.spotT > 2.6) {
          this._flash = false;
          if (sp.occupied) {
            if (this.holdFail > 0.45) { Game.pullFromLocker(sp); }
            else { UI.prof(t('pf_pass')); audio.breath(null); sp.tgt = 0; this.spot = null; this.setState('search'); this.timer = 3.5; }
          } else { sp.tgt = 0; this.spot = null; this.setState('search'); this.timer = 3.5; }
        }
        break;
      }
      case 'return': {
        if (this.pause > 0) { animWeights = { idle: 1 }; break; }
        this.openDoorsAhead();
        const done = this.pi >= this.path.length ? true : this.follow(dt, 2.0 * dm.speed, 6);
        if (done) { this.setState('patrol'); this.timer = 0; this.pickPatrol(); }
        break;
      }
      default: break;
    }
    // random muttering
    this.voiceT -= dt;
    if (this.voiceT <= 0 && ['patrol', 'return', 'search'].includes(st)) { this.voiceT = rand(28, 55); const line = t(pick(PROF_LINES)); UI.prof(line, dPl < 25); if (dPl < 22) speak(line); audio.whisper({ x: this.pos.x, y: this.pos.y + 1.7, z: this.pos.z }); }
    // door interplay / light
    this.updateVisual(dt, this.curSpeed, animWeights);
    if (this.canSee && this.state !== 'chase' && this.state !== 'attack') { /* meter shown by UI */ }
  }

  updateVisual(dt, speed, animWeights) {
    const c = this.char; c.root.position.copy(this.pos); c.root.rotation.y = this.yaw;
    if (!this.visible) return;
    let w = animWeights;
    if (!w) {
      const wr = clamp((speed - 3.0) / 1.0, 0, 1), ww = clamp(speed / 1.2, 0, 1) * (1 - wr);
      w = { run: wr, walk: ww, idle: Math.max(0, 1 - wr - ww) };
    }
    c.anim.set(w); c.anim.speed('walk', clamp(speed / 1.6, 0.5, 1.4)); c.anim.speed('run', clamp(speed / 3.8, 0.8, 1.3));
    c.anim.update(dt);
    // procedural coat sway + eye flicker
    const sway = clamp(speed * 0.18, 0, 0.7); c.j.coatL.rotation.x = sway + Math.sin(G.time * 3) * 0.04; c.j.coatR.rotation.x = sway * 0.9 + Math.sin(G.time * 2.7 + 1) * 0.04;
    c.eyeGlow.material.opacity = 0.6 + 0.3 * Math.sin(G.time * 11) * Math.sin(G.time * 3.3);
    // footsteps (heavy, positional) + dragging
    if (this.active && speed > 0.6) {
      this.stepAcc += speed * dt; const stride = speed > 3 ? 2.0 : 1.35;
      if (this.stepAcc >= stride) { this.stepAcc = 0; audio.step('heavy', { x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z }, speed > 3 ? 1.3 : 1); }
    }
    monsterLight.position.set(this.pos.x, this.pos.y + 1.6, this.pos.z);
    const near = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    monsterLight.intensity = this.active ? (near < 14 ? 5.5 * (0.7 + 0.3 * Math.sin(G.time * 7)) : 1.5) * (this.state === 'chase' ? 1.3 : 1) : 0;
    c.blob.visible = true;
  }
  pickPatrolNear() { this.path = []; this.pi = 0; this.lastPatrol = -1; }
}

/* =====================================================================
   8. GAME LOGIC — items, doors, puzzles, quests, scares, hiding, endings, saves
   ===================================================================== */
/* ---------------- legendary atmosphere: dust, storms, ghost, aura ---------------- */
const SAFE_ROOMS = ['nurse', 'lounge'];
const FX = {
  ready: false, dust: null, lightningEl: null, flash: 0, stormT: 34, ghost: null, aura: [], ghostTex: null,
  init() {
    if (this.ready) return;
    const n = S.quality === 'low' ? 90 : (S.quality === 'ultra' ? 340 : 210);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = rand(-7, 7); pos[i * 3 + 1] = rand(-1.5, 2.6); pos[i * 3 + 2] = rand(-7, 7); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ map: T.glow, color: 0xffe9c0, size: S.quality === 'low' ? 0.05 : 0.045, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.dust.frustumCulled = false; scene.add(this.dust);
    this.ghostTex = canvasTex(128, 256, (x, w, h) => {
      const grd = x.createLinearGradient(0, 60, 0, 256); grd.addColorStop(0, 'rgba(225,235,245,0.85)'); grd.addColorStop(0.55, 'rgba(180,200,220,0.4)'); grd.addColorStop(1, 'rgba(120,150,180,0)');
      x.fillStyle = grd; x.beginPath(); x.moveTo(64, 70); x.bezierCurveTo(30, 90, 24, 150, 16, 236); x.bezierCurveTo(50, 220, 78, 220, 112, 236); x.bezierCurveTo(104, 150, 98, 90, 64, 70); x.fill();
      x.fillStyle = 'rgba(230,235,240,0.7)'; x.beginPath(); x.ellipse(64, 52, 22, 27, 0, 0, TAU); x.fill();
      x.fillStyle = 'rgba(15,20,30,0.55)'; x.fillRect(53, 50, 7, 4); x.fillRect(69, 50, 7, 4);
      x.fillStyle = 'rgba(20,30,40,0.5)'; x.beginPath(); x.ellipse(64, 65, 5, 7, 0, 0, TAU); x.fill();
      x.fillStyle = 'rgba(12,18,26,0.75)'; x.beginPath(); x.ellipse(64, 44, 26, 20, 0, Math.PI, TAU); x.fill(); x.fillRect(38, 44, 10, 90); x.fillRect(80, 44, 10, 90);
      x.globalCompositeOperation = 'destination-out'; x.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 40; i++) x.fillRect(Math.random() * w, 80 + Math.random() * 176, rand(1, 3), rand(4, 18));
    }, false);
    const ghostMat = new THREE.SpriteMaterial({ map: this.ghostTex, color: 0xcfe0f0, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.NormalBlending });
    this.ghost = { sprite: new THREE.Sprite(ghostMat), t: 0, dur: 0 }; this.ghost.sprite.scale.set(1.1, 2.2, 1); this.ghost.sprite.visible = false; scene.add(this.ghost.sprite);
    for (let i = 0; i < 3; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: 0x9a1008, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); sp.scale.setScalar(1.6 + i * 0.5); sp.visible = false; scene.add(sp); this.aura.push(sp); }
    const el = document.createElement('div'); el.id = 'fx-lightning'; document.getElementById('fx').appendChild(el); this.lightningEl = el;
    this.ready = true;
  },
  ghostAt(x, y, z, dur = 3) {
    if (!this.ready) return;
    this.ghost.sprite.position.set(x, y, z); this.ghost.t = dur; this.ghost.dur = dur; this.ghost.sprite.visible = true; this.ghost.sprite.material.opacity = 0; audio.whisper({ x, y: y + 1, z });
  },
  update(dt) {
    if (!this.ready) return;
    this.dust.position.set(camera.position.x, clamp(camera.position.y, -2.6, 2.4), camera.position.z);
    this.dust.rotation.y += dt * 0.03;
    this.dust.visible = S.quality !== 'low' && (G.state === 'playing' || G.state === 'menu');
    const stormOn = (G.state === 'playing' && !G.modal) || G.state === 'menu';
    this.stormT -= dt;
    if (this.stormT <= 0 && stormOn) { this.stormT = rand(30, 62); this.flash = S.safe ? 0 : 0.5; setTimeout(() => audio.thunder(), rand(350, 1400)); if (G.state === 'playing') UI.sub(t('sub_storm'), 3200); }
    if (this.flash > 0) { this.flash -= dt; const f = Math.max(0, this.flash); this.lightningEl.style.opacity = String(f * 2.1 * (Math.random() > 0.35 ? 1 : 0.3)); renderer.toneMappingExposure = 1.25 + f * 2.0; }
    else { this.lightningEl.style.opacity = '0'; if (Math.abs(renderer.toneMappingExposure - 1.25) > 0.01) renderer.toneMappingExposure = 1.25; }
    if (this.ghost.t > 0) {
      this.ghost.t -= dt; const k = this.ghost.t / this.ghost.dur;
      this.ghost.sprite.material.opacity = clamp(Math.min((1 - k) * 4, k * 2.2), 0, 0.62);
      this.ghost.sprite.position.y += dt * 0.16; if (this.ghost.t <= 0) this.ghost.sprite.visible = false;
    }
    const auraOn = !!(prof && prof.active && prof.visible && (prof.phase >= 2 || prof.state === 'chase'));
    this.aura.forEach((sp, i) => {
      sp.visible = auraOn;
      if (auraOn) {
        sp.position.set(prof.pos.x + Math.sin(G.time * 1.3 + i * 2.1) * 0.62, prof.pos.y + 0.45 + i * 0.62 + Math.sin(G.time * 2 + i) * 0.08, prof.pos.z + Math.cos(G.time * 1.2 + i * 2.1) * 0.62);
        sp.material.opacity = 0.16 + 0.1 * Math.sin(G.time * 3 + i) + (prof.phase - 1) * 0.06;
        const d = Math.hypot(prof.pos.x - camera.position.x, prof.pos.z - camera.position.z);
        sp.material.opacity *= clamp(1 - d / 22, 0, 1);
      }
    });
  },
};

const START = { x: 6.1, y: 0, z: 10.0, yaw: Math.PI };
const KEY_CODE = '0347';
const LOCK_FLAG = { d_library: 'libraryOpen', d_lab: 'labOpen', d_office: 'officeOpen', d_stairs: 'stairsOpen', d_shrine: 'shrineOpen' };
const MAX_PAGES = 8, TRUTH_PAGES = 6;

const Game = {
  interactables: [], projectiles: [], current: null, timers: [], room: null, saveT: 0, objCache: '', blackT: 0, visited: new Set(), explored: new Set(), scareT: 0, msgT: 0,

  /* ---------- setup ---------- */
  init() {
    G.notes = new Set(); G.unlocked = new Set(); G.fuses = 0;
    const I = this.interactables;
    const itemName = (d) => d.type === 'note' ? t('note_' + d.note + '_t') : d.type === 'key' ? t('it_' + d.key) : d.type === 'relic' ? t('relic_' + d.relic) : t('it_' + d.type);
    for (const it of World.items) I.push({ pos: it.pos, r: 1.9, prio: 2, can: () => !it.picked, label: () => t('pick_up', { name: itemName(it.def) }), use: () => this.pickup(it) });
    for (const d of World.doors) {
      if (d.secret) continue;
      I.push({ pos: d.pos, r: 2.0, prio: 1, can: () => !(d.exit && G.endingPending), label: () => this.doorLabel(d), use: () => this.useDoor(d) });
    }
    for (const h of World.hides) I.push({ pos: h.pos, r: h.under ? 1.5 : 1.3, prio: 3, can: () => !player.hidden && !h.occupied, label: () => t(h.under ? 'hide_under' : 'hide'), use: () => this.enterHide(h) });

    I.push({ pos: new THREE.Vector3(42.0, 1.2, 1.0), r: 1.7, prio: 3, can: () => !G.flags.secretOpen, label: () => t('pull_book'), use: () => this.openSecret() });
    I.push({ pos: new THREE.Vector3(71, -2.9, 9.2), r: 2.2, prio: 3, can: () => !G.flags.power, label: () => (G.fuses >= 2 ? t('insert_fuses') : t('fusebox_need', { n: 2 - G.fuses })), use: () => this.useFusebox() });
    I.push({ pos: new THREE.Vector3(84, -3.0, 13.3), r: 2.0, prio: 3, can: () => !G.flags.fire && G.flags.power && G.inv.has('main_key'), label: () => t('overload'), use: () => this.askOverload() });
    I.push({ pos: new THREE.Vector3(98, -3.0, 27.7), r: 2.3, prio: 4, can: () => G.flags.power && !G.altarDone, label: () => (G.relics.size >= 3 && G.inv.has('ring')) ? t('altar_use') : t('altar_need'), use: () => this.useAltar() });
    I.push({ pos: new THREE.Vector3(24.5, 1.2, 14.2), r: 2.4, prio: 1, can: () => true, label: () => t('examine_clock'), use: () => { UI.toast(t('sub_clock'), 'warn'); UI.sub(t('sub_clock'), 5000); audio.click(); } });
    for (const h of World.hides) { h.tgt = 0; h.amt = 0; h.closeT = 0; }
  },
  doorLabel(d) {
    if (d.barricaded) return t('unbarricade');
    if (d.locked) {
      if (d.exit) return G.inv.has('main_key') ? t('use_key') : t('locked');
      if (d.lock === 'code') return t('enter_code');
      if (d.lock === 'power') return G.flags.power ? t('open_door') : t('locked');
      return G.inv.has(d.lock) ? t('use_key') : t('locked');
    }
    if (d.exit) return t('open_exit');
    return d.open ? t('close_door') : t('open_door');
  },
  after(sec, fn) { this.timers.push({ t: sec, fn }); },

  /* ---------- world state ---------- */
  resetWorld() {
    G.flags = {}; G.inv.clear(); G.pages.clear(); G.notes.clear(); G.picked.clear(); G.unlocked.clear(); G.fuses = 0; G.scared.clear();
    G.relics.clear(); G.throwables = { chalk: 0, bottle: 0 }; G.barricades = [];
    for (const p of this.projectiles) { dynGroup.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    this.projectiles.length = 0; player.busy = null; UI.setBusy(null);
    G.sanity = 100; G.tookDamage = false; G.chaseTime = 0; G.altarDone = false; G.legendSeen = false; G.whispersT = 20; G.safeNotice = 0; G.phase = 1;
    const gl = document.getElementById('gl'); if (gl) gl.classList.remove('low-sanity', 'panic'); const sf = document.getElementById('sanity-fx'); if (sf) sf.classList.remove('on');
    G.blackout = 1; G.fireTimer = 0; G.tension = 0; G.chase = false; G.modal = null; G.safeTime = 0; G.endingPending = false; G.playTime = 0; this.timers = []; this.blackT = 0;
    this.visited.clear(); this.explored.clear(); this.room = null;
    for (const it of World.items) { it.picked = false; it.mesh.visible = true; }
    for (const d of World.doors) d.reset();
    for (const h of World.hides) { h.occupied = false; h.tgt = 0; h.amt = 0; if (h.pivot) h.pivot.rotation.y = 0; }
    for (const id in boards) boards[id].write(null);
    World.redBook.position.z = 0.62; World.redBook.visible = true;
    scene.fog.color.setHex(0x03040a); scene.background.setHex(0x020306);
    audio.stopLoops(); audio.lullabyOn = 0; UI.hideFire();
    prof.deactivate(); prof.setRage(false);
    player.reset(START.x, START.y, START.z, START.yaw);
    player.health = 100; player.battery = 100; player.hasFlash = false; player.flash = false; player.flashI = 0; player.stamina = 100;
    buildNav();
  },
  snapshot() {
    return {
      v: 1, t: Date.now(), pos: [player.pos.x, player.pos.y, player.pos.z], yaw: player.yaw, battery: player.battery, hasFlash: player.hasFlash,
      flags: Object.assign({}, G.flags, { fire: false, rage: false, mercyTried: false }), inv: [...G.inv], pages: [...G.pages], notes: [...G.notes], picked: [...G.picked], unlocked: [...G.unlocked],
      fuses: G.fuses, scared: [...G.scared], playTime: G.playTime, deaths: G.deaths, relics: [...G.relics], sanity: G.sanity,
      throwables: Object.assign({}, G.throwables), barricades: [...G.barricades], diff: S.diff,
    };
  },
  applySnapshot(s) {
    this.resetWorld();
    G.flags = s.flags || {}; G.flags.fire = false; G.flags.rage = false; G.flags.mercyTried = false; (s.inv || []).forEach((k) => G.inv.add(k)); (s.pages || []).forEach((k) => G.pages.add(k)); (s.notes || []).forEach((k) => G.notes.add(k));
    (s.picked || []).forEach((k) => G.picked.add(k)); (s.relics || []).forEach((k) => G.relics.add(k)); G.sanity = s.sanity === undefined ? 100 : s.sanity;
    G.throwables = Object.assign({ chalk: 0, bottle: 0 }, s.throwables || {});
    (s.barricades || []).forEach((id) => { const d = World.doorById[id]; if (d) { d.setBarricade(true); G.barricades.push(id); } }); (s.unlocked || []).forEach((k) => G.unlocked.add(k)); G.fuses = s.fuses || 0; (s.scared || []).forEach((k) => G.scared.add(k)); G.playTime = s.playTime || 0; G.deaths = s.deaths || 0;
    for (const it of World.items) if (G.picked.has(it.def.id)) { it.picked = true; it.mesh.visible = false; }
    for (const id of G.unlocked) { const d = World.doorById[id]; if (d) { d.setLocked(false); d.lock = null; } }
    if (G.flags.power) { const d = World.doorById.d_shrine; d.setLocked(false); d.lock = null; }
    if (G.flags.secretOpen) { const d = World.doorById.d_secret1; d.open = true; d.target = 1; d.angle = 1; d.update(0); World.redBook.position.z = 0.7; }
    if (G.flags.libBoard) boards.class2b.write(t('board_run').split('|'), true);
    player.hasFlash = !!s.hasFlash; player.battery = s.battery === undefined ? 100 : s.battery; player.health = 100;
    player.reset(s.pos[0], s.pos[1], s.pos[2], s.yaw);
    buildNav();
    if (G.flags.profActive) this.spawnProfessorFar();
  },
  spawnProfessorFar() {
    let best = null, bd = 0;
    for (const [x, z, tag] of PATROL_POINTS) {
      if (tag === 'office' && !G.flags.officeOpen) continue; if (tag === 'base' && !G.flags.stairsOpen) continue; if (tag === 'shrine' && !G.flags.power) continue;
      const d = Math.hypot(x - player.pos.x, z - player.pos.z) + (Math.abs((tag === 'base' || tag === 'shrine' ? -4 : 0) - player.pos.y) > 2 ? 60 : 0);
      if (d > bd && d < 70) { bd = d; best = [x, z]; }
    }
    if (!best) best = [26, 35];
    prof.activate(best[0], best[1], 'patrol'); prof.pickPatrol();
  },
  slotKey(n) { return 'save' + (n || G.slot || 1); },
  checkpoint(force) {
    if (G.state !== 'playing' && !force) return;
    if (G.flags.rage || G.fireTimer > 0) return;
    G.checkpoint = this.snapshot(); Store.set(this.slotKey(), G.checkpoint); Store.set('lastSlot', G.slot || 1); UI.flashSave();
  },
  readSlot(n) { const s = Store.get('save' + n, null); return (s && s.v === 1 && s.pos) ? s : null; },
  deleteSlot(n) { Store.del('save' + n); if (G.slot === n) { G.checkpoint = null; } },
  anySave() { return [1, 2, 3].some((n) => !!this.readSlot(n)); },
  hasSave() { return !!this.readSlot(G.slot || 1); },

  /* ---------- flow ---------- */
  async newGame() {
    audio.init(); audio.resume(); Store.del(this.slotKey()); Store.set('lastSlot', G.slot || 1); G.checkpoint = null;
    this.resetWorld(); UI.showScreen(null); UI.hudShow(false); UI.fade(true, 0);
    G.state = 'intro'; await UI.intro([t('intro_1'), t('intro_2'), t('intro_3')]);
    UI.fade(true, 0); UI.showScreen(null); G.state = 'playing'; UI.hudShow(true); requestLock(); Input.clear();
    await new Promise((r) => setTimeout(r, 250)); UI.fade(false, 1800);
    this.after(2.5, () => { this.blackout(1.6); audio.whisper({ x: player.pos.x - 2, y: 1.5, z: player.pos.z - 3 }); UI.sub(t('sub_intro'), 5500); });
    G.checkpoint = this.snapshot();
  },
  async continueGame(slot) {
    if (slot) G.slot = slot;
    const s = this.readSlot(G.slot || 1); if (!s) return this.newGame();
    if (s.diff && DIFF[s.diff]) { S.diff = s.diff; saveSettings(); UI.syncSettings(); }
    audio.init(); audio.resume(); this.applySnapshot(s); G.checkpoint = s;
    UI.showScreen(null); UI.fade(true, 0); G.state = 'playing'; UI.hudShow(true); requestLock(); Input.clear();
    await new Promise((r) => setTimeout(r, 200)); UI.fade(false, 1200); UI.toast(t('game_loaded'), 'good');
  },
  retry() {
    audio.stopLoops(); UI.showScreen(null); UI.fade(true, 0);
    if (G.checkpoint) this.applySnapshot(G.checkpoint); else { this.resetWorld(); }
    player.health = 100; G.state = 'playing'; UI.hudShow(true); requestLock(); Input.clear(); UI.fade(false, 1200);
    if (!player.hasFlash && !G.checkpoint) player.hasFlash = false;
  },
  die(cause) {
    if (G.state !== 'playing') return;
    if (cause === 'caught' && G.inv.has('ring') && G.pages.size >= TRUTH_PAGES && !G.flags.fire && !G.flags.mercyTried) {
      G.flags.mercyTried = true; G.modal = 'choice'; player.health = 1; releaseLock();
      UI.choice(t('mercy_title'), t('mercy_text'), [
        { label: t('opt_give_ring'), primary: true, fn: () => { UI.closeModal(); this.finish('peace'); } },
        { label: t('opt_refuse'), fn: () => { UI.closeModal(); player.health = 0; this.die('caught'); } },
      ]);
      return;
    }
    G.state = 'dead'; G.deaths++; audio.stopLoops(); audio.stinger(1); releaseLock(); UI.hudShow(false);
    UI.hideFire(); flashlight.intensity = 0;
    setTimeout(() => { if (G.state === 'dead') UI.showGameOver(cause); }, 900);
  },
  finish(ending) {
    if (G.state === 'ending') return;
    G.state = 'ending'; G.modal = null; audio.stopLoops(); releaseLock(); UI.hudShow(false); UI.hideFire(); Store.del(this.slotKey()); G.checkpoint = null;
    if (!G.endings.includes(ending)) { G.endings.push(ending); Store.set('endings', G.endings); }
    Achv.unlock(ending);
    if (ending === 'escape' && !G.tookDamage) Achv.unlock('untouched');
    if (S.diff === 'legend') Achv.unlock('nightmare');
    UI.fade(true, 1400, ending === 'escape' || ending === 'peace' || ending === 'legend');
    if (ending === 'peace' || ending === 'legend') { audio.lullabyOn = 1; }
    setTimeout(() => UI.showEnding(ending), 1800);
  },

  /* ---------- per-frame ---------- */
  update(dt) {
    G.playTime += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    for (const d of World.doors) d.update(dt);
    for (const h of World.hides) {
      if (h.closeT > 0) { h.closeT -= dt; if (h.closeT <= 0 && !h.occupied) h.tgt = 0; }
      if (h.pivot && Math.abs(h.amt - h.tgt) > 0.001) { h.amt = damp(h.amt, h.tgt, 9, dt); h.pivot.rotation.y = -h.amt * 1.75; }
    }
    // blackout handling
    if (this.blackT > 0) { this.blackT -= dt; G.blackout = S.safe ? 0.25 : (hash1(Math.floor(G.time * 16)) > 0.8 ? 0.35 : 0.0); if (this.blackT <= 0) G.blackout = 1; }
    player.update(dt); prof.update(dt);
    this.updateBusy(dt); this.updateProjectiles(dt);
    this.updateMythic(dt);
    this.updateItems(dt);
    if (Input.consume('throw')) this.throwItem();
    if (Input.consume('barricade')) { const d = this.nearestDoorFor(); if (d) this.toggleBarricade(d); }
    this.detectInteract();
    this.scares(dt);
    // zone / room
    const room = roomAt(player.pos.x, player.pos.z);
    if (room !== this.room) { this.room = room; if (room) this.onEnterRoom(room); }
    const lull = room && (room.id === 'secret1' || room.id === 'shrine') ? 1 : (room && room.id === 'bcorr' && G.flags.power ? 0.25 : 0);
    audio.lullabyOn = damp(audio.lullabyOn, lull, 1.5, dt);
    const ek = Math.floor(player.pos.x / 4) + ',' + Math.floor(player.pos.z / 4) + ',' + (player.pos.y < -2 ? 'b' : 'g'); this.explored.add(ek);
    // tension / music
    const tn = prof.tension(); G.tension = damp(G.tension, tn, 2.2, dt); G.chase = prof.state === 'chase' || prof.state === 'attack' || prof.state === 'ambush';
    if (G.chase) G.safeTime = 0;
    // fire
    if (G.fireTimer > 0) {
      G.fireTimer -= dt; UI.fire(G.fireTimer);
      if (Math.random() < dt * 0.6) { G.shake = Math.max(G.shake, 0.3); audio.bang({ x: player.pos.x + rand(-10, 10), y: player.pos.y, z: player.pos.z + rand(-10, 10) }); }
      if (G.fireTimer <= 0 && G.state === 'playing') { audio.explosion(); G.shake = 2; this.die('explosion'); }
    }
    // autosave when calm
    this.saveT += dt; if (this.saveT > 45 && !G.chase && prof.state !== 'chase') { this.saveT = 0; this.checkpoint(); }
    // objective & hud
    this.msgT -= dt; if (this.msgT <= 0) { this.msgT = 0.4; UI.refreshObjective(); }
    UI.updateHud(dt);
  },
  updateMythic(dt) {
    const room = this.room;
    const inSafe = room && SAFE_ROOMS.includes(room.id) && !G.flags.fire;
    const dProf = prof.active ? Math.hypot(prof.pos.x - player.pos.x, prof.pos.z - player.pos.z) + Math.abs(prof.pos.y - player.pos.y) : 99;
    let drain = 0;
    if (G.chase) drain += 7.2; else if (dProf < 10) drain += 3.4; else if (dProf < 18) drain += 1.1;
    if (room && room.basement) drain += 0.7;
    if (!player.flash && room && (room.lights === 'off' || room.lights === 'broken')) drain += 1.4;
    if (room && room.secret) drain += 0.6;
    if (inSafe) drain -= 13;
    if (!prof.active) drain -= 2.2;
    if (player.hidden) drain -= 1.2;
    if (G.flags.power) drain -= 0.5;
    G.sanity = clamp(G.sanity - drain * dt, 0, 100);
    G.chaseTime = G.chase ? G.chaseTime + dt : 0;
    if (G.chaseTime > 30) Achv.unlock('hunted');
    const gl = document.getElementById('gl');
    if (gl) { gl.classList.toggle('low-sanity', G.sanity < 50); gl.classList.toggle('panic', G.sanity < 24); }
    const sf = document.getElementById('sanity-fx'); if (sf) sf.classList.toggle('on', G.sanity < 34);
    const st = document.getElementById('safe-tag'); if (st) st.classList.toggle('hidden', !(inSafe && G.sanity < 99.5));
    G.whispersT -= dt;
    if (G.sanity < 48 && G.whispersT <= 0) {
      G.whispersT = rand(11, 20);
      audio.whisper({ x: player.pos.x + rand(-3.2, 3.2), y: player.pos.y + 1.5, z: player.pos.z + rand(-3.2, 3.2) });
      if (G.sanity < 28) { audio.step('walk', { x: player.pos.x + rand(-4, 4), y: player.pos.y, z: player.pos.z + rand(-4, 4) }, 0.55); UI.sub(t('sanity_low'), 4000); }
    }
    if (inSafe && G.sanity < 96 && G.safeNotice <= 0) { G.safeNotice = 12; UI.sub(t('safe_zone'), 3500); }
    G.safeNotice -= dt;
    FX.update(dt);
  },
  updateItems(dt) {
    const tm = G.time;
    for (const it of World.items) {
      if (it.picked) continue;
      const dx = it.def.x - player.pos.x, dz = it.def.z - player.pos.z; if (dx * dx + dz * dz > 400) continue;
      it.mesh.rotation.y += dt * 0.8; it.mesh.position.y = it.def.y + 0.025 + Math.sin(tm * 2 + it.def.x) * 0.012;
      const g = it.mesh.userData.glow; if (g) g.material.opacity = 0.45 + 0.3 * Math.sin(tm * 3 + it.def.z);
    }
  },
  nearestDoorFor() {
    let best = null, bd = 2.2;
    for (const d of World.doors) { if (d.secret || d.exit || d.locked) continue; const dd = Math.hypot(d.cx - player.pos.x, d.cz - player.pos.z); if (dd < bd && Math.abs(d.pos.y - 1.1 - player.pos.y) < 1.6) { bd = dd; best = d; } }
    return best;
  },
  detectInteract() {
    let best = null, bs = 1e9;
    if (!player.hidden && G.state === 'playing') {
      const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
      for (const o of this.interactables) {
        const dy = o.pos.y - (player.pos.y + 1.0); if (Math.abs(dy) > 2.2) continue;
        const dx = o.pos.x - player.pos.x, dz = o.pos.z - player.pos.z, d = Math.hypot(dx, dz); if (d > o.r) continue;
        if (!o.can()) continue;
        const face = d > 0.6 ? (dx * fx + dz * fz) / d : 1; if (face < -0.3) continue;
        const score = d / o.r - o.prio * 0.15 - face * 0.2; if (score < bs) { bs = score; best = o; }
      }
    } else if (player.hidden) best = { label: () => t('exit_hide'), use: () => this.exitHide(player.hidden) };
    this.current = best;
    if (Input.consume('interact') && best && G.state === 'playing' && !G.modal) best.use();
  },

  /* ---------- items ---------- */
  pickup(it) {
    const d = it.def; it.picked = true; it.mesh.visible = false; G.picked.add(d.id); audio.pickup();
    switch (d.type) {
      case 'flashlight': player.hasFlash = true; G.inv.add('flashlight'); UI.toast(t('got_flash'), 'good'); player.flash = true; audio.flash(); Achv.unlock('first_light'); break;
      case 'battery': player.addBattery(45); UI.toast(t('got_battery'), 'good'); break;
      case 'key': G.inv.add(d.key); UI.toast(t('got_item', { name: t('it_' + d.key) }), 'good'); break;
      case 'fuse': G.fuses++; UI.toast(t('got_fuse', { n: G.fuses }), 'good'); break;
      case 'medkit': player.health = Math.min(100, player.health + 50); UI.toast(t('got_medkit'), 'good'); break;
      case 'throwable': { const k = d.kind; G.throwables[k] = (G.throwables[k] || 0) + (d.n || 1); UI.invSig = ''; UI.toast(t('got_throwable', { name: t('it_' + k), n: G.throwables[k] }), 'good'); if (!G.flags.throwTip) { G.flags.throwTip = true; this.after(1.6, () => UI.toast(t('throw_hint'), '')); } break; }
      case 'relic': G.relics.add(d.relic); Codex.addRelic(d.relic); G.flags['relic_'+d.relic] = true; UI.toast(t('got_relic', { name: t('relic_'+d.relic), n: G.relics.size }), 'good'); audio.pickup(); this.onRelic(d); break;
      case 'ring': G.inv.add('ring'); UI.toast(t('got_item', { name: t('it_ring') }), 'good'); this.after(1.2, () => UI.sub(t('sub_ring'), 6000)); break;
      case 'note': this.readNote(d.note); break;
      default: break;
    }
    this.onItem(d); this.checkpoint();
  },
  readNote(id) {
    G.notes.add(id); if (/^d\d/.test(id)) { G.pages.add(id); Codex.addPage(id); }
    if (G.pages.size >= MAX_PAGES) Achv.unlock('truth');
    UI.openNote(id);
  },
  onRelic(d) {
    if (d.relic === 'locket' && !G.scared.has('locket')) { G.scared.add('locket'); this.after(0.8, () => { this.blackout(2.4); audio.stinger(0.6); FX.ghostAt(d.x, d.y + 1.2, d.z - 2.4, 2.6); if (prof.active) prof.investigate(new THREE.Vector3(d.x, d.y, d.z), false); }); }
    if (d.relic === 'box' && !G.scared.has('relbox')) { G.scared.add('relbox'); audio.lullabyOn = 1; this.after(3.5, () => { if (G.state === 'playing' && !G.legendSeen) audio.lullabyOn = 0; }); }
    if (d.relic === 'photo') { this.after(0.6, () => this.ghostEvent('photo')); }
  },
  ghostEvent(kind) {
    const p = player.pos; FX.ghostAt(p.x + Math.sin(player.yaw + 0.6) * 4.4, p.y + 1.1, p.z + Math.cos(player.yaw + 0.6) * 4.4, 3.4);
    audio.whisper({ x: p.x, y: p.y + 1.6, z: p.z }); UI.sub(t('sub_ghost'), 4200);
  },
  onItem(d) {
    if (d.id === 'k_library' && !G.flags.libBoard) {
      G.flags.libBoard = true;
      this.after(1.0, () => { boards.class2b.write(t('board_run').split('|'), true); audio.bang({ x: 18, y: 1.5, z: 0.5 }); this.blackout(3); G.shake = 0.8; UI.sub(t('sub_board'), 4500); });
    }
    if (d.id === 'fuse2' && !G.scared.has('janitor')) {
      G.scared.add('janitor'); audio.staticBurst(2.2);
      this.after(1.0, () => { const j = World.doorById.d_janitor; j.forceClose(true); audio.stinger(0.7); this.blackout(2.5); UI.sub(t('sub_janitor'), 4500); if (prof.active) prof.investigate(new THREE.Vector3(48, 0, 20), true); });
    }
    if (d.id === 'k_main' && !G.flags.rage) this.startRage();
    if (d.id === 'flashlight') this.after(2, () => UI.toast(t('tip_flash'), ''));
    if (d.type === 'relic') {
      this.after(1.0, () => UI.sub(t('sub_relic'), 4500));
      if (G.relics.size >= 3) { Achv.unlock('relics'); this.after(1.4, () => { audio.whisper(player.pos); UI.sub(t('relics_all'), 6000); }); }
    }
  },
  startRage() {
    G.flags.rage = true; prof.setRage(true); audio.startAlarm(); audio.stinger(1); scene.fog.color.setHex(0x1a0305); G.shake = 1;
    UI.sub(t('sub_rage'), 6000); UI.toast(t('alarm'), 'warn');
    // bring him from a far part of the school so the player has a fair head start
    let best = null, bd = 0;
    for (const [x, z, tag] of PATROL_POINTS) {
      if (tag === 'base' || tag === 'shrine') continue; const d = Math.hypot(x - player.pos.x, z - player.pos.z); if (d > bd) { bd = d; best = [x, z]; }
    }
    prof.activate(best[0], best[1], 'investigate'); prof.setRage(true);
    if (!prof.pathTo(98, 25)) prof.pathTo(86, 18); prof.target.set(98, -4, 25);
    prof.setState('investigate'); prof.timer = 0;
    this.after(0.1, () => { buildNav(); });
  },

  /* ---------- doors ---------- */
  useDoor(d) {
    if (d.barricaded) { this.toggleBarricade(d); return; }
    if (d.exit) return this.useExit(d);
    if (d.locked) {
      if (d.lock === 'code') { UI.openKeypad(d); return; }
      if (d.lock === 'power') { UI.toast(t('locked_power'), 'warn'); audio.locked(d.pos); player.makeNoise(6, 'door'); return; }
      if (G.inv.has(d.lock)) {
        const key = d.lock; this.unlockDoor(d); UI.toast(t('unlocked_with', { name: t('it_' + key) }), 'good'); d.toggle(player.pos); return;
      }
      UI.toast(t('locked_need', { name: t('it_' + d.lock) }), 'warn'); audio.locked(d.pos); player.makeNoise(7, 'door'); return;
    }
    if (d.open) { if (Math.hypot(player.pos.x - d.cx, player.pos.z - d.cz) < 0.9) return; d.toggle(player.pos); }
    else d.toggle(player.pos);
    player.makeNoise(8.5, 'door');
  },
  unlockDoor(d) {
    d.setLocked(false); d.lock = null; G.unlocked.add(d.id); audio.unlock(d.pos);
    const fl = LOCK_FLAG[d.id]; if (fl) G.flags[fl] = true;
    buildNav(); this.checkpoint();
    if (d.id === 'd_library') Achv.unlock('librarian');
    if (d.id === 'd_office') Achv.unlock('secret');
  },
  onDoorByNpc() { /* hook for future events */ },
  tryCode(door, code) {
    if (code === KEY_CODE) { this.unlockDoor(door); door.toggle(player.pos); return true; }
    player.makeNoise(10, 'alarm'); audio.blip({ type: 'square', f0: 180, dur: 0.35, vol: 0.15 }); return false;
  },
  openSecret() {
    const d = World.doorById.d_secret1; G.flags.secretOpen = true; d.toggle(player.pos); audio.click(); World.redBook.position.z = 0.7;
    audio.blip({ type: 'sawtooth', f0: 55, f1: 38, dur: 1.8, vol: 0.3, filter: { type: 'lowpass', f: 260 } }); G.shake = 0.35;
    UI.toast(t('secret_open'), 'good'); UI.sub(t('sub_secret_open'), 4500); buildNav(); this.checkpoint(); player.makeNoise(11, 'door'); Achv.unlock('secret'); this.after(0.9, () => this.ghostEvent('secret'));
  },
  useAltar() {
    const missing = [];
    if (G.relics.size < 3) missing.push(t('archive_relics') + ' ' + G.relics.size + '/3');
    if (!G.inv.has('ring')) missing.push(t('it_ring'));
    if (G.pages.size < TRUTH_PAGES) missing.push(t('jr_pages', { n: G.pages.size, max: TRUTH_PAGES }));
    if (missing.length) { UI.toast(t('altar_missing') + ' ' + missing.join(' · '), 'warn'); audio.locked({ x: 98, y: -3, z: 27.7 }); return; }
    G.altarDone = true; G.legendSeen = true; G.state = 'playing';
    prof.deactivate(); audio.stopLoops(); audio.stinger(0.7);
    for (let i = 0; i < 5; i++) audio.blip({ f0: 440 + i * 110, dur: 2.4, vol: 0.12, delay: i * 0.15 });
    audio.lullabyOn = 1; UI.sub(t('altar_ready'), 7000); UI.hideFire(); G.fireTimer = 0;
    Game.checkpoint = null; Store.del('save');
    this.after(1.2, () => UI.fade(true, 1600, true));
    this.after(3.6, () => this.finish('legend'));
  },
  useFusebox() {
    if (G.fuses < 2) { UI.toast(t('fusebox_need', { n: 2 - G.fuses }), 'warn'); audio.locked({ x: 71, y: -3, z: 9 }); return; }
    G.fuses = 0; G.flags.power = true; audio.click(); audio.staticBurst(1.6);
    for (let i = 0; i < 5; i++) audio.blip({ type: 'sawtooth', f0: 40 + i * 12, f1: 70 + i * 20, dur: 1.6, vol: 0.12, delay: i * 0.12, filter: { type: 'lowpass', f: 400 } });
    this.blackout(1.8); G.shake = 0.7;
    const s = World.doorById.d_shrine; s.setLocked(false); s.lock = null; G.unlocked.add('d_shrine'); G.flags.shrineOpen = true;
    this.after(1.9, () => { audio.unlock(s.pos); audio.stinger(0.5); UI.toast(t('power_on'), 'good'); UI.sub(t('sub_power'), 6000); if (prof.active) prof.investigate(new THREE.Vector3(71, -4, 12), false); buildNav(); Achv.unlock('power'); });
    this.checkpoint();
  },
  askOverload() {
    G.modal = 'choice'; releaseLock();
    UI.choice(t('overload_title'), t('overload_text'), [
      { label: t('opt_overload'), primary: true, fn: () => { UI.closeModal(); this.startFire(); } },
      { label: t('opt_cancel'), fn: () => UI.closeModal() },
    ]);
  },
  startFire() {
    G.flags.fire = true; G.fireTimer = 130; audio.startAlarm(); audio.explosion(); G.shake = 1.5; scene.fog.color.setHex(0x2a0c02);
    UI.toast(t('fire_started'), 'warn'); UI.sub(t('sub_fire'), 6000);
  },
  useExit(d) {
    if (d.locked) {
      if (G.inv.has('main_key')) { d.setLocked(false); audio.unlock(d.pos); UI.toast(t('exit_unlocked'), 'good'); }
      else { UI.toast(t('locked_need', { name: t('it_main_key') }), 'warn'); audio.locked(d.pos); player.makeNoise(8, 'door'); return; }
    }
    const opts = [], truth = G.pages.size >= TRUTH_PAGES, fire = G.flags.fire;
    opts.push({ label: t('opt_leave'), primary: true, fn: () => { UI.closeModal(); d.toggle(player.pos, true); this.finish(fire ? 'fire' : 'escape'); } });
    if (G.inv.has('ring') && truth && !fire) opts.push({ label: t('opt_return_ring'), fn: () => { UI.closeModal(); this.finish('peace'); } });
    opts.push({ label: t('opt_wait'), fn: () => UI.closeModal() });
    G.modal = 'choice'; releaseLock();
    UI.choice(t('exit_title'), t(fire ? 'exit_text_fire' : 'exit_text'), opts);
  },

  /* ---------- throwables ---------- */
  throwPick() { const t1 = G.throwables; return t1.bottle > 0 ? 'bottle' : (t1.chalk > 0 ? 'chalk' : null); },
  throwItem() {
    if (player.hidden || G.state !== 'playing') return;
    const kind = this.throwPick();
    if (!kind) { UI.toast(t('no_throwable'), 'warn'); audio.click(); return; }
    G.throwables[kind]--; UI.invSig = '';
    const dir = new THREE.Vector3().copy(player.aim).sub(player.handPos).normalize();
    const p = new THREE.Vector3(player.handPos.x, player.handPos.y, player.handPos.z);
    const proj = { kind, pos: p, vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 2.1, 0)), life: 6, mesh: null, bounces: 0 };
    const geo = kind === 'chalk' ? new THREE.CylinderGeometry(0.014, 0.014, 0.08, 6) : new THREE.CylinderGeometry(0.035, 0.042, 0.18, 8);
    const mat = kind === 'chalk' ? new THREE.MeshStandardMaterial({ color: 0xf2eede, emissive: 0x303030 }) : new THREE.MeshStandardMaterial({ color: 0x3f7a4a, transparent: true, opacity: 0.7, emissive: 0x0d2412 });
    proj.mesh = new THREE.Mesh(geo, mat); proj.mesh.position.copy(p); proj.mesh.castShadow = true; dynGroup.add(proj.mesh);
    this.projectiles.push(proj);
    audio.noise({ type: 'highpass', f: 2200, dur: 0.12, vol: 0.07 });
    player.char.anim.shot('hurt', 0.35);          // quick arm motion
    player.makeNoise(3.5, 'throw');
  },
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt; p.vel.y -= 16 * dt;
      const stepLen = p.vel.length() * dt;
      const dir = p.vel.clone().normalize();
      const hit = rayBoxes(p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z, Math.max(stepLen, 0.01) + 0.06, 0.02);
      const ground = groundAt(p.pos.x, p.pos.z, p.pos.y + 0.4, 0.1);
      let impact = false, ix = p.pos.x, iy = p.pos.y, iz = p.pos.z;
      if (hit < stepLen + 0.05) { impact = true; ix += dir.x * hit; iy += dir.y * hit; iz += dir.z * hit; }
      else {
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y <= ground + 0.03) { impact = true; ix = p.pos.x; iy = ground + 0.03; iz = p.pos.z; }
      }
      p.mesh.position.copy(p.pos); p.mesh.rotation.x += dt * 9; p.mesh.rotation.z += dt * 6;
      if (impact) { this.projectileImpact(p, ix, iy, iz); dynGroup.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); this.projectiles.splice(i, 1); continue; }
      if (p.life <= 0) { dynGroup.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); this.projectiles.splice(i, 1); }
    }
  },
  projectileImpact(p, x, y, z) {
    const pos = { x, y: y + 0.1, z };
    const loud = p.kind === 'bottle';
    if (loud) { audio.glass(pos); audio.bang(pos); } else { audio.noise({ type: 'bandpass', f: 1500, q: 2, dur: 0.1, vol: 0.4, pos, ref: 4 }); audio.blip({ f0: 300, f1: 140, dur: 0.12, vol: 0.3, pos, ref: 4 }); }
    const v = new THREE.Vector3(x, y, z);
    if (prof.active && !['attack'].includes(prof.state)) {
      const far = Math.hypot(prof.pos.x - player.pos.x, prof.pos.z - player.pos.z);
      prof.hear(v, loud ? 30 : 17, 'throw');
      if (prof.state === 'chase') { prof.lastKnown.copy(v); prof.losT = Math.max(prof.losT, 2.6); if (!prof.canSee) prof.loseTrack(); }
      else prof.investigate(v, false);
      if (far > 6) Achv.unlock('thrower');
    }
    UI.ping(v);
  },
  toggleBarricade(d) {
    if (player.busy) return;
    if (d.barricaded) { this.startBusy(1.1, t('unbarricade_busy'), () => this.finishBarricade(d, false)); return; }
    if (d.open) { UI.toast(t('barricade_cant'), 'warn'); return; }
    if (G.barricades.length >= 2) { UI.toast(t('barricade_limit', { n: 2 }), 'warn'); return; }
    this.startBusy(1.6, t('barricade_busy'), () => this.finishBarricade(d, true));
  },
  finishBarricade(d, on) {
    d.setBarricade(on);
    if (on) {
      G.barricades.push(d.id); UI.toast(t('barricade_done'), 'good');
      audio.noise({ type: 'lowpass', f: 420, dur: 0.5, vol: 0.5, pos: d.pos }); audio.blip({ f0: 110, f1: 55, dur: 0.4, vol: 0.4, pos: d.pos });
      player.makeNoise(9, 'barricade');
      if (prof.state === 'chase') Achv.unlock('barricade');
    } else {
      G.barricades = G.barricades.filter((x) => x !== d.id); UI.toast(t('barricade_removed'), '');
      audio.noise({ type: 'lowpass', f: 500, dur: 0.3, vol: 0.35, pos: d.pos }); player.makeNoise(7, 'barricade');
    }
    buildNav(); this.checkpoint();
  },
  breakBarricade(d, who) {
    if (!d.barricaded) return;
    d.breakT = (d.breakT || 0) + 0.55;
    audio.bang(d.pos); G.shake = Math.max(G.shake, S.safe ? 0 : 0.45);
    if (d.breakT === 0.55) UI.sub(t('barricade_breaking'), 2600, 'prof');
    const need = who && who.rage ? 1.6 : 2.4;
    if (d.breakT >= need) {
      d.setBarricade(false); d.breakT = 0; G.barricades = G.barricades.filter((x) => x !== d.id);
      audio.doorSlam(d.pos); audio.glass(d.pos); UI.toast(t('barricade_broken'), 'warn'); buildNav();
      d.toggle(who ? who.pos : null);
    }
  },
  startBusy(dur, label, done) { player.busy = { t: 0, dur, label, done }; },
  updateBusy(dt) {
    const b = player.busy; if (!b) return;
    if (player.hidden || G.state !== 'playing') { player.busy = null; UI.setBusy(null); return; }
    b.t += dt; UI.setBusy(b);
    if (player.speed > 1.6) { player.busy = null; UI.setBusy(null); return; }
    if (b.t >= b.dur) { player.busy = null; UI.setBusy(null); b.done(); }
  },

  /* ---------- hiding ---------- */
  enterHide(h) {
    if (player.hidden || h.occupied) return;
    const seen = prof.active && prof.state === 'chase' && prof.canSee;
    player.hidden = h; h.occupied = true; h.tgt = h.under ? 0 : 1; h.closeT = 0.45; player.pos.set(h.x, h.y, h.z); player.vel.set(0, 0, 0);
    player.busy = null; UI.setBusy(null);
    player.char.root.visible = false; player.yaw = Math.atan2(h.fx, h.fz); player.pitch = 0.05; player.hideTime = 0; player.breath = 100; player.breathLock = false; player.crouch = false;
    audio.click(); UI.setHide(true, !!h.under); Achv.unlock('hidden');
    if (h.under) UI.sub(t('hide_under_hint'), 3200);
    prof.knowsHidden = seen; if (seen) prof.ambush(h);
  },
  exitHide(h, forced) {
    if (!player.hidden) return;
    player.hidden = null; h.occupied = false; h.tgt = h.under ? 0 : 1; h.closeT = 0.8; player.char.root.visible = true;
    player.pos.set(h.stand.x, h.y, h.stand.z); resolveCircle(player.pos, 0.31, player.pos.y, 1.6);
    player.bodyYaw = Math.atan2(h.fx, h.fz); player.yaw = player.bodyYaw; player.pitch = 0.28; player.vel.set(0, 0, 0);
    audio.click(); UI.setHide(false); prof.knowsHidden = false; if (!forced) audio.creak(h.pos);
  },
  pullFromLocker(h) {
    this.exitHide(h, true); audio.growl(prof.pos); G.shake = 1;
    player.hurt(prof.dm.dmg); prof.startChase(false); prof.cool = 1.0; prof.pause = 0.4;
  },

  /* ---------- atmosphere events ---------- */
  blackout(sec) { this.blackT = Math.max(this.blackT, sec); audio.staticBurst(Math.min(sec, 1.2)); },
  onEnterRoom(r) {
    const first = !this.visited.has(r.id); this.visited.add(r.id);
    if (first && r.id !== 'class1a') this.checkpointSoft();
    if (!first) return;
    switch (r.id) {
      case 'lab': this.after(0.8, () => { audio.glass({ x: 58, y: 1.5, z: 5 }); this.blackout(3.5); G.shake = 0.6; UI.sub(t('sub_lab'), 4500); if (prof.active) this.after(2.5, () => prof.investigate(new THREE.Vector3(58, 0, 13), false)); }); break;
      case 'music': this.after(0.6, () => { [261.6, 277.2, 329.6, 370].forEach((f, i) => audio.blip({ type: 'triangle', f0: f, dur: 2.2, vol: 0.22, delay: i * 0.03, pos: { x: 53, y: 1, z: 34 }, ref: 4 })); UI.sub(t('sub_piano'), 4000); }); break;
      case 'restroom': this.after(0.5, () => { audio.whisper({ x: 39, y: 1.7, z: 33 }); audio.drip({ x: 40, y: 1, z: 36 }); UI.sub(t('sub_mirror'), 4000); }); break;
      case 'bcorr': this.after(0.5, () => { audio.whisper({ x: player.pos.x + 4, y: -2.5, z: 18 }); UI.sub(t('sub_basement'), 5000); }); break;
      case 'secret1': UI.sub(t('sub_secret'), 5500); break;
      case 'shrine': UI.sub(t('sub_shrine'), 6000); audio.stinger(0.4); break;
      case 'library': UI.sub(t('sub_library'), 4000); break;
      case 'office': UI.sub(t('sub_office'), 4000); break;
      case 'archive': UI.sub(t('sub_archive'), 4000); break;
      default: break;
    }
  },
  checkpointSoft() { if (G.safeTime > 3 && !G.chase) this.checkpoint(); },
  scares() {
    // first corridor scare: the classroom door slams and the professor appears at the end of the hall
    if (!G.scared.has('slam') && this.room && this.room.id === 'corridor1') {
      G.scared.add('slam'); G.flags.profActive = true;
      const d = World.doorById.d_1a; this.after(0.6, () => { d.forceClose(true); this.blackout(2.0); G.shake = 0.6; });
      this.after(1.8, () => { prof.activate(60.5, 13, 'idle'); prof.yaw = -Math.PI / 2; audio.stinger(0.9); audio.growl(prof.pos); UI.sub(t('sub_slam'), 4500); });
      this.after(6.2, () => { if (prof.state === 'idle') { this.blackout(0.9); this.after(0.7, () => { prof.deactivate(); audio.whisper({ x: player.pos.x + 3, y: 1.5, z: player.pos.z }); }); } });
      this.after(14, () => { if (!prof.active) prof.activate(26, 35, 'patrol'), prof.pickPatrol(); });
    }
    if (!G.scared.has('fakeknock') && G.flags.libraryOpen && this.room && this.room.id === 'library') { G.scared.add('fakeknock'); this.after(2, () => { audio.bang({ x: 40, y: 1, z: 13 }); }); }
  },
  onEnterHideLocker() { /* reserved */ },
};
void Game.onEnterHideLocker;

/* =====================================================================
   9. USER INTERFACE — HUD, menus, modals, journal & map, touch controls
   ===================================================================== */
const ENDINGS = ['escape', 'peace', 'fire', 'legend'];
const UI = {
  subT: 0, invSig: '', grainT: 0, fpsAcc: 0, fpsN: 0, fpsT: 0, lowT: 0, highT: 0, keyBuf: '', keyDoor: null, noteBack: false, tab: 'obj', hideOn: false, saveFlashT: 0,

  el: (id) => document.getElementById(id),
  open(id) { const e = this.el(id); if (e) e.classList.add('active'); },
  close(id) { const e = this.el(id); if (e) e.classList.remove('active'); },
  showScreen(id) { ['loading', 'menu', 'pause', 'settings', 'controls', 'journal', 'note', 'keypad', 'choice', 'gameover', 'ending', 'intro', 'language', 'archive', 'slots'].forEach((s) => { if (s !== id) this.close(s); }); if (id) this.open(id); },
  hudShow(on) { this.el('hud').classList.toggle('hidden', !on); this.updateTouchVis(); },
  fade(on, ms = 800, white = false) { const f = this.el('fx-fade'); f.style.transitionDuration = ms + 'ms'; f.classList.toggle('white', !!white); f.classList.toggle('on', !!on); },
  updateTouchVis() { const show = S.touch && (G.state === 'playing') && !G.modal; this.el('touch').classList.toggle('hidden', !show); },

  /* ---------- feedback ---------- */
  toast(text, kind = '') {
    const box = this.el('toasts'); const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = text; box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => d.classList.add('out'), 3200); setTimeout(() => d.remove(), 3800);
  },
  sub(text, ms = 4000, cls = '') {
    if (!S.subs) return; const s = this.el('subtitle'); s.textContent = text; s.className = 'show ' + cls;
    clearTimeout(this.subT); this.subT = setTimeout(() => { s.className = ''; }, ms);
  },
  prof(text, show = true) { if (show) this.sub('« ' + text + ' »', 3800, 'prof'); },
  damageFlash() { const d = this.el('fx-damage'); d.style.transition = 'none'; d.style.opacity = '0.85'; requestAnimationFrame(() => { d.style.transition = 'opacity 0.9s'; d.style.opacity = '0'; }); },
  flashSave() { this.saveFlashT = 1.6; },
  fire(sec) { const e = this.el('fire-timer'); e.classList.remove('hidden'); e.textContent = '🔥 ' + fmtTime(Math.max(0, sec)); },
  hideFire() { this.el('fire-timer').classList.add('hidden'); },
  setHide(on, under) { this.hideOn = on; this.el('hide-overlay').classList.toggle('hidden', !on || !!under); this.el('breath-box').classList.toggle('hidden', !on); },
  setBusy(b) {
    let e = this.el('busy-bar');
    if (!b) { if (e) e.classList.add('hidden'); return; }
    if (!e) { e = document.createElement('div'); e.id = 'busy-bar'; e.innerHTML = '<span></span><div class="track"><i></i></div>'; this.el('hud').appendChild(e); }
    e.classList.remove('hidden'); e.querySelector('span').textContent = b.label;
    e.querySelector('i').style.width = Math.round(clamp(b.t / b.dur, 0, 1) * 100) + '%';
  },
  ping(v) { void v; },
  async intro(lines) {
    this.open('intro'); const els = ['intro-line1', 'intro-line2', 'intro-line3'].map((i) => this.el(i));
    els.forEach((e, i) => { e.textContent = lines[i] || ''; e.classList.remove('show'); });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(500); for (let i = 0; i < els.length; i++) { els[i].classList.add('show'); await wait(2300); }
    await wait(900); this.close('intro');
  },

  /* ---------- HUD ---------- */
  updateHud(dt) {
    const p = player;
    this.el('bar-hp').style.width = clamp(p.health, 0, 100) + '%';
    this.el('bar-st').style.width = clamp(p.stamina, 0, 100) + '%';
    const mb = this.el('meter-bat'); mb.classList.toggle('hidden', !p.hasFlash); mb.classList.toggle('low', p.battery < 20); this.el('bar-bat').style.width = clamp(p.battery, 0, 100) + '%';
    const pb = this.el('phase-badge');
    if (pb) {
      const shownPhase = 1 + (G.pages.size >= 3 ? 1 : 0) + (G.pages.size >= 6 ? 1 : 0);
      const vis = shownPhase >= 2 && G.state === 'playing';
      pb.classList.toggle('hidden', !vis);
      if (vis) pb.textContent = '☠ ' + t('phase_badge', { n: ['', 'I', 'II', 'III'][shownPhase] || shownPhase });
    }
    const bs = this.el('bar-san'), msan = this.el('meter-san');
    if (bs) { bs.style.width = clamp(G.sanity, 0, 100) + '%'; msan.classList.toggle('low', G.sanity < 32); }
    if (this.relicSig !== G.relics.size + '|' + LANG) {
      this.relicSig = G.relics.size + '|' + LANG;
      const rc = this.el('relic-icons'); if (rc) { rc.innerHTML = ''; const imap = { box: '🎵', locket: '📿', photo: '🖼️' }; G.relics.forEach((k) => { const sp = document.createElement('span'); sp.textContent = imap[k] || '🏺'; sp.title = t('relic_' + k); rc.appendChild(sp); }); }
    }
    // prompt
    const cur = Game.current, pr = this.el('prompt');
    if (cur && !G.modal && G.state === 'playing') { pr.classList.remove('hidden'); this.el('prompt-text').textContent = cur.label(); this.el('prompt-key').textContent = (IS_TOUCH && S.touch) ? '👆' : 'E'; } else pr.classList.add('hidden');
    // awareness meter
    const aw = this.el('aware'); const show = prof.active && prof.awareness > 0.06 && prof.state !== 'chase' && !p.hidden;
    aw.classList.toggle('hidden', !show); if (show) aw.querySelector('i').style.width = Math.round(prof.awareness * 100) + '%';
    // breath (hiding)
    if (this.hideOn) {
      this.el('bar-breath').style.width = clamp(p.breath, 0, 100) + '%';
      const near = prof.active && Math.hypot(prof.pos.x - p.pos.x, prof.pos.z - p.pos.z) < 6.5;
      this.el('breath-hint').textContent = near ? t('breath_now') : t('breath_hint');
    }
    // overlays
    const danger = clamp(G.tension * 0.85 + (p.health < 40 ? (40 - p.health) / 60 : 0), 0, 1);
    this.el('fx-danger').style.opacity = String(danger * (0.7 + 0.3 * Math.sin(G.time * 8)));
    // inventory
    const sig = [p.hasFlash, [...G.inv].join(), G.fuses, G.pages.size, G.throwables.chalk, G.throwables.bottle].join('|');
    if (sig !== this.invSig) {
      this.invSig = sig; const ic = this.el('inv-icons'); ic.innerHTML = '';
      const add = (txt, title) => { const s = document.createElement('span'); s.textContent = txt; s.title = title || ''; ic.appendChild(s); };
      if (p.hasFlash) add('🔦', t('it_flashlight'));
      if (G.throwables.chalk) add('✏️' + G.throwables.chalk, t('it_chalk'));
      if (G.throwables.bottle) add('🍾' + G.throwables.bottle, t('it_bottle')); ['library_key', 'lab_key', 'basement_key', 'main_key'].forEach((k) => { if (G.inv.has(k)) add('🗝️', t('it_' + k)); });
      if (G.fuses) add('🔌×' + G.fuses, t('it_fuse')); if (G.inv.has('ring')) add('💍', t('it_ring')); if (G.pages.size) add('📄' + G.pages.size + '/' + MAX_PAGES, t('jr_notes'));
    }
    if (this.saveFlashT > 0) { this.saveFlashT -= dt; }
    // film grain
    this.grainT -= dt;
    if (this.grainT <= 0 && S.grain && S.quality !== 'low') {
      this.grainT = 0.09; const c = this.el('fx-grain'), x = c.getContext('2d'), im = x.createImageData(c.width, c.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } x.putImageData(im, 0, 0);
    }
  },
  objectiveInfo() {
    const f = G.flags; const has = (k) => G.inv.has(k);
    if (!player.hasFlash) return ['ob_flash'];
    if (!f.libraryOpen) return has('library_key') ? ['ob_open_library'] : ['ob_library_key'];
    if (!f.labOpen) return has('lab_key') ? ['ob_open_lab'] : (f.secretOpen ? ['ob_lab_key'] : ['ob_secret']);
    if (!f.officeOpen) return ['ob_code'];
    if (!f.stairsOpen) return has('basement_key') ? ['ob_open_stairs'] : ['ob_basement_key'];
    if (!f.power) return G.fuses >= 2 ? ['ob_fusebox'] : ['ob_fuses', { n: G.fuses }];
    if (!has('main_key')) return ['ob_shrine'];
    if (f.fire) return ['ob_fire'];
    if (G.relics.size >= 3 && has('ring') && G.pages.size >= TRUTH_PAGES && !G.altarDone) return ['ob_relics'];
    return ['ob_exit'];
  },
  refreshObjective() { const [k, v] = this.objectiveInfo(); const txt = t(k, v); const e = this.el('objective-text'); if (e.textContent !== txt) { e.textContent = txt; if (G.state === 'playing') { e.parentElement.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 700 }); } } },

  /* ---------- pause / menus ---------- */
  pause(on) {
    Input.pressed.clear();
    if (on) {
      if (G.state !== 'playing') return; G.state = 'paused'; releaseLock(); Input.clear(); this.open('pause'); audio.suspend(); this.updateTouchVis();
    } else {
      if (G.state !== 'paused') return; this.close('pause'); this.close('settings'); this.close('controls'); G.state = 'playing'; audio.resume(); requestLock(); Input.clear(); this.updateTouchVis();
    }
  },
  showMenu() {
    G.state = 'menu'; G.modal = null; audio.stopLoops(); this.hudShow(false); this.hideFire(); this.setHide(false); this.fade(false, 600);
    this.showScreen('menu'); this.el('btn-continue').disabled = !Game.anySave();
    this.el('menu-endings').textContent = t('endings_found', { n: G.endings.length, total: ENDINGS.length }) + ' · ' + t('ach_count', { a: Achv.set.size, b: ACH_LIST.length });
    this.el('btn-continue').disabled = !Game.anySave();
    player.char.root.visible = false; flashlight.intensity = 0; player.beam.visible = false; releaseLock();
    prof.activate(50, 13, 'idle'); prof.yaw = -Math.PI / 2; scene.fog.color.setHex(0x03040a);
  },
  quitToMenu() { Game.checkpoint(true); audio.resume(); this.close('pause'); this.showMenu(); },

  /* ---------- modals ---------- */
  modalOpen(name, id) { G.modal = name; releaseLock(); Input.clear(); Input.pressed.clear(); this.open(id); this.updateTouchVis(); },
  closeModal() {
    ['note', 'keypad', 'choice'].forEach((s) => this.close(s));
    if (this.noteBack) { this.noteBack = false; G.modal = 'journal'; return; }
    this.close('journal'); G.modal = null; this.keyDoor = null; this.updateTouchVis();
    if (G.state === 'playing') { requestLock(); Input.clear(); }
  },
  openNote(id, fromJournal) {
    this.noteBack = !!fromJournal;
    this.el('note-title').textContent = t('note_' + id + '_t'); this.el('note-body').textContent = t('note_' + id + '_b');
    G.modal = 'note'; releaseLock(); Input.clear(); this.open('note'); this.updateTouchVis(); audio.click();
  },
  openKeypad(door) {
    this.keyDoor = door; this.keyBuf = ''; this.drawKeypad(); this.el('kp-msg').textContent = t('kp_hint'); this.modalOpen('keypad', 'keypad');
  },
  drawKeypad(state) {
    const disp = this.el('kp-display'); disp.className = state || ''; disp.textContent = (this.keyBuf + '----').slice(0, 4);
  },
  keypadPress(k) {
    if (G.modal !== 'keypad') return; audio.blip({ type: 'square', f0: 900 + (k.charCodeAt(0) % 10) * 40, dur: 0.05, vol: 0.06 });
    if (k === 'C') this.keyBuf = ''; else if (k === '⌫') this.keyBuf = this.keyBuf.slice(0, -1); else if (this.keyBuf.length < 4) this.keyBuf += k;
    this.drawKeypad();
    if (this.keyBuf.length === 4) {
      const ok = Game.tryCode(this.keyDoor, this.keyBuf);
      if (ok) { this.drawKeypad('ok'); this.el('kp-msg').textContent = t('kp_ok'); setTimeout(() => this.closeModal(), 700); }
      else { this.drawKeypad('err'); this.el('kp-msg').textContent = t('kp_bad'); setTimeout(() => { this.keyBuf = ''; this.drawKeypad(); }, 600); }
    }
  },
  choice(title, text, opts) {
    this.el('choice-title').textContent = title; this.el('choice-text').textContent = text;
    const box = this.el('choice-buttons'); box.innerHTML = '';
    opts.forEach((o) => { const b = document.createElement('button'); b.className = 'btn big' + (o.primary ? ' primary' : ''); b.textContent = o.label; b.addEventListener('click', () => { audio.click(); o.fn(); }); box.appendChild(b); });
    G.modal = 'choice'; releaseLock(); Input.clear(); this.open('choice'); this.updateTouchVis();
  },

  /* ---------- journal & map ---------- */
  openJournal(tab) {
    this.modalOpen('journal', 'journal'); this.setTab(tab || 'obj');
  },
  setTab(tab) {
    this.tab = tab; $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab)); $$('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab));
    if (tab === 'obj') this.buildObjTab(); else if (tab === 'notes') this.buildNotesTab(); else this.drawMap();
  },
  buildObjTab() {
    const [k, v] = this.objectiveInfo(); const f = G.flags, has = (x) => G.inv.has(x);
    const ms = [['ms_flash', player.hasFlash], ['ms_library', f.libraryOpen], ['ms_secret', f.secretOpen], ['ms_lab', f.labOpen], ['ms_office', f.officeOpen], ['ms_stairs', f.stairsOpen], ['ms_power', f.power], ['ms_key', has('main_key')]];
    let h = `<div class="obj-current">🎯 ${t(k, v)}</div><ul class="obj-list">` + ms.map(([m, d]) => `<li class="${d ? 'done' : 'todo'}">${t(m)}</li>`).join('') + '</ul>';
    h += `<h3>${t('jr_items')}</h3><div class="inv-grid">`;
    const chips = []; if (player.hasFlash) chips.push('🔦 ' + t('it_flashlight') + ' (' + Math.round(player.battery) + '%)'); ['library_key', 'lab_key', 'basement_key', 'main_key', 'ring'].forEach((x) => { if (has(x)) chips.push((x === 'ring' ? '💍 ' : '🗝️ ') + t('it_' + x)); });
    if (G.fuses) chips.push('🔌 ' + t('it_fuse') + ' ×' + G.fuses); chips.push('📄 ' + t('jr_pages', { n: G.pages.size, max: MAX_PAGES }));
    h += chips.map((c) => `<span class="inv-chip">${c}</span>`).join('') + '</div>';
    h += '<h3>' + t('tools') + '</h3><div class="inv-grid">' + ['chalk', 'bottle'].map((k) => '<span class="inv-chip">' + (k === 'chalk' ? '✏️ ' : '🍾 ') + t('it_' + k) + ' ×' + (G.throwables[k] || 0) + '</span>').join('') + ('<span class="inv-chip">🪑 ' + t('barricade') + ' ' + G.barricades.length + '/2</span>') + '</div>';
    h += '<h3>' + t('jr_legends') + '</h3><div class="inv-grid">' + ['box','locket','photo'].map((k) => '<span class="inv-chip">' + (G.relics.has(k) ? '🏺 ' : '◇ ') + t('relic_' + k) + '</span>').join('') + '</div>';
    h += '<p class="hint">' + t('archive_progress', { a: Achv.set.size, b: ACH_LIST.length, e: G.endings.length, r: G.relics.size, p: G.pages.size }) + '</p>';
    this.el('tab-obj').innerHTML = h;
  },
  buildNotesTab() {
    const box = this.el('tab-notes'); box.innerHTML = '';
    if (!G.notes.size) { box.innerHTML = `<p class="hint">${t('jr_no_notes')}</p>`; return; }
    [...G.notes].forEach((id) => { const b = document.createElement('button'); b.className = 'note-row'; b.textContent = '📄 ' + t('note_' + id + '_t'); b.addEventListener('click', () => this.openNote(id, true)); box.appendChild(b); });
  },
  drawMap() {
    const cv = this.el('map-canvas'), x = cv.getContext('2d'), W = cv.width, H = cv.height; x.fillStyle = '#07080a'; x.fillRect(0, 0, W, H);
    const bx0 = -2, bz0 = -9, bw = 108, bh = 51, sc = Math.min(W / bw, H / bh), ox = (W - bw * sc) / 2, oz = (H - bh * sc) / 2;
    const mx = (px) => ox + (px - bx0) * sc, mz = (pz) => oz + (pz - bz0) * sc;
    x.font = '11px sans-serif'; x.textAlign = 'center';
    for (const r of World.rooms) {
      const known = Game.visited.has(r.id) || (r.corridor && Game.visited.has(r.id));
      if (!known) { x.strokeStyle = 'rgba(255,255,255,0.05)'; x.strokeRect(mx(r.x0), mz(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc); continue; }
      x.fillStyle = r.basement ? '#1b2228' : '#232a24'; x.fillRect(mx(r.x0), mz(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc);
      x.strokeStyle = '#6a7a6e'; x.lineWidth = 1.5; x.strokeRect(mx(r.x0), mz(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc);
      if ((r.x1 - r.x0) * sc > 40) { x.fillStyle = '#a9b3aa'; x.fillText(t('room_' + r.id), mx(r.cx), mz(r.cz) + 4); }
    }
    for (const d of World.doors) { const kr = d.room && Game.visited.has(d.room.id); if (!kr && !d.locked) continue; x.fillStyle = d.locked ? '#d04a4a' : '#8aa68e'; x.fillRect(mx(d.cx) - 3, mz(d.cz) - 3, 6, 6); }
    x.fillStyle = '#d9a441'; x.beginPath(); const p = player.pos; x.save(); x.translate(mx(p.x), mz(p.z)); x.rotate(-player.yaw + Math.PI); x.moveTo(0, -8); x.lineTo(6, 7); x.lineTo(-6, 7); x.closePath(); x.fill(); x.restore();
    x.fillStyle = '#9aa'; x.fillText(p.y < -2 ? t('map_basement') : t('map_ground'), 40, 14);
  },

  /* ---------- game over / ending ---------- */
  showGameOver(cause) {
    this.el('go-text').textContent = t(cause === 'explosion' ? 'go_explosion' : 'go_caught'); this.el('go-tip').textContent = t('tip_go_' + (1 + Math.floor(Math.random() * 4)));
    this.showScreen('gameover'); this.updateTouchVis();
  },
  showEnding(id) {
    const truth = G.pages.size >= TRUTH_PAGES;
    this.el('end-title').textContent = t('end_' + id + '_t');
    let body = t('end_' + id + '_b'); if (id === 'escape') body += '\n\n' + t(truth ? 'end_escape_truth' : 'end_escape_blind'); if (id === 'fire') body += '\n\n' + t(truth ? 'end_fire_truth' : 'end_fire_blind');
    if (id === 'legend') { body += '\n\n' + t('end_legend_extra'); this.el('end-title').style.color = '#d8b45a'; }
    this.el('end-text').textContent = body;
    this.el('end-stats').innerHTML = [`⏱ ${fmtTime(G.playTime)}`, `📄 ${G.pages.size}/${MAX_PAGES}`, `🏺 ${G.relics.size}/3`, `🏆 ${Achv.set.size}/${ACH_LIST.length}`, `💀 ${G.deaths}`, S.diff === 'legend' ? '☠ LEGEND' : ''].filter(Boolean).map((s) => `<b>${s}</b>`).join('');
    this.el('end-progress').textContent = t('endings_found', { n: G.endings.length, total: ENDINGS.length }) + ' — ' + ENDINGS.map((e) => (G.endings.includes(e) ? '✔ ' : '✘ ') + t('end_' + e + '_t')).join('  ·  ');
    this.showScreen('ending'); this.fade(false, 400);
  },

  /* ---------- settings ---------- */
  bindSettings() {
    const set = (id, v) => { const e = this.el(id); if (!e) return; if (e.type === 'checkbox') e.checked = !!v; else e.value = v; };
    const sync = () => {
      set('set-quality', S.quality); set('set-shadow', String(S.shadow)); set('set-res', S.res); set('set-fov', S.fov); set('set-autoq', S.autoQ); set('set-grain', S.grain); set('set-fps', S.fps);
      set('set-safe', S.safe); set('set-pad', S.pad); set('set-master', S.master); set('set-music', S.music); set('set-sfx', S.sfx); set('set-voice', S.voice); set('set-diff', S.diff); set('set-sens', S.sens); set('set-invert', S.invert); set('set-subs', S.subs); set('set-touch', S.touch);
      this.el('out-res').textContent = S.res + '%'; this.el('out-fov').textContent = S.fov + '°';
    };
    this.syncSettings = sync; sync();
    const bind = (id, key, conv, after) => this.el(id).addEventListener('input', (e) => { const el = e.target; S[key] = conv ? conv(el.type === 'checkbox' ? el.checked : el.value) : (el.type === 'checkbox' ? el.checked : el.value); saveSettings(); if (after) after(); sync(); });
    bind('set-quality', 'quality', null, () => { dynScale = 1; applyQuality(); });
    bind('set-shadow', 'shadow', (v) => v, () => applyQuality());
    bind('set-res', 'res', Number, () => applyQuality()); bind('set-fov', 'fov', Number, () => applyQuality());
    bind('set-autoq', 'autoQ', null, () => { dynScale = 1; applyQuality(); }); bind('set-grain', 'grain', null, () => applyQuality()); bind('set-fps', 'fps', null, () => this.el('fps').classList.toggle('hidden', !S.fps));
    bind('set-safe', 'safe', null, () => { document.documentElement.classList.toggle('safe-mode', !!S.safe); if (S.safe) { G.shake = 0; FX.flash = 0; } });
    bind('set-pad', 'pad');
    ['master', 'music', 'sfx'].forEach((k) => bind('set-' + k, k, Number, () => audio.setVolumes(S)));
    bind('set-voice', 'voice'); bind('set-diff', 'diff'); bind('set-sens', 'sens', Number); bind('set-invert', 'invert'); bind('set-subs', 'subs'); bind('set-touch', 'touch', null, () => this.updateTouchVis());
    this.el('btn-lang').addEventListener('click', (e) => { e.preventDefault(); audio.init(); audio.click(); this.openLanguage(); });
    this.el('set-lang').addEventListener('click', (e) => { e.preventDefault(); audio.init(); audio.click(); this.openLanguage(true); });
    this.el('btn-language-back').addEventListener('click', () => { audio.click(); this.close('language'); if (this.langBack) { this.open('settings'); } this.langBack = null; });
    this.el('btn-archive').addEventListener('click', (e) => { e.preventDefault(); audio.init(); audio.click(); this.openArchive(); });
    this.el('btn-archive-back').addEventListener('click', () => { audio.click(); this.close('archive'); });
    this.el('btn-erase').addEventListener('click', () => { if (confirm(t('erase_confirm'))) { [1, 2, 3].forEach((n) => Store.del('save' + n)); Store.del('save'); Store.del('endings'); Store.del('settings'); Store.del('achv'); Store.del('foundRelics'); Store.del('foundPages'); Store.del('lastSlot'); location.reload(); } });
  },
  setLang(l) {
    if (!LANG_CODES.includes(l)) l = 'en';
    LANG = l; S.lang = l; saveSettings(); applyStaticI18n(); this.invSig = ''; this.relicSig = '';
    this.el('menu-endings').textContent = t('endings_found', { n: G.endings.length, total: ENDINGS.length }) + ' · ' + t('ach_count', { a: Achv.set.size, b: ACH_LIST.length });
    this.el('btn-fullscreen').textContent = t('btn_fullscreen');
    this.buildLanguage();
    if (G.modal === 'journal') this.setTab(this.tab);
    if (document.getElementById('archive').classList.contains('active')) this.buildArchive();
    this.refreshObjective(); this.syncSettings(); this.updateTouchVis();
  },
  openSlots(mode) {
    this.slotMode = mode || 'load'; this.buildSlots(); this.open('slots');
  },
  buildSlots() {
    const box = this.el('slots-list'); box.innerHTML = '';
    const diffName = (d) => t('d_' + (d === 'legend' ? 'legend' : d === 'hard' ? 'hard' : d === 'easy' ? 'easy' : 'normal'));
    for (let n = 1; n <= 3; n++) {
      const sv = Game.readSlot(n);
      const row = document.createElement('div'); row.className = 'slot' + (sv ? '' : ' empty') + (G.slot === n ? ' current' : '');
      const info = document.createElement('div'); info.className = 'info';
      if (sv) {
        const obj = (sv.flags && sv.flags.power) ? t('ms_power') : (sv.flags && sv.flags.officeOpen) ? t('ms_office') : (sv.flags && sv.flags.libraryOpen) ? t('ms_library') : t('ms_flash');
        info.innerHTML = '<b>' + t('slot_n', { n }) + '</b><small>' + t('slot_info', { obj, time: fmtTime(sv.playTime || 0), pages: (sv.pages || []).length, relics: (sv.relics || []).length, diff: diffName(sv.diff || 'normal') }) + '</small>';
      } else info.innerHTML = '<b>' + t('slot_n', { n }) + '</b><small>' + t('slot_empty') + '</small>';
      const acts = document.createElement('div'); acts.className = 'acts';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.addEventListener('click', (e) => { e.preventDefault(); audio.init(); audio.click(); fn(); }); acts.appendChild(b); };
      if (sv) mk(t('slot_load'), 'primary', () => { this.close('slots'); Game.continueGame(n); });
      mk(sv ? t('slot_new') : t('slot_new'), sv ? '' : 'primary', () => {
        if (sv && !confirm(t('slot_overwrite', { n }))) return;
        G.slot = n; Store.set('lastSlot', n); this.close('slots'); Game.newGame();
      });
      if (sv) mk(t('slot_delete'), 'danger', () => { if (!confirm(t('slot_delete_confirm', { n }))) return; Game.deleteSlot(n); this.buildSlots(); this.el('btn-continue').disabled = !Game.anySave(); });
      const num = document.createElement('div'); num.className = 'num'; num.textContent = n;
      row.appendChild(num); row.appendChild(info); row.appendChild(acts); box.appendChild(row);
    }
  },
  openLanguage(fromSettings) {
    this.langBack = fromSettings ? 'settings' : null;
    if (fromSettings) this.close('settings');
    this.buildLanguage(); this.open('language');
  },
  buildLanguage() {
    const g = this.el('lang-grid'); if (!g) return;
    if (!g.children.length) {
      LANGS.forEach((l) => {
        const b = document.createElement('button'); b.className = 'lang-btn'; b.dataset.lang = l.code; b.type = 'button';
        b.innerHTML = '<span class="fl">' + l.flag + '</span><span>' + l.native + '<small>' + l.en + '</small></span>';
        b.addEventListener('click', () => { audio.init(); audio.click(); this.setLang(l.code); });
        g.appendChild(b);
      });
    }
    $$('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === LANG));
  },
  openArchive() { this.buildArchive(); this.open('archive'); },
  buildArchive() {
    this.el('archive-progress').textContent = t('archive_progress', { a: Achv.set.size, b: ACH_LIST.length, e: G.endings.length, r: Math.max(G.relics.size, Codex.relics.size), p: Math.max(G.pages.size, Codex.pages.size) });
    const imap = { box: '🎵', locket: '📿', photo: '🖼️' };
    this.el('archive-relics').innerHTML = ['box', 'locket', 'photo'].map((k) => '<div class="relic-tile ' + (G.relics.has(k) || Codex.relics.has(k) ? 'found' : '') + '"><b>' + imap[k] + '</b>' + t('relic_' + k) + '</div>').join('');
    this.el('archive-endings').innerHTML = ENDINGS.map((e) => {
      const found = G.endings.includes(e);
      return '<div class="ach-card ' + (found ? 'done' : '') + '"><b>' + (found ? '🎬' : '🔒') + '</b><span><span class="t">' + (found ? t('end_' + e + '_t') : t('archive_none')) + '</span><span class="d">' + (found ? t('archive_found') : t('archive_hidden')) + '</span></span></div>';
    }).join('');
    const icons = { first_light: '🔦', hidden: '🤫', librarian: '📚', secret: '🗝️', power: '⚡', truth: '📄', relics: '🏺', escape: '🚪', peace: '💍', fire: '🔥', hunted: '🏃', untouched: '🛡️', nightmare: '☠️', legend: '👑' };
    this.el('archive-achievements').innerHTML = ACH_LIST.map((id) => {
      const done = Achv.has(id);
      return '<div class="ach-card ' + (done ? 'done' : '') + '"><b>' + (done ? icons[id] : '🔒') + '</b><span><span class="t">' + (done ? t('ach_' + id + '_t') : t('archive_none')) + '</span><span class="d">' + (done ? t('ach_' + id + '_d') : t('archive_hidden')) + '</span></span></div>';
    }).join('');
  },

  /* ---------- buttons wiring ---------- */
  bind() {
    const on = (id, fn) => this.el(id).addEventListener('click', (e) => { e.preventDefault(); audio.init(); audio.click(); fn(); });
    on('btn-new', () => { this.openSlots('new'); });
    on('btn-continue', () => this.openSlots('load'));
    this.el('btn-slots-back').addEventListener('click', () => { audio.click(); this.close('slots'); });
    on('btn-settings', () => this.open('settings')); on('btn-controls', () => this.open('controls'));
    on('btn-settings-back', () => { this.close('settings'); }); on('btn-controls-back', () => this.close('controls'));
    on('btn-fullscreen', () => { const d = document.documentElement; try { if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) { d.requestFullscreen().then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {}); } } catch (e) { /* ignore */ } });
    on('btn-resume', () => this.pause(false)); on('btn-pause-settings', () => this.open('settings')); on('btn-pause-controls', () => this.open('controls'));
    on('btn-pause-journal', () => { this.close('pause'); G.state = 'playing'; this.openJournal('obj'); });
    on('btn-checkpoint', () => { this.close('pause'); this.pause(false); this.close('pause'); Game.retry(); });
    on('btn-quit', () => this.quitToMenu());
    on('btn-hud-pause', () => this.pause(true)); on('btn-hud-journal', () => { if (G.state === 'playing' && !G.modal) this.openJournal('obj'); });
    on('btn-journal-close', () => this.closeModal()); on('btn-note-close', () => this.closeModal()); on('btn-kp-close', () => this.closeModal());
    on('btn-retry', () => Game.retry()); on('btn-go-restart', () => { Game.newGame(); }); on('btn-go-menu', () => { this.close('gameover'); this.showMenu(); });
    on('btn-end-again', () => Game.newGame()); on('btn-end-menu', () => { this.close('ending'); this.showMenu(); });
    $$('.tab').forEach((b) => b.addEventListener('click', () => { audio.click(); this.setTab(b.dataset.tab); }));
    const grid = this.el('kp-grid'); ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].forEach((k) => { const b = document.createElement('button'); b.textContent = k; b.addEventListener('click', () => this.keypadPress(k)); grid.appendChild(b); });
    window.addEventListener('keydown', (e) => { if (G.modal === 'keypad') { const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code); if (m) this.keypadPress(m[1]); else if (e.code === 'Backspace') this.keypadPress('⌫'); } });
    this.initTouch();
  },
  initTouch() {
    const joyZone = this.el('joy-zone'), base = this.el('joy-base'), knob = this.el('joy-knob'), look = this.el('look-zone');
    let jid = null, jc = { x: 0, y: 0 }; const R = 56;
    joyZone.addEventListener('pointerdown', (e) => {
      if (jid !== null) return; jid = e.pointerId; joyZone.setPointerCapture(jid); const r = joyZone.getBoundingClientRect();
      jc = { x: clamp(e.clientX, r.left + 70, r.right - 20), y: clamp(e.clientY, r.top + 70, r.bottom - 30) };
      base.style.left = jc.x - 64 + 'px'; base.style.top = jc.y - 64 + 'px'; base.style.bottom = 'auto'; Input.joyActive = true; e.preventDefault();
    });
    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== jid) return; let dx = e.clientX - jc.x, dy = e.clientY - jc.y; const l = Math.hypot(dx, dy); if (l > R) { dx = dx / l * R; dy = dy / l * R; }
      knob.style.transform = `translate(${dx}px,${dy}px)`; Input.joyX = dx / R; Input.joyY = -dy / R; e.preventDefault();
    });
    const jend = (e) => { if (e.pointerId !== jid) return; jid = null; Input.joyX = Input.joyY = 0; Input.joyActive = false; knob.style.transform = ''; base.style.left = ''; base.style.top = ''; base.style.bottom = ''; };
    joyZone.addEventListener('pointerup', jend); joyZone.addEventListener('pointercancel', jend);
    let lid = null, lx = 0, ly = 0;
    look.addEventListener('pointerdown', (e) => { if (lid !== null) return; lid = e.pointerId; look.setPointerCapture(lid); lx = e.clientX; ly = e.clientY; e.preventDefault(); });
    look.addEventListener('pointermove', (e) => { if (e.pointerId !== lid) return; Input.lookDX += (e.clientX - lx) * 1.15; Input.lookDY += (e.clientY - ly) * 1.15; lx = e.clientX; ly = e.clientY; e.preventDefault(); });
    const lend = (e) => { if (e.pointerId === lid) lid = null; }; look.addEventListener('pointerup', lend); look.addEventListener('pointercancel', lend);
    const tap = (id, fn) => { const b = this.el(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); fn(true); }); const up = (e) => { b.classList.remove('down'); fn(false); }; b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up); };
    tap('tb-act', (d) => { if (d) Input.press('interact'); }); tap('tb-jump', (d) => { if (d) Input.press('jump'); Input.touchBreath = d; });
    tap('tb-crouch', (d) => { if (d) Input.press('crouch'); }); tap('tb-light', (d) => { if (d) Input.press('flash'); }); tap('tb-run', (d) => { Input.touchRun = d; });
    const bar = this.el('tb-barricade'); if (bar) bar.addEventListener('pointerdown', (e) => { e.preventDefault(); bar.classList.add('down'); Input.press('barricade'); setTimeout(() => bar.classList.remove('down'), 120); });
    const thb = this.el('tb-throw'); if (thb) thb.addEventListener('pointerdown', (e) => { e.preventDefault(); thb.classList.add('down'); Input.press('throw'); setTimeout(() => thb.classList.remove('down'), 120); });
    const jb = this.el('tb-journal'); if (jb) jb.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.click(); if (G.state === 'playing' && !G.modal) this.openJournal('obj'); else if (G.modal === 'journal') this.closeModal(); });
  },
  /* FPS counter + adaptive resolution */
  perf(dt) {
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0;
      if (S.fps) this.el('fps').textContent = Math.round(fps) + ' FPS · ' + renderer.info.render.calls + ' dc · ' + Math.round(renderer.info.render.triangles / 1000) + 'k tris · ×' + dynScale.toFixed(2);
      if (S.autoQ && G.state === 'playing') {
        if (fps < 28) { this.lowT += 0.5; this.highT = 0; } else if (fps > 56) { this.highT += 0.5; this.lowT = 0; } else { this.lowT = 0; this.highT = 0; }
        if (this.lowT >= 3 && dynScale > 0.55) { dynScale = Math.max(0.55, dynScale - 0.12); this.lowT = 0; resize(); }
        else if (this.highT >= 8 && dynScale < 1) { dynScale = Math.min(1, dynScale + 0.08); this.highT = 0; resize(); }
      }
    }
  },
};

/* =====================================================================
   10a. TRANSLATIONS (English / Arabic RTL)
   ===================================================================== */
STR = {
  en: {
    loading: 'Loading…', load_init: 'Starting graphics engine…', load_rooms: 'Building the school…', load_doors: 'Hanging doors…', load_furniture: 'Placing desks, lockers and shadows…', load_lights: 'Wiring the flickering lights…', load_items: 'Hiding keys and secrets…', load_nav: 'Teaching the professor the corridors…', load_done: 'Ready',
    tagline: 'Detention never ends. Mr. Karim is still teaching… and he is looking for the student who stayed behind.',
    btn_continue: 'Continue', btn_new: 'New Game', btn_settings: 'Settings', btn_controls: 'Controls & Tips', btn_fullscreen: '⛶ Fullscreen', btn_back: 'Back', btn_close: 'Close',
    endings_found: 'Endings discovered: {n} / {total}',
    pause_title: 'PAUSED', btn_resume: 'Resume', btn_journal: 'Journal & Map', btn_checkpoint: 'Reload last checkpoint', btn_quit: 'Save & quit to menu',
    set_title: 'SETTINGS', set_graphics: 'Graphics', set_quality: 'Graphics quality', q_low: 'Low (weak devices)', q_med: 'Medium', q_high: 'High', q_ultra: 'Ultra',
    set_shadow: 'Flashlight shadow size', sh_auto: 'Auto (by quality)', sh_off: 'Off', sh_low: 'Low · 512', sh_med: 'Medium · 1024', sh_high: 'High · 2048',
    set_res: 'Resolution scale', set_fov: 'Field of view', set_autoq: 'Adaptive resolution (keeps FPS stable)', set_grain: 'Film grain', set_fps: 'Show FPS / draw calls',
    set_reload_hint: 'Texture size and material type change after reloading the page.', set_audio: 'Audio', set_master: 'Master volume', set_music: 'Music & ambience', set_sfx: 'Sound effects', set_voice: 'Professor whispers (speech synthesis)',
    set_gameplay: 'Gameplay', set_diff: 'Difficulty', d_easy: 'Easy', d_normal: 'Normal', d_hard: 'Hard', set_sens: 'Look sensitivity', set_invert: 'Invert Y axis', set_subs: 'Subtitles', set_touch: 'On-screen touch controls', set_lang: 'Language', set_data: 'Saved data', btn_erase: 'Erase all data',
    erase_confirm: 'Erase saved game, endings and settings?', new_confirm: 'Starting a new game will overwrite your saved progress. Continue?',
    ctl_title: 'CONTROLS & TIPS', ctl_pc: 'Keyboard & mouse', ctl_move: 'Move', ctl_look: 'Look around', ctl_run: 'Run (uses stamina) / hold breath', ctl_crouch: 'Crouch (toggle)', ctl_jump: 'Jump / hold breath when hiding', ctl_interact: 'Interact: open, pick up, hide', ctl_light: 'Flashlight on / off', ctl_journal: 'Journal', ctl_map: 'Map', ctl_pause: 'Pause',
    ctl_mobile: 'Touch (landscape)', ctl_m1: 'Left thumb: virtual joystick to move.', ctl_m2: 'Right side: drag to move the camera. Buttons: action, jump, crouch, run, flashlight.', ctl_m3: 'While hiding, hold the jump or run button to hold your breath.',
    ctl_tips: 'Survival tips', tip1: 'He hears running, doors and wrong codes. Walk or crouch near him.', tip2: 'A flashlight can be seen from far away. Switch it off in dark corridors when he is near.', tip3: 'Crouch behind cabinets, shelves and lockers to break his line of sight.', tip4: 'Hide in lockers — but if he sees you enter, he will come for you. Hold your breath while he checks.',
    jr_title: 'JOURNAL', jr_obj: 'Objectives', jr_notes: 'Notes', jr_map: 'Map', map_hint: 'Only rooms you have visited appear. Red squares are locked doors. The clock in the corridor remembers.', jr_items: 'Inventory', jr_pages: 'Diary pages {n}/{max}', jr_no_notes: 'You have not found any notes yet.', map_ground: 'Ground floor', map_basement: 'Basement',
    hp: 'HEALTH', stamina: 'STAMINA', battery: 'BATTERY', objective: 'OBJECTIVE', aware: 'NOTICING YOU', tb_act: 'ACT', rotate_msg: 'Please rotate your device to landscape.',
    kp_title: 'KEYPAD', kp_hint: 'Enter the 4-digit code.', kp_ok: 'ACCESS GRANTED', kp_bad: 'WRONG CODE — that was loud!',
    go_title: 'YOU DIED', go_caught: 'Mr. Karim found you. The school keeps its secrets — and now it keeps you.', go_explosion: 'The boiler explosion swallowed the whole basement.', btn_retry: 'Retry from checkpoint', btn_restart: 'Restart the story', btn_menu: 'Main menu',
    tip_go_1: 'Tip: close doors behind you — he has to stop and open them.', tip_go_2: 'Tip: switch your flashlight off in the dark. He notices light from far away.', tip_go_3: 'Tip: crouch behind tall furniture to break his line of sight.', tip_go_4: 'Tip: hold your breath (Space / Shift) while he checks your locker.',
    end_label: 'ENDING', btn_again: 'Play again',
    intro_1: 'Room 1-A. Detention. 7:52 PM.', intro_2: 'Everyone left hours ago. The bell rang… and then the lights died.', intro_3: 'Mr. Karim used to be the kindest teacher in this school. That was before Layla.',
    sub_intro: 'Hello…? Is anyone still here?', game_loaded: 'Progress loaded.',
    no_flash: 'You have no flashlight yet.', no_battery: 'The batteries are dead.', battery_dead: 'The flashlight died. Find batteries!', tip_flash: 'Press F to toggle the flashlight. Batteries drain only while it is on.',
    pick_up: 'Pick up {name}', hide: 'Hide', exit_hide: 'Leave hiding place', pull_book: 'Pull the red book', insert_fuses: 'Insert fuses', fusebox_need: 'Fuse box — {n} fuse(s) missing', overload: 'Overload the boiler (dangerous!)', examine_clock: 'Examine the clock',
    sub_clock: 'The clock is frozen at 3:47. It has been dead for a long time.',
    use_key: 'Unlock', locked: 'Locked', enter_code: 'Enter code', open_door: 'Open', close_door: 'Close', open_exit: 'Open the main doors',
    locked_need: 'Locked — requires: {name}', unlocked_with: 'Unlocked with {name}', locked_power: 'Magnetic lock — no power.',
    it_flashlight: 'Flashlight', it_battery: 'Battery', it_fuse: 'Fuse', it_medkit: 'First-aid kit', it_ring: "Layla's wedding ring", it_library_key: 'Library key', it_lab_key: 'Laboratory key', it_basement_key: 'Basement key', it_main_key: 'Main gate key',
    got_flash: 'You found a flashlight!', got_battery: 'Battery +45%', got_item: 'Picked up: {name}', got_fuse: 'Fuse collected ({n}/2)', got_medkit: 'Health restored.', sub_ring: 'It is still warm… as if someone just took it off.',
    board_run: "DON'T RUN|STAY AFTER CLASS", sub_board: 'The blackboard… someone just wrote that.', sub_janitor: 'The door slammed. Something is awake in the dark.',
    secret_open: 'A hidden passage opens behind the shelf!', sub_secret_open: 'Layla’s secret reading room…', power_on: 'Power restored. A lock clicked open deep below.', sub_power: 'Somewhere below, a heavy door unlocked. A music box begins to play.',
    overload_title: 'The boiler', overload_text: 'Overloading it will burn the school and everything in it — the evidence, the secrets, maybe him. You will have 2 minutes to get out. There is no undoing it.', opt_overload: 'Turn the valve', opt_cancel: 'Step back', fire_started: 'The boiler is overloading! Get out!', sub_fire: 'Run! The whole building is shaking!',
    exit_unlocked: 'The chains fall away.', exit_title: 'The main doors', exit_text: 'Cold night air seeps through the crack. Behind you, the school waits. What will you do?', exit_text_fire: 'Smoke pours through the corridors behind you. There is no time to turn back.', opt_leave: 'Leave the school', opt_return_ring: 'Go back and return the ring to Mr. Karim', opt_wait: 'Not yet…',
    mercy_title: 'His hands close around you…', mercy_text: 'You know what happened to Layla. You have her ring. This may be your only chance to reach him.', opt_give_ring: 'Hold out the ring', opt_refuse: 'Struggle',
    alarm: 'The alarm is screaming — he knows!', sub_rage: 'The alarm wakes the whole school. He is coming for the key!',
    sub_lab: 'Glass shattering… the lights died.', sub_piano: 'A piano key sinks down by itself.', sub_mirror: 'The mirror is covered with writing you can’t read.', sub_basement: 'Layla… Layla… Layla…', sub_secret: 'A music box plays softly. This was her room.', sub_shrine: 'Candles. Photographs. A bed made for someone who never came back.', sub_library: 'Dust. Silence. Someone was reading here very recently.', sub_office: 'The principal’s office. Papers everywhere.', sub_archive: 'Locked records. Someone wanted these forgotten.',
    sub_slam: 'A figure stands at the end of the corridor.',
    hold_breath_now: 'He is checking your hiding place — HOLD YOUR BREATH!', breath_hint: 'Hold Space / Shift / run button to hold your breath', breath_now: 'HE IS NEAR — HOLD YOUR BREATH!', pf_pass: '…Nothing here.',
    pl_1: 'Layla… where are you?', pl_2: 'Nobody opened the door…', pl_3: 'Class is not over.', pl_4: 'I can hear you breathing, child.', pl_5: 'Quiet. She is sleeping.', pl_6: 'Why did no one help her?',
    pc_1: 'THERE you are!', pc_2: 'Detention is not over!', pc_3: 'Stay for the lesson!', pc_4: 'Do not run from me!', pf_1: 'Where did you go…', pf_2: 'I will find you…', pf_3: 'Hide, hide… the bell has not rung.',
    ob_flash: 'Find a light source in this classroom.', ob_library_key: 'Find the Library key — check the other classrooms.', ob_open_library: 'Open the Library door.', ob_secret: 'The library hides a secret. Read the notes and look for something that doesn’t belong.',
    ob_lab_key: 'Search the secret study for the lab key.', ob_open_lab: 'Open the Science Laboratory.', ob_code: 'Open the Principal’s office. The code is hidden in the story… and in the corridor.', ob_basement_key: 'Find the basement key in the Principal’s office.',
    ob_open_stairs: 'Open the stairwell door to the basement.', ob_fuses: 'Collect two fuses ({n}/2) — laboratory, janitor’s room.', ob_fusebox: 'Insert the fuses into the basement fuse box.', ob_shrine: 'Power is back. Find what was unlocked in the basement.',
    ob_exit: 'Get to the main doors at the front hall. Avoid him!', ob_fire: 'GET OUT BEFORE THE BOILER EXPLODES!',
    ms_flash: 'Find the flashlight', ms_library: 'Open the library', ms_secret: 'Discover the hidden study', ms_lab: 'Open the laboratory', ms_office: 'Crack the Principal’s code', ms_stairs: 'Open the basement stairwell', ms_power: 'Restore power', ms_key: 'Take the main gate key',
    room_class1a: 'Classroom 1-A', room_class2b: 'Classroom 2-B', room_class3c: 'Classroom 3-C', room_library: 'Library', room_lab: 'Science Lab', room_corridor1: 'North Corridor', room_hall: 'Entrance Hall', room_lounge: 'Teachers’ Lounge', room_office: 'Principal’s Office', room_nurse: 'Nurse’s Office', room_janitor: 'Janitor’s Room', room_stairs: 'Stairwell', room_corridor2: 'South Corridor', room_cafeteria: 'Cafeteria', room_restroom: 'Restroom', room_music: 'Music Room', room_art: 'Art Room', room_secret1: 'Secret Study', room_bcorr: 'Basement Corridor', room_electrical: 'Electrical Room', room_boiler: 'Boiler Room', room_archive: 'Archive', room_storage: 'Storage', room_maint: 'Maintenance', room_shrine: 'The Shrine',
    note_slip_t: 'Detention slip', note_slip_b: 'Student: Omar\nReason: late to class (again)\nDetention: Room 1-A until 7:00 PM\n— Mr. Karim\n\n(in the corner, in different handwriting)\n“Don’t stay after the bell.”',
    note_d1_t: 'Diary — page 1', note_d1_b: 'September.\nLayla brought a cake to the staff room today. She laughed so loudly the whole corridor heard her.\nTwelve years of teaching, and I never felt as lucky as when she walks through those doors. The children adore her — the nurse who never says no to a scraped knee.',
    note_d2_t: 'Diary — page 2', note_d2_b: 'November.\nLayla says the lab smells of gas again. She told the principal three times. “After the exams,” he said.\nI told her to stay away from that lab. She only smiled: “Karim, someone has to take care of the children.”',
    note_d3_t: 'Diary — page 3', note_d3_b: 'Layla loved the library more than anyone. She kept a hidden reading room behind the north shelf.\nOnly one book on those shelves has a red spine — the one she called “the only honest book”. Pull it, and the wall remembers her.',
    note_d4_t: 'Diary — page 4', note_d4_b: 'March.\nThe doors to the labs were locked because of “detention policy”. Layla was inside when it happened.\nThe students in detention heard her knocking. Nobody was allowed to open the door.\nHer lab key lies here. I can’t bear to look at it.',
    note_d5_t: 'Lab log & a note', note_d5_b: 'LOG: gas line reading above safe limits — reported 3 times — ignored.\n\nUnderneath, in Karim’s handwriting:\n“I stopped the corridor clock at the minute she died. I will never let it move again. That hour opens every lock I own.”',
    note_d6_t: 'Principal’s memo', note_d6_b: 'CONFIDENTIAL.\nThe lab incident will be recorded as a “student prank”. Mr. Karim must not see the original report.\nSeal the basement archive. Nobody enters without my key.\nThe school’s reputation comes first.',
    note_d7_t: 'Incident report (original)', note_d7_b: 'Cause: neglected gas line. Warnings ignored by the administration.\nVictim: L. Karim, school nurse. Time of death: 3:47 PM.\nThe lab doors were locked from the outside under the detention policy. Students heard her calling for help.\nThis report has been removed from the official file.',
    note_d8_t: 'Karim’s letter', note_d8_b: 'To whoever stayed late —\nI do not hate you, child. I hate the silence of that afternoon. Nobody opened the door.\nHer ring is on the altar. If you ever understand… put it in my hand, and I will let go.\nThe key to the front doors is there too. Take it and go. Or forgive me.',
    end_escape_t: 'THE LONG NIGHT', end_escape_b: 'You shoulder the chained doors open and the cold night air hits your face. Behind you the school falls silent — but somewhere inside, a man is still waiting for an answer.',
    end_escape_truth: 'You know what really happened in that lab. One day you will tell the world, and maybe Layla will finally be heard.', end_escape_blind: 'You never learned why he did all this. Maybe nobody ever will.',
    end_peace_t: 'FAREWELL, LAYLA', end_peace_b: 'You turn around and hold out the ring. The footsteps stop. For the first time the red glow in his eyes fades, and a tired old teacher looks at his wife’s ring.\n“Thank you,” he whispers.\nThe lights come back on. The bell rings. The doors open by themselves. It is only a school again.',
    end_fire_t: 'ASHES', end_fire_b: 'The boiler tears through the foundations. Fire runs through the corridors, the archive, the shrine — every secret, every lie. You watch the school burn from the street as the sirens come.',
    end_fire_truth: 'You know the truth, and now the evidence is gone. Will anyone believe you?', end_fire_blind: 'You never learned what the fire destroyed. Maybe it was better that way.',
  },
  ar: {
    loading: 'جارٍ التحميل…', load_init: 'تشغيل محرك الرسومات…', load_rooms: 'بناء المدرسة…', load_doors: 'تركيب الأبواب…', load_furniture: 'ترتيب المقاعد والخزائن والظلال…', load_lights: 'توصيل الأضواء المتقطعة…', load_items: 'إخفاء المفاتيح والأسرار…', load_nav: 'تعليم الأستاذ ممرات المدرسة…', load_done: 'جاهز',
    tagline: 'الاحتجاز لا ينتهي. الأستاذ كريم ما زال يُدرّس… ويبحث عن الطالب الذي بقي خلف الجرس.',
    btn_continue: 'متابعة', btn_new: 'لعبة جديدة', btn_settings: 'الإعدادات', btn_controls: 'التحكم والنصائح', btn_fullscreen: '⛶ ملء الشاشة', btn_back: 'رجوع', btn_close: 'إغلاق',
    endings_found: 'النهايات المكتشفة: {n} / {total}',
    pause_title: 'إيقاف مؤقت', btn_resume: 'متابعة اللعب', btn_journal: 'المفكرة والخريطة', btn_checkpoint: 'العودة لآخر نقطة حفظ', btn_quit: 'حفظ والخروج للقائمة',
    set_title: 'الإعدادات', set_graphics: 'الرسومات', set_quality: 'جودة الرسومات', q_low: 'منخفضة (للأجهزة الضعيفة)', q_med: 'متوسطة', q_high: 'عالية', q_ultra: 'فائقة',
    set_shadow: 'حجم ظلال المصباح', sh_auto: 'تلقائي (حسب الجودة)', sh_off: 'إيقاف', sh_low: 'منخفض · 512', sh_med: 'متوسط · 1024', sh_high: 'عالٍ · 2048',
    set_res: 'مقياس الدقة', set_fov: 'زاوية الرؤية', set_autoq: 'دقة تكيفية (تثبيت الإطارات)', set_grain: 'حبيبات الفيلم', set_fps: 'عرض الإطارات / نداءات الرسم',
    set_reload_hint: 'حجم التركيبات ونوع المواد يتغيران بعد إعادة تحميل الصفحة.', set_audio: 'الصوت', set_master: 'الصوت العام', set_music: 'الموسيقى والأجواء', set_sfx: 'المؤثرات الصوتية', set_voice: 'همسات الأستاذ (تحويل النص لكلام)',
    set_gameplay: 'اللعب', set_diff: 'الصعوبة', d_easy: 'سهل', d_normal: 'عادي', d_hard: 'صعب', set_sens: 'حساسية الكاميرا', set_invert: 'عكس المحور العمودي', set_subs: 'الترجمة النصية', set_touch: 'أزرار اللمس على الشاشة', set_lang: 'اللغة', set_data: 'البيانات المحفوظة', btn_erase: 'مسح كل البيانات',
    erase_confirm: 'هل تريد مسح اللعبة المحفوظة والنهايات والإعدادات؟', new_confirm: 'بدء لعبة جديدة سيستبدل تقدمك المحفوظ. هل تريد المتابعة؟',
    ctl_title: 'التحكم والنصائح', ctl_pc: 'الكيبورد والماوس', ctl_move: 'الحركة', ctl_look: 'تحريك الكاميرا', ctl_run: 'الركض (يستهلك التحمل) / كتم النفس', ctl_crouch: 'الانحناء (تبديل)', ctl_jump: 'القفز / كتم النفس أثناء الاختباء', ctl_interact: 'تفاعل: فتح، التقاط، اختباء', ctl_light: 'تشغيل/إطفاء المصباح', ctl_journal: 'المفكرة', ctl_map: 'الخريطة', ctl_pause: 'إيقاف مؤقت',
    ctl_mobile: 'اللمس (شاشة أفقية)', ctl_m1: 'الإبهام الأيسر: عصا تحكم افتراضية للحركة.', ctl_m2: 'الجهة اليمنى: اسحب لتحريك الكاميرا. الأزرار: تفاعل، قفز، انحناء، ركض، مصباح.', ctl_m3: 'أثناء الاختباء اضغط مطولًا على زر القفز أو الركض لكتم النفس.',
    ctl_tips: 'نصائح للنجاة', tip1: 'يسمع الركض والأبواب والرموز الخاطئة. امشِ أو انحنِ عندما يكون قريبًا.', tip2: 'ضوء المصباح يُرى من بعيد. أطفئه في الممرات المظلمة عندما يقترب.', tip3: 'انحنِ خلف الخزائن والرفوف لقطع خط نظره.', tip4: 'اختبئ في الخزائن — لكن إن رآك تدخل سيأتي إليك. اكتم نفسك أثناء تفتيشه.',
    jr_title: 'المفكرة', jr_obj: 'المهام', jr_notes: 'الملاحظات', jr_map: 'الخريطة', map_hint: 'تظهر الغرف التي زرتها فقط. المربعات الحمراء أبواب مقفلة. ساعة الممر تتذكّر.', jr_items: 'الأغراض', jr_pages: 'صفحات اليوميات {n}/{max}', jr_no_notes: 'لم تعثر على أي ملاحظات بعد.', map_ground: 'الطابق الأرضي', map_basement: 'القبو',
    hp: 'الصحة', stamina: 'التحمل', battery: 'البطارية', objective: 'المهمة', aware: 'ينتبه إليك', tb_act: 'تفاعل', rotate_msg: 'من فضلك أدِر جهازك إلى الوضع الأفقي.',
    kp_title: 'لوحة الأرقام', kp_hint: 'أدخل الرمز المكوّن من 4 أرقام.', kp_ok: 'تم السماح بالدخول', kp_bad: 'رمز خاطئ — كان الصوت عاليًا!',
    go_title: 'لقد متّ', go_caught: 'وجدك الأستاذ كريم. المدرسة تحتفظ بأسرارها — والآن تحتفظ بك أيضًا.', go_explosion: 'انفجار الغلاية ابتلع القبو بأكمله.', btn_retry: 'إعادة من نقطة الحفظ', btn_restart: 'إعادة القصة من البداية', btn_menu: 'القائمة الرئيسية',
    tip_go_1: 'نصيحة: أغلق الأبواب خلفك — سيضطر للتوقف وفتحها.', tip_go_2: 'نصيحة: أطفئ المصباح في الظلام. هو يلاحظ الضوء من بعيد.', tip_go_3: 'نصيحة: انحنِ خلف الأثاث العالي لقطع خط نظره.', tip_go_4: 'نصيحة: اكتم نفسك (مسافة / Shift) أثناء تفتيشه للخزانة.',
    end_label: 'النهاية', btn_again: 'العب مرة أخرى',
    intro_1: 'الصف 1-أ. الاحتجاز. 7:52 مساءً.', intro_2: 'غادر الجميع منذ ساعات. رنّ الجرس… ثم انطفأت الأنوار.', intro_3: 'كان الأستاذ كريم أطيب معلم في هذه المدرسة. كان ذلك قبل ليلى.',
    sub_intro: 'مرحبًا…؟ هل ما زال أحد هنا؟', game_loaded: 'تم تحميل التقدم.',
    no_flash: 'ليس لديك مصباح بعد.', no_battery: 'البطاريات فارغة.', battery_dead: 'انطفأ المصباح. ابحث عن بطاريات!', tip_flash: 'اضغط F لتشغيل/إطفاء المصباح. البطارية لا تنفد إلا وهو مضاء.',
    pick_up: 'التقاط {name}', hide: 'اختباء', exit_hide: 'الخروج من مخبئك', pull_book: 'اسحب الكتاب الأحمر', insert_fuses: 'تركيب الفيوزات', fusebox_need: 'صندوق الفيوزات — ينقصه {n} فيوز', overload: 'إفراط ضغط الغلاية (خطر!)', examine_clock: 'فحص الساعة',
    sub_clock: 'الساعة متوقفة عند 3:47. ماتت منذ زمن طويل.',
    use_key: 'فتح القفل', locked: 'مقفل', enter_code: 'إدخال الرمز', open_door: 'فتح', close_door: 'إغلاق', open_exit: 'فتح البوابة الرئيسية',
    locked_need: 'مقفل — يتطلب: {name}', unlocked_with: 'تم الفتح بواسطة {name}', locked_power: 'قفل مغناطيسي — لا توجد كهرباء.',
    it_flashlight: 'المصباح اليدوي', it_battery: 'بطارية', it_fuse: 'فيوز', it_medkit: 'حقيبة إسعاف', it_ring: 'خاتم زواج ليلى', it_library_key: 'مفتاح المكتبة', it_lab_key: 'مفتاح المختبر', it_basement_key: 'مفتاح القبو', it_main_key: 'مفتاح البوابة الرئيسية',
    got_flash: 'وجدت مصباحًا يدويًا!', got_battery: 'بطارية +45%', got_item: 'تم التقاط: {name}', got_fuse: 'تم جمع فيوز ({n}/2)', got_medkit: 'تمت استعادة الصحة.', sub_ring: 'ما زال دافئًا… وكأن أحدهم خلعه للتو.',
    board_run: 'لا تهرب|ابقَ بعد الدرس', sub_board: 'السبّورة… شخص ما كتب هذا للتو.', sub_janitor: 'انغلق الباب بعنف. شيء ما استيقظ في الظلام.',
    secret_open: 'ممر مخفي ينفتح خلف الرف!', sub_secret_open: 'غرفة القراءة السرية لليلى…', power_on: 'عادت الكهرباء. قفل ما انفتح في الأعماق.', sub_power: 'في مكان ما في الأسفل انفتح باب ثقيل. وبدأ صندوق موسيقى يعزف.',
    overload_title: 'الغلاية', overload_text: 'إفراط ضغطها سيحرق المدرسة وكل ما فيها — الأدلة والأسرار وربما هو أيضًا. سيكون أمامك دقيقتان للخروج. لا رجعة بعد ذلك.', opt_overload: 'أدِر الصمام', opt_cancel: 'تراجع', fire_started: 'الغلاية تنفجر! اهرب!', sub_fire: 'اركض! المبنى كله يهتز!',
    exit_unlocked: 'سقطت السلاسل.', exit_title: 'البوابة الرئيسية', exit_text: 'هواء الليل البارد يتسلل من الشق. وخلفك تنتظر المدرسة. ماذا ستفعل؟', exit_text_fire: 'الدخان يملأ الممرات خلفك. لا وقت للعودة.', opt_leave: 'اترك المدرسة', opt_return_ring: 'ارجع وسلّم الخاتم للأستاذ كريم', opt_wait: 'ليس بعد…',
    mercy_title: 'يداه تطبقان عليك…', mercy_text: 'أنت تعرف ما حدث لليلى. ومعك خاتمها. قد تكون هذه فرصتك الوحيدة للوصول إليه.', opt_give_ring: 'مدّ الخاتم إليه', opt_refuse: 'قاوِم',
    alarm: 'جرس الإنذار يصرخ — لقد عرف!', sub_rage: 'الإنذار أيقظ المدرسة كلها. إنه قادم من أجل المفتاح!',
    sub_lab: 'زجاج يتحطم… انطفأت الأنوار.', sub_piano: 'مفتاح بيانو يغوص وحده.', sub_mirror: 'المرآة مغطاة بكتابة لا تستطيع قراءتها.', sub_basement: 'ليلى… ليلى… ليلى…', sub_secret: 'صندوق موسيقى يعزف بهدوء. هذه كانت غرفتها.', sub_shrine: 'شموع. صور. سرير مرتب لشخص لم يعد أبدًا.', sub_library: 'غبار. صمت. أحدهم كان يقرأ هنا منذ وقت قريب جدًا.', sub_office: 'مكتب المدير. أوراق في كل مكان.', sub_archive: 'سجلات مقفلة. أحدهم أراد نسيانها.',
    sub_slam: 'شبح يقف في نهاية الممر.',
    hold_breath_now: 'إنه يفتّش مخبأك — اكتم نفسك!', breath_hint: 'اضغط مسافة / Shift / زر الركض لكتم النفس', breath_now: 'إنه قريب — اكتم نفسك!', pf_pass: '…لا شيء هنا.',
    pl_1: 'ليلى… أين أنتِ؟', pl_2: 'لم يفتح أحد الباب…', pl_3: 'الحصة لم تنتهِ بعد.', pl_4: 'أسمع أنفاسك يا بُني.', pl_5: 'اهدأوا. إنها نائمة.', pl_6: 'لماذا لم يساعدها أحد؟',
    pc_1: 'ها أنت هنا!', pc_2: 'الاحتجاز لم ينتهِ!', pc_3: 'ابقَ للدرس!', pc_4: 'لا تهرب مني!', pf_1: 'إلى أين ذهبت…', pf_2: 'سأجدك…', pf_3: 'اختبئ، اختبئ… الجرس لم يرنّ بعد.',
    ob_flash: 'ابحث عن مصدر ضوء في هذا الصف.', ob_library_key: 'ابحث عن مفتاح المكتبة — تفقّد الصفوف الأخرى.', ob_open_library: 'افتح باب المكتبة.', ob_secret: 'المكتبة تخفي سرًا. اقرأ الملاحظات وابحث عن شيء لا ينتمي للمكان.',
    ob_lab_key: 'فتّش الغرفة السرية عن مفتاح المختبر.', ob_open_lab: 'افتح مختبر العلوم.', ob_code: 'افتح مكتب المدير. الرمز مخبّأ في القصة… وفي الممر.', ob_basement_key: 'اعثر على مفتاح القبو في مكتب المدير.',
    ob_open_stairs: 'افتح باب السلم المؤدي إلى القبو.', ob_fuses: 'اجمع فيوزين ({n}/2) — المختبر، غرفة الحارس.', ob_fusebox: 'ركّب الفيوزات في صندوق الكهرباء بالقبو.', ob_shrine: 'عادت الكهرباء. ابحث عمّا انفتح في القبو.',
    ob_exit: 'اذهب إلى البوابة الرئيسية في بهو المدخل. وتجنّبه!', ob_fire: 'اخرج قبل أن تنفجر الغلاية!',
    ms_flash: 'العثور على المصباح', ms_library: 'فتح المكتبة', ms_secret: 'اكتشاف الغرفة السرية', ms_lab: 'فتح المختبر', ms_office: 'كسر رمز المدير', ms_stairs: 'فتح سلم القبو', ms_power: 'إعادة الكهرباء', ms_key: 'أخذ مفتاح البوابة',
    room_class1a: 'الصف 1-أ', room_class2b: 'الصف 2-ب', room_class3c: 'الصف 3-ج', room_library: 'المكتبة', room_lab: 'مختبر العلوم', room_corridor1: 'الممر الشمالي', room_hall: 'بهو المدخل', room_lounge: 'غرفة المعلمين', room_office: 'مكتب المدير', room_nurse: 'عيادة الممرضة', room_janitor: 'غرفة الحارس', room_stairs: 'السلم', room_corridor2: 'الممر الجنوبي', room_cafeteria: 'الكافتيريا', room_restroom: 'دورة المياه', room_music: 'غرفة الموسيقى', room_art: 'غرفة الفنون', room_secret1: 'الغرفة السرية', room_bcorr: 'ممر القبو', room_electrical: 'غرفة الكهرباء', room_boiler: 'غرفة الغلاية', room_archive: 'الأرشيف', room_storage: 'المخزن', room_maint: 'الصيانة', room_shrine: 'المقام',
    note_slip_t: 'ورقة احتجاز', note_slip_b: 'الطالب: عمر\nالسبب: التأخر عن الحصة (مرة أخرى)\nالاحتجاز: الصف 1-أ حتى السابعة مساءً\n— الأستاذ كريم\n\n(في الزاوية، بخط مختلف)\n«لا تبقَ بعد الجرس.»',
    note_d1_t: 'اليوميات — صفحة 1', note_d1_b: 'سبتمبر.\nأحضرت ليلى كعكة إلى غرفة المعلمين اليوم. ضحكت بصوت عالٍ حتى سمعها الممر كله.\nاثنتا عشرة سنة في التدريس، ولم أشعر يومًا بحظٍّ كحظي حين تدخل من ذلك الباب. الأطفال يعشقونها — الممرضة التي لا تقول «لا» لركبة مجروحة.',
    note_d2_t: 'اليوميات — صفحة 2', note_d2_b: 'نوفمبر.\nتقول ليلى إن رائحة الغاز تفوح من المختبر مجددًا. أبلغت المدير ثلاث مرات. قال: «بعد الامتحانات».\nطلبت منها ألا تقترب من ذلك المختبر. ابتسمت فقط: «كريم، لا بد أن يعتني أحدٌ بالأطفال».',
    note_d3_t: 'اليوميات — صفحة 3', note_d3_b: 'أحبّت ليلى المكتبة أكثر من أي شخص. كان لها غرفة قراءة مخفية خلف الرف الشمالي.\nكتاب واحد فقط على تلك الرفوف له غلاف أحمر — الذي كانت تسميه «الكتاب الصادق الوحيد». اسحبه، فيتذكّرها الجدار.',
    note_d4_t: 'اليوميات — صفحة 4', note_d4_b: 'مارس.\nأُقفلت أبواب المختبرات بسبب «سياسة الاحتجاز». كانت ليلى بالداخل حين وقع ما وقع.\nسمع الطلاب المحتجزون طرقها على الباب. لم يُسمح لأحد بفتحه.\nمفتاح مختبرها هنا. لا أحتمل النظر إليه.',
    note_d5_t: 'سجل المختبر وملاحظة', note_d5_b: 'السجل: قراءة خط الغاز فوق الحد الآمن — تم الإبلاغ 3 مرات — تم التجاهل.\n\nوتحته بخط كريم:\n«أوقفتُ ساعة الممر عند الدقيقة التي ماتت فيها. لن أسمح لها بالحركة أبدًا. تلك الساعة تفتح كل قفل أملكه.»',
    note_d6_t: 'مذكرة المدير', note_d6_b: 'سري.\nسيُسجَّل حادث المختبر على أنه «مقلب طلابي». يجب ألا يرى الأستاذ كريم التقرير الأصلي.\nأغلقوا أرشيف القبو. لا يدخله أحد دون مفتاحي.\nسمعة المدرسة أولًا.',
    note_d7_t: 'تقرير الحادث (الأصلي)', note_d7_b: 'السبب: خط غاز مهمل. تحذيرات تجاهلتها الإدارة.\nالضحية: ل. كريم، ممرضة المدرسة. وقت الوفاة: 3:47 مساءً.\nأُقفلت أبواب المختبر من الخارج بموجب سياسة الاحتجاز. سمع الطلاب استغاثتها.\nتم سحب هذا التقرير من الملف الرسمي.',
    note_d8_t: 'رسالة كريم', note_d8_b: 'إلى من بقي متأخرًا —\nلا أكرهك يا بُني. أكره صمت ذلك العصر. لم يفتح أحد الباب.\nخاتمها على المذبح. إن فهمتَ يومًا… ضعه في يدي، وسأترك كل شيء.\nومفتاح البوابة الرئيسية هناك أيضًا. خذه وارحل. أو سامحني.',
    end_escape_t: 'الليلة الطويلة', end_escape_b: 'تدفع البوابة المكبّلة بكتفك، ويضرب هواء الليل البارد وجهك. خلفك تصمت المدرسة — لكن في مكان ما بالداخل، ما زال رجل ينتظر جوابًا.',
    end_escape_truth: 'تعرف ما حدث حقًا في ذلك المختبر. ذات يوم ستخبر العالم، وربما تُسمَع ليلى أخيرًا.', end_escape_blind: 'لم تعرف أبدًا لماذا فعل كل هذا. ربما لن يعرف أحد أبدًا.',
    end_peace_t: 'وداعًا يا ليلى', end_peace_b: 'تستدير وتمدّ الخاتم. تتوقف الخطوات. وللمرة الأولى يخبو الوهج الأحمر في عينيه، ويحدّق معلّم عجوز متعب في خاتم زوجته.\n«شكرًا لك» يهمس.\nتعود الأنوار. يرنّ الجرس. تنفتح الأبواب وحدها. وتصير المدرسة مجرد مدرسة من جديد.',
    end_fire_t: 'رماد', end_fire_b: 'تمزّق الغلاية الأساسات. تركض النيران في الممرات والأرشيف والمقام — كل سرّ وكل كذبة. تشاهد المدرسة تحترق من الشارع بينما تقترب صفارات الإنذار.',
    end_fire_truth: 'تعرف الحقيقة، والآن اختفت الأدلة. هل سيصدّقك أحد؟', end_fire_blind: 'لم تعرف أبدًا ما الذي أحرقته النيران. ربما كان ذلك أفضل.',
  },
};

/* merge extra language packs + legendary strings */
Object.keys(EXTRA_LANGS || {}).forEach((code) => { STR[code] = Object.assign({}, EXTRA_LANGS[code]); });
Object.keys(LEGEND_STRINGS || {}).forEach((code) => { STR[code] = Object.assign(STR[code] || {}, LEGEND_STRINGS[code]); });
if (STR[S.lang]) LANG = S.lang;

/* =====================================================================
   10b. MAIN LOOP, MENU BACKDROP, BOOT
   ===================================================================== */
let lastT = performance.now();
function menuUpdate(dt) {
  const tm = G.time;
  scene.fog.density = 0.032;
  camera.position.set(7 + Math.sin(tm * 0.11) * 1.8 + Math.min(4, tm * 0.04 % 6), 1.55 + Math.sin(tm * 0.5) * 0.015, 12.9 + Math.sin(tm * 0.17) * 0.5);
  camera.lookAt(40, 1.75, 13 + Math.sin(tm * 0.09) * 0.8);
  flashlight.intensity = 0;
  updatePooledLights(dt, tm, camera.position);
  prof.updateVisual(dt, 0); prof.yaw = -Math.PI / 2 + Math.sin(tm * 0.2) * 0.1;
  FX.update(dt);
  audio.update(dt, { tension: 0.15, chase: false, playing: false, pos: camera.position, zone: 'school' });
}
const Pad = {
  idx: null, prev: {}, rumbleT: 0,
  poll(dt) {
    if (!S.pad || !navigator.getGamepads) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) { if (p && p.connected) { gp = p; break; } }
    if (!gp) { if (this.idx !== null) { this.idx = null; G.padName = ''; } return; }
    if (this.idx !== gp.index) { this.idx = gp.index; G.padName = gp.id.slice(0, 28); UI.toast(t('pad_connected', { name: G.padName }), 'good'); }
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    const ax = gp.axes || [];
    if (G.state === 'playing' && !G.modal) {
      Input.joyX = dz(ax[0] || 0); Input.joyY = -dz(ax[1] || 0);
      const lookScale = 10 * (S.sens / 100) * (dt * 60);
      Input.lookDX += dz(ax[2] || 0) * lookScale; Input.lookDY += dz(ax[3] || 0) * lookScale;
    }
    const b = gp.buttons || [];
    const down = (i) => !!(b[i] && b[i].pressed);
    const edge = (i, act) => { const now = down(i); if (now && !this.prev[i]) { if (G.state === 'playing' || act === 'pause') Input.press(act); } this.prev[i] = now; };
    edge(0, 'jump'); edge(1, 'crouch'); edge(2, 'interact'); edge(3, 'flash');
    edge(4, 'throw'); edge(6, 'barricade'); edge(8, 'journal'); edge(9, 'pause');
    Input.touchRun = down(5) || down(7);
    Input.touchBreath = down(0);
    // vibration scales with fear / chase
    this.rumbleT -= dt;
    if (this.rumbleT <= 0 && gp.vibrationActuator && G.state === 'playing' && !S.safe) {
      this.rumbleT = 0.5;
      const str = G.chase ? 0.5 : (G.tension > 0.4 ? 0.18 : 0);
      if (str > 0) { try { gp.vibrationActuator.playEffect('dual-rumble', { duration: 420, weakMagnitude: str, strongMagnitude: str * 0.7 }); } catch (e) { /* ignore */ } }
    }
  },
};

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0001, (now - lastT) / 1000)); lastT = now;
  G.time += dt;
  Pad.poll(dt);
  // global key actions
  if (Input.consume('pause')) {
    if (G.modal) UI.closeModal();
    else if (G.state === 'playing') UI.pause(true);
  }
  if (G.state === 'playing') {
    if (Input.consume('journal')) { if (G.modal === 'journal') UI.closeModal(); else if (!G.modal) UI.openJournal('obj'); }
    if (Input.consume('map')) { if (G.modal === 'journal') UI.closeModal(); else if (!G.modal) UI.openJournal('map'); }
    if (G.modal === 'note' && Input.consume('interact')) UI.closeModal();
  }
  try {
    switch (G.state) {
      case 'playing':
        if (!G.modal) { Game.update(dt); } else if (G.modal === 'journal' || G.modal === 'note') { /* world frozen while reading */ }
        break;
      case 'menu': menuUpdate(dt); break;
      case 'dead': prof.updateVisual(dt, 0, { idle: 1 }); G.shake = Math.max(0, G.shake - dt); break;
      default: break;
    }
    if (G.state === 'playing' || G.state === 'dead') {
      if (G.state === 'playing') { audio.setListener(camera.position, player.camFwd); }
      const inBase = player.pos.y < -2;
      audio.update(dt, { tension: G.state === 'dead' ? 0 : G.tension, chase: G.chase, playing: G.state === 'playing' && !G.modal, pos: player.pos, zone: inBase ? 'basement' : 'school' });
      const tmr = G.time; updatePooledLights(dt, tmr, G.state === 'playing' ? player.pos : camera.position);
    }
    renderer.render(scene, camera);
  } catch (err) {
    console.error(err); if (!frame.errShown) { frame.errShown = true; UI.toast('⚠ ' + (err && err.message ? err.message : err), 'warn'); }
  }
  UI.perf(dt);
}

async function boot() {
  applyStaticI18n();
  const bar = $('#loading-bar'), txt = $('#loading-text');
  const prog = (p, key) => { bar.style.width = Math.round(p * 100) + '%'; txt.textContent = t(key); };
  try {
    prog(0.02, 'load_init');
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WEBGL');
    initRenderer(); await nextFrame();
    setupLights(); buildTextures(); buildMaterials(); applyQuality();
    player = new Player(); prof = new Professor();          // characters first (they only need textures/materials)
    await buildLevel((p, k) => prog(0.05 + p * 0.9, k));
    Game.init(); FX.init(); UI.bindSettings(); UI.bind(); UI.buildLanguage(); initInput(); audio.setVolumes(S); UI.buildArchive();
    canvasEl.addEventListener('webglcontextlost', (e) => { e.preventDefault(); UI.toast('WebGL context lost — reloading…', 'warn'); setTimeout(() => location.reload(), 1500); });
    $('#fps').classList.toggle('hidden', !S.fps);
    document.documentElement.classList.toggle('safe-mode', !!S.safe);
    prog(1, 'load_done'); await new Promise((r) => setTimeout(r, 250));
    UI.showMenu(); resize();
    requestAnimationFrame(frame);
    window.DARK_SCHOOL_DEBUG = { Codex, Pad, get renderer() { return renderer; }, get lang() { return LANG; }, LANGS, Achv, ACH_LIST, FX, get sanity() { return G.sanity; }, G, Input, Game, World, S, UI, audio, THREE, scene, camera, get player() { return player; }, get prof() { return prof; }, findPath, NAV, R };
  } catch (err) {
    console.error(err);
    const e = $('#loading-error'); e.classList.remove('hidden');
    e.textContent = err && err.message === 'WEBGL' ? (LANG === 'ar' ? 'متصفحك لا يدعم WebGL. جرّب متصفحًا حديثًا أو فعّل تسريع العتاد.' : 'Your browser does not support WebGL. Try a modern browser or enable hardware acceleration.') : ('Error: ' + (err && err.message ? err.message : err));
  }
}
boot();











