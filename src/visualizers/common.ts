import { state } from '../state/appState';
import { spectrumCanvas, spectrumWrapper, gonioCanvas, waveformContainer } from '../ui/dom';
import { drawWaveformOverview } from './waveform';

export interface CanvasDimensions {
  width: number;
  height: number;
  dpr: number;
}

// --- Canvas Dimensions Cache (Prevents Layout Thrashing & Layout Shifts) ---
export const canvasCache: Record<string, CanvasDimensions> = {
  spectrum: { width: 0, height: 0, dpr: 1 },
  gonio: { width: 0, height: 0, dpr: 1 }
};

export function updateCanvasResolution(canvas: HTMLCanvasElement | null, container: HTMLElement | null, cacheKey: string) {
  if (!canvas || !container) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(container.clientWidth);
  const height = Math.floor(container.clientHeight);
  if (width <= 0 || height <= 0) return;

  const targetW = Math.floor(width * dpr);
  const targetH = Math.floor(height * dpr);

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  if (canvasCache[cacheKey]) {
    canvasCache[cacheKey].width = width;
    canvasCache[cacheKey].height = height;
    canvasCache[cacheKey].dpr = dpr;
  }

  const ctx = canvas.getContext('2d');
  ctx?.resetTransform?.();
  ctx?.scale(dpr, dpr);
}

// Set up ResizeObserver to handle canvas resizing on container size changes
export function initResizeObserver() {
  if (!spectrumWrapper || !spectrumCanvas || !gonioCanvas) return;

  const resizeObserver = new ResizeObserver(() => {
    updateCanvasResolution(spectrumCanvas, spectrumWrapper, 'spectrum');
    if (gonioCanvas.parentElement) {
      updateCanvasResolution(gonioCanvas, gonioCanvas.parentElement, 'gonio');
    }
    if (state.audioBuffer) {
      drawWaveformOverview(state.audioBuffer);
    }
  });

  resizeObserver.observe(spectrumWrapper);
  if (gonioCanvas.parentElement) {
    resizeObserver.observe(gonioCanvas.parentElement);
  }
  if (waveformContainer) {
    resizeObserver.observe(waveformContainer);
  }

  // Initial sizing
  setTimeout(() => {
    updateCanvasResolution(spectrumCanvas, spectrumWrapper, 'spectrum');
    if (gonioCanvas.parentElement) {
      updateCanvasResolution(gonioCanvas, gonioCanvas.parentElement, 'gonio');
    }
  }, 0);
}
