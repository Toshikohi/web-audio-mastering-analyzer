import { state } from '../state/appState';
import { spectrumCanvas } from '../ui/dom';
import { canvasCache } from './common';
import { freqLabels, minFreq, maxFreq, getMultiResSample } from './spectrum';
import type { MRFFTData } from '../audio/context';

// --- High-Performance Spectrogram (Waterfall) Engine (v2.6.0) ---
const spectroCanvas = document.createElement('canvas');
const spectroCtx = spectroCanvas.getContext('2d', { willReadFrequently: true });
let spectroLUT_Y: Float32Array | null = null;
let spectroLUTHeight = 0;
let spectroSlice: ImageData | null = null;
let spectroSlice32: Uint32Array | null = null;
const SPECTRO_SCROLL_SPEED = 2; // px per frame

// Precomputed 256-color Heatmap Palette (Little-Endian ABGR Uint32 for direct buffer copy)
export const SPECTRO_PALETTE_32 = new Uint32Array(256);
(function initSpectroPalette() {
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r = 0, g = 0, b = 0;
    if (t < 0.12) {
      // Deep Abyss Navy
      const p = t / 0.12;
      r = (6 + 8 * p) | 0;
      g = (8 + 10 * p) | 0;
      b = (20 + 45 * p) | 0;
    } else if (t < 0.35) {
      // Deep Blue to Violet
      const p = (t - 0.12) / 0.23;
      r = (14 + 60 * p) | 0;
      g = (18 + 12 * p) | 0;
      b = (65 + 115 * p) | 0;
    } else if (t < 0.6) {
      // Violet to Magenta / Crimson
      const p = (t - 0.35) / 0.25;
      r = (74 + 146 * p) | 0;
      g = (30 + 10 * p) | 0;
      b = (180 - 100 * p) | 0;
    } else if (t < 0.82) {
      // Crimson to Vivid Orange to Gold
      const p = (t - 0.6) / 0.22;
      r = (220 + 35 * p) | 0;
      g = (40 + 175 * p) | 0;
      b = (80 * (1 - p)) | 0;
    } else {
      // Gold to Electric Bright White
      const p = (t - 0.82) / 0.18;
      r = 255;
      g = (215 + 40 * p) | 0;
      b = (255 * p) | 0;
    }
    // Alpha = 255 (0xFF), Little-endian RGBA in memory: 0xAABBGGRR
    SPECTRO_PALETTE_32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  }
})();

export function ensureSpectroLUT_Y(height: number): Float32Array {
  const h = height | 0;
  if (spectroLUT_Y && spectroLUTHeight === h) return spectroLUT_Y;
  spectroLUTHeight = h;
  spectroLUT_Y = new Float32Array(h);
  const minLog = Math.log10(minFreq);
  const maxLog = Math.log10(maxFreq);
  const logRange = maxLog - minLog;
  for (let y = 0; y < h; y++) {
    const ratio = (h - 1 - y) / Math.max(1, h - 1);
    spectroLUT_Y[y] = Math.pow(10, minLog + ratio * logRange);
  }
  return spectroLUT_Y;
}

export function renderSpectrogram(
  freqDataL: Uint8Array,
  freqDataR: Uint8Array,
  mrData: MRFFTData | null = null
) {
  const width = canvasCache.spectrum.width;
  const height = canvasCache.spectrum.height;
  if (width <= 0 || height <= 0 || !spectrumCanvas || !spectroCtx) return;

  const ctx = spectrumCanvas.getContext('2d');
  if (!ctx) return;

  // Initialize or resize offscreen spectrogram buffer
  if (spectroCanvas.width !== width || spectroCanvas.height !== height) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = spectroCanvas.width;
    tempCanvas.height = spectroCanvas.height;
    if (tempCanvas.width > 0 && tempCanvas.height > 0) {
      tempCanvas.getContext('2d')?.drawImage(spectroCanvas, 0, 0);
    }

    spectroCanvas.width = width;
    spectroCanvas.height = height;
    spectroCtx.fillStyle = '#05070d';
    spectroCtx.fillRect(0, 0, width, height);

    if (tempCanvas.width > 0 && tempCanvas.height > 0) {
      spectroCtx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, width, height);
    }

    spectroSlice = spectroCtx.createImageData(SPECTRO_SCROLL_SPEED, height);
    spectroSlice32 = new Uint32Array(spectroSlice.data.buffer);
    ensureSpectroLUT_Y(height);
  }

  const lutY = ensureSpectroLUT_Y(height);
  const nyquist = (state.audioCtx ? state.audioCtx.sampleRate : 44100) / 2;
  const isMulti = state.fftMode === 'multi' && mrData && mrData.lowL;
  const binCount = isMulti ? mrData.lowL.length : freqDataL.length;
  const binWidth = nyquist / binCount;

  // When audio is playing, shift spectrogram left and write newest frequency slice
  if (state.isPlaying && state.audioBuffer && spectroSlice && spectroSlice32) {
    spectroCtx.drawImage(
      spectroCanvas,
      SPECTRO_SCROLL_SPEED, 0, width - SPECTRO_SCROLL_SPEED, height,
      0, 0, width - SPECTRO_SCROLL_SPEED, height
    );

    for (let y = 0; y < height; y++) {
      const f = lutY[y];
      let val = 0;
      if (isMulti) {
        const vL = getMultiResSample(f, mrData.lowL, mrData.midL, mrData.highL, nyquist);
        const vR = getMultiResSample(f, mrData.lowR, mrData.midR, mrData.highR, nyquist);
        val = Math.max(vL, vR) | 0;
      } else {
        const bin = Math.min(freqDataL.length - 1, Math.round(f / binWidth));
        val = Math.max(freqDataL[bin], freqDataR[bin]) | 0;
      }
      const col32 = SPECTRO_PALETTE_32[Math.min(255, Math.max(0, val))];
      const rowOffset = y * SPECTRO_SCROLL_SPEED;
      for (let sx = 0; sx < SPECTRO_SCROLL_SPEED; sx++) {
        spectroSlice32[rowOffset + sx] = col32;
      }
    }
    spectroCtx.putImageData(spectroSlice, width - SPECTRO_SCROLL_SPEED, 0);
  }

  // Draw spectrogram bitmap to main canvas
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(spectroCanvas, 0, 0);

  // Draw Frequency horizontal grid & labels
  ctx.lineWidth = 1;
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  const minLog = Math.log10(minFreq);
  const maxLog = Math.log10(maxFreq);
  const logRange = maxLog - minLog;

  freqLabels.forEach(freq => {
    const ratio = (Math.log10(freq) - minLog) / logRange;
    const y = Math.round((1 - ratio) * (height - 1));
    if (y < 4 || y > height - 4) return;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(4, y - 9, ctx.measureText(label).width + 6, 11);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(label, 7, y);
  });

  // Draw Color Intensity Legend Bar (Top-Right)
  const legendW = 90;
  const legendH = 8;
  const legendX = width - legendW - 12;
  const legendY = 12;

  ctx.fillStyle = 'rgba(10, 14, 23, 0.75)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX - 2, legendY - 2, legendW + 4, legendH + 4);

  const grad = ctx.createLinearGradient(legendX, 0, legendX + legendW, 0);
  grad.addColorStop(0.0, '#060814');
  grad.addColorStop(0.2, '#141845');
  grad.addColorStop(0.45, '#6a187a');
  grad.addColorStop(0.7, '#d83a12');
  grad.addColorStop(0.9, '#ffe600');
  grad.addColorStop(1.0, '#ffffff');
  ctx.fillStyle = grad;
  ctx.fillRect(legendX, legendY, legendW, legendH);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fillText('-85dB', legendX, legendY + legendH + 10);
  ctx.fillText('0dB', legendX + legendW - 18, legendY + legendH + 10);
}
