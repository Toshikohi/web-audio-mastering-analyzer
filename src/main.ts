import { state } from './state/appState';
import { initAudioContext } from './audio/context';
import {
  initPlayerControls,
  setStartLoopCallback,
  getCurrentTime
} from './audio/playback';
import { initFileLoader } from './audio/loader';
import { initTestToneButtons } from './audio/testTones';
import { initExportWav } from './audio/exportWav';
import { initResizeObserver } from './visualizers/common';
import { renderSpectrum, initSpectrumTooltip } from './visualizers/spectrum';
import { renderSpectrogram } from './visualizers/spectrogram';
import { renderOscilloscope } from './visualizers/oscilloscope';
import { renderGoniometer } from './visualizers/goniometer';
import { drawWaveformOverview, updatePlayhead } from './visualizers/waveform';
import { analyzeTimeDomainMetrics, updateMeters } from './dsp/analysis';
import { initBandMeters } from './ui/meters';
import { initMasteringUI } from './ui/masteringUi';
import { initAnalyzerControls } from './ui/analyzerControls';
import {
  fpsBadge,
  grBarFill,
  grValText,
  lufsNum,
  truePeakValue,
  widthPhaseStatus,
  widthPhaseBar
} from './ui/dom';

// --- Main Render Loop (60 FPS) ---
const timeDomainL = new Uint8Array(state.fftSize);
const timeDomainR = new Uint8Array(state.fftSize);
let freqDataL = new Uint8Array(state.fftSize / 2);
let freqDataR = new Uint8Array(state.fftSize / 2);

// Multi-Resolution Array Buffers (Low: 8192, Mid: 2048, High: 512)
const mrBuffers = {
  lowL: new Uint8Array(4096),
  lowR: new Uint8Array(4096),
  midL: new Uint8Array(1024),
  midR: new Uint8Array(1024),
  highL: new Uint8Array(256),
  highR: new Uint8Array(256)
};

// FPS Monitor & Meter Throttling variables
let fpsFrameCount = 0;
let fpsLastTime = performance.now();
let lastMeterTime = 0;
const METER_UPDATE_INTERVAL = 33; // Update DOM meters at ~30 FPS to eliminate Reflow/Repaint bottlenecks while keeping Canvas at 60 FPS

function renderLoop(timestamp?: number) {
  // 1. High-precision FPS Measurement (500ms moving average)
  const now = timestamp || performance.now();
  fpsFrameCount++;
  const elapsed = now - fpsLastTime;
  if (elapsed >= 500) {
    const currentFps = (fpsFrameCount * 1000) / elapsed;
    if (fpsBadge) {
      fpsBadge.textContent = `${currentFps.toFixed(1)} FPS`;
      fpsBadge.classList.remove('fps-high', 'fps-mid', 'fps-low');
      if (currentFps >= 55) {
        fpsBadge.classList.add('fps-high');
      } else if (currentFps >= 40) {
        fpsBadge.classList.add('fps-mid');
      } else {
        fpsBadge.classList.add('fps-low');
      }
    }
    fpsFrameCount = 0;
    fpsLastTime = now;
  }

  if (state.analyserL && state.analyserR) {
    state.analyserL.getByteTimeDomainData(timeDomainL);
    state.analyserR.getByteTimeDomainData(timeDomainR);

    // Always update standard frequency data (maintains fallback & compatibility)
    if (freqDataL.length !== state.analyserL.frequencyBinCount) {
      freqDataL = new Uint8Array(state.analyserL.frequencyBinCount);
      freqDataR = new Uint8Array(state.analyserR.frequencyBinCount);
    }
    state.analyserL.getByteFrequencyData(freqDataL);
    state.analyserR.getByteFrequencyData(freqDataR);

    // Multi-Resolution FFT buffers
    if (state.fftMode === 'multi' && state.mrNodes && state.mrNodes.lowL) {
      state.mrNodes.lowL.getByteFrequencyData(mrBuffers.lowL);
      state.mrNodes.lowR.getByteFrequencyData(mrBuffers.lowR);
      state.mrNodes.midL.getByteFrequencyData(mrBuffers.midL);
      state.mrNodes.midR.getByteFrequencyData(mrBuffers.midR);
      state.mrNodes.highL.getByteFrequencyData(mrBuffers.highL);
      state.mrNodes.highR.getByteFrequencyData(mrBuffers.highR);
    }

    // 2. Render Main Visualizer (Spectrum / Spectrogram / Oscilloscope) & Goniometer
    if (state.displayMode === 'spectrogram') {
      renderSpectrogram(freqDataL, freqDataR, mrBuffers);
    } else if (state.displayMode === 'oscilloscope') {
      renderOscilloscope(timeDomainL, timeDomainR);
    } else {
      renderSpectrum(timeDomainL, timeDomainR, freqDataL, freqDataR, mrBuffers);
    }
    renderGoniometer(timeDomainL, timeDomainR);

    // 3. Throttled DOM Meters (Update at ~30 FPS to eliminate heavy Reflow/Repaint cycles)
    if (now - lastMeterTime >= METER_UPDATE_INTERVAL) {
      lastMeterTime = now;

      // Single unified 2048-sample pass for ALL time-domain meters
      const metrics = (state.audioBuffer && state.isPlaying)
        ? analyzeTimeDomainMetrics(timeDomainL, timeDomainR)
        : null;

      // Multi-Res Band Balance & Correlation Meters
      updateMeters(timeDomainL, timeDomainR, freqDataL, freqDataR, mrBuffers, metrics);

      // Mastering Suite Realtime Meters
      if (state.masteringNodes) {
        // A. Glue Comp Gain Reduction Readout
        if (state.masteringNodes.compNode && grBarFill && grValText) {
          const gr = (state.mastering.comp.enabled && !state.mastering.bypass && state.isPlaying)
            ? (state.masteringNodes.compNode as any).reduction
            : 0;
          const clampedGr = Math.max(-12, Math.min(0, gr));
          const grPct = (-clampedGr / 12) * 100;
          grBarFill.style.width = `${grPct}%`;
          grValText.textContent = `${clampedGr.toFixed(1)} dB`;
        }

        // B. Maximizer Loudness (LUFS) & True Peak readout (Using pre-computed unified metrics)
        if (lufsNum && truePeakValue) {
          if (metrics && state.isPlaying) {
            const rms = Math.sqrt(metrics.sumSq / (metrics.len * 2));
            const lufs = rms > 0.0001 ? Math.max(-70, 20 * Math.log10(rms) - 0.69) : -70;
            const peakDb = metrics.maxAmp > 0.0001 ? Math.max(-70, 20 * Math.log10(metrics.maxAmp)) : -70;
            lufsNum.textContent = lufs.toFixed(1);
            truePeakValue.textContent = `${peakDb >= -0.05 ? '0.0' : peakDb.toFixed(1)} dBTP`;
          } else {
            lufsNum.textContent = `-14.0`;
            truePeakValue.textContent = `-0.1 dBTP`;
          }
        }

        // C. Stereo Width Phase Status (Using pre-computed unified metrics)
        if (widthPhaseStatus && widthPhaseBar) {
          const corr = metrics ? metrics.corr : 0.90;
          const sign = corr >= 0 ? '+' : '';
          widthPhaseStatus.textContent = state.isPlaying ? `${sign}${corr.toFixed(2)}` : '+0.90';
          widthPhaseStatus.style.color = corr < 0 ? 'var(--danger)' : (corr < 0.3 ? 'var(--warning)' : 'var(--success)');
          
          const barWidth = Math.abs(corr) * 50;
          if (corr >= 0) {
            widthPhaseBar.style.left = '50%';
            widthPhaseBar.style.width = `${barWidth}%`;
            widthPhaseBar.style.background = 'var(--success)';
          } else {
            widthPhaseBar.style.left = `${50 - barWidth}%`;
            widthPhaseBar.style.width = `${barWidth}%`;
            widthPhaseBar.style.background = 'var(--danger)';
          }
        }
      }
    }
  }

  // Update Playhead & Time
  if (state.isPlaying) {
    updatePlayhead(getCurrentTime());
  }

  state.animationFrameId = requestAnimationFrame(renderLoop);
}

// Ensure playback start can resume the render loop if paused
setStartLoopCallback(() => {
  if (!state.animationFrameId) {
    state.animationFrameId = requestAnimationFrame(renderLoop);
  }
});

// Window Resize Handling
window.addEventListener('resize', () => {
  if (state.audioBuffer) {
    drawWaveformOverview(state.audioBuffer);
  }
});

// --- Initialize All Modules ---
initBandMeters();
initResizeObserver();
initSpectrumTooltip();
initFileLoader();
initPlayerControls();
initTestToneButtons();
initExportWav();
initAnalyzerControls();
initMasteringUI();

// Start render loop immediately for ambient background
state.animationFrameId = requestAnimationFrame(renderLoop);
