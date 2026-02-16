/**
 * soundManager.js — Generates and plays ASMR-quality crack/snap sounds.
 *
 * What this does:
 * - Uses the Web Audio API to synthesise crisp cracking sounds in real time
 *   (no audio files needed — we generate them mathematically)
 * - Varies pitch, duration, and character so each crack sounds unique
 * - Layers multiple micro-sounds for a single crack event
 * - Zero latency — sounds play the instant the user taps
 *
 * Why generate sounds instead of using audio files?
 * - No files to load = instant startup, no loading screen
 * - Infinite variation = never sounds repetitive
 * - Tiny bundle size
 * - Can be precisely synchronised to visual events
 */

let audioContext = null;

/**
 * Initialise the audio system. Must be called after a user interaction
 * (browsers require a user gesture before playing audio).
 */
export function initAudio() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

/**
 * Ensure audio context is running (browsers suspend it until user interaction).
 */
function ensureRunning() {
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume();
  }
}

/**
 * Play a crack sound synchronised to a fracture event.
 * Layers several micro-sounds for a rich, ASMR-quality crack.
 *
 * @param {number} intensity - 0 to 1, how big the crack is (affects volume and pitch)
 * @param {number} fragmentCount - how many pieces broke off (more = richer sound)
 */
export function playCrackSound(intensity = 0.5, fragmentCount = 3) {
  if (!audioContext) initAudio();
  ensureRunning();

  const now = audioContext.currentTime;
  const volume = 0.15 + intensity * 0.25; // don't make it too loud — ASMR, not explosion

  // Layer 1: The main "snap" — a very short burst of filtered noise
  playSnap(now, volume, 800 + Math.random() * 600);

  // Layer 2: A few "crinkle" micro-cracks, slightly delayed
  const crinkleCount = Math.min(fragmentCount, 5);
  for (let i = 0; i < crinkleCount; i++) {
    const delay = 0.01 + Math.random() * 0.04; // 10-50ms after the main snap
    const pitch = 1200 + Math.random() * 2000;
    playSnap(now + delay, volume * (0.3 + Math.random() * 0.3), pitch);
  }

  // Layer 3: A low "thud" for big cracks (adds body to the sound)
  if (intensity > 0.4) {
    playThud(now, volume * 0.5 * intensity);
  }
}

/**
 * Play a single snap/crack — a burst of filtered noise.
 * This is the core building block of the crack sound.
 */
function playSnap(time, volume, filterFreq) {
  const duration = 0.02 + Math.random() * 0.03; // 20-50ms — very short

  // Create a noise buffer (random samples = white noise)
  const bufferSize = Math.ceil(audioContext.sampleRate * duration);
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    // Shape the noise: sharp attack, fast decay
    const envelope = Math.exp(-i / (bufferSize * 0.15));
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  // Play the noise through a bandpass filter (makes it sound like a crack, not static)
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

/**
 * Play a low thud for big cracks — adds satisfying body to the sound.
 */
function playThud(time, volume) {
  const osc = audioContext.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 80 + Math.random() * 40; // low rumble

  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

  osc.connect(gain);
  gain.connect(audioContext.destination);

  osc.start(time);
  osc.stop(time + 0.1);
}

/**
 * Play the sound when fragments are pushed/dragged — a subtle scraping sound.
 *
 * @param {number} speed - how fast the fragment is moving (affects volume)
 */
export function playSlideSound(speed) {
  if (!audioContext) return;
  ensureRunning();

  const volume = Math.min(0.08, speed * 0.01);
  if (volume < 0.005) return; // too quiet to bother

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

/**
 * Play a "new popadom" whoosh sound.
 */
export function playNewPopadomSound() {
  if (!audioContext) initAudio();
  ensureRunning();

  const now = audioContext.currentTime;

  // Quick rising tone
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
