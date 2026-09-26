import { state } from '../state/appState';
import { precomputeFullTrackEnvelopes } from '../dsp/fft';
import { resetSpectrumPeaks, resetGonioPeaks } from './meters';
import {
  fftSizeSelect,
  viewModeSelect,
  smoothingSelect,
  displayModeButtons,
  mainDisplayTitle,
  fftSizeItem,
  viewModeItem,
  smoothingItem,
  btnResetSpectrumPeak,
  btnResetGonioPeak,
  peakLevelBadge,
  spectrumClipSummaryBadge,
  gonioHistoryBadge
} from './dom';

export function initAnalyzerControls() {
  // --- Controls: FFT Size, Mode, Smoothing ---
  if (fftSizeSelect) {
    fftSizeSelect.addEventListener('change', (e: Event) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val === 'multi') {
        state.fftMode = 'multi';
        state.fftSize = 2048;
      } else {
        state.fftMode = 'fixed';
        state.fftSize = parseInt(val, 10);
        if (state.analyserL && state.analyserR) {
          state.analyserL.fftSize = state.fftSize;
          state.analyserR.fftSize = state.fftSize;
        }
      }
      if (state.analyserL && state.analyserR) {
        state.peakHoldL = new Float32Array(state.analyserL.frequencyBinCount);
        state.peakHoldR = new Float32Array(state.analyserR.frequencyBinCount);
        if (state.audioBuffer) {
          precomputeFullTrackEnvelopes(state.audioBuffer);
        } else {
          state.cumulativeMaxL = new Float32Array(state.analyserL.frequencyBinCount);
          state.cumulativeMaxR = new Float32Array(state.analyserR.frequencyBinCount);
        }
      }
    });
  }

  if (viewModeSelect) {
    viewModeSelect.addEventListener('change', (e: Event) => {
      state.viewMode = (e.target as HTMLSelectElement).value as any;
    });
  }

  if (smoothingSelect) {
    smoothingSelect.addEventListener('change', (e: Event) => {
      state.smoothingTimeConstant = parseFloat((e.target as HTMLSelectElement).value);
      if (state.analyserL && state.analyserR) {
        state.analyserL.smoothingTimeConstant = state.smoothingTimeConstant;
        state.analyserR.smoothingTimeConstant = state.smoothingTimeConstant;
        if (state.mrNodes && state.mrNodes.lowL) {
          state.mrNodes.lowL.smoothingTimeConstant = state.smoothingTimeConstant;
          state.mrNodes.lowR.smoothingTimeConstant = state.smoothingTimeConstant;
          state.mrNodes.midL.smoothingTimeConstant = state.smoothingTimeConstant;
          state.mrNodes.midR.smoothingTimeConstant = state.smoothingTimeConstant;
          state.mrNodes.highL.smoothingTimeConstant = Math.max(0.15, state.smoothingTimeConstant * 0.6);
          state.mrNodes.highR.smoothingTimeConstant = Math.max(0.15, state.smoothingTimeConstant * 0.6);
        }
      }
    });
  }

  // --- Display Mode Toggle Buttons (v2.6.0) ---
  displayModeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (!mode || state.displayMode === mode) return;
      state.displayMode = mode as any;
      displayModeButtons.forEach(b => b.classList.toggle('active', b === btn));

      if (mode === 'spectrum') {
        if (mainDisplayTitle) mainDisplayTitle.innerHTML = '<span>📊</span> Frequency Spectrum';
        if (fftSizeItem) { fftSizeItem.style.opacity = '1'; fftSizeItem.style.pointerEvents = 'auto'; }
        if (viewModeItem) { viewModeItem.style.opacity = '1'; viewModeItem.style.pointerEvents = 'auto'; }
        if (smoothingItem) { smoothingItem.style.opacity = '1'; smoothingItem.style.pointerEvents = 'auto'; }
      } else if (mode === 'spectrogram') {
        if (mainDisplayTitle) mainDisplayTitle.innerHTML = '<span>🌊</span> Spectrogram (Waterfall)';
        if (fftSizeItem) { fftSizeItem.style.opacity = '1'; fftSizeItem.style.pointerEvents = 'auto'; }
        if (viewModeItem) { viewModeItem.style.opacity = '0.35'; viewModeItem.style.pointerEvents = 'none'; }
        if (smoothingItem) { smoothingItem.style.opacity = '1'; smoothingItem.style.pointerEvents = 'auto'; }
      } else if (mode === 'oscilloscope') {
        if (mainDisplayTitle) mainDisplayTitle.innerHTML = '<span>〰️</span> Oscilloscope';
        if (fftSizeItem) { fftSizeItem.style.opacity = '0.35'; fftSizeItem.style.pointerEvents = 'none'; }
        if (viewModeItem) { viewModeItem.style.opacity = '1'; viewModeItem.style.pointerEvents = 'auto'; }
        if (smoothingItem) { smoothingItem.style.opacity = '0.35'; smoothingItem.style.pointerEvents = 'none'; }
      }
    });
  });

  // --- Peak Reset Buttons ---
  if (btnResetSpectrumPeak) {
    btnResetSpectrumPeak.addEventListener('click', resetSpectrumPeaks);
  }
  if (btnResetGonioPeak) {
    btnResetGonioPeak.addEventListener('click', resetGonioPeaks);
  }
  if (peakLevelBadge) {
    peakLevelBadge.addEventListener('click', resetSpectrumPeaks);
  }
  if (spectrumClipSummaryBadge) {
    spectrumClipSummaryBadge.addEventListener('click', resetSpectrumPeaks);
  }
  if (gonioHistoryBadge) {
    gonioHistoryBadge.addEventListener('click', resetGonioPeaks);
  }
}
