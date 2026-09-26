import { state } from '../state/appState';
import { spectrumCanvas } from '../ui/dom';
import { canvasCache } from './common';

// --- Realtime Oscilloscope / Waveform Engine (v2.6.0) ---
export function renderOscilloscope(timeDomainL: Uint8Array, timeDomainR: Uint8Array) {
  const width = canvasCache.spectrum.width;
  const height = canvasCache.spectrum.height;
  if (width <= 0 || height <= 0 || !spectrumCanvas) return;

  const ctx = spectrumCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  ctx.lineWidth = 1;
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';

  const midY = height / 2;
  const isSplit = state.viewMode === 'split';

  if (isSplit) {
    // Split Mode: Top is L, Bottom is R
    const midL = height * 0.25;
    const midR = height * 0.75;

    // Split separator
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Sub zero lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(0, midL); ctx.lineTo(width, midL);
    ctx.moveTo(0, midR); ctx.lineTo(width, midR);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
    ctx.fillText('L (Left Channel)', 8, 14);
    ctx.fillStyle = 'rgba(255, 42, 141, 0.7)';
    ctx.fillText('R (Right Channel)', 8, midY + 14);
  } else {
    // Overlay & Difference Mode
    const levels = [
      { amp: 1.0, label: '+1.0 (0dBFS)' },
      { amp: 0.5, label: '+0.5 (-6dBFS)' },
      { amp: 0.0, label: ' 0.0' },
      { amp: -0.5, label: '-0.5 (-6dBFS)' },
      { amp: -1.0, label: '-1.0 (0dBFS)' }
    ];

    levels.forEach(lvl => {
      const y = midY - lvl.amp * (midY - 12);
      ctx.strokeStyle = lvl.amp === 0.0 ? 'rgba(0, 240, 255, 0.25)' : 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillText(lvl.label, 8, y - 3);
    });
  }

  if (!state.audioBuffer || !state.isPlaying) {
    // Idle state: Draw static center line
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.beginPath();
    ctx.moveTo(0, isSplit ? height * 0.25 : midY);
    ctx.lineTo(width, isSplit ? height * 0.25 : midY);
    if (isSplit) {
      ctx.moveTo(0, height * 0.75);
      ctx.lineTo(width, height * 0.75);
    }
    ctx.stroke();
    return;
  }

  // Rising Zero-Crossing Trigger Detection (Stabilizes waveform like a hardware oscilloscope)
  const bufferLen = timeDomainL.length;
  let triggerIdx = 0;
  const searchLimit = Math.min(512, bufferLen - 256);
  for (let i = 0; i < searchLimit; i++) {
    if (timeDomainL[i] < 128 && timeDomainL[i + 1] >= 128) {
      triggerIdx = i;
      break;
    }
  }

  const sampleCount = Math.min(1024, bufferLen - triggerIdx);
  const sampleRate = state.audioCtx ? state.audioCtx.sampleRate : 44100;
  const totalTimeMs = (sampleCount / sampleRate) * 1000;

  // Vertical Time Grids (every 5ms or 2ms)
  const msStep = totalTimeMs > 25 ? 5 : 2;
  for (let ms = msStep; ms < totalTimeMs; ms += msStep) {
    const x = (ms / totalTimeMs) * width;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillText(`${ms.toFixed(0)}ms`, x + 3, height - 6);
  }

  // Helper function to draw waveform path
  function drawWavePath(data: Uint8Array, startIdx: number, count: number, centerY: number, scaleY: number, strokeColor: string, glowColor: string) {
    if (count <= 1 || !ctx) return;
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * width;
      const norm = (data[startIdx + i] - 128) / 128;
      const y = centerY - norm * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Neon Glow Pass (High-FPS dual-pass stroke)
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 4.0;
    ctx.stroke();
    ctx.restore();
  }

  if (isSplit) {
    const midL = height * 0.25;
    const midR = height * 0.75;
    const scale = (height * 0.25) - 8;
    drawWavePath(timeDomainL, triggerIdx, sampleCount, midL, scale, '#00f0ff', 'rgba(0, 240, 255, 0.25)');
    drawWavePath(timeDomainR, triggerIdx, sampleCount, midR, scale, '#ff2a8d', 'rgba(255, 42, 141, 0.25)');
  } else if (state.viewMode === 'difference') {
    // Difference Mode: Draw (L-R) alongside L and R
    const scale = midY - 14;
    drawWavePath(timeDomainL, triggerIdx, sampleCount, midY, scale, 'rgba(0, 240, 255, 0.6)', 'rgba(0, 240, 255, 0.15)');
    drawWavePath(timeDomainR, triggerIdx, sampleCount, midY, scale, 'rgba(255, 42, 141, 0.6)', 'rgba(255, 42, 141, 0.15)');

    // Difference (L - R)
    ctx.save();
    ctx.strokeStyle = '#ffe600';
    ctx.lineWidth = 2.0;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < sampleCount; i++) {
      const x = (i / (sampleCount - 1)) * width;
      const normL = (timeDomainL[triggerIdx + i] - 128) / 128;
      const normR = (timeDomainR[triggerIdx + i] - 128) / 128;
      const diff = normL - normR;
      const y = midY - diff * scale * 0.5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 230, 0, 0.3)';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ffe600';
    ctx.fillText('Diff (L - R Side)', width - 110, 20);
  } else {
    // Overlay Mode (Standard)
    const scale = midY - 14;
    drawWavePath(timeDomainR, triggerIdx, sampleCount, midY, scale, '#ff2a8d', 'rgba(255, 42, 141, 0.25)');
    drawWavePath(timeDomainL, triggerIdx, sampleCount, midY, scale, '#00f0ff', 'rgba(0, 240, 255, 0.25)');

    // Legend (Top-Right)
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('■ L (Cyan)', width - 125, 20);
    ctx.fillStyle = '#ff2a8d';
    ctx.fillText('■ R (Magenta)', width - 65, 20);
  }
}
