// @ts-nocheck
import { state } from '../state/appState';
import { correlationVal, correlationBar } from '../ui/dom';
import { updatePeakBadges, cachedBandElements } from '../ui/meters';

// --- Fast Time-Domain Metrics Analysis (Single Unified 2048-Sample Pass with 4x True Peak Estimation) ---
export function analyzeTimeDomainMetrics(tdL, tdR) {
  const len = tdL.length;
  let sumLR = 0, sumL2 = 0, sumR2 = 0, maxAmp = 0, maxAmpL = 0, maxAmpR = 0;
  let maxTpAmpL = 0, maxTpAmpR = 0;
  let hasByteSaturation = false;

  for (let i = 0; i < len; i++) {
    const rawL = tdL[i];
    const rawR = tdR[i];
    if (rawL >= 255 || rawL <= 0 || rawR >= 255 || rawR <= 0) {
      hasByteSaturation = true;
    }

    // Exact symmetrical full-scale normalization: 255 -> +1.000, 128 -> 0.000, 0 -> -1.000
    const l = rawL >= 128 ? (rawL - 128) / 127 : (rawL - 128) / 128;
    const r = rawR >= 128 ? (rawR - 128) / 127 : (rawR - 128) / 128;

    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
    const absL = l < 0 ? -l : l;
    const absR = r < 0 ? -r : r;
    if (absL > maxAmpL) maxAmpL = absL;
    if (absR > maxAmpR) maxAmpR = absR;

    // 4x Cubic Spline Inter-Sample Peak Interpolation (Pruned for speed when abs > 0.4)
    if (i >= 1 && i < len - 2) {
      if (absL > 0.4) {
        const rawP0 = tdL[i - 1];
        const rawP2 = tdL[i + 1];
        const rawP3 = tdL[i + 2];
        const p0 = rawP0 >= 128 ? (rawP0 - 128) / 127 : (rawP0 - 128) / 128;
        const p2 = rawP2 >= 128 ? (rawP2 - 128) / 127 : (rawP2 - 128) / 128;
        const p3 = rawP3 >= 128 ? (rawP3 - 128) / 127 : (rawP3 - 128) / 128;
        const a = -0.5 * p0 + 1.5 * l - 1.5 * p2 + 0.5 * p3;
        const b = p0 - 2.5 * l + 2.0 * p2 - 0.5 * p3;
        const c = -0.5 * p0 + 0.5 * p2;
        const d = l;
        const v1 = Math.abs(((a * 0.25 + b) * 0.25 + c) * 0.25 + d);
        const v2 = Math.abs(((a * 0.50 + b) * 0.50 + c) * 0.50 + d);
        const v3 = Math.abs(((a * 0.75 + b) * 0.75 + c) * 0.75 + d);
        const peakInterp = Math.max(v1, v2, v3);
        if (peakInterp > maxTpAmpL) maxTpAmpL = peakInterp;
      }
      if (absR > 0.4) {
        const rawP0 = tdR[i - 1];
        const rawP2 = tdR[i + 1];
        const rawP3 = tdR[i + 2];
        const p0 = rawP0 >= 128 ? (rawP0 - 128) / 127 : (rawP0 - 128) / 128;
        const p2 = rawP2 >= 128 ? (rawP2 - 128) / 127 : (rawP2 - 128) / 128;
        const p3 = rawP3 >= 128 ? (rawP3 - 128) / 127 : (rawP3 - 128) / 128;
        const a = -0.5 * p0 + 1.5 * r - 1.5 * p2 + 0.5 * p3;
        const b = p0 - 2.5 * r + 2.0 * p2 - 0.5 * p3;
        const c = -0.5 * p0 + 0.5 * p2;
        const d = r;
        const v1 = Math.abs(((a * 0.25 + b) * 0.25 + c) * 0.25 + d);
        const v2 = Math.abs(((a * 0.50 + b) * 0.50 + c) * 0.50 + d);
        const v3 = Math.abs(((a * 0.75 + b) * 0.75 + c) * 0.75 + d);
        const peakInterp = Math.max(v1, v2, v3);
        if (peakInterp > maxTpAmpR) maxTpAmpR = peakInterp;
      }
    }
  }
  maxAmp = Math.max(maxAmpL, maxAmpR);
  maxTpAmpL = Math.max(maxTpAmpL, maxAmpL);
  maxTpAmpR = Math.max(maxTpAmpR, maxAmpR);
  const maxTp = Math.max(maxTpAmpL, maxTpAmpR);

  const denom = Math.sqrt(sumL2 * sumR2);
  const corr = denom > 1e-4 ? Math.max(-1, Math.min(1, sumLR / denom)) : 1.0;
  const sumSq = sumL2 + sumR2;
  return { corr, sumSq, maxAmp, maxAmpL, maxAmpR, maxTp, maxTpAmpL, maxTpAmpR, hasByteSaturation, len };
}

// --- Stereo Phase Correlation & Timbre Balance Calculation ---
export function updateMeters(timeDomainL, timeDomainR, freqDataL, freqDataR, mrData = null, metrics = null) {
  if (!state.audioBuffer || !state.isPlaying) {
    state.peaks.spectrum.realtimeDbL = -60;
    state.peaks.spectrum.realtimeDbR = -60;
    state.peaks.spectrum.realtimeDbTp = -60;
    state.peaks.gonio.realtimeLevelDb = -60;
    updatePeakBadges();
    if (correlationVal) correlationVal.textContent = '+1.00';
    if (correlationBar) {
      correlationBar.style.left = '50%';
      correlationBar.style.width = '0%';
      correlationBar.style.backgroundColor = 'var(--success)';
    }
    return;
  }

  // 1. Stereo Phase Correlation (Re-use unified metrics if provided, else compute)
  const m = metrics || analyzeTimeDomainMetrics(timeDomainL, timeDomainR);
  const r = m.corr;

  // Update Universal Realtime Peak Levels & Clip Alerts (Active across all visualizer modes)
  const dbL = m.maxAmpL > 0.0001 ? 20 * Math.log10(m.maxAmpL) : -60;
  const dbR = m.maxAmpR > 0.0001 ? 20 * Math.log10(m.maxAmpR) : -60;
  state.peaks.spectrum.realtimeDbL = dbL;
  state.peaks.spectrum.realtimeDbR = dbR;

  // True Peak (dBTP) via 4x Cubic Spline Intersample Oversampling
  const dbTp = m.maxTp > 0.0001 ? 20 * Math.log10(m.maxTp) : -60;
  state.peaks.spectrum.realtimeDbTp = dbTp;
  if (dbTp > state.peaks.spectrum.maxPeakDbTp) state.peaks.spectrum.maxPeakDbTp = dbTp;

  const nowTime = performance.now();
  const isCurClipL = (dbL >= -0.05 || m.maxAmpL >= 0.994);
  const isCurClipR = (dbR >= -0.05 || m.maxAmpR >= 0.994);
  const isCurClipTp = (dbTp >= 0.0);
  const isAnyClip = isCurClipL || isCurClipR || isCurClipTp || m.hasByteSaturation;

  if (isCurClipL) {
    state.peaks.spectrum.clipHoldUntilL = nowTime + 450;
  }
  if (isCurClipR) {
    state.peaks.spectrum.clipHoldUntilR = nowTime + 450;
  }

  // Realtime Clip Counter (Active during all playback, whether original bypassed audio or mastering active)
  const isMutedBySeek = nowTime < (state.peaks.spectrum._seekMuteUntil || 0);
  if (isAnyClip && !isMutedBySeek) {
    // Musical event debounce: continuous clipping passage counts as a single event
    if (nowTime >= (state.peaks.spectrum._clipCooldownUntil || 0)) {
      state.peaks.spectrum.clipCount++;
      state.peaks.spectrum._clipCooldownUntil = nowTime + 350;
    }
  }

  if (dbL > state.peaks.spectrum.maxPeakDbL) state.peaks.spectrum.maxPeakDbL = dbL;
  if (dbR > state.peaks.spectrum.maxPeakDbR) state.peaks.spectrum.maxPeakDbR = dbR;

  // Track Min (Worst) Phase Correlation
  if (r < state.peaks.gonio.minCorrelation) {
    state.peaks.gonio.minCorrelation = r;
  }
  updatePeakBadges();

  // Display correlation
  if (correlationVal) {
    correlationVal.textContent = (r >= 0 ? '+' : '') + r.toFixed(2);
  }
  if (correlationBar) {
    if (r >= 0) {
      correlationBar.style.left = '50%';
      correlationBar.style.width = `${(r * 50).toFixed(1)}%`;
      correlationBar.style.backgroundColor = r > 0.3 ? 'var(--success)' : 'var(--warning)';
    } else {
      const widthPct = Math.abs(r) * 50;
      correlationBar.style.left = `${(50 - widthPct).toFixed(1)}%`;
      correlationBar.style.width = `${widthPct.toFixed(1)}%`;
      correlationBar.style.backgroundColor = 'var(--danger)';
    }
  }

  // 2. Multi-band Timbre Balance
  const nyquist = (state.audioCtx ? state.audioCtx.sampleRate : 44100) / 2;
  const isMulti = state.fftMode === 'multi' && mrData && mrData.lowL;

  state.bands.forEach((band, idx) => {
    let energyL = 0;
    let energyR = 0;
    let count = 0;

    if (isMulti) {
      // Select optimal multi-res buffer according to band frequency
      let bL, bR;
      if (band.max <= 250) {
        bL = mrData.lowL;
        bR = mrData.lowR;
      } else if (band.min >= 2500) {
        bL = mrData.highL;
        bR = mrData.highR;
      } else {
        bL = mrData.midL;
        bR = mrData.midR;
      }
      const bWidth = nyquist / bL.length;
      const sBin = Math.max(0, Math.floor(band.min / bWidth));
      const eBin = Math.min(bL.length - 1, Math.floor(band.max / bWidth));
      for (let b = sBin; b <= eBin; b++) {
        energyL += bL[b];
        energyR += bR[b];
        count++;
      }
    } else {
      const binWidth = nyquist / freqDataL.length;
      const startBin = Math.max(0, Math.floor(band.min / binWidth));
      const endBin = Math.min(freqDataL.length - 1, Math.floor(band.max / binWidth));
      for (let b = startBin; b <= endBin; b++) {
        energyL += freqDataL[b];
        energyR += freqDataR[b];
        count++;
      }
    }

    const avgL = count > 0 ? energyL / count : 0;
    const avgR = count > 0 ? energyR / count : 0;
    const total = avgL + avgR;

    const bandEl = cachedBandElements[idx];
    const fillL = bandEl ? bandEl.fillL : document.getElementById(`bandFillL_${idx}`);
    const fillR = bandEl ? bandEl.fillR : document.getElementById(`bandFillR_${idx}`);
    const diffSpan = bandEl ? bandEl.diffSpan : document.getElementById(`bandDiffVal_${idx}`);

    if (fillL && fillR && diffSpan) {
      if (total > 4) {
        // Balance percentage (-50% to +50%)
        const balance = (avgR - avgL) / total; // -1 to +1
        if (balance > 0) {
          fillL.style.width = '0%';
          fillR.style.width = `${Math.min(50, balance * 50).toFixed(1)}%`;
        } else {
          fillR.style.width = '0%';
          fillL.style.width = `${Math.min(50, Math.abs(balance) * 50).toFixed(1)}%`;
        }

        // Approx dB difference (clamped for layout stability)
        const diffDb = 20 * Math.log10(Math.max(0.01, avgL) / Math.max(0.01, avgR));
        const clamped = Math.min(99, Math.abs(diffDb)).toFixed(1);
        const diffText = Math.abs(diffDb) < 0.3 ? 'Center' : (diffDb > 0 ? `L +${clamped}dB` : `R +${clamped}dB`);
        diffSpan.textContent = diffText;
        diffSpan.style.color = Math.abs(diffDb) > 3 ? (diffDb > 0 ? 'var(--accent-l)' : 'var(--accent-r)') : 'var(--text-muted)';
      } else {
        fillL.style.width = '0%';
        fillR.style.width = '0%';
        diffSpan.textContent = 'Center';
        diffSpan.style.color = 'var(--text-sub)';
      }
    }
  });
}
