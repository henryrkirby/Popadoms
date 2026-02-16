/**
 * soundManager.js — Audio system for the popadom game.
 *
 * - Synthesised crack/snap sounds (no audio files)
 * - Ambient Indian restaurant background atmosphere:
 *   - Sitar-like drone
 *   - Tabla-like rhythmic pattern
 *   - Background murmur/chatter
 */

let audioContext = null;
let ambientNodes = null;

export function initAudio() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

function ensureRunning() {
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume();
  }
}

// ─── Crack / Break Sounds ────────────────────────────────────

export function playCrackSound(intensity = 0.5, fragmentCount = 3) {
  if (!audioContext) initAudio();
  ensureRunning();

  const now = audioContext.currentTime;
  const volume = 0.15 + intensity * 0.25;

  // Main snap
  playSnap(now, volume, 800 + Math.random() * 600);

  // Crinkle micro-cracks
  const crinkleCount = Math.min(fragmentCount, 5);
  for (let i = 0; i < crinkleCount; i++) {
    const delay = 0.01 + Math.random() * 0.04;
    const pitch = 1200 + Math.random() * 2000;
    playSnap(now + delay, volume * (0.3 + Math.random() * 0.3), pitch);
  }

  // Low thud for big cracks
  if (intensity > 0.4) {
    playThud(now, volume * 0.5 * intensity);
  }
}

function playSnap(time, volume, filterFreq) {
  const duration = 0.02 + Math.random() * 0.03;
  const bufferSize = Math.ceil(audioContext.sampleRate * duration);
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    const envelope = Math.exp(-i / (bufferSize * 0.15));
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;

  const filter = audioContext.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = 1.5 + Math.random() * 2;

  const gain = audioContext.createGain();
  gain.gain.value = volume;
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);

  source.start(time);
  source.stop(time + duration);
}

function playThud(time, volume) {
  const osc = audioContext.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 80 + Math.random() * 40;

  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

  osc.connect(gain);
  gain.connect(audioContext.destination);

  osc.start(time);
  osc.stop(time + 0.1);
}

export function playSlideSound(speed) {
  if (!audioContext) return;
  ensureRunning();

  const volume = Math.min(0.08, speed * 0.01);
  if (volume < 0.005) return;

  const now = audioContext.currentTime;
  const duration = 0.05;
  const bufferSize = Math.ceil(audioContext.sampleRate * duration);
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3 * Math.exp(-i / (bufferSize * 0.5));
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;

  const filter = audioContext.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 2000;

  const gain = audioContext.createGain();
  gain.gain.value = volume;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);

  source.start(now);
  source.stop(now + duration);
}

export function playNewPopadomSound() {
  if (!audioContext) initAudio();
  ensureRunning();

  const now = audioContext.currentTime;

  const osc = audioContext.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);

  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain);
  gain.connect(audioContext.destination);

  osc.start(now);
  osc.stop(now + 0.25);
}

// ─── Ambient Indian Restaurant Atmosphere ────────────────────

/**
 * Start the ambient background soundscape.
 * Creates a layered atmosphere: sitar-like drone, soft tabla rhythm, murmur.
 */
export function startAmbient() {
  if (!audioContext) initAudio();
  ensureRunning();
  if (ambientNodes) return; // already playing

  const masterGain = audioContext.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioContext.destination);

  // Fade in over 2 seconds
  masterGain.gain.linearRampToValueAtTime(0.12, audioContext.currentTime + 2);

  const nodes = [];

  // Layer 1: Tanpura-style drone (Sa and Pa — tonic and fifth)
  const droneGain = audioContext.createGain();
  droneGain.gain.value = 0.35;
  droneGain.connect(masterGain);

  // Sa (tonic) — low C
  const droneSa = createDroneTone(130.81, droneGain); // C3
  nodes.push(droneSa);

  // Pa (fifth) — G
  const dronePa = createDroneTone(196.0, droneGain); // G3
  dronePa.gain.gain.value = 0.2;
  nodes.push(dronePa);

  // Upper Sa (octave)
  const droneHi = createDroneTone(261.63, droneGain); // C4
  droneHi.gain.gain.value = 0.1;
  nodes.push(droneHi);

  // Layer 2: Background murmur (filtered noise = distant chatter)
  const murmurGain = audioContext.createGain();
  murmurGain.gain.value = 0.25;
  murmurGain.connect(masterGain);
  const murmur = createMurmur(murmurGain);
  nodes.push(murmur);

  // Layer 3: Subtle tabla-like rhythm loop
  const tablaGain = audioContext.createGain();
  tablaGain.gain.value = 0.2;
  tablaGain.connect(masterGain);
  const tablaInterval = startTablaLoop(tablaGain);

  ambientNodes = {
    masterGain,
    nodes,
    tablaInterval,
  };
}

/**
 * Stop the ambient soundscape.
 */
export function stopAmbient() {
  if (!ambientNodes) return;

  const { masterGain, nodes, tablaInterval } = ambientNodes;

  // Fade out
  masterGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 1);

  // Stop all nodes after fade
  setTimeout(() => {
    for (const node of nodes) {
      if (node.osc) node.osc.stop();
      if (node.source) node.source.stop();
    }
    clearInterval(tablaInterval);
  }, 1200);

  ambientNodes = null;
}

/**
 * Create a tanpura-like drone tone with slight vibrato.
 */
function createDroneTone(freq, destination) {
  const osc = audioContext.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = freq;

  // Slow vibrato for that shimmering tanpura quality
  const vibrato = audioContext.createOscillator();
  vibrato.frequency.value = 0.2 + Math.random() * 0.3; // very slow wobble
  const vibratoGain = audioContext.createGain();
  vibratoGain.gain.value = freq * 0.003; // very subtle
  vibrato.connect(vibratoGain);
  vibratoGain.connect(osc.frequency);
  vibrato.start();

  // Filter to warm up the sawtooth — makes it sound more like a string
  const filter = audioContext.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = freq * 3;
  filter.Q.value = 1;

  const gain = audioContext.createGain();
  gain.gain.value = 0.3;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  osc.start();

  return { osc, vibrato, gain };
}

/**
 * Create filtered noise that sounds like distant restaurant chatter/murmur.
 */
function createMurmur(destination) {
  // Create a long noise buffer
  const duration = 4;
  const bufferSize = audioContext.sampleRate * duration;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    // Shape the noise with slow amplitude modulation (sounds like voices)
    const mod = 0.3 + 0.7 * Math.sin(i / audioContext.sampleRate * 1.5) *
                Math.sin(i / audioContext.sampleRate * 0.7);
    data[i] = (Math.random() * 2 - 1) * mod;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  // Bandpass filter to voice-like frequencies
  const filter1 = audioContext.createBiquadFilter();
  filter1.type = "bandpass";
  filter1.frequency.value = 400;
  filter1.Q.value = 0.5;

  const filter2 = audioContext.createBiquadFilter();
  filter2.type = "lowpass";
  filter2.frequency.value = 1200;

  source.connect(filter1);
  filter1.connect(filter2);
  filter2.connect(destination);

  source.start();

  return { source };
}

/**
 * Play a tabla-like hit — synthesised drum sound.
 */
function playTablaHit(destination, type = "ta") {
  if (!audioContext) return;
  const now = audioContext.currentTime;

  if (type === "ta") {
    // High tabla hit — short pitched tone
    const osc = audioContext.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } else {
    // Low "dha" — bass drum thud
    const osc = audioContext.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }
}

/**
 * Start a simple rhythmic tabla pattern on a loop.
 * Tintal-inspired: 16-beat cycle, emphasis on beats 1, 5, 9, 13.
 */
function startTablaLoop(destination) {
  let beat = 0;
  const bpm = 70; // slow, relaxed pace
  const interval = (60 / bpm) * 1000; // ms per beat

  const pattern = [
    "dha", null, "ta", null,
    "ta", null, "dha", null,
    "dha", null, "ta", null,
    "ta", null, null, null,
  ];

  const tablaInterval = setInterval(() => {
    const hit = pattern[beat % pattern.length];
    if (hit) {
      playTablaHit(destination, hit === "dha" ? "dha" : "ta");
    }
    beat++;
  }, interval);

  return tablaInterval;
}
