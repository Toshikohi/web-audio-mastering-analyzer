// @ts-nocheck

// --- Mastering Presets ---
export const MASTERING_PRESETS = {
  clean: {
    clean: { enabled: true, lowCut: 25, monoMaker: 120, tone: 0.5, air: 1.2 },
    comp: { enabled: true, threshold: -10.5, mix: 85, ratio: 4 },
    sat: { enabled: true, mode: 'tape', drive: 25, warmth: 1.5, oversample: '4x' },
    width: { enabled: true, spread: 115 },
    max: { enabled: true, boost: 3.5, ceiling: -0.1, response: 'smooth' }
  },
  warm: {
    clean: { enabled: true, lowCut: 35, monoMaker: 100, tone: -0.5, air: 0.5 },
    comp: { enabled: true, threshold: -12.0, mix: 90, ratio: 4 },
    sat: { enabled: true, mode: 'tube', drive: 40, warmth: 2.5, oversample: '4x' },
    width: { enabled: true, spread: 110 },
    max: { enabled: true, boost: 4.0, ceiling: -0.2, response: 'smooth' }
  },
  punch: {
    clean: { enabled: true, lowCut: 30, monoMaker: 140, tone: 1.0, air: 2.0 },
    comp: { enabled: true, threshold: -14.0, mix: 95, ratio: 4 },
    sat: { enabled: true, mode: 'tape', drive: 32, warmth: 1.0, oversample: '4x' },
    width: { enabled: true, spread: 125 },
    max: { enabled: true, boost: 4.8, ceiling: -0.1, response: 'punchy' }
  },
  loud: {
    clean: { enabled: true, lowCut: 35, monoMaker: 120, tone: 0.8, air: 1.5 },
    comp: { enabled: true, threshold: -16.0, mix: 100, ratio: 8 },
    sat: { enabled: true, mode: 'tape', drive: 38, warmth: 1.5, oversample: '4x' },
    width: { enabled: true, spread: 120 },
    max: { enabled: true, boost: 6.5, ceiling: -0.1, response: 'fast' }
  },
  acoustic: {
    clean: { enabled: true, lowCut: 25, monoMaker: 80, tone: 0.2, air: 2.5 },
    comp: { enabled: true, threshold: -8.0, mix: 70, ratio: 2 },
    sat: { enabled: true, mode: 'tape', drive: 15, warmth: 0.8, oversample: '4x' },
    width: { enabled: true, spread: 110 },
    max: { enabled: true, boost: 2.2, ceiling: -0.3, response: 'smooth' }
  }
};

// --- Application State ---
export const state: any = {
  audioCtx: null,
  audioBuffer: null,
  sourceNode: null,
  splitterNode: null,
  analyserL: null,
  analyserR: null,
  gainNode: null,
  isPlaying: false,
  isLooping: false,
  startTime: 0,
  pausedAt: 0,
  duration: 0,
  fftMode: 'multi', // 'multi' (MRFFT) or numeric 1024, 2048, 4096, 8192
  fftSize: 2048,
  mrNodes: {
    lowL: null, lowR: null,   // 8192 FFT
    midL: null, midR: null,   // 2048 FFT
    highL: null, highR: null  // 512 FFT
  },
  smoothingTimeConstant: 0.75,
  displayMode: 'spectrum', // 'spectrum', 'spectrogram', 'oscilloscope'
  viewMode: 'overlay', // 'overlay', 'split', 'difference'
  volume: 0.8,
  animationFrameId: null,
  peakHoldL: null,
  peakHoldR: null,
  peakDecay: 0.98,
  cumulativeMaxL: null, // Float32Array for Peak (100%) frequency envelope across whole song
  cumulativeMaxR: null,
  envelope80L: null,    // Float32Array for Core (80th percentile) frequency envelope across whole song
  envelope80R: null,
  angularMaxRadius: new Float32Array(360), // 360 degrees Peak (100%) polar envelope for goniometer
  angular80Radius: new Float32Array(360),  // 360 degrees Core (80th percentile) polar envelope for goniometer
  dynamicAcc: {
    spectrumAccumulating: false, // true when user resets peaks and accumulates dynamic mastering audio
    spectrumHistL: null,         // Uint32Array(binCount * 128)
    spectrumHistR: null,
    spectrumSliceCount: 0,
    gonioAccumulating: false,    // true when user resets gonio peaks
    gonioHist: new Uint32Array(360 * 60), // 360 angles x 60 radial distance bins (0.00-1.20, binWidth 0.02)
    gonioAngleCounts: new Uint32Array(360)
  },
  peaks: {
    spectrum: {
      maxPeakFreq: 0,
      maxPeakDbL: -Infinity,     // Cumulative maximum Sample Peak (dBFS)
      maxPeakDbR: -Infinity,
      maxPeakDbTp: -Infinity,    // Cumulative maximum True Peak (dBTP)
      realtimeDbL: -60,          // Instantaneous Sample Peak (dBFS)
      realtimeDbR: -60,
      realtimeDbTp: -60,         // Instantaneous True Peak (dBTP)
      clipHoldUntilL: 0,         // Clip indicator hold timestamp (ms)
      clipHoldUntilR: 0,
      clipCount: 0,              // Post-mastering clip detection count (↺ to reset)
      clipPositions: [],         // Clip timestamp positions (seconds)
      _clipCooldownUntil: 0,     // Anti-chattering cooldown (ms)
      _seekMuteUntil: 0          // Transient shock prevention mute guard after seek (ms)
    },
    gonio: {
      maxRadiusPct: 0,
      maxLevelDb: -Infinity,     // Cumulative maximum peak (Session Cumulative)
      realtimeLevelDb: -60,      // Instantaneous level
      clipHoldUntil: 0,          // Clip indicator hold timestamp (ms)
      minCorrelation: 1.0
    }
  },
  // Frequency bands for timbre balance
  bands: [
    { name: 'Sub (20-60Hz)', min: 20, max: 60 },
    { name: 'Bass (60-250Hz)', min: 60, max: 250 },
    { name: 'Low-Mid (250-1kHz)', min: 250, max: 1000 },
    { name: 'High-Mid (1k-4kHz)', min: 1000, max: 4000 },
    { name: 'Presence (4k-8kHz)', min: 4000, max: 8000 },
    { name: 'Brilliance (8k-20k)', min: 8000, max: 20000 }
  ],
  // Mastering Suite State (v2.0.0)
  mastering: {
    enabled: false, // Mastering default OFF on launch
    bypass: true,   // Starts in pure original sound (Dry bit-perfect) mode
    gainMatch: true,// Default ON to match original loudness and prevent peak clipping
    preset: 'clean',
    clean: {
      enabled: true,
      lowCut: 25,     // 0 (OFF), 25, 35 Hz
      monoMaker: 120, // 0 (OFF), 80, 120 Hz
      tone: 0.5,      // dB (-6 to +6)
      air: 1.2        // dB (-3 to +6)
    },
    comp: {
      enabled: true,
      threshold: -10.5, // dB (-24 to 0)
      mix: 85,          // % (0 to 100)
      ratio: 4,         // 2, 4, 8
      gr: 0             // dB
    },
    sat: {
      enabled: true,
      mode: 'tape',     // 'tape', 'tube'
      drive: 25,        // % (0 to 100)
      warmth: 1.5,      // dB (-5 to +5)
      oversample: '4x'  // '2x', '4x'
    },
    width: {
      enabled: true,
      spread: 115       // % (0 to 160)
    },
    max: {
      enabled: true,
      boost: 3.5,       // dB (0 to +12)
      ceiling: -0.1,    // dB (-6.0 to 0.0)
      response: 'smooth'// 'punchy', 'smooth', 'fast'
    }
  },
  masteringNodes: null // Holds Web Audio DSP node references
};
