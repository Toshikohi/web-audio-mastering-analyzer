// @ts-nocheck
import { state } from '../state/appState';
import { getDistortionCurve, getBrickwallLimiterCurve } from './curves';

// --- Create Mastering Web Audio Chain with Module-Level True Bypass ---
export function createMasteringChain(ctx, mState) {
  // Global Input & Output
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dryGain = ctx.createGain(); // Global Bypass path
  const wetGain = ctx.createGain(); // Global Wet path
  const matchGain = ctx.createGain();

  const initMatch = (mState.gainMatch && !mState.bypass && mState.max.enabled)
    ? (1.0 / Math.pow(10, (mState.max.boost * 0.75) / 20))
    : 1.0;
  matchGain.gain.value = initMatch;

  // =========================================================================
  // Plugin Delay Compensation (PDC: 3.0ms Lookahead Delay Matching)
  // Both Wet (Mastering) and Dry (Bypass) share matched 3.0ms latency
  // Maintains time alignment for A/B switching
  // =========================================================================
  const LOOKAHEAD_SEC = 0.003; // 3.0ms lookahead delay
  const dryDelay = ctx.createDelay(0.05);
  dryDelay.delayTime.value = LOOKAHEAD_SEC;

  // Global Dry bypass route directly through PDC delay
  input.connect(dryDelay);
  dryDelay.connect(dryGain);
  dryGain.connect(output);

  // =========================================================================
  // Module 1: Clean & Tone (True Bypassable)
  // =========================================================================
  const cleanIn = ctx.createGain();
  const cleanOut = ctx.createGain();
  const cleanDry = ctx.createGain();
  const cleanWet = ctx.createGain();

  cleanDry.gain.value = mState.clean.enabled ? 0.0 : 1.0;
  cleanWet.gain.value = mState.clean.enabled ? 1.0 : 0.0;

  cleanIn.connect(cleanDry);
  cleanDry.connect(cleanOut);

  // Clean DSP Nodes
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = mState.clean.lowCut > 0 ? mState.clean.lowCut : 10;
  lowCut.Q.value = 0.707;

  const toneLow = ctx.createBiquadFilter();
  toneLow.type = 'lowshelf';
  toneLow.frequency.value = 500;
  toneLow.gain.value = -(mState.clean.tone * 0.8);

  const toneHigh = ctx.createBiquadFilter();
  toneHigh.type = 'highshelf';
  toneHigh.frequency.value = 2500;
  toneHigh.gain.value = +(mState.clean.tone * 0.8);

  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 12000;
  air.gain.value = mState.clean.air;

  // Mono Maker (Mid/Side processing)
  const mmSplit = ctx.createChannelSplitter(2);
  const mmMidSum = ctx.createGain(); mmMidSum.gain.value = 0.5;
  const mmSideDiffL = ctx.createGain(); mmSideDiffL.gain.value = 0.5;
  const mmSideDiffR = ctx.createGain(); mmSideDiffR.gain.value = -0.5;
  const mmSideSum = ctx.createGain();
  const mmSideHpf = ctx.createBiquadFilter();
  mmSideHpf.type = 'highpass';
  mmSideHpf.frequency.value = mState.clean.monoMaker > 0 ? mState.clean.monoMaker : 10;
  mmSideHpf.Q.value = 0.707;

  const mmMerger = ctx.createChannelMerger(2);
  const mmMidToL = ctx.createGain(); mmMidToL.gain.value = 1.0;
  const mmMidToR = ctx.createGain(); mmMidToR.gain.value = 1.0;
  const mmSideToL = ctx.createGain(); mmSideToL.gain.value = 1.0;
  const mmSideToR = ctx.createGain(); mmSideToR.gain.value = -1.0;

  cleanIn.connect(lowCut);
  lowCut.connect(toneLow);
  toneLow.connect(toneHigh);
  toneHigh.connect(air);
  air.connect(mmSplit);

  mmSplit.connect(mmMidSum, 0);
  mmSplit.connect(mmMidSum, 1);
  mmSplit.connect(mmSideDiffL, 0);
  mmSplit.connect(mmSideDiffR, 1);
  mmSideDiffL.connect(mmSideSum);
  mmSideDiffR.connect(mmSideSum);
  mmSideSum.connect(mmSideHpf);

  mmMidSum.connect(mmMidToL);
  mmMidSum.connect(mmMidToR);
  mmSideHpf.connect(mmSideToL);
  mmSideHpf.connect(mmSideToR);

  mmMidToL.connect(mmMerger, 0, 0);
  mmSideToL.connect(mmMerger, 0, 0);
  mmMidToR.connect(mmMerger, 0, 1);
  mmSideToR.connect(mmMerger, 0, 1);

  mmMerger.connect(cleanWet);
  cleanWet.connect(cleanOut);

  // =========================================================================
  // Module 2: Glue Comp (True Bypassable)
  // =========================================================================
  const compIn = ctx.createGain();
  const compOut = ctx.createGain();
  const compDry = ctx.createGain();
  const compWet = ctx.createGain();

  const compNode = ctx.createDynamicsCompressor();
  compNode.threshold.value = mState.comp.threshold;
  compNode.ratio.value = mState.comp.ratio;
  compNode.attack.value = 0.03;
  compNode.release.value = 0.15;
  compNode.knee.value = 6.0;

  const mixRatio = mState.comp.enabled ? mState.comp.mix / 100 : 0;
  compDry.gain.value = mState.comp.enabled ? (1 - mixRatio) : 1.0;
  compWet.gain.value = mState.comp.enabled ? mixRatio : 0.0;

  compIn.connect(compDry);
  compIn.connect(compNode);
  compNode.connect(compWet);
  compDry.connect(compOut);
  compWet.connect(compOut);

  // =========================================================================
  // Module 3: Saturator (True Bypassable)
  // =========================================================================
  const satIn = ctx.createGain();
  const satOut = ctx.createGain();
  const satDry = ctx.createGain();
  const satWet = ctx.createGain();

  satDry.gain.value = mState.sat.enabled ? 0.0 : 1.0;
  satWet.gain.value = mState.sat.enabled ? 1.0 : 0.0;

  satIn.connect(satDry);
  satDry.connect(satOut);

  const satDrive = ctx.createGain();
  satDrive.gain.value = 1.0; // Unity gain: drive is handled inside normalized transfer curve

  const satShaper = ctx.createWaveShaper();
  satShaper.curve = getDistortionCurve(mState.sat.mode, mState.sat.drive);
  const isHighRes = ctx.sampleRate >= 88200;
  satShaper.oversample = isHighRes ? '2x' : (mState.sat.oversample || '4x');

  const satCompGain = ctx.createGain();
  satCompGain.gain.value = 1.0; // Compensated mathematically inside curve normalization

  const satWarmth = ctx.createBiquadFilter();
  satWarmth.type = 'peaking';
  satWarmth.frequency.value = 250;
  satWarmth.Q.value = 0.8;
  satWarmth.gain.value = mState.sat.warmth;

  satIn.connect(satDrive);
  satDrive.connect(satShaper);
  satShaper.connect(satCompGain);
  satCompGain.connect(satWarmth);
  satWarmth.connect(satWet);
  satWet.connect(satOut);

  // =========================================================================
  // Module 4: Stereo Width (True Bypassable)
  // =========================================================================
  const widthIn = ctx.createGain();
  const widthOut = ctx.createGain();
  const widthDry = ctx.createGain();
  const widthWet = ctx.createGain();

  widthDry.gain.value = mState.width.enabled ? 0.0 : 1.0;
  widthWet.gain.value = mState.width.enabled ? 1.0 : 0.0;

  widthIn.connect(widthDry);
  widthDry.connect(widthOut);

  const wSplit = ctx.createChannelSplitter(2);
  const wMidSum = ctx.createGain(); wMidSum.gain.value = 0.5;
  const wSideDiffL = ctx.createGain(); wSideDiffL.gain.value = 0.5;
  const wSideDiffR = ctx.createGain(); wSideDiffR.gain.value = -0.5;
  const wSideSum = ctx.createGain();
  const wSideGain = ctx.createGain();
  wSideGain.gain.value = mState.width.spread / 100;

  const wMerger = ctx.createChannelMerger(2);
  const wMidToL = ctx.createGain(); wMidToL.gain.value = 1.0;
  const wMidToR = ctx.createGain(); wMidToR.gain.value = 1.0;
  const wSideToL = ctx.createGain(); wSideToL.gain.value = 1.0;
  const wSideToR = ctx.createGain(); wSideToR.gain.value = -1.0;

  widthIn.connect(wSplit);
  wSplit.connect(wMidSum, 0);
  wSplit.connect(wMidSum, 1);
  wSplit.connect(wSideDiffL, 0);
  wSplit.connect(wSideDiffR, 1);
  wSideDiffL.connect(wSideSum);
  wSideDiffR.connect(wSideSum);
  wSideSum.connect(wSideGain);

  wMidSum.connect(wMidToL);
  wMidSum.connect(wMidToR);
  wSideGain.connect(wSideToL);
  wSideGain.connect(wSideToR);

  wMidToL.connect(wMerger, 0, 0);
  wSideToL.connect(wMerger, 0, 0);
  wMidToR.connect(wMerger, 0, 1);
  wSideToR.connect(wMerger, 0, 1);

  wMerger.connect(widthWet);
  widthWet.connect(widthOut);

  // =========================================================================
  // Internal Headroom Attenuator (Gain Staging)
  // Uses 32-bit float headroom to scale input to -6.02dBFS (0.50x).
  // Reduces internal clipping across filters, EQs, and shaper nodes
  // =========================================================================
  const inHeadroom = ctx.createGain();
  inHeadroom.gain.value = 0.50; // -6.02 dBFS internal headroom

  // =========================================================================
  // Module 5: Maximizer & Brickwall Limiter (True Bypassable)
  // Combines DynamicsCompressor (RMS density) + Brickwall Soft-Clipper (Oversampled 4x True Peak Ceiling Shaper)
  // =========================================================================
  const maxIn = ctx.createGain();
  const maxOut = ctx.createGain();
  const maxDry = ctx.createGain();
  const maxWet = ctx.createGain();

  // Makeup headroom gain (2.0x = +6.02dB) restores internal -6dB headroom back to 1.0x
  const MAKEUP_HEADROOM = 2.0;
  const ceilingGain = Math.pow(10, mState.max.ceiling / 20);
  maxDry.gain.value = mState.max.enabled ? 0.0 : MAKEUP_HEADROOM;
  maxWet.gain.value = mState.max.enabled ? ceilingGain : 0.0;

  // Module 5 Bypass with PDC Delay Match
  const maxDryDelay = ctx.createDelay(0.05);
  maxDryDelay.delayTime.value = LOOKAHEAD_SEC;
  maxIn.connect(maxDryDelay);
  maxDryDelay.connect(maxDry);
  maxDry.connect(maxOut);

  const maxPreGain = ctx.createGain();
  // Total PreGain = Makeup Headroom (2.0x) * Boost Gain
  maxPreGain.gain.value = MAKEUP_HEADROOM * Math.pow(10, mState.max.boost / 20);

  const limiter = ctx.createDynamicsCompressor();
  // Musical mastering compressor: smooth 4ms attack prevents low-end wave destruction (50-100Hz),
  // wide 10dB soft knee smoothly tames RMS before brickwall soft-clipper
  limiter.threshold.value = -Math.max(2.0, mState.max.boost * 0.8 + 2.0);
  limiter.ratio.value = 16.0; // Transparent mastering compression ratio
  limiter.knee.value = 10.0;  // 10dB wide soft knee prevents harsh distortion on transients
  limiter.attack.value = 0.004; // 4ms attack protects low-frequency wave integrity (50-100Hz)
  limiter.release.value = mState.max.response === 'punchy' ? 0.10 : (mState.max.response === 'fast' ? 0.02 : 0.05);

  // Lookahead Delay Buffer (Pre-shaper peak anticipation)
  const wetLookahead = ctx.createDelay(0.05);
  wetLookahead.delayTime.value = LOOKAHEAD_SEC;

  // Brickwall Soft-Clipper (True Peak Ceiling Shaper with 4x oversampling & Decimation Guard)
  const HEADROOM = 4.0;
  const shaperPreGain = ctx.createGain();
  shaperPreGain.gain.value = 1.0 / HEADROOM;

  const brickwallShaper = ctx.createWaveShaper();
  brickwallShaper.curve = getBrickwallLimiterCurve(HEADROOM, 0.80, 0.940);
  brickwallShaper.oversample = isHighRes ? '2x' : '4x';

  maxIn.connect(maxPreGain);
  maxPreGain.connect(limiter);
  limiter.connect(wetLookahead);
  wetLookahead.connect(shaperPreGain);
  shaperPreGain.connect(brickwallShaper);
  brickwallShaper.connect(maxWet);
  maxWet.connect(maxOut);

  // =========================================================================
  // Serial Module Routing (All true bypassable with Internal Headroom)
  // =========================================================================
  let isWetAttached = false;
  if (!mState.bypass) {
    input.connect(inHeadroom);
    isWetAttached = true;
  }
  inHeadroom.connect(cleanIn);
  cleanOut.connect(compIn);
  compOut.connect(satIn);
  satOut.connect(widthIn);
  widthOut.connect(maxIn);
  maxOut.connect(matchGain);
  matchGain.connect(wetGain);
  wetGain.connect(output);

  return {
    input, output, dryGain, wetGain, matchGain, inHeadroom, isWetAttached,
    // Module 1 (Clean)
    cleanDry, cleanWet, lowCut, toneLow, toneHigh, air, mmSideHpf,
    // Module 2 (Comp)
    compDry, compWet, compNode,
    // Module 3 (Sat)
    satDry, satWet, satDrive, satShaper, satCompGain, satWarmth,
    // Module 4 (Width)
    widthDry, widthWet, wSideGain,
    // Module 5 (Max)
    maxDry, maxWet, maxPreGain, limiter, shaperPreGain, brickwallShaper
  };
}

let onMasteringUIUpdateCallback = null;
export function setMasteringUIUpdateCallback(cb) {
  onMasteringUIUpdateCallback = cb;
}

// --- Update Mastering DSP Parameters Smoothly ---
export function updateMasteringDSP() {
  if (!state.masteringNodes || !state.audioCtx) return;
  const n = state.masteringNodes;
  const m = state.mastering;
  const t = state.audioCtx.currentTime + 0.02;

  // Global Bypass: Physical Detach & Smooth Micro-Fade
  const isBypassed = m.bypass;
  if (isBypassed) {
    // Micro-fade dry in and wet out (avoids clicks/pops)
    n.dryGain.gain.setTargetAtTime(1.0, t, 0.015);
    n.wetGain.gain.setTargetAtTime(0.0, t, 0.015);
    // Physically detach wet route after micro-fade to sleep all DSP nodes
    if (n.isWetAttached) {
      setTimeout(() => {
        if (state.mastering.bypass && n.isWetAttached) {
          try {
            n.input.disconnect(n.inHeadroom);
            n.isWetAttached = false;
          } catch(e) {}
        }
      }, 35);
    }
  } else {
    // Re-attach wet route BEFORE fading in
    if (!n.isWetAttached) {
      try {
        n.input.connect(n.inHeadroom);
        n.isWetAttached = true;
      } catch(e) {}
    }
    n.dryGain.gain.setTargetAtTime(0.0, t, 0.02);
    n.wetGain.gain.setTargetAtTime(1.0, t, 0.02);
  }

  // Auto-Gain Match (only compensates when Maximizer is active and boosting)
  if (m.gainMatch && !isBypassed && m.max.enabled) {
    const matchFactor = 1.0 / Math.pow(10, (m.max.boost * 0.75) / 20);
    n.matchGain.gain.setTargetAtTime(matchFactor, t, 0.03);
  } else {
    n.matchGain.gain.setTargetAtTime(1.0, t, 0.03);
  }

  // 1. Clean & Tone True Bypass & Params
  const cleanOn = m.clean.enabled;
  n.cleanDry.gain.setTargetAtTime(cleanOn ? 0.0 : 1.0, t, 0.02);
  n.cleanWet.gain.setTargetAtTime(cleanOn ? 1.0 : 0.0, t, 0.02);
  if (cleanOn) {
    n.lowCut.frequency.setTargetAtTime(m.clean.lowCut > 0 ? m.clean.lowCut : 10, t, 0.02);
    n.toneLow.gain.setTargetAtTime(-(m.clean.tone * 0.8), t, 0.02);
    n.toneHigh.gain.setTargetAtTime(+(m.clean.tone * 0.8), t, 0.02);
    n.air.gain.setTargetAtTime(m.clean.air, t, 0.02);
    n.mmSideHpf.frequency.setTargetAtTime(m.clean.monoMaker > 0 ? m.clean.monoMaker : 10, t, 0.02);
  }

  // 2. Glue Comp True Bypass & Params
  const compOn = m.comp.enabled;
  const mixR = compOn ? m.comp.mix / 100 : 0;
  n.compDry.gain.setTargetAtTime(compOn ? (1 - mixR) : 1.0, t, 0.02);
  n.compWet.gain.setTargetAtTime(compOn ? mixR : 0.0, t, 0.02);
  if (compOn) {
    n.compNode.threshold.setTargetAtTime(m.comp.threshold, t, 0.02);
    n.compNode.ratio.setTargetAtTime(m.comp.ratio, t, 0.02);
  }

  // 3. Saturator True Bypass & Params
  const satOn = m.sat.enabled;
  n.satDry.gain.setTargetAtTime(satOn ? 0.0 : 1.0, t, 0.02);
  n.satWet.gain.setTargetAtTime(satOn ? 1.0 : 0.0, t, 0.02);
  if (satOn) {
    n.satDrive.gain.setTargetAtTime(1.0, t, 0.02);
    n.satCompGain.gain.setTargetAtTime(1.0, t, 0.02);
    n.satWarmth.gain.setTargetAtTime(m.sat.warmth, t, 0.02);
    n.satShaper.curve = getDistortionCurve(m.sat.mode, m.sat.drive);
    const isHighRes = state.audioCtx.sampleRate >= 88200;
    n.satShaper.oversample = isHighRes ? '2x' : (m.sat.oversample || '4x');
  }

  // 4. Stereo Width True Bypass & Params
  const widthOn = m.width.enabled;
  n.widthDry.gain.setTargetAtTime(widthOn ? 0.0 : 1.0, t, 0.02);
  n.widthWet.gain.setTargetAtTime(widthOn ? 1.0 : 0.0, t, 0.02);
  if (widthOn) {
    n.wSideGain.gain.setTargetAtTime(m.width.spread / 100, t, 0.02);
  }

  // 5. Maximizer & Brickwall Limiter True Bypass & Params
  const maxOn = m.max.enabled;
  const MAKEUP_HEADROOM = 2.0;
  const ceilingGain = Math.pow(10, m.max.ceiling / 20);
  n.maxDry.gain.setTargetAtTime(maxOn ? 0.0 : MAKEUP_HEADROOM, t, 0.02);
  n.maxWet.gain.setTargetAtTime(maxOn ? ceilingGain : 0.0, t, 0.02);
  if (maxOn) {
    n.maxPreGain.gain.setTargetAtTime(MAKEUP_HEADROOM * Math.pow(10, m.max.boost / 20), t, 0.02);
    n.limiter.threshold.setTargetAtTime(-Math.max(2.0, m.max.boost * 0.8 + 2.0), t, 0.02);
    n.limiter.knee.setTargetAtTime(10.0, t, 0.02);
    n.limiter.ratio.setTargetAtTime(16.0, t, 0.02);
    n.limiter.attack.setTargetAtTime(0.004, t, 0.02);
    n.limiter.release.setTargetAtTime(m.max.response === 'punchy' ? 0.10 : (m.max.response === 'fast' ? 0.02 : 0.05), t, 0.02);
    // Brickwall curve is normalized to [0, 1.0] and remains constant. Ceiling is applied via maxWet post-gain.
  }

  if (onMasteringUIUpdateCallback) {
    onMasteringUIUpdateCallback();
  }
}
