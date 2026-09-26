import { state } from '../state/appState';
import { initAudioContext } from './context';
import { stopPlayback } from './playback';
import { loadAudioBuffer } from './loader';
import { fileNameLabel } from '../ui/dom';

// --- Built-in Test Tone / Signal Generator ---
export function generateTestAudioBuffer(type: string, duration: number = 5.0): AudioBuffer {
  if (!state.audioCtx) initAudioContext();
  const sr = state.audioCtx?.sampleRate || 44100;
  const numSamples = Math.floor(sr * duration);
  const buffer = state.audioCtx!.createBuffer(2, numSamples, sr);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  if (type === 'sine0') {
    // 1kHz Sine @ 0dBFS (amplitude exactly 1.0)
    const freq = 1000.0;
    const w = (2 * Math.PI * freq) / sr;
    for (let i = 0; i < numSamples; i++) {
      const val = Math.sin(w * i);
      left[i] = val;
      right[i] = val;
    }
  } else if (type === 'sine-12') {
    // 1kHz Sine @ -12dBFS (amplitude ~0.251)
    const amp = Math.pow(10, -12 / 20);
    const freq = 1000.0;
    const w = (2 * Math.PI * freq) / sr;
    for (let i = 0; i < numSamples; i++) {
      const val = amp * Math.sin(w * i);
      left[i] = val;
      right[i] = val;
    }
  } else if (type === 'drum') {
    // Drum Transient Burst (120 BPM Kick + Snare with sharp transients)
    // Tests Brickwall Soft-Clipper transient response and clip-free punch
    const bpm = 120;
    const beatSamples = Math.floor(sr * (60 / bpm));
    const numBeats = Math.floor(numSamples / beatSamples);

    for (let beat = 0; beat < numBeats; beat++) {
      const start = beat * beatSamples;
      if (beat % 2 === 0) {
        // Kick: Fast pitch envelope 160Hz -> 45Hz + transient click
        const kLen = Math.min(Math.floor(sr * 0.35), numSamples - start);
        let phase = 0;
        for (let i = 0; i < kLen; i++) {
          const t = i / sr;
          const freq = 45.0 + 130.0 * Math.exp(-t * 35.0);
          phase += (2 * Math.PI * freq) / sr;
          const ampEnv = Math.exp(-t * 9.0);
          const click = Math.sin(2 * Math.PI * 1200.0 * t) * Math.exp(-t * 120.0) * 0.7;
          const val = (Math.sin(phase) + click) * ampEnv * 0.98;
          left[start + i] += val;
          right[start + i] += val;
        }
      } else {
        // Snare: 220Hz body tone + wide stereo noise burst
        const sLen = Math.min(Math.floor(sr * 0.30), numSamples - start);
        for (let i = 0; i < sLen; i++) {
          const t = i / sr;
          const body = Math.sin(2 * Math.PI * 220.0 * t) * Math.exp(-t * 18.0) * 0.55;
          const noiseL = (Math.random() * 2 - 1) * Math.exp(-t * 14.0) * 0.65;
          const noiseR = (Math.random() * 2 - 1) * Math.exp(-t * 14.0) * 0.65;
          left[start + i] += (body + noiseL) * 0.95;
          right[start + i] += (body + noiseR) * 0.95;
        }
      }
      // Hi-hat on 8th notes
      const hhStart = start + Math.floor(beatSamples / 2);
      if (hhStart < numSamples) {
        const hhLen = Math.min(Math.floor(sr * 0.06), numSamples - hhStart);
        for (let i = 0; i < hhLen; i++) {
          const t = i / sr;
          const hhNoise = (Math.random() * 2 - 1) * Math.exp(-t * 70.0) * 0.25;
          left[hhStart + i] += hhNoise;
          right[hhStart + i] += hhNoise;
        }
      }
    }

    // Peak normalize drum pattern to 0.99 (~-0.1dBFS)
    let peak = 0;
    for (let i = 0; i < numSamples; i++) {
      const lAbs = Math.abs(left[i]);
      const rAbs = Math.abs(right[i]);
      if (lAbs > peak) peak = lAbs;
      if (rAbs > peak) peak = rAbs;
    }
    if (peak > 0.001) {
      const norm = 0.99 / peak;
      for (let i = 0; i < numSamples; i++) {
        left[i] *= norm;
        right[i] *= norm;
      }
    }
  } else if (type === 'sweep') {
    // Logarithmic Sine Sweep (20Hz - 20kHz, -12dBFS)
    const amp = Math.pow(10, -12 / 20);
    const f0 = 20.0;
    const f1 = 20000.0;
    const lnRatio = Math.log(f1 / f0);
    for (let i = 0; i < numSamples; i++) {
      const t = i / sr;
      const phase = (2 * Math.PI * f0 * ((Math.pow(f1 / f0, t / duration) - 1.0) / lnRatio));
      const val = amp * Math.sin(phase);
      left[i] = val;
      right[i] = val;
    }
  }

  return buffer;
}

// Cache for generated test audio buffers (avoids recomputation on rapid switching)
const testBufferCache: Record<string, AudioBuffer> = {};

export function loadTestSignal(type: string) {
  initAudioContext();
  if (state.audioCtx && state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }
  stopPlayback();

  const labels: Record<string, string> = {
    drum: '🧪 Test Signal: Drum Transient (0 dBFS)',
    sine0: '🧪 Test Signal: 1 kHz Sine (0 dBFS)',
    'sine-12': '🧪 Test Signal: 1 kHz Sine (-12 dBFS)',
    sweep: '🧪 Test Signal: Log Sine Sweep (20 Hz - 20 kHz)'
  };

  const title = labels[type] || '🧪 Test Signal';
  try {
    if (!testBufferCache[type]) {
      testBufferCache[type] = generateTestAudioBuffer(type, 5.0);
    }
    loadAudioBuffer(testBufferCache[type], title, true);
  } catch(err) {
    console.error('Test signal generation failed:', err);
    if (fileNameLabel) fileNameLabel.textContent = 'Error: Failed to generate test signal';
  }
}

// Attach Test Tone button listeners
export function initTestToneButtons() {
  const testToneButtons = document.getElementById('testToneButtons');
  if (testToneButtons) {
    testToneButtons.querySelectorAll<HTMLButtonElement>('.btn-test-tone').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.dataset.test;
        if (!type) return;
        testToneButtons.querySelectorAll('.btn-test-tone').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadTestSignal(type);
      });
    });
  }
}
