import { state } from '../state/appState';
import { spectrumCanvas, spectrumTooltip } from '../ui/dom';
import { canvasCache } from './common';
import type { MRFFTData } from '../audio/context';

export const freqLabels = [20, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000];
export const minFreq = 20;
export const maxFreq = 20000;

export function freqToX(freq: number, width: number): number {
  const minLog = Math.log10(minFreq);
  const maxLog = Math.log10(maxFreq);
  return ((Math.log10(freq) - minLog) / (maxLog - minLog)) * width;
}

// --- High-Performance Logarithmic Frequency Look-Up Table (LUT) (v2.2.0) ---
let freqLUT: Float32Array | null = null;
let freqLUTWidth = 0;

export function ensureFreqLUT(width: number): Float32Array {
  const w = width | 0;
  if (freqLUT && freqLUTWidth === w) return freqLUT;
  freqLUTWidth = w;
  freqLUT = new Float32Array(w + 1);
  const minLog = Math.log10(minFreq);
  const maxLog = Math.log10(maxFreq);
  const logRange = maxLog - minLog;
  for (let x = 0; x <= w; x++) {
    freqLUT[x] = Math.pow(10, minLog + (x / w) * logRange);
  }
  return freqLUT;
}

export function xToFreq(x: number, width: number): number {
  const w = width | 0;
  if (freqLUT && freqLUTWidth === w) {
    const idx = x | 0;
    if (idx >= 0 && idx <= w) return freqLUT[idx];
    return idx < 0 ? minFreq : maxFreq;
  }
  if (w > 0) {
    ensureFreqLUT(w);
    const idx = x | 0;
    if (idx >= 0 && idx <= w) return freqLUT[idx];
  }
  const minLog = Math.log10(minFreq);
  const maxLog = Math.log10(maxFreq);
  return Math.pow(10, minLog + (x / width) * (maxLog - minLog));
}

// --- Multi-Resolution Sample Interpolator (MRFFT) ---
// Smoothly samples from 8192 (Low) -> 2048 (Mid) -> 512 (High) with hermite crossfades
export function getMultiResSample(
  freq: number,
  bufLow: Uint8Array,
  bufMid: Uint8Array,
  bufHigh: Uint8Array,
  nyquist: number
): number {
  // Band 1: Deep Bass & Bass (< 220 Hz) -> Low Analyser (8192 FFT, ~5.4Hz / bin)
  if (freq < 220) {
    const bin = Math.min(bufLow.length - 1, Math.round(freq * (bufLow.length / nyquist)));
    return bufLow[bin];
  }
  // Crossfade 1: 220 Hz - 360 Hz (Smooth transition from 8192 to 2048)
  else if (freq < 360) {
    const t = (freq - 220) * 0.007142857; // 1 / 140
    const bL = Math.min(bufLow.length - 1, Math.round(freq * (bufLow.length / nyquist)));
    const bM = Math.min(bufMid.length - 1, Math.round(freq * (bufMid.length / nyquist)));
    return bufLow[bL] * (1 - t) + bufMid[bM] * t;
  }
  // Band 2: Low-Mid & High-Mid (360 Hz - 2200 Hz) -> Mid Analyser (2048 FFT, ~21.5Hz / bin)
  else if (freq < 2200) {
    const bin = Math.min(bufMid.length - 1, Math.round(freq * (bufMid.length / nyquist)));
    return bufMid[bin];
  }
  // Crossfade 2: 2200 Hz - 3200 Hz (Smooth transition from 2048 to 512)
  else if (freq < 3200) {
    const t = (freq - 2200) * 0.001; // 1 / 1000
    const bM = Math.min(bufMid.length - 1, Math.round(freq * (bufMid.length / nyquist)));
    const bH = Math.min(bufHigh.length - 1, Math.round(freq * (bufHigh.length / nyquist)));
    return bufMid[bM] * (1 - t) + bufHigh[bH] * t;
  }
  // Band 3: Presence & Brilliance (> 3200 Hz) -> High Analyser (512 FFT, 10.7ms fast transient)
  else {
    const bin = Math.min(bufHigh.length - 1, Math.round(freq * (bufHigh.length / nyquist)));
    return bufHigh[bin];
  }
}

export function freqToNote(freq: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const semitone = 12 * (Math.log(freq / 440) / Math.log(2));
  const noteIndex = Math.round(semitone) + 69;
  const name = notes[noteIndex % 12];
  const oct = Math.floor(noteIndex / 12) - 1;
  return `${name}${oct}`;
}

export function drawSpectrumEnvelope(
  ctx: CanvasRenderingContext2D,
  cumData: Float32Array | null,
  width: number,
  height: number,
  _nyquist: number,
  binWidth: number,
  strokeColor: string,
  isDashed: boolean = false,
  lineWidth: number = 1.6
) {
  if (!cumData) return;
  const usableHeight = height - 20;
  const lut = ensureFreqLUT(width);
  ctx.save();
  ctx.beginPath();
  let first = true;
  for (let x = 0; x < width; x += 2) {
    const freq = lut[x];
    const binIndex = Math.min(cumData.length - 1, Math.floor(freq / binWidth));
    const val = cumData[binIndex] / 255;
    if (val <= 0.01) continue;
    const y = height - (val * usableHeight);
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (!first) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    if (isDashed) {
      ctx.setLineDash([4, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSpectrumPath(
  ctx: CanvasRenderingContext2D,
  freqData: Uint8Array,
  width: number,
  height: number,
  nyquist: number,
  binWidth: number,
  fillColor: string,
  strokeColor: string,
  _peakHold: Float32Array | null = null,
  isMulti: boolean = false,
  bufLow: Uint8Array | null = null,
  bufMid: Uint8Array | null = null,
  bufHigh: Uint8Array | null = null
) {
  const usableHeight = height - 20;
  const lut = ensureFreqLUT(width);
  ctx.beginPath();
  ctx.moveTo(0, height);

  let first = true;
  for (let x = 0; x < width; x += 2) {
    const freq = lut[x];
    let rawVal: number;
    if (isMulti && bufLow && bufMid && bufHigh) {
      rawVal = getMultiResSample(freq, bufLow, bufMid, bufHigh, nyquist);
    } else {
      const binIndex = Math.min(freqData.length - 1, Math.floor(freq / binWidth));
      rawVal = freqData[binIndex];
    }
    const val = rawVal / 255; // 0 to 1
    const y = height - (val * usableHeight);

    if (first) {
      ctx.lineTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.lineWidth = 1.8;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}

export function drawDifferenceSpectrum(
  ctx: CanvasRenderingContext2D,
  freqDataL: Uint8Array,
  freqDataR: Uint8Array,
  width: number,
  height: number,
  nyquist: number,
  binWidth: number,
  isMulti: boolean = false,
  mrData: MRFFTData | null = null
) {
  const midY = height / 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();

  ctx.fillStyle = '#00f0ff';
  ctx.fillText('▲ LEFT DOMINANT (+dB)', 10, midY - 12);
  ctx.fillStyle = '#ff2a8d';
  ctx.fillText('▼ RIGHT DOMINANT (-dB)', 10, midY + 22);

  const lut = ensureFreqLUT(width);
  const barWidth = 3;
  for (let x = 0; x < width; x += barWidth + 1) {
    const freq = lut[x];
    let valL: number, valR: number;
    if (isMulti && mrData && mrData.lowL) {
      valL = getMultiResSample(freq, mrData.lowL, mrData.midL, mrData.highL, nyquist);
      valR = getMultiResSample(freq, mrData.lowR, mrData.midR, mrData.highR, nyquist);
    } else {
      const binIndex = Math.min(freqDataL.length - 1, Math.floor(freq / binWidth));
      valL = freqDataL[binIndex];
      valR = freqDataR[binIndex];
    }
    const diff = (valL - valR) / 255; // -1 to +1
    const barH = diff * (midY - 20);

    if (diff > 0) {
      ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
      ctx.fillRect(x, midY - barH, barWidth, barH);
    } else {
      ctx.fillStyle = 'rgba(255, 42, 141, 0.7)';
      ctx.fillRect(x, midY, barWidth, -barH);
    }
  }
}

// --- Main Spectrum Analyzer Render Function ---
export function renderSpectrum(
  _timeDomainL: Uint8Array,
  _timeDomainR: Uint8Array,
  freqDataL: Uint8Array,
  freqDataR: Uint8Array,
  mrData: MRFFTData | null = null
) {
  const width = canvasCache.spectrum.width;
  const height = canvasCache.spectrum.height;
  if (width <= 0 || height <= 0 || !spectrumCanvas) return;

  const lut = ensureFreqLUT(width);
  const ctx = spectrumCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const nyquist = (state.audioCtx ? state.audioCtx.sampleRate : 44100) / 2;
  const isMulti = state.fftMode === 'multi' && mrData && mrData.lowL;
  const binCount = isMulti ? mrData.lowL.length : freqDataL.length;
  const binWidth = nyquist / binCount;

  // Draw Grid & Labels
  ctx.lineWidth = 1;
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';

  // Frequency vertical grid
  freqLabels.forEach(freq => {
    const x = freqToX(freq, width);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
    ctx.fillText(label, x + 3, height - 6);
  });

  // dB horizontal grid
  const dBLabels = [0, -12, -24, -36, -48, -60];
  dBLabels.forEach(db => {
    const y = (-db / 60) * (height - 24);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(`${db}dB`, 6, y + 10);
  });

  if (!state.audioBuffer) return;

  // Scan frequency bins for instantaneous and session peaks
  let curMaxVal = 0;
  let curMaxFreq = 0;
  let curMaxL = 0;
  let curMaxR = 0;

  if (isMulti) {
    for (let x = 0; x < width; x += 3) {
      const f = lut[x];
      const valL = getMultiResSample(f, mrData.lowL, mrData.midL, mrData.highL, nyquist);
      const valR = getMultiResSample(f, mrData.lowR, mrData.midR, mrData.highR, nyquist);
      if (valL > curMaxL) curMaxL = valL;
      if (valR > curMaxR) curMaxR = valR;

      const maxCh = Math.max(valL, valR);
      if (maxCh > curMaxVal) {
        curMaxVal = maxCh;
        curMaxFreq = f;
      }
    }
  } else {
    for (let i = 0; i < binCount; i++) {
      const valL = freqDataL[i];
      const valR = freqDataR[i];
      if (valL > curMaxL) curMaxL = valL;
      if (valR > curMaxR) curMaxR = valR;

      const maxCh = Math.max(valL, valR);
      if (maxCh > curMaxVal) {
        curMaxVal = maxCh;
        const freq = i * binWidth;
        if (freq >= minFreq && freq <= maxFreq) {
          curMaxFreq = freq;
        }
      }
    }
  }

  if (!state.cumulativeMaxL || state.cumulativeMaxL.length !== binCount) {
    state.cumulativeMaxL = new Float32Array(binCount);
    state.cumulativeMaxR = new Float32Array(binCount);
  }

  if (state.isPlaying) {
    // Track frequency-by-frequency cumulative maximums across the whole song
    if (isMulti) {
      for (let i = 0; i < binCount; i++) {
        if (mrData.lowL[i] > state.cumulativeMaxL[i]) state.cumulativeMaxL[i] = mrData.lowL[i];
        if (mrData.lowR[i] > state.cumulativeMaxR[i]) state.cumulativeMaxR[i] = mrData.lowR[i];
      }
    } else {
      for (let i = 0; i < binCount; i++) {
        if (freqDataL[i] > state.cumulativeMaxL[i]) state.cumulativeMaxL[i] = freqDataL[i];
        if (freqDataR[i] > state.cumulativeMaxR[i]) state.cumulativeMaxR[i] = freqDataR[i];
      }
    }

    if (curMaxVal > 0 && curMaxFreq > 0 && curMaxVal / 255 > 0.2) {
      state.peaks.spectrum.maxPeakFreq = curMaxFreq;
    }

    // Dynamic Mastering Audio Accumulation (active after Reset)
    if (state.dynamicAcc.spectrumAccumulating) {
      const acc = state.dynamicAcc;
      if (!acc.spectrumHistL || acc.spectrumHistL.length !== binCount * 128) {
        acc.spectrumHistL = new Uint32Array(binCount * 128);
        acc.spectrumHistR = new Uint32Array(binCount * 128);
        acc.spectrumSliceCount = 0;
      }

      const histL = acc.spectrumHistL;
      const histR = acc.spectrumHistR;
      const dataL = isMulti ? mrData.lowL : freqDataL;
      const dataR = isMulti ? mrData.lowR : freqDataR;

      // 128 bins (0-255 mapped to 0-127 via >> 1)
      for (let i = 0; i < binCount; i++) {
        const bL = Math.min(127, dataL[i] >> 1);
        const bR = Math.min(127, dataR[i] >> 1);
        histL[i * 128 + bL]++;
        histR[i * 128 + bR]++;
      }
      acc.spectrumSliceCount++;

      // Recalculate 80th percentile envelope periodically (every 6 frames ~ 10Hz to preserve 60FPS)
      if (acc.spectrumSliceCount % 6 === 0 || acc.spectrumSliceCount <= 10) {
        const targetCount = Math.floor(acc.spectrumSliceCount * 0.80);
        for (let i = 0; i < binCount; i++) {
          const offset = i * 128;
          let cL = 0;
          let p80L = 0;
          for (let b = 0; b < 128; b++) {
            cL += histL[offset + b];
            if (cL >= targetCount) {
              p80L = (b << 1) + 1;
              break;
            }
          }
          state.envelope80L[i] = p80L;

          let cR = 0;
          let p80R = 0;
          for (let b = 0; b < 128; b++) {
            cR += histR[offset + b];
            if (cR >= targetCount) {
              p80R = (b << 1) + 1;
              break;
            }
          }
          state.envelope80R[i] = p80R;
        }
      }
    }
  }

  // Mode: Overlay, Split, or Difference
  if (state.viewMode === 'overlay') {
    // Draw Left (Cyan fill + stroke)
    drawSpectrumPath(ctx, freqDataL, width, height, nyquist, binWidth, 'rgba(0, 240, 255, 0.25)', '#00f0ff', state.peakHoldL, isMulti, mrData ? mrData.lowL : null, mrData ? mrData.midL : null, mrData ? mrData.highL : null);
    // Draw Right (Magenta fill + stroke with screen/lighter blend)
    ctx.globalCompositeOperation = 'screen';
    drawSpectrumPath(ctx, freqDataR, width, height, nyquist, binWidth, 'rgba(255, 42, 141, 0.25)', '#ff2a8d', state.peakHoldR, isMulti, mrData ? mrData.lowR : null, mrData ? mrData.midR : null, mrData ? mrData.highR : null);
    ctx.globalCompositeOperation = 'source-over';
  } else if (state.viewMode === 'split') {
    const halfH = height / 2;
    // Top: Left Channel
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, halfH);
    ctx.clip();
    drawSpectrumPath(ctx, freqDataL, width, halfH, nyquist, binWidth, 'rgba(0, 240, 255, 0.25)', '#00f0ff', state.peakHoldL, isMulti, mrData ? mrData.lowL : null, mrData ? mrData.midL : null, mrData ? mrData.highL : null);
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('LEFT CHANNEL', width - 85, 18);
    ctx.restore();

    // Divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(width, halfH);
    ctx.stroke();

    // Bottom: Right Channel
    ctx.save();
    ctx.translate(0, halfH);
    ctx.beginPath();
    ctx.rect(0, 0, width, halfH);
    ctx.clip();
    drawSpectrumPath(ctx, freqDataR, width, halfH, nyquist, binWidth, 'rgba(255, 42, 141, 0.25)', '#ff2a8d', state.peakHoldR, isMulti, mrData ? mrData.lowR : null, mrData ? mrData.midR : null, mrData ? mrData.highR : null);
    ctx.fillStyle = '#ff2a8d';
    ctx.fillText('RIGHT CHANNEL', width - 92, 18);
    ctx.restore();
  } else if (state.viewMode === 'difference') {
    // Timbre EQ Difference (L - R)
    drawDifferenceSpectrum(ctx, freqDataL, freqDataR, width, height, nyquist, binWidth, isMulti, mrData);
  }

  // Render Spectrum Envelopes: Core (80% Percentile, Solid) & Peak (100%, Dashed)
  if (state.viewMode === 'overlay') {
    // Core (80th percentile) Solid lines (shadowBlur disabled for high-FPS rendering)
    drawSpectrumEnvelope(ctx, state.envelope80L, width, height, nyquist, binWidth, '#00f0ff', false, 2.0);
    drawSpectrumEnvelope(ctx, state.envelope80R, width, height, nyquist, binWidth, '#ff2a8d', false, 2.0);
    // Peak (100%) Dashed lines
    drawSpectrumEnvelope(ctx, state.cumulativeMaxL, width, height, nyquist, binWidth, 'rgba(0, 240, 255, 0.65)', true, 1.2);
    drawSpectrumEnvelope(ctx, state.cumulativeMaxR, width, height, nyquist, binWidth, 'rgba(255, 42, 141, 0.65)', true, 1.2);
  } else if (state.viewMode === 'split') {
    const halfH = height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, halfH);
    ctx.clip();
    drawSpectrumEnvelope(ctx, state.envelope80L, width, halfH, nyquist, binWidth, '#00f0ff', false, 2.0);
    drawSpectrumEnvelope(ctx, state.cumulativeMaxL, width, halfH, nyquist, binWidth, 'rgba(0, 240, 255, 0.65)', true, 1.2);
    ctx.restore();

    ctx.save();
    ctx.translate(0, halfH);
    ctx.beginPath();
    ctx.rect(0, 0, width, halfH);
    ctx.clip();
    drawSpectrumEnvelope(ctx, state.envelope80R, width, halfH, nyquist, binWidth, '#ff2a8d', false, 2.0);
    drawSpectrumEnvelope(ctx, state.cumulativeMaxR, width, halfH, nyquist, binWidth, 'rgba(255, 42, 141, 0.65)', true, 1.2);
    ctx.restore();
  }

  // Legend on Spectrum Canvas (Top-Right)
  if (state.audioBuffer && (state.envelope80L || state.cumulativeMaxL)) {
    ctx.save();
    ctx.font = '9px "SF Mono", Monaco, monospace';
    const legX = width - (isMulti ? 240 : 165);
    const legY = 16;
    if (isMulti) {
      ctx.fillStyle = 'rgba(0, 240, 255, 0.85)';
      ctx.fillText('⚡ Multi-Res FFT', legX, legY + 3);
    }
    // Core 80% legend: Solid line
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(legX + (isMulti ? 75 : 0), legY);
    ctx.lineTo(legX + (isMulti ? 91 : 16), legY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText('Core 80%', legX + (isMulti ? 95 : 20), legY + 3);

    // Peak 100% legend: Dashed line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(legX + (isMulti ? 155 : 85), legY);
    ctx.lineTo(legX + (isMulti ? 171 : 101), legY);
    ctx.stroke();
    ctx.fillText('Peak 100%', legX + (isMulti ? 175 : 105), legY + 3);
    ctx.restore();
  }
}

// Spectrum / Spectrogram / Oscilloscope Mouse Hover Tooltip (v2.6.0)
export function initSpectrumTooltip() {
  if (!spectrumCanvas || !spectrumTooltip) return;

  spectrumCanvas.addEventListener('mousemove', (e) => {
    const rect = spectrumCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state.displayMode === 'oscilloscope') {
      const midY = rect.height / 2;
      const normAmp = (midY - y) / Math.max(1, midY - 12);
      const clampedAmp = Math.max(-1.0, Math.min(1.0, normAmp));
      const absAmp = Math.abs(clampedAmp);
      const ampDb = absAmp > 0.0001 ? (20 * Math.log10(absAmp)).toFixed(1) + ' dBFS' : '-∞ dBFS';
      const sampleRate = state.audioCtx ? state.audioCtx.sampleRate : 44100;
      const totalMs = (1024 / sampleRate) * 1000;
      const tMs = (x / Math.max(1, rect.width)) * totalMs;

      spectrumTooltip.style.opacity = '1';
      spectrumTooltip.style.left = `${Math.min(rect.width - 140, Math.max(10, x - 60))}px`;
      spectrumTooltip.style.top = `${Math.max(10, y - 40)}px`;
      spectrumTooltip.innerHTML = `<strong>${(clampedAmp * 100).toFixed(0)}%</strong> (${ampDb}) | <strong>${tMs.toFixed(1)} ms</strong>`;
    } else if (state.displayMode === 'spectrogram') {
      const minLog = Math.log10(minFreq);
      const maxLog = Math.log10(maxFreq);
      const ratio = (rect.height - y) / Math.max(1, rect.height);
      const freq = Math.pow(10, minLog + ratio * (maxLog - minLog));
      if (freq >= minFreq && freq <= maxFreq) {
        const note = freqToNote(freq);
        spectrumTooltip.style.opacity = '1';
        spectrumTooltip.style.left = `${Math.min(rect.width - 130, Math.max(10, x - 50))}px`;
        spectrumTooltip.style.top = `${Math.max(10, y - 40)}px`;
        spectrumTooltip.innerHTML = `<strong>${freq >= 1000 ? (freq / 1000).toFixed(2) + ' kHz' : Math.round(freq) + ' Hz'}</strong> (${note})`;
      }
    } else {
      const freq = xToFreq(x, rect.width);
      if (freq >= minFreq && freq <= maxFreq) {
        const note = freqToNote(freq);
        spectrumTooltip.style.opacity = '1';
        spectrumTooltip.style.left = `${Math.min(rect.width - 120, Math.max(10, x - 50))}px`;
        spectrumTooltip.style.top = `${Math.max(10, y - 40)}px`;
        spectrumTooltip.innerHTML = `<strong>${freq >= 1000 ? (freq / 1000).toFixed(2) + ' kHz' : Math.round(freq) + ' Hz'}</strong> (${note})`;
      }
    }
  });

  spectrumCanvas.addEventListener('mouseleave', () => {
    spectrumTooltip.style.opacity = '0';
  });
}
