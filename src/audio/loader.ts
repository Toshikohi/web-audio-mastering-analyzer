import { state } from '../state/appState';
import { initAudioContext } from './context';
import { stopPlayback, startPlayback } from './playback';
import { resetAllPeaks } from '../ui/meters';
import { formatTime, drawWaveformOverview } from '../visualizers/waveform';
import { precomputeFullTrackEnvelopes } from '../dsp/fft';
import {
  dropZone,
  fileInput,
  fileNameLabel,
  durationStats,
  formatStats,
  channelStats,
  totalTimeSpan,
  currentTimeSpan,
  btnPlayPause,
  btnStop,
  btnSkipBack,
  btnSkipForward,
  btnExportWav,
  btnLoop
} from '../ui/dom';

// --- Unified Audio Buffer Loader ---
export function loadAudioBuffer(decodedBuffer: AudioBuffer, trackName: string, autoLoop: boolean = false) {
  stopPlayback();
  state.audioBuffer = decodedBuffer;
  state.duration = decodedBuffer.duration;
  state.pausedAt = 0;
  resetAllPeaks();

  // Reset peak holds
  if (state.analyserL) {
    state.peakHoldL = new Float32Array(state.analyserL.frequencyBinCount);
  }
  if (state.analyserR) {
    state.peakHoldR = new Float32Array(state.analyserR.frequencyBinCount);
  }

  // Update UI
  if (fileNameLabel) fileNameLabel.textContent = trackName;
  if (formatStats) formatStats.textContent = `Sample Rate: ${(decodedBuffer.sampleRate / 1000).toFixed(1)} kHz`;
  if (channelStats) channelStats.textContent = `Channels: ${decodedBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo (' + decodedBuffer.numberOfChannels + 'ch)'}`;
  if (durationStats) durationStats.textContent = `Duration: ${formatTime(decodedBuffer.duration)}`;
  if (totalTimeSpan) totalTimeSpan.textContent = formatTime(decodedBuffer.duration);
  if (currentTimeSpan) currentTimeSpan.textContent = formatTime(0);

  [btnPlayPause, btnStop, btnSkipBack, btnSkipForward, btnExportWav].forEach(b => {
    if (b) b.disabled = false;
  });

  if (autoLoop) {
    state.isLooping = true;
    if (btnLoop) btnLoop.classList.add('active');
  }

  drawWaveformOverview(decodedBuffer);
  precomputeFullTrackEnvelopes(decodedBuffer);
  startPlayback();
}

// --- Audio File Handler with Intelligent Container Sanitization ---
export async function handleFile(file: File) {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|aac|m4a|weba|webm)$/i.test(file.name)) {
    alert('Please select a valid audio file (MP3, WAV, FLAC, OGG, M4A, etc.).');
    return;
  }

  initAudioContext();
  stopPlayback();

  if (fileNameLabel) fileNameLabel.textContent = `Loading: ${file.name}...`;
  if (durationStats) durationStats.textContent = 'Decoding...';

  let decodedBuffer: AudioBuffer | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();

    // Attempt 1: Direct standard decode (slice(0) prevents detaching original arrayBuffer)
    try {
      if (state.audioCtx) {
        decodedBuffer = await state.audioCtx.decodeAudioData(arrayBuffer.slice(0));
      }
    } catch (firstErr) {
      console.warn('Direct decode failed. Attempting intelligent container sanitization...', firstErr);

      // Attempt 2: Intelligent Buffer Sanitization
      // Handles files where ID3v2 tags were prepended to MP4/M4A (ftyp), OGG, or WAV containers
      const bytes = new Uint8Array(arrayBuffer);
      let sanitizedBuffer: ArrayBuffer | null = null;

      // 2A. Search for 'ftyp' box in first 64KB (common in mislabeled AAC files saved with .mp3 extension)
      for (let i = 0; i < Math.min(bytes.length - 8, 65536); i++) {
        if (bytes[i] === 0x66 && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x79 && bytes[i + 3] === 0x70) {
          const boxStart = Math.max(0, i - 4);
          console.log(`Detected embedded MP4/M4A container at offset ${boxStart}. Retrying decode from ftyp header...`);
          sanitizedBuffer = arrayBuffer.slice(boxStart);
          break;
        }
      }

      // 2B. If not ftyp, check if ID3v2 tag prefix is confusing the decoder
      if (!sanitizedBuffer && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
        const tagSize = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14) | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F);
        const footerPresent = (bytes[5] & 0x10) !== 0;
        const id3End = 10 + tagSize + (footerPresent ? 10 : 0);
        if (id3End < bytes.length) {
          console.log(`Stripping ID3v2 header (${id3End} bytes) and retrying decode...`);
          sanitizedBuffer = arrayBuffer.slice(id3End);
        }
      }

      // 2C. Check for embedded RIFF (WAV) or OggS (OGG) headers
      if (!sanitizedBuffer) {
        for (let i = 0; i < Math.min(bytes.length - 4, 32768); i++) {
          if ((bytes[i] === 0x52 && bytes[i+1] === 0x49 && bytes[i+2] === 0x46 && bytes[i+3] === 0x46) || // RIFF
              (bytes[i] === 0x4F && bytes[i+1] === 0x67 && bytes[i+2] === 0x67 && bytes[i+3] === 0x53)) {  // OggS
            console.log(`Detected embedded audio container at offset ${i}. Retrying decode...`);
            sanitizedBuffer = arrayBuffer.slice(i);
            break;
          }
        }
      }

      if (sanitizedBuffer && state.audioCtx) {
        decodedBuffer = await state.audioCtx.decodeAudioData(sanitizedBuffer);
        console.log('Successfully decoded sanitized audio buffer!');
      } else {
        throw firstErr;
      }
    }
  } catch (err) {
    console.error('Audio decode error after sanitization attempt:', err);
    if (fileNameLabel) fileNameLabel.textContent = 'Error: Failed to decode audio file.';
    if (durationStats) durationStats.textContent = '--:--';
    alert('Failed to decode audio file. The file may be corrupted or use an unsupported codec.');
    return;
  }

  if (decodedBuffer) {
    try {
      loadAudioBuffer(decodedBuffer, file.name, false);
    } catch (err) {
      console.error('Playback initialization error:', err);
    }
  }
}

// --- Drag & Drop and File Input Initialization ---
export function initFileLoader() {
  // Global drag & drop protection on window (prevents accidental file opening outside dropZone)
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
      });
    });

    dropZone.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    });

    fileInput.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        handleFile(target.files[0]);
      }
    });
  }
}
