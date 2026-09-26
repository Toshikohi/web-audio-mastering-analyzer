import { state } from '../state/appState';
import { gonioCanvas } from '../ui/dom';
import { canvasCache } from './common';
import { updatePeakBadges } from '../ui/meters';

// --- Goniometer / Lissajous (Vectorscope) Rendering ---
// Precomputed Trigonometric Tables for Goniometer (0-359 deg) (Massive FPS Boost)
export const gonioCosTable = new Float32Array(360);
export const gonioSinTable = new Float32Array(360);
for (let a = 0; a < 360; a++) {
  const angleRad = (a / 360) * (2 * Math.PI) - Math.PI;
  gonioCosTable[a] = Math.cos(angleRad);
  gonioSinTable[a] = Math.sin(angleRad);
}

export function renderGoniometer(timeDomainL: Uint8Array, timeDomainR: Uint8Array) {
  const width = canvasCache.gonio.width;
  const height = canvasCache.gonio.height;
  if (width <= 0 || height <= 0 || !gonioCanvas) return;

  const ctx = gonioCanvas.getContext('2d');
  if (!ctx) return;

  // Fade-out decay effect for smooth persistence (phosphor glow)
  ctx.fillStyle = 'rgba(8, 12, 20, 0.28)';
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const gonioRadius = Math.min(cx, cy) * 0.80;

  // Draw Grid Circles & Diagonal Reference Axes
  // Outer Circle = 0 dBFS Limit (100% Normalized Full Scale)
  // Middle Circles = -12 dB (25%), -6 dB (50%), -3 dB (70.7%)
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.beginPath();
  ctx.arc(cx, cy, gonioRadius * 0.25, 0, Math.PI * 2); // -12dB (25%)
  ctx.arc(cx, cy, gonioRadius * 0.50, 0, Math.PI * 2); // -6dB (50%)
  ctx.arc(cx, cy, gonioRadius * 0.707, 0, Math.PI * 2); // -3dB (70.7%)
  ctx.stroke();

  // Outer 0 dBFS Full-scale Boundary Circle
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.beginPath();
  ctx.arc(cx, cy, gonioRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Axis lines: M (Mid / Center vertical), S (Side / Width horizontal)
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  // Mid (Mono) axis
  ctx.moveTo(cx, cy - gonioRadius);
  ctx.lineTo(cx, cy + gonioRadius);
  // Side (Stereo Width) axis
  ctx.moveTo(cx - gonioRadius, cy);
  ctx.lineTo(cx + gonioRadius, cy);
  ctx.stroke();

  // 45 degree L & R axes
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.beginPath();
  const r45 = gonioRadius * 0.7071;
  ctx.moveTo(cx - r45, cy - r45);
  ctx.lineTo(cx + r45, cy + r45);
  ctx.moveTo(cx + r45, cy - r45);
  ctx.lineTo(cx - r45, cy + r45);
  ctx.stroke();

  // Axis Labels
  ctx.font = '9px -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillText('+M (Mono)', cx - 22, cy - gonioRadius - 5);
  ctx.fillText('-M', cx - 7, cy + gonioRadius + 13);
  ctx.fillText('+S (Wide)', cx + gonioRadius + 5, cy + 3);
  ctx.fillText('-S', cx - gonioRadius - 16, cy + 3);
  ctx.fillText('L', cx - r45 - 10, cy - r45 - 4);
  ctx.fillText('R', cx + r45 + 3, cy - r45 - 4);

  // Scale dB labels on vertical axis
  ctx.font = '8px -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.fillText('-6dB', cx + 4, cy - gonioRadius * 0.50 + 3);
  ctx.fillText('0dBFS', cx + 4, cy - gonioRadius + 10);

  // 1. Plot Lissajous / Goniometer Realtime Samples (Background/Middle Z-layer)
  if (state.audioBuffer && state.isPlaying) {
    const len = Math.min(timeDomainL.length, timeDomainR.length);
    const invSqrt2 = 0.70710678;

    let frameMaxDist = 0;

    ctx.beginPath();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';

    const step = len > 2048 ? 2 : 1;
    const gonioAcc = state.dynamicAcc.gonioAccumulating;
    const gHist = state.dynamicAcc.gonioHist;
    const gCounts = state.dynamicAcc.gonioAngleCounts;

    for (let i = 0; i < len; i += step) {
      // Convert byte data [0, 255] to normalized [-1.0, 1.0]
      const l = (timeDomainL[i] - 128) / 128;
      const r = (timeDomainR[i] - 128) / 128;

      const normDist = Math.max(Math.abs(l), Math.abs(r));
      if (normDist > frameMaxDist) frameMaxDist = normDist;

      const gx = (r - l) * invSqrt2;
      const gy = -(l + r) * invSqrt2;
      const rawDist = Math.sqrt(l * l + r * r);

      // Track angular maximum radius for every degree theta (0-359 deg)
      if (normDist > 0.005) {
        const theta = Math.atan2(gy, gx); // -PI to PI
        let deg = Math.floor(((theta + Math.PI) / (2 * Math.PI)) * 360);
        if (deg >= 360) deg = 359;
        if (normDist > state.angularMaxRadius[deg]) {
          state.angularMaxRadius[deg] = normDist;
        }

        if (gonioAcc && gHist && gCounts) {
          const rBin = Math.min(59, Math.floor(normDist * 50));
          gHist[deg * 60 + rBin]++;
          gCounts[deg]++;
        }
      }

      // Angular scale normalization: map [-1, 1] square boundary to circle radius 1.0
      const scale = rawDist > 0.0001 ? (normDist / rawDist) : 1.0;
      const x = cx + (gx * scale) * gonioRadius;
      const y = cy + (gy * scale) * gonioRadius;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Update Realtime & Cumulative Level & Badge
    const curLevelDb = frameMaxDist > 0.0001 ? 20 * Math.log10(Math.min(1.0, frameMaxDist)) : -60;
    state.peaks.gonio.realtimeLevelDb = curLevelDb;

    const nowTime = performance.now();
    if (curLevelDb >= -0.05 || frameMaxDist >= 0.994) {
      state.peaks.gonio.clipHoldUntil = nowTime + 450;
    }

    if (frameMaxDist > state.peaks.gonio.maxRadiusPct) {
      state.peaks.gonio.maxRadiusPct = Math.min(1.0, frameMaxDist);
      state.peaks.gonio.maxLevelDb = 20 * Math.log10(Math.max(0.0001, state.peaks.gonio.maxRadiusPct));
    }

    // Dynamic Goniometer 80% Percentile Recalculation (periodically every 6 frames ~ 10Hz)
    if (gonioAcc && gHist && gCounts) {
      state.dynamicAcc._gonioFrame = (state.dynamicAcc._gonioFrame || 0) + 1;
      if (state.dynamicAcc._gonioFrame % 6 === 0 || state.dynamicAcc._gonioFrame <= 10) {
        for (let deg = 0; deg < 360; deg++) {
          const degTotal = gCounts[deg];
          if (degTotal > 5) {
            const targetCount = Math.floor(degTotal * 0.80);
            let count = 0;
            let r80Bin = 0;
            const offset = deg * 60;
            for (let b = 0; b < 60; b++) {
              count += gHist[offset + b];
              if (count >= targetCount) {
                r80Bin = b;
                break;
              }
            }
            state.angular80Radius[deg] = Math.min(1.15, (r80Bin + 0.5) * 0.02);
          } else if (state.angularMaxRadius[deg] > 0) {
            state.angular80Radius[deg] = state.angularMaxRadius[deg] * 0.8;
          }
        }
      }
    }

    updatePeakBadges();
  }

  // 2. Render Angular Polar Envelopes on TOP (Foreground Z-layer, Distinct High-Contrast Colors)
  if (state.audioBuffer && (state.angular80Radius || state.angularMaxRadius)) {
    function buildPolarPath(radiiArray: Float32Array, preservePeak = false) {
      let hasPoints = false;
      ctx.beginPath();
      for (let a = 0; a < 360; a++) {
        let rVal: number;
        if (preservePeak) {
          // Peak 100%: Retain recorded max value
          rVal = radiiArray[a];
          // Fill unvisited gaps from neighbors so line connects smoothly without shrinking
          if (rVal <= 0.005) {
            const prev = radiiArray[(a + 359) % 360];
            const next = radiiArray[(a + 1) % 360];
            rVal = Math.max(prev, next);
          }
        } else {
          // Core 80%: Slight smoothing for stable statistical silhouette
          const prev = radiiArray[(a + 359) % 360];
          const curr = radiiArray[a];
          const next = radiiArray[(a + 1) % 360];
          rVal = (prev + curr * 2 + next) / 4;
        }

        if (rVal > 0.01) {
          const rScaled = rVal * gonioRadius;
          const px = cx + gonioCosTable[a] * rScaled;
          const py = cy + gonioSinTable[a] * rScaled;

          if (!hasPoints) {
            ctx.moveTo(px, py);
            hasPoints = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
      }
      if (hasPoints) ctx.closePath();
      return hasPoints;
    }

    ctx.save();

    // Layer 2A: Core 80% Envelope (Warm Amber/Gold #fbbf24 - distinct from Cyan Live beam)
    if (state.angular80Radius && buildPolarPath(state.angular80Radius, false)) {
      ctx.fillStyle = 'rgba(251, 191, 36, 0.12)';
      ctx.fill();

      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([]);
      ctx.stroke();
    }

    // Layer 2B: Peak 100% Outer Envelope (Neon Coral/Orange #ff7043 - Dashed)
    // preservePeak = true retains Peak 100% envelope boundary
    if (state.angularMaxRadius && buildPolarPath(state.angularMaxRadius, true)) {
      ctx.strokeStyle = '#ff7043';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
    }

    // Layer 2C: Foreground Legend
    ctx.font = '9px "SF Mono", Monaco, monospace';
    ctx.setLineDash([]);
    // Live (Cyan)
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('― Live', 10, 18);
    // Core 80% (Gold)
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('― Core 80%', 58, 18);
    // Peak 100% (Orange)
    ctx.fillStyle = '#ff7043';
    ctx.fillText('- - Peak 100%', 126, 18);

    ctx.restore();
  }
}
