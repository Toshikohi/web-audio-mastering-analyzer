// @ts-nocheck
import { state } from '../state/appState';
import { updatePeakBadges } from '../ui/meters';

// --- Radix-2 FFT Engine for Pre-computing Track Peak Envelopes ---
export class FastFFT {
  size: number;
  cosTable: Float32Array;
  sinTable: Float32Array;
  hannWindow: Float32Array;
  bitRev: Uint32Array;
  real: Float32Array;
  imag: Float32Array;

  constructor(size = 2048) {
    this.size = size;
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    this.hannWindow = new Float32Array(size);
    this.bitRev = new Uint32Array(size);

    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    for (let i = 0; i < size; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
    }

    let j = 0;
    for (let i = 0; i < size - 1; i++) {
      this.bitRev[i] = j;
      let k = size >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }
    this.bitRev[size - 1] = size - 1;

    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);
  }

  transform(inputData, outMags, outSliceData = null, sliceOffset = 0) {
    const n = this.size;
    const real = this.real;
    const imag = this.imag;
    const win = this.hannWindow;
    const bitRev = this.bitRev;

    // Windowing and bit-reversal reordering
    for (let i = 0; i < n; i++) {
      const rev = bitRev[i];
      real[rev] = inputData[i] * win[i];
      imag[rev] = 0;
    }

    // Radix-2 in-place FFT
    for (let halfSize = 1; halfSize < n; halfSize <<= 1) {
      const step = halfSize << 1;
      const tableStep = (n / step);
      for (let i = 0; i < n; i += step) {
        for (let j = 0; j < halfSize; j++) {
          const k = j * tableStep;
          const c = this.cosTable[k];
          const s = this.sinTable[k];
          const tr = real[i + j + halfSize] * c - imag[i + j + halfSize] * s;
          const ti = real[i + j + halfSize] * s + imag[i + j + halfSize] * c;
          real[i + j + halfSize] = real[i + j] - tr;
          imag[i + j + halfSize] = imag[i + j] - ti;
          real[i + j] += tr;
          imag[i + j] += ti;
        }
      }
    }

    // Map magnitude to 0-255 dB scale matching Web Audio AnalyserNode (-100dB to -30dB)
    const binCount = n / 2;
    const minDb = -100;
    const maxDb = -30;
    const dbRange = maxDb - minDb;
    const invN = 2.0 / n;

    for (let i = 0; i < binCount; i++) {
      const r = real[i] * invN;
      const im = imag[i] * invN;
      const mag = Math.sqrt(r * r + im * im);
      let norm = 0;
      if (mag > 0.0000001) {
        const db = 20 * Math.log10(mag);
        norm = Math.max(0, Math.min(255, ((db - minDb) / dbRange) * 255));
        if (outMags && norm > outMags[i]) {
          outMags[i] = norm;
        }
      }
      if (outSliceData) {
        outSliceData[sliceOffset + i] = norm;
      }
    }
  }
}

// Pre-computes full-track Peak (100%) and Core (80th percentile) envelopes on file load
export function precomputeFullTrackEnvelopes(buffer) {
  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;
  const len = buffer.length;
  const effectiveFftSize = state.fftMode === 'multi' ? 8192 : (state.fftSize || 2048);
  const binCount = effectiveFftSize / 2;

  // 1. Clear previous song's envelopes completely
  state.cumulativeMaxL = new Float32Array(binCount);
  state.cumulativeMaxR = new Float32Array(binCount);
  state.envelope80L = new Float32Array(binCount);
  state.envelope80R = new Float32Array(binCount);
  state.angularMaxRadius = new Float32Array(360);
  state.angular80Radius = new Float32Array(360);

  state.peaks.spectrum.maxPeakFreq = 0;
  state.peaks.spectrum.maxPeakDbL = -Infinity;
  state.peaks.spectrum.maxPeakDbR = -Infinity;
  state.peaks.spectrum.maxPeakDbTp = -Infinity;
  state.peaks.spectrum.realtimeDbTp = -60;
  state.peaks.spectrum.clipCount = 0;
  state.peaks.spectrum.clipPositions = [];
  state.peaks.spectrum._clipCooldownUntil = 0;
  state.peaks.spectrum._seekMuteUntil = 0;
  state.peaks.gonio.maxRadiusPct = 0;
  state.peaks.gonio.maxLevelDb = -Infinity;
  state.peaks.gonio.minCorrelation = 1.0;

  // 2. Pre-compute Goniometer Angular Peak (100%) & Core (80% percentile) Envelope
  // Angular scale normalization: maps [-1, 1] square boundary to circular full scale (radius 1.0 = 0dBFS)
  const invSqrt2 = 0.70710678;
  // Scan all samples without downsampling to capture transient peaks
  const gonioStep = 1;
  let gonioMaxNormDist = 0;
  // 360 angles x 120 radial amplitude bins (0.00 to 1.20, binWidth = 0.01)
  const numDistBins = 120;
  const gonioHist = new Uint32Array(360 * numDistBins);

  for (let i = 0; i < len; i += gonioStep) {
    const l = chL[i];
    const r = chR[i];
    const normDist = Math.max(Math.abs(l), Math.abs(r)); // Normalized distance to circle [0.0, 1.0+]
    if (normDist > gonioMaxNormDist) gonioMaxNormDist = normDist;

    if (normDist > 0.005) {
      const gx = (r - l) * invSqrt2;
      const gy = -(l + r) * invSqrt2;
      const theta = Math.atan2(gy, gx);
      let deg = Math.floor(((theta + Math.PI) / (2 * Math.PI)) * 360);
      if (deg >= 360) deg = 359;

      // Peak (100% boundary) - store exact raw peak normalized distance without clipping
      if (normDist > state.angularMaxRadius[deg]) {
        state.angularMaxRadius[deg] = normDist;
      }

      // 80% Percentile distribution binning
      const rBin = Math.min(numDistBins - 1, Math.floor(normDist * 100));
      gonioHist[deg * numDistBins + rBin]++;
    }
  }

  // Calculate true 80th percentile radius for each angle (80% of samples fall within this radius)
  for (let deg = 0; deg < 360; deg++) {
    const offset = deg * numDistBins;
    let degTotal = 0;
    for (let b = 0; b < numDistBins; b++) {
      degTotal += gonioHist[offset + b];
    }
    if (degTotal > 5) {
      const targetCount = Math.floor(degTotal * 0.80);
      let count = 0;
      let r80Bin = 0;
      for (let b = 0; b < numDistBins; b++) {
        count += gonioHist[offset + b];
        if (count >= targetCount) {
          r80Bin = b;
          break;
        }
      }
      state.angular80Radius[deg] = Math.min(1.15, (r80Bin + 0.5) / 100);
    } else {
      state.angular80Radius[deg] = state.angularMaxRadius[deg] * 0.8;
    }
  }

  // Sample blocks across the track to pre-compute minimum phase correlation
  const corrBlockSize = 4096;
  const numCorrBlocks = Math.floor(len / corrBlockSize);
  const corrSampleStep = Math.max(1, Math.floor(numCorrBlocks / 200));
  let minCorr = 1.0;

  for (let b = 0; b < numCorrBlocks; b += corrSampleStep) {
    let sumLR = 0, sumL2 = 0, sumR2 = 0;
    const start = b * corrBlockSize;
    const end = start + corrBlockSize;
    for (let j = start; j < end; j += 4) {
      const l = chL[j];
      const r = chR[j];
      sumLR += l * r;
      sumL2 += l * l;
      sumR2 += r * r;
    }
    const denom = Math.sqrt(sumL2 * sumR2);
    if (denom > 0.01) {
      const rVal = sumLR / denom;
      if (rVal < minCorr) minCorr = rVal;
    }
  }

  state.peaks.gonio.minCorrelation = Math.max(-1.0, Math.min(1.0, minCorr));
  state.peaks.gonio.maxRadiusPct = Math.min(1.0, gonioMaxNormDist);
  state.peaks.gonio.maxLevelDb = 20 * Math.log10(Math.max(0.0001, gonioMaxNormDist));

  // 3. Pre-compute Spectrum Frequency Peak (100%) and Core (80th percentile) Envelopes
  const fastFFT = new FastFFT(effectiveFftSize);
  const blockL = new Float32Array(effectiveFftSize);
  const blockR = new Float32Array(effectiveFftSize);

  if (len < effectiveFftSize) {
    for (let j = 0; j < effectiveFftSize; j++) {
      blockL[j] = j < len ? chL[j] : 0;
      blockR[j] = j < len ? chR[j] : 0;
    }
    fastFFT.transform(blockL, state.cumulativeMaxL);
    fastFFT.transform(blockR, state.cumulativeMaxR);
    state.envelope80L.set(state.cumulativeMaxL);
    state.envelope80R.set(state.cumulativeMaxR);
    state.peaks.spectrum.realtimeDbL = -60;
    state.peaks.spectrum.realtimeDbR = -60;
    state.peaks.gonio.realtimeLevelDb = -60;
    updatePeakBadges();
    return;
  }

  const numSlices = Math.min(1200, Math.max(200, Math.floor(len / (effectiveFftSize * 2))));
  const hopSize = Math.max(1, Math.floor((len - effectiveFftSize) / numSlices));

  const allSlicesL = new Uint8Array(numSlices * binCount);
  const allSlicesR = new Uint8Array(numSlices * binCount);

  for (let s = 0; s < numSlices; s++) {
    const offset = s * hopSize;
    for (let j = 0; j < effectiveFftSize; j++) {
      const idx = offset + j;
      blockL[j] = idx < len ? chL[idx] : 0;
      blockR[j] = idx < len ? chR[idx] : 0;
    }
    fastFFT.transform(blockL, state.cumulativeMaxL, allSlicesL, s * binCount);
    fastFFT.transform(blockR, state.cumulativeMaxR, allSlicesR, s * binCount);
  }

  // Calculate true 80th percentile for each frequency bin across all slices (80% of song time is <= this level)
  const histL = new Uint16Array(256);
  const histR = new Uint16Array(256);
  const targetSliceCount = Math.floor(numSlices * 0.80);

  for (let k = 0; k < binCount; k++) {
    histL.fill(0);
    histR.fill(0);
    for (let s = 0; s < numSlices; s++) {
      const idx = s * binCount + k;
      histL[allSlicesL[idx]]++;
      histR[allSlicesR[idx]]++;
    }

    let countL = 0;
    let p80L = 0;
    for (let v = 0; v < 256; v++) {
      countL += histL[v];
      if (countL >= targetSliceCount) {
        p80L = v;
        break;
      }
    }
    state.envelope80L[k] = p80L;

    let countR = 0;
    let p80R = 0;
    for (let v = 0; v < 256; v++) {
      countR += histR[v];
      if (countR >= targetSliceCount) {
        p80R = v;
        break;
      }
    }
    state.envelope80R[k] = p80R;
  }

  // Find dominant peak frequency and overall peak dB across precomputed spectrum
  const nyquist = buffer.sampleRate / 2;
  const binWidth = nyquist / binCount;
  let overallMaxVal = 0;
  let dominantFreq = 0;
  let maxL = 0, maxR = 0;

  for (let k = 0; k < binCount; k++) {
    const vL = state.cumulativeMaxL[k];
    const vR = state.cumulativeMaxR[k];
    if (vL > maxL) maxL = vL;
    if (vR > maxR) maxR = vR;
    const maxBin = Math.max(vL, vR);
    if (maxBin > overallMaxVal) {
      overallMaxVal = maxBin;
      dominantFreq = k * binWidth;
    }
  }

  state.peaks.spectrum.maxPeakFreq = dominantFreq;
  state.peaks.spectrum.maxPeakDbL = maxL > 0 ? 20 * Math.log10(maxL / 255) : -60;
  state.peaks.spectrum.maxPeakDbR = maxR > 0 ? 20 * Math.log10(maxR / 255) : -60;
  state.peaks.spectrum.realtimeDbL = -60;
  state.peaks.spectrum.realtimeDbR = -60;
  state.peaks.gonio.realtimeLevelDb = -60;
  // Reset dynamic accumulation state to false (showing full-track precomputed summaries)
  state.dynamicAcc.spectrumAccumulating = false;
  state.dynamicAcc.spectrumSliceCount = 0;
  state.dynamicAcc.spectrumHistL = null;
  state.dynamicAcc.spectrumHistR = null;
  state.dynamicAcc.gonioAccumulating = false;
  if (state.dynamicAcc.gonioHist) state.dynamicAcc.gonioHist.fill(0);
  if (state.dynamicAcc.gonioAngleCounts) state.dynamicAcc.gonioAngleCounts.fill(0);
  state.dynamicAcc._gonioFrame = 0;

  updatePeakBadges();
}
