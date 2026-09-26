// @ts-nocheck
import { state } from '../state/appState';
import {
  peakLevelBadge,
  spectrumClipSummaryBadge,
  gonioPeakLevelBadge,
  gonioHistoryBadge,
  gonioMinPhaseBadge,
  bandsContainer,
  btnResetSpectrumPeak,
  btnResetGonioPeak
} from './dom';

export function updatePeakBadges() {
  const sp = state.peaks.spectrum;
  const gp = state.peaks.gonio;
  const now = performance.now();

  // 1. Realtime Level Badge (Sample Peak L/R & True Peak dBTP separated)
  const isClipL = now < sp.clipHoldUntilL;
  const isClipR = now < sp.clipHoldUntilR;
  const isRealtimeClip = isClipL || isClipR;

  let lStr = isClipL ? 'CLIP' : (sp.realtimeDbL > -59.5 ? sp.realtimeDbL.toFixed(1) + 'dB' : '-- dB');
  let rStr = isClipR ? 'CLIP' : (sp.realtimeDbR > -59.5 ? sp.realtimeDbR.toFixed(1) + 'dB' : '-- dB');
  let tpStr = sp.realtimeDbTp > -59.5 ? sp.realtimeDbTp.toFixed(1) + 'dBTP' : '-- dBTP';
  const isTpClip = sp.realtimeDbTp >= 0.0;

  peakLevelBadge.innerHTML = `L: ${lStr} | R: ${rStr} <span style="opacity:0.75; font-size:0.9em; margin-left:4px;">(TP: <span style="color:${isTpClip ? 'var(--danger)' : 'inherit'}">${tpStr}</span>)</span>`;
  peakLevelBadge.classList.toggle('realtime-clip', isRealtimeClip);
  peakLevelBadge.classList.toggle('clip', isRealtimeClip);

  // 2. Spectrum Dynamic Clip Summary Badge (Neighbor of FPS badge; hidden when clipCount === 0)
  if (spectrumClipSummaryBadge) {
    if (sp.clipCount > 0) {
      spectrumClipSummaryBadge.textContent = `⚠ CLIP ${sp.clipCount}`;
      spectrumClipSummaryBadge.style.display = 'inline-flex';
    } else {
      spectrumClipSummaryBadge.style.display = 'none';
    }
  }

  // 3. Goniometer Realtime Level & History Badges
  const isGonioClip = now < gp.clipHoldUntil;
  if (gonioPeakLevelBadge) {
    const curLvlStr = isGonioClip ? 'CLIP' : (gp.realtimeLevelDb > -59.5 ? gp.realtimeLevelDb.toFixed(1) + 'dB' : '-- dB');
    gonioPeakLevelBadge.textContent = 'Level: ' + curLvlStr;
    gonioPeakLevelBadge.classList.toggle('realtime-clip', isGonioClip);
    gonioPeakLevelBadge.classList.toggle('clip', isGonioClip);
  }

  if (gonioHistoryBadge) {
    const maxStr = gp.maxLevelDb > -Infinity ? gp.maxLevelDb.toFixed(1) + 'dB' : '-- dB';
    gonioHistoryBadge.textContent = 'Max: ' + maxStr;
    gonioHistoryBadge.className = 'peak-badge clip-history-badge ' + (gp.maxLevelDb >= -0.05 ? 'has-clip' : 'clean');
  }

  // 5. Goniometer Correlation
  if (gp.minCorrelation <= 1.0 && gp.minCorrelation >= -1.0 && gp.maxRadiusPct > 0) {
    const sign = gp.minCorrelation >= 0 ? '+' : '';
    gonioMinPhaseBadge.textContent = 'Min φ: ' + sign + gp.minCorrelation.toFixed(2);
    gonioMinPhaseBadge.style.color = gp.minCorrelation < 0 ? 'var(--danger)' : (gp.minCorrelation < 0.3 ? 'var(--warning)' : 'var(--text-muted)');
  } else {
    gonioMinPhaseBadge.textContent = 'Min φ: --';
    gonioMinPhaseBadge.style.color = 'var(--text-muted)';
  }
}

export function resetSpectrumPeaks() {
  state.peaks.spectrum.maxPeakFreq = 0;
  state.peaks.spectrum.maxPeakDbL = -Infinity;
  state.peaks.spectrum.maxPeakDbR = -Infinity;
  state.peaks.spectrum.maxPeakDbTp = -Infinity;
  state.peaks.spectrum.realtimeDbTp = -60;
  state.peaks.spectrum.clipCount = 0;
  state.peaks.spectrum.clipPositions = [];
  state.peaks.spectrum._clipCooldownUntil = 0;
  state.peaks.spectrum.clipHoldUntilL = 0;
  state.peaks.spectrum.clipHoldUntilR = 0;
  if (state.cumulativeMaxL) state.cumulativeMaxL.fill(0);
  if (state.cumulativeMaxR) state.cumulativeMaxR.fill(0);
  if (state.envelope80L) state.envelope80L.fill(0);
  if (state.envelope80R) state.envelope80R.fill(0);
  if (state.peakHoldL) state.peakHoldL.fill(0);
  if (state.peakHoldR) state.peakHoldR.fill(0);

  // Activate dynamic histogram accumulation for mastering output
  const effectiveFftSize = state.fftMode === 'multi' ? 8192 : (state.fftSize || 2048);
  const binCount = effectiveFftSize / 2;
  state.dynamicAcc.spectrumHistL = new Uint32Array(binCount * 128);
  state.dynamicAcc.spectrumHistR = new Uint32Array(binCount * 128);
  state.dynamicAcc.spectrumSliceCount = 0;
  state.dynamicAcc.spectrumAccumulating = true;

  updatePeakBadges();
}

export function resetGonioPeaks() {
  state.peaks.gonio.maxRadiusPct = 0;
  state.peaks.gonio.maxLevelDb = -Infinity;
  state.peaks.gonio.minCorrelation = 1.0;
  state.peaks.gonio.clipHoldUntil = 0;
  if (state.angularMaxRadius) state.angularMaxRadius.fill(0);
  if (state.angular80Radius) state.angular80Radius.fill(0);

  // Activate dynamic polar histogram accumulation for goniometer
  if (state.dynamicAcc.gonioHist) state.dynamicAcc.gonioHist.fill(0);
  if (state.dynamicAcc.gonioAngleCounts) state.dynamicAcc.gonioAngleCounts.fill(0);
  state.dynamicAcc._gonioFrame = 0;
  state.dynamicAcc.gonioAccumulating = true;

  updatePeakBadges();
}

export function resetAllPeaks() {
  resetSpectrumPeaks();
  resetGonioPeaks();
}

export function initPeakResetListeners() {
  if (btnResetSpectrumPeak) btnResetSpectrumPeak.addEventListener('click', resetSpectrumPeaks);
  if (btnResetGonioPeak) btnResetGonioPeak.addEventListener('click', resetGonioPeaks);
  if (peakLevelBadge) peakLevelBadge.addEventListener('click', resetSpectrumPeaks);
  if (spectrumClipSummaryBadge) spectrumClipSummaryBadge.addEventListener('click', resetSpectrumPeaks);
  if (gonioHistoryBadge) gonioHistoryBadge.addEventListener('click', resetGonioPeaks);
}

// Build multi-band UI and cache DOM elements
export const cachedBandElements = [];

export function initBandMeters() {
  if (!bandsContainer || cachedBandElements.length > 0) return;
  state.bands.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'band-row';
    row.innerHTML = `
      <span class="band-name">${b.name}</span>
      <div class="band-track">
        <div class="band-center-line"></div>
        <div class="band-fill-l" id="bandFillL_${i}"></div>
        <div class="band-fill-r" id="bandFillR_${i}"></div>
      </div>
      <span class="band-diff-val" id="bandDiffVal_${i}">0.0dB</span>
    `;
    bandsContainer.appendChild(row);
    cachedBandElements.push({
      fillL: row.querySelector(`#bandFillL_${i}`),
      fillR: row.querySelector(`#bandFillR_${i}`),
      diffSpan: row.querySelector(`#bandDiffVal_${i}`)
    });
  });
}
