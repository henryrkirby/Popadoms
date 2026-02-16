/**
 * soundManager.js — Audio system using Howler.js + Web Audio synthesis.
 *
 * Generates procedural audio buffers at init (crack, snap, crinkle, thud, slide)
 * and plays them via Howler for robust cross-browser/mobile playback.
 *
 * Ambient restaurant atmosphere uses Web Audio oscillators (tanpura drone,
 * filtered noise murmur, tabla rhythm) layered under the Howler sounds.
 */

import { Howl } from "howler";

let initialized = false;
let sounds = {};
let ambientCtx = null;
let ambientNodes = null;

// ─── Procedural buffer generation ──────────────────────────────

function generateBuffer(sampleRate, duration, fillFn) {
  const length = Math.ceil(sampleRate * duration);
  const buffer = new Float32Array(length);
  fillFn(buffer, length, sampleRate);
  return buffer;
}

function floatToWav(samples, sampleRate) {
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length * 2, true);

  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

// ─── Sound generation ──────────────────────────────────────────

function generateCrackSound(sampleRate = 44100) {
  return generateBuffer(sampleRate, 0.08, (buf, len, sr) => {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const envelope = Math.exp(-t * 80);
      // Filtered noise burst with resonance
      const noise = (Math.random() * 2 - 1);
      const tone = Math.sin(t * 2400 * Math.PI * 2) * 0.3;
      buf[i] = (noise * 0.7 + tone) * envelope;
    }
  });
}

function generateSnapSound(sampleRate = 44100) {
  return generateBuffer(sampleRate, 0.04, (buf, len, sr) => {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const envelope = Math.exp(-t * 150);
      buf[i] = (Math.random() * 2 - 1) * envelope;
    }
  });
}

function generateCrinkleSound(sampleRate = 44100) {
  return generateBuffer(sampleRate, 0.06, (buf, len, sr) => {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const envelope = Math.exp(-t * 60) * (1 + Math.sin(t * 8000) * 0.5);
      buf[i] = (Math.random() * 2 - 1) * envelope * 0.5;
    }
  });
}

function generateThudSound(sampleRate = 44100) {
  return generateBuffer(sampleRate, 0.12, (buf, len, sr) => {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const freq = 90 * Math.exp(-t * 20);
      const envelope = Math.exp(-t * 30);
      buf[i] = Math.sin(t * freq * Math.PI * 2) * envelope * 0.8;
    }
  });
}

function generateSlideSound(sampleRate = 44100) {
  return generateBuffer(sampleRate, 0.1, (buf, len, sr) => {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const envelope = Math.exp(-t * 20) * 0.3;
      buf[i] = (Math.random() * 2 - 1) * envelope;
    }
  });
}

function generatePlaceSound(sampleRate = 44100) {
  return generateBuffer(sampleRate, 0.2, (buf, len, sr) => {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const freq = 400 + t * 800;
      const envelope = Math.sin(t / 0.2 * Math.PI) * 0.15;
      buf[i] = Math.sin(t * freq * Math.PI * 2) * envelope;
    }
  });
}

// ─── Init ──────────────────────────────────────────────────────

export function initAudio() {
  if (initialized) return;
  initialized = true;

  const sr = 44100;

  // Generate multiple crack variations for layering
  const crackUrls = Array.from({ length: 4 }, () =>
    floatToWav(generateCrackSound(sr), sr)
  );
  const snapUrls = Array.from({ length: 3 }, () =>
    floatToWav(generateSnapSound(sr), sr)
  );
  const crinkleUrls = Array.from({ length: 3 }, () =>
    floatToWav(generateCrinkleSound(sr), sr)
  );

  sounds = {
    cracks: crackUrls.map((url) => new Howl({ src: [url], volume: 0.4 })),
    snaps: snapUrls.map((url) => new Howl({ src: [url], volume: 0.3 })),
    crinkles: crinkleUrls.map((url) => new Howl({ src: [url], volume: 0.2 })),
    thud: new Howl({ src: [floatToWav(generateThudSound(sr), sr)], volume: 0.35 }),
    slide: new Howl({ src: [floatToWav(generateSlideSound(sr), sr)], volume: 0.15 }),
    place: new Howl({ src: [floatToWav(generatePlaceSound(sr), sr)], volume: 0.2 }),
  };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Playback API ──────────────────────────────────────────────

export function playCrackSound(intensity = 0.5, fragmentCount = 3) {
  if (!initialized) initAudio();

  // Main crack
  const crack = pickRandom(sounds.cracks);
  crack.volume(0.2 + intensity * 0.3);
  crack.rate(0.8 + Math.random() * 0.4);
  crack.play();

  // Layer crinkles for multiple fragments
  const crinkleCount = Math.min(fragmentCount, 4);
  for (let i = 0; i < crinkleCount; i++) {
    setTimeout(() => {
      const c = pickRandom(sounds.crinkles);
      c.volume(0.1 + Math.random() * 0.15);
      c.rate(0.7 + Math.random() * 0.6);
      c.play();
    }, 10 + Math.random() * 40);
  }

  // Snaps for sharp accents
  if (fragmentCount > 2) {
    setTimeout(() => {
      const s = pickRandom(sounds.snaps);
      s.volume(0.15 + intensity * 0.15);
      s.rate(0.8 + Math.random() * 0.4);
      s.play();
    }, 5 + Math.random() * 20);
  }

  // Low thud for big breaks
  if (intensity > 0.4) {
    sounds.thud.volume(0.2 * intensity);
    sounds.thud.rate(0.8 + Math.random() * 0.3);
    sounds.thud.play();
  }
}

export function playSlideSound(speed) {
  if (!initialized || !sounds.slide) return;
  const vol = Math.min(0.15, speed * 0.02);
  if (vol < 0.01) return;
  sounds.slide.volume(vol);
  sounds.slide.rate(0.8 + speed * 0.1);
  sounds.slide.play();
}

export function playNewPopadomSound() {
  if (!initialized) initAudio();
  if (sounds.place) {
    sounds.place.volume(0.2);
    sounds.place.play();
  }
}

// ─── Ambient soundscape (Web Audio — runs independently) ──────

export function startAmbient() {
  if (ambientNodes) return;

  ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (ambientCtx.state === "suspended") ambientCtx.resume();

  const masterGain = ambientCtx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(ambientCtx.destination);
  masterGain.gain.linearRampToValueAtTime(0.1, ambientCtx.currentTime + 2);

  const nodes = [];

  // Tanpura drone
  const droneGain = ambientCtx.createGain();
  droneGain.gain.value = 0.3;
  droneGain.connect(masterGain);

  for (const freq of [130.81, 196.0, 261.63]) {
    const osc = ambientCtx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;

    const vib = ambientCtx.createOscillator();
    vib.frequency.value = 0.2 + Math.random() * 0.3;
    const vibGain = ambientCtx.createGain();
    vibGain.gain.value = freq * 0.003;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    vib.start();

    const filter = ambientCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq * 3;

    const gain = ambientCtx.createGain();
    gain.gain.value = freq < 150 ? 0.25 : freq < 200 ? 0.15 : 0.08;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(droneGain);
    osc.start();
    nodes.push({ osc, vib });
  }

  // Murmur
  const murmurDuration = 4;
  const murmurBuf = ambientCtx.createBuffer(1, ambientCtx.sampleRate * murmurDuration, ambientCtx.sampleRate);
  const murmurData = murmurBuf.getChannelData(0);
  for (let i = 0; i < murmurData.length; i++) {
    const mod = 0.3 + 0.7 * Math.sin(i / ambientCtx.sampleRate * 1.5) * Math.sin(i / ambientCtx.sampleRate * 0.7);
    murmurData[i] = (Math.random() * 2 - 1) * mod;
  }
  const murmurSrc = ambientCtx.createBufferSource();
  murmurSrc.buffer = murmurBuf;
  murmurSrc.loop = true;
  const bp = ambientCtx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 400;
  bp.Q.value = 0.5;
  const lp = ambientCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200;
  const murmurGain = ambientCtx.createGain();
  murmurGain.gain.value = 0.2;
  murmurSrc.connect(bp);
  bp.connect(lp);
  lp.connect(murmurGain);
  murmurGain.connect(masterGain);
  murmurSrc.start();
  nodes.push({ source: murmurSrc });

  // Tabla loop
  let beat = 0;
  const pattern = ["dha", null, "ta", null, "ta", null, "dha", null, "dha", null, "ta", null, "ta", null, null, null];
  const tablaGain = ambientCtx.createGain();
  tablaGain.gain.value = 0.15;
  tablaGain.connect(masterGain);

  const tablaInterval = setInterval(() => {
    const hit = pattern[beat % pattern.length];
    if (hit && ambientCtx) {
      const now = ambientCtx.currentTime;
      const osc = ambientCtx.createOscillator();
      osc.type = "sine";
      const g = ambientCtx.createGain();
      if (hit === "ta") {
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
        g.gain.setValueAtTime(0.3, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      } else {
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);
        g.gain.setValueAtTime(0.4, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      }
      osc.connect(g);
      g.connect(tablaGain);
      osc.start(now);
      osc.stop(now + 0.25);
    }
    beat++;
  }, (60 / 70) * 1000);

  ambientNodes = { masterGain, nodes, tablaInterval };
}

export function stopAmbient() {
  if (!ambientNodes) return;
  const { masterGain, nodes, tablaInterval } = ambientNodes;
  if (ambientCtx) {
    masterGain.gain.linearRampToValueAtTime(0, ambientCtx.currentTime + 1);
  }
  setTimeout(() => {
    for (const node of nodes) {
      if (node.osc) try { node.osc.stop(); } catch (e) { /* already stopped */ }
      if (node.vib) try { node.vib.stop(); } catch (e) { /* already stopped */ }
      if (node.source) try { node.source.stop(); } catch (e) { /* already stopped */ }
    }
    clearInterval(tablaInterval);
  }, 1200);
  ambientNodes = null;
}
