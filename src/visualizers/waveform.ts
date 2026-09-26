// @ts-nocheck
import { state } from '../state/appState';
import {
  waveformContainer,
  waveformCanvas,
  progressOverlay,
  playhead,
  currentTimeSpan
} from '../ui/dom';
import { updatePeakBadges } from '../ui/meters';

// Helper: format seconds to mm:ss.s
export function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return '00:00.0';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ds = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ds}`;
}

export function updatePlayhead(time) {
  if (!state.duration || !progressOverlay || !playhead) return;
  const pct = Math.max(0, Math.min(100, (time / state.duration) * 100));
  progressOverlay.style.width = `${pct}%`;
  playhead.style.left = `${pct}%`;
  if (currentTimeSpan) {
    currentTimeSpan.textContent = formatTime(time);
  }
}

// Waveform overview renderer with Red Full-Track Clip Markers (v2.7.0)
export function drawWaveformOverview(buffer) {
  if (!waveformContainer || !waveformCanvas) return;
  const canvas = waveformCanvas;
  const dpr = window.devicePixelRatio || 1;
  const width = waveformContainer.clientWidth;
  const height = waveformContainer.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;
  const step = Math.ceil(buffer.length / width);
  const amp = height / 2;

  ctx.lineWidth = 1;

  const clipThreshold = 0.994; // -0.05 dBFS
  const clipXPoints = [];

  // Draw Left channel (top half - cyan)
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    let min = 1.0, max = -1.0;
    const start = x * step;
    const end = Math.min(start + step, buffer.length);
    let hasClip = false;
    for (let j = start; j < end; j += 4) {
      const datum = chL[j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
      if (datum >= clipThreshold || datum <= -clipThreshold) {
        hasClip = true;
      }
    }
    ctx.moveTo(x, amp * 0.5 + min * amp * 0.45);
    ctx.lineTo(x, amp * 0.5 + max * amp * 0.45);
    if (hasClip) clipXPoints.push(x);
  }
  ctx.stroke();

  // Draw Right channel (bottom half - magenta)
  ctx.strokeStyle = 'rgba(255, 42, 141, 0.6)';
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    let min = 1.0, max = -1.0;
    const start = x * step;
    const end = Math.min(start + step, buffer.length);
    let hasClip = false;
    for (let j = start; j < end; j += 4) {
      const datum = chR[j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
      if (datum >= clipThreshold || datum <= -clipThreshold) {
        hasClip = true;
      }
    }
    ctx.moveTo(x, amp * 1.5 + min * amp * 0.45);
    ctx.lineTo(x, amp * 1.5 + max * amp * 0.45);
    if (hasClip && !clipXPoints.includes(x)) clipXPoints.push(x);
  }
  ctx.stroke();

  // Divider line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  ctx.moveTo(0, amp);
  ctx.lineTo(width, amp);
  ctx.stroke();

  // Full-Track Clip Markers: Draw vivid red vertical lines where clipping occurs
  if (clipXPoints.length > 0) {
    ctx.strokeStyle = 'rgba(255, 45, 85, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < clipXPoints.length; i++) {
      const cx = clipXPoints[i];
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, height);
    }
    ctx.stroke();
  }

  state.originalClipCount = clipXPoints.length;
  updatePeakBadges();
}
