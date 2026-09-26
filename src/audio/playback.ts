// @ts-nocheck
import { state } from '../state/appState';
import { initAudioContext } from './context';
import { updatePlayhead } from '../visualizers/waveform';
import {
  btnPlayPause,
  playIcon,
  playText,
  btnStop,
  btnSkipBack,
  btnSkipForward,
  btnLoop,
  volSlider,
  volValue,
  waveformContainer
} from '../ui/dom';

let onStartLoopCallback = null;
export function setStartLoopCallback(cb) {
  onStartLoopCallback = cb;
}

// --- Playback Engine (Node Lifecycle Management) ---
export function cleanupSourceNode() {
  if (state.sourceNode) {
    // Detach event listener FIRST to prevent async onended cascade on stop()
    state.sourceNode.onended = null;
    try { state.sourceNode.stop(); } catch(e){}
    try { state.sourceNode.disconnect(); } catch(e){}
    state.sourceNode = null;
  }
}

export function startPlayback(offset = 0) {
  if (!state.audioBuffer) return;
  initAudioContext();
  if (state.audioCtx && state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }

  // Fully cleanup any previous playing source node
  cleanupSourceNode();

  const source = state.audioCtx.createBufferSource();
  source.buffer = state.audioBuffer;
  source.loop = state.isLooping;
  if (state.isLooping && state.audioBuffer) {
    source.loopStart = 0;
    source.loopEnd = state.audioBuffer.duration;
  }

  // Connect source directly to mastering DSP chain input (which feeds both listener gain and analysers)
  source.connect(state.masteringNodes.input);

  // Onended is only for natural end of playback when looping is OFF
  source.onended = () => {
    // Ignore events from orphaned / replaced nodes
    if (state.sourceNode !== source) return;
    state.sourceNode = null;

    if (state.isPlaying) {
      stopPlayback();
    }
  };

  state.startTime = state.audioCtx.currentTime - offset;
  source.start(0, offset);

  state.sourceNode = source;
  state.isPlaying = true;
  state.pausedAt = 0;

  if (playIcon) playIcon.textContent = '⏸';
  if (playText) playText.textContent = 'Pause';

  if (!state.animationFrameId && onStartLoopCallback) {
    onStartLoopCallback();
  }
}

export function pausePlayback() {
  if (!state.isPlaying) return;
  const elapsed = state.audioCtx.currentTime - state.startTime;
  state.pausedAt = elapsed % state.duration;

  cleanupSourceNode();

  state.isPlaying = false;
  if (playIcon) playIcon.textContent = '▶';
  if (playText) playText.textContent = 'Resume';
}

export function stopPlayback() {
  cleanupSourceNode();
  state.isPlaying = false;
  state.pausedAt = 0;
  if (playIcon) playIcon.textContent = '▶';
  if (playText) playText.textContent = 'Play';
  updatePlayhead(0);
}

export function seekTo(targetTime) {
  if (!state.audioBuffer) return;
  targetTime = Math.max(0, Math.min(state.duration, targetTime));
  // Guard against transient click/pop noise during source node restart
  state.peaks.spectrum._seekMuteUntil = performance.now() + 150;
  if (state.isPlaying) {
    startPlayback(targetTime);
  } else {
    state.pausedAt = targetTime;
    updatePlayhead(targetTime);
  }
}

export function getCurrentTime() {
  if (!state.audioBuffer) return 0;
  if (state.isPlaying) {
    let t = (state.audioCtx.currentTime - state.startTime);
    if (state.isLooping) {
      t = t % state.duration;
    } else {
      t = Math.min(state.duration, t);
    }
    return t;
  }
  return state.pausedAt;
}

export function initPlayerControls() {
  if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => {
      if (!state.audioBuffer) return;
      if (state.isPlaying) {
        pausePlayback();
      } else {
        startPlayback(state.pausedAt);
      }
    });
  }

  if (btnStop) btnStop.addEventListener('click', stopPlayback);

  if (btnSkipBack) {
    btnSkipBack.addEventListener('click', () => {
      const current = getCurrentTime();
      seekTo(current - 5);
    });
  }

  if (btnSkipForward) {
    btnSkipForward.addEventListener('click', () => {
      const current = getCurrentTime();
      seekTo(current + 5);
    });
  }

  if (btnLoop) {
    btnLoop.addEventListener('click', () => {
      state.isLooping = !state.isLooping;
      if (state.sourceNode) {
        state.sourceNode.loop = state.isLooping;
        if (state.isLooping && state.audioBuffer) {
          state.sourceNode.loopStart = 0;
          state.sourceNode.loopEnd = state.audioBuffer.duration;
        }
      }
      btnLoop.classList.toggle('active', state.isLooping);
      btnLoop.textContent = `🔁 Loop: ${state.isLooping ? 'ON' : 'OFF'}`;
    });
  }

  if (volSlider) {
    volSlider.addEventListener('input', (e) => {
      state.volume = parseFloat(e.target.value);
      if (state.gainNode) {
        state.gainNode.gain.value = state.volume;
      }
      if (volValue) volValue.textContent = `${Math.round(state.volume * 100)}%`;
    });
  }

  if (waveformContainer) {
    waveformContainer.addEventListener('click', (e) => {
      if (!state.audioBuffer) return;
      const rect = waveformContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      seekTo(pct * state.duration);
    });
  }
}
