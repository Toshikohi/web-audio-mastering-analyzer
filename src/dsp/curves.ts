// @ts-nocheck

// Distortion curves cache (keyed by mode + quantized drive)
const distortionCurveCacheMap = new Map();

export function getDistortionCurve(mode = 'tape', drive = 25) {
  // Quantize drive to nearest 2% step to avoid redundant allocations while keeping slider response smooth
  const qDrive = Math.max(0, Math.min(100, Math.round(drive / 2) * 2));
  const cacheKey = `${mode}_${qDrive}`;
  if (distortionCurveCacheMap.has(cacheKey)) {
    return distortionCurveCacheMap.get(cacheKey);
  }

  // Odd length (8193 = 2^13 + 1) ensures exact center zero-crossing at index 4096
  const samples = 8193;
  const curve = new Float32Array(samples);
  const half = (samples - 1) / 2;
  const normDrive = qDrive / 100.0; // [0.0, 1.0]

  if (mode === 'tube') {
    // Tube mode: Asymmetric 2nd-order harmonics (triode saturation)
    // Slope at origin (x=0) is 1.0 to prevent gain change on low-level signals
    const dt = normDrive * 0.25;
    for (let i = 0; i < samples; ++i) {
      const x = (i - half) / half; // [-1.0, 1.0]
      if (x >= 0) {
        curve[i] = x - dt * (x * x);
      } else {
        curve[i] = x + 0.5 * dt * (x * x);
      }
    }
  } else {
    // Tape mode: 3rd-order harmonic soft saturation (polynomial transfer)
    // Slope at origin (x=0) is 1.0; compresses peaks without harsh clipping
    const d = normDrive * 0.35;
    for (let i = 0; i < samples; ++i) {
      const x = (i - half) / half; // [-1.0, 1.0]
      curve[i] = x - d * (x * x * x);
    }
  }

  distortionCurveCacheMap.set(cacheKey, curve);
  return curve;
}

// Cache for Brickwall curve to avoid redundant memory allocations
let brickwallCurveCache = null;

// Brickwall limiter curve with decimation guard (v2.9.0)
// - Linear zone up to threshold (0.80 = -1.94dBFS)
// - Continuous C1-smooth asymptotic soft saturation bounded below ceilingPeak (0.940 = -0.54dBFS)
// - Decimation margin absorbs Gibbs-phenomenon ringing during 4x downsampling LPF
// - Keeps sample peak after downsampling below 0.970 (-0.26dBFS) to mitigate false clip alarms
export function getBrickwallLimiterCurve(headroom = 4.0, threshold = 0.80, ceilingPeak = 0.940) {
  if (brickwallCurveCache) {
    return brickwallCurveCache;
  }

  const n = 65537; // 2^16 + 1 for exact zero-crossing at center index 32768
  const curve = new Float32Array(n);
  const half = (n - 1) / 2;
  const T = threshold;    // Linear threshold (0.85 = -1.4dBFS)
  const M = ceilingPeak;  // Transparent asymptotic peak (0.995 = -0.04dBFS)
  const delta = M - T;

  for (let i = 0; i < n; i++) {
    const u = (i - half) / half; // [-1.0, 1.0]
    const x = u * headroom;      // [-headroom, headroom]
    const absX = Math.abs(x);

    let y;
    if (absX <= T) {
      y = x; // Linear response
    } else {
      // Continuous C1-smooth asymptotic soft saturation bounded below M
      const sat = T + delta * Math.tanh((absX - T) / delta);
      y = x < 0 ? -sat : sat;
    }
    // Boundary clamp limiting samples to M
    curve[i] = Math.max(-M, Math.min(M, y));
  }

  brickwallCurveCache = curve;
  return curve;
}
