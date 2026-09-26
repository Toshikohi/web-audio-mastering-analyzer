// @ts-nocheck
import { state } from '../state/appState';
import { createMasteringChain } from '../dsp/mastering';

// --- Audio Context Setup ---
export function initAudioContext() {
  if (!state.audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContextClass();

    state.splitterNode = state.audioCtx.createChannelSplitter(2);

    // Standard Single Analysers
    state.analyserL = state.audioCtx.createAnalyser();
    state.analyserL.fftSize = state.fftSize;
    state.analyserL.smoothingTimeConstant = state.smoothingTimeConstant;

    state.analyserR = state.audioCtx.createAnalyser();
    state.analyserR.fftSize = state.fftSize;
    state.analyserR.smoothingTimeConstant = state.smoothingTimeConstant;

    // Multi-Resolution FFT Analysers (Low: 8192, Mid: 2048, High: 512)
    state.mrNodes.lowL = state.audioCtx.createAnalyser();
    state.mrNodes.lowL.fftSize = 8192;
    state.mrNodes.lowL.smoothingTimeConstant = state.smoothingTimeConstant;

    state.mrNodes.lowR = state.audioCtx.createAnalyser();
    state.mrNodes.lowR.fftSize = 8192;
    state.mrNodes.lowR.smoothingTimeConstant = state.smoothingTimeConstant;

    state.mrNodes.midL = state.audioCtx.createAnalyser();
    state.mrNodes.midL.fftSize = 2048;
    state.mrNodes.midL.smoothingTimeConstant = state.smoothingTimeConstant;

    state.mrNodes.midR = state.audioCtx.createAnalyser();
    state.mrNodes.midR.fftSize = 2048;
    state.mrNodes.midR.smoothingTimeConstant = state.smoothingTimeConstant;

    state.mrNodes.highL = state.audioCtx.createAnalyser();
    state.mrNodes.highL.fftSize = 512;
    state.mrNodes.highL.smoothingTimeConstant = Math.max(0.15, state.smoothingTimeConstant * 0.6); // Rapid transient response

    state.mrNodes.highR = state.audioCtx.createAnalyser();
    state.mrNodes.highR.fftSize = 512;
    state.mrNodes.highR.smoothingTimeConstant = Math.max(0.15, state.smoothingTimeConstant * 0.6);

    state.gainNode = state.audioCtx.createGain();
    state.gainNode.gain.value = state.volume;

    // Routing:
    // Splitter -> Standard Analysers
    state.splitterNode.connect(state.analyserL, 0);
    state.splitterNode.connect(state.analyserR, 1);

    // Splitter -> Multi-Resolution Analysers (Native parallel processing)
    state.splitterNode.connect(state.mrNodes.lowL, 0);
    state.splitterNode.connect(state.mrNodes.lowR, 1);
    state.splitterNode.connect(state.mrNodes.midL, 0);
    state.splitterNode.connect(state.mrNodes.midR, 1);
    state.splitterNode.connect(state.mrNodes.highL, 0);
    state.splitterNode.connect(state.mrNodes.highR, 1);

    // Gain -> Destination (Listening Volume)
    state.gainNode.connect(state.audioCtx.destination);

    // Build Mastering DSP Chain (v2.0.0 Integrated)
    state.masteringNodes = createMasteringChain(state.audioCtx, state.mastering);
    state.masteringNodes.output.connect(state.gainNode);
    state.masteringNodes.output.connect(state.splitterNode);
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }
}
