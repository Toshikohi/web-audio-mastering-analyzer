import { state } from '../state/appState';
import { createMasteringChain } from '../dsp/mastering';
import {
  btnExportWav,
  exportWavModal,
  btnExportModalClose,
  btnExportModalCancel,
  btnExportModalExecute,
  exportSampleRateSelect,
  exportBitDepthSelect,
  exportLeadInSelect,
  exportLeadOutSelect,
  exportMicroFadeCheck,
  exportEstimatedSize,
  exportSourceSpec,
  exportBitHint,
  fileNameLabel
} from '../ui/dom';

// --- Dynamic Sample Rate Options Generator ---
export function buildSampleRateOptions(srcRate: number) {
  if (!exportSampleRateSelect) return;
  exportSampleRateSelect.innerHTML = '';

  const candidates = new Set<number>();
  candidates.add(srcRate);

  // Integer multiples
  if (srcRate * 2 <= 192000) candidates.add(srcRate * 2);
  if (srcRate * 4 <= 192000) candidates.add(srcRate * 4);

  // Integer submultiples
  if (srcRate % 2 === 0 && srcRate / 2 >= 11025) candidates.add(srcRate / 2);
  if (srcRate % 3 === 0 && srcRate / 3 >= 11025) candidates.add(srcRate / 3);
  if (srcRate % 4 === 0 && srcRate / 4 >= 11025) candidates.add(srcRate / 4);
  if ((srcRate * 2) % 3 === 0 && (srcRate * 2) / 3 >= 11025) candidates.add(Math.round((srcRate * 2) / 3));

  // Standard industry cross-rates
  [44100, 48000, 88200, 96000, 192000].forEach(r => {
    if (r <= 192000) candidates.add(r);
  });

  const sortedRates = Array.from(candidates).sort((a, b) => a - b);

  sortedRates.forEach(rate => {
    const opt = document.createElement('option');
    opt.value = rate.toString();

    let tag = '';
    if (rate === srcRate) {
      tag = ' [1.0x Source / Recommended]';
    } else if (rate === srcRate * 2) {
      tag = ' [2.0x Integer / Upsample]';
    } else if (rate === srcRate * 4) {
      tag = ' [4.0x Integer / Upsample]';
    } else if (rate === srcRate / 2) {
      tag = ' [1/2 Fractional / Downsample]';
    } else if (rate === srcRate / 3) {
      tag = ' [1/3 Fractional / Downsample]';
    } else if (rate === srcRate / 4) {
      tag = ' [1/4 Fractional / Downsample]';
    } else if (rate === Math.round(srcRate * 2 / 3)) {
      tag = ' [2/3 Fractional / Downsample]';
    } else if (rate === 44100) {
      tag = ' [CD Standard 44.1kHz / Cross-rate]';
    } else if (rate === 48000) {
      tag = ' [Video/Broadcast 48kHz / Cross-rate]';
    } else if (rate === 88200) {
      tag = ' [Hi-Res 88.2kHz / Cross-rate]';
    } else if (rate === 96000) {
      tag = ' [Studio Hi-Res 96kHz / Cross-rate]';
    } else if (rate === 192000) {
      tag = ' [Ultra Hi-Res 192kHz / Cross-rate]';
    } else {
      tag = ' [Resampling]';
    }

    opt.textContent = `${rate.toLocaleString()} Hz${tag}`;
    if (rate === srcRate) {
      opt.selected = true;
    }
    exportSampleRateSelect.appendChild(opt);
  });
}

// --- Estimated File Size Calculation ---
export function updateExportEstimatedSize() {
  if (!state.audioBuffer || !exportEstimatedSize) return;
  const src = state.audioBuffer;
  const targetRate = parseInt(exportSampleRateSelect ? exportSampleRateSelect.value : src.sampleRate.toString(), 10) || src.sampleRate;
  const bitDepth = parseInt(exportBitDepthSelect ? exportBitDepthSelect.value : '24', 10) || 24;
  const leadInSec = parseFloat(exportLeadInSelect ? exportLeadInSelect.value : '0.2') || 0;
  const leadOutSec = parseFloat(exportLeadOutSelect ? exportLeadOutSelect.value : '1.0') || 0;
  const numChannels = src.numberOfChannels;

  // Exact render sample count (Lead-in + Audio + Lead-out)
  const srcDuration = src.duration;
  const totalDuration = leadInSec + srcDuration + leadOutSec;
  const targetSamples = Math.max(1, Math.round(totalDuration * targetRate));
  const bytesPerSample = (bitDepth === 32) ? 4 : (bitDepth === 24 ? 3 : 2);
  const dataSize = targetSamples * numChannels * bytesPerSample;
  const totalBytes = 44 + dataSize;
  const mb = (totalBytes / (1024 * 1024)).toFixed(2);
  const totalMin = Math.floor(totalDuration / 60);
  const totalSec = Math.floor(totalDuration % 60).toString().padStart(2, '0');
  exportEstimatedSize.textContent = `~ ${mb} MB (${totalMin}:${totalSec} / ${(totalBytes / 1024).toFixed(0)} KB)`;
}

// --- Modal Open / Close Handlers ---
export function openExportWavModal() {
  if (!state.audioBuffer) return;
  const src = state.audioBuffer;
  const fSrc = src.sampleRate;
  const duration = src.duration;
  const channels = src.numberOfChannels;

  const min = Math.floor(duration / 60);
  const sec = Math.floor(duration % 60).toString().padStart(2, '0');
  if (exportSourceSpec) {
    exportSourceSpec.textContent = `${(fSrc / 1000).toFixed(1)} kHz / ${channels}ch / ${min}:${sec}`;
  }

  buildSampleRateOptions(fSrc);
  updateExportEstimatedSize();

  if (exportWavModal) {
    exportWavModal.style.display = 'flex';
  }
}

export function closeExportWavModal() {
  if (exportWavModal) {
    exportWavModal.style.display = 'none';
  }
}

// --- RIFF WAV Binary Generator (16bit TPDF Dither / 24bit PCM / 32bit Float) ---
export function audioBufferToWavBlob(buffer: AudioBuffer, bitDepth: number = 16): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const is32Bit = (bitDepth === 32);
  const is24Bit = (bitDepth === 24);
  const bytesPerSample = is32Bit ? 4 : (is24Bit ? 3 : 2);
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF Chunk
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt Subchunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, is32Bit ? 3 : 1, true); // 1 = PCM, 3 = IEEE Float
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data Subchunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const chL = buffer.getChannelData(0);
  const chR = numChannels > 1 ? buffer.getChannelData(1) : chL;
  let offset = 44;

  if (is32Bit) {
    // 32-bit IEEE 754 Float
    for (let i = 0; i < length; i++) {
      view.setFloat32(offset, chL[i], true);
      offset += 4;
      if (numChannels > 1) {
        view.setFloat32(offset, chR[i], true);
        offset += 4;
      }
    }
  } else if (is24Bit) {
    // 24-bit PCM ([-8388608, 8388607], 3 bytes little-endian)
    for (let i = 0; i < length; i++) {
      let sL = Math.max(-1, Math.min(1, chL[i]));
      let valL = Math.max(-8388608, Math.min(8388607, Math.round(sL * 8388607)));
      if (valL < 0) valL += 16777216; // 24-bit 2's complement
      view.setUint8(offset, valL & 0xFF);
      view.setUint8(offset + 1, (valL >> 8) & 0xFF);
      view.setUint8(offset + 2, (valL >> 16) & 0xFF);
      offset += 3;

      if (numChannels > 1) {
        let sR = Math.max(-1, Math.min(1, chR[i]));
        let valR = Math.max(-8388608, Math.min(8388607, Math.round(sR * 8388607)));
        if (valR < 0) valR += 16777216;
        view.setUint8(offset, valR & 0xFF);
        view.setUint8(offset + 1, (valR >> 8) & 0xFF);
        view.setUint8(offset + 2, (valR >> 16) & 0xFF);
        offset += 3;
      }
    }
  } else {
    // 16-bit PCM with Triangular PDF (TPDF) Dithering
    for (let i = 0; i < length; i++) {
      // TPDF dither: (Math.random() - Math.random()) / 32768
      const ditherL = (Math.random() - Math.random()) / 32768;
      let sL = Math.max(-1, Math.min(1, chL[i] + ditherL));
      view.setInt16(offset, sL < 0 ? Math.round(sL * 0x8000) : Math.round(sL * 0x7FFF), true);
      offset += 2;

      if (numChannels > 1) {
        const ditherR = (Math.random() - Math.random()) / 32768;
        let sR = Math.max(-1, Math.min(1, chR[i] + ditherR));
        view.setInt16(offset, sR < 0 ? Math.round(sR * 0x8000) : Math.round(sR * 0x7FFF), true);
        offset += 2;
      }
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// --- High-Quality Offline Render & Rasterize Mastered WAV (with Lead-in/out Blanks & S-curve Micro-Fade) ---
export async function executeExportWav() {
  if (!state.audioBuffer || !btnExportWav) return;
  const sourceBuffer = state.audioBuffer;
  const targetRate = parseInt(exportSampleRateSelect?.value || sourceBuffer.sampleRate.toString(), 10) || sourceBuffer.sampleRate;
  const bitDepth = parseInt(exportBitDepthSelect?.value || '16', 10) || 16;
  const leadInSec = parseFloat(exportLeadInSelect?.value || '0.2') || 0;
  const leadOutSec = parseFloat(exportLeadOutSelect?.value || '1.0') || 0;
  const applyMicroFade = exportMicroFadeCheck ? exportMicroFadeCheck.checked : true;
  const numChannels = sourceBuffer.numberOfChannels;

  // Audio duration and render sample counts
  const srcDuration = sourceBuffer.duration;
  const totalDuration = leadInSec + srcDuration + leadOutSec;
  const totalSamples = Math.max(1, Math.round(totalDuration * targetRate));

  closeExportWavModal();

  const origBtnText = btnExportWav.innerHTML;
  btnExportWav.disabled = true;
  btnExportWav.innerHTML = '⏳ Rendering...';

  try {
    const OfflineAudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const offlineCtx = new OfflineAudioContextClass(numChannels, totalSamples, targetRate);

    // Build source node
    const offlineSource = offlineCtx.createBufferSource();
    offlineSource.buffer = sourceBuffer;

    // Build mastering chain on offlineCtx
    const offlineChain = createMasteringChain(offlineCtx, state.mastering);
    offlineSource.connect(offlineChain.input);
    offlineChain.output.connect(offlineCtx.destination);

    // Start playback with leadInSec offset to ensure DSP stability
    offlineSource.start(leadInSec);

    // Offline rendering
    const renderedBuffer = await offlineCtx.startRendering();

    // --- Anti-click micro-fade (10ms start / 20ms end S-curve) & blank padding ---
    const leadInSamples = Math.round(leadInSec * targetRate);
    const soundEndSamples = Math.min(totalSamples, Math.round((leadInSec + srcDuration) * targetRate));

    if (applyMicroFade) {
      const fadeInSec = 0.010; // 10ms
      const fadeOutSec = 0.020; // 20ms
      const fadeInSamples = Math.min(soundEndSamples - leadInSamples, Math.round(fadeInSec * targetRate));
      const fadeOutSamples = Math.min(soundEndSamples - leadInSamples, Math.round(fadeOutSec * targetRate));
      const fadeOutStartSamples = Math.max(leadInSamples, soundEndSamples - fadeOutSamples);

      for (let ch = 0; ch < numChannels; ch++) {
        const data = renderedBuffer.getChannelData(ch);

        // 1. Clear lead-in blank section
        for (let i = 0; i < leadInSamples; i++) {
          data[i] = 0;
        }

        // 2. Micro-fade in (10ms): S-curve sin^2((pi/2) * (i / L))
        for (let i = 0; i < fadeInSamples; i++) {
          const idx = leadInSamples + i;
          if (idx < soundEndSamples) {
            const t = i / fadeInSamples;
            const gain = 0.5 * (1 - Math.cos(Math.PI * t)); // S-curve 0 -> 1
            data[idx] *= gain;
          }
        }

        // 3. Micro-fade out (20ms): S-curve cos^2((pi/2) * (j / L))
        for (let j = 0; j < fadeOutSamples; j++) {
          const idx = fadeOutStartSamples + j;
          if (idx < soundEndSamples) {
            const t = j / fadeOutSamples;
            const gain = 0.5 * (1 + Math.cos(Math.PI * t)); // S-curve 1 -> 0
            data[idx] *= gain;
          }
        }

        // 4. Clear lead-out blank section
        for (let k = soundEndSamples; k < totalSamples; k++) {
          data[k] = 0;
        }
      }
    } else {
      // Zero blanks even if micro-fade is disabled
      for (let ch = 0; ch < numChannels; ch++) {
        const data = renderedBuffer.getChannelData(ch);
        for (let i = 0; i < leadInSamples; i++) data[i] = 0;
        for (let k = soundEndSamples; k < totalSamples; k++) data[k] = 0;
      }
    }

    // Export WAV Blob with selected bit depth (16-bit TPDF / 24-bit PCM / 32-bit Float)
    const wavBlob = audioBufferToWavBlob(renderedBuffer, bitDepth);

    // Trigger file download
    const baseName = (fileNameLabel?.textContent || 'mastered_audio').replace(/\.[^/.]+$/, '');
    const rateKHz = (targetRate % 1000 === 0) ? `${targetRate / 1000}k` : `${(targetRate / 1000).toFixed(1)}k`;
    const outName = `${baseName}_mastered_${rateKHz}_${bitDepth}bit.wav`;
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    btnExportWav.innerHTML = '✅ Export Complete!';
    setTimeout(() => {
      btnExportWav.innerHTML = origBtnText;
      btnExportWav.disabled = false;
    }, 2000);
  } catch (err: any) {
    console.error('Mastering WAV Export error:', err);
    alert('Error exporting WAV: ' + err.message);
    btnExportWav.innerHTML = origBtnText;
    btnExportWav.disabled = false;
  }
}

// --- Initialize Export WAV Dialog & Events ---
export function initExportWav() {
  if (btnExportWav) {
    btnExportWav.addEventListener('click', openExportWavModal);
  }
  if (btnExportModalClose) {
    btnExportModalClose.addEventListener('click', closeExportWavModal);
  }
  if (btnExportModalCancel) {
    btnExportModalCancel.addEventListener('click', closeExportWavModal);
  }
  if (btnExportModalExecute) {
    btnExportModalExecute.addEventListener('click', executeExportWav);
  }
  if (exportWavModal) {
    exportWavModal.addEventListener('click', (e) => {
      if (e.target === exportWavModal) {
        closeExportWavModal();
      }
    });
  }
  if (exportSampleRateSelect) {
    exportSampleRateSelect.addEventListener('change', updateExportEstimatedSize);
  }
  if (exportBitDepthSelect) {
    exportBitDepthSelect.addEventListener('change', () => {
      updateExportEstimatedSize();
      const bd = parseInt(exportBitDepthSelect.value, 10);
      if (exportBitHint) {
        if (bd === 16) {
          exportBitHint.textContent = '* Applies Triangular Probability Density Function (TPDF) dither to eliminate quantization distortion.';
        } else if (bd === 24) {
          exportBitHint.textContent = '* 24-bit PCM provides studio-grade dynamic range (144dB) for faithful reproduction of low-level detail.';
        } else {
          exportBitHint.textContent = '* 32-bit Float (IEEE 754) provides clip-free headroom ideal for DAW interop and further processing.';
        }
      }
    });
  }
  if (exportLeadInSelect) {
    exportLeadInSelect.addEventListener('change', updateExportEstimatedSize);
  }
  if (exportLeadOutSelect) {
    exportLeadOutSelect.addEventListener('change', updateExportEstimatedSize);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (exportWavModal && exportWavModal.style.display !== 'none') {
        closeExportWavModal();
      }
    }
  });
}
