import { state, MASTERING_PRESETS } from '../state/appState';
import { updateMasteringDSP, setMasteringUIUpdateCallback } from '../dsp/mastering';
import {
  globalBypassBtn,
  globalBypassText,
  gainMatchBtn,
  masteringStatusSummary,
  presetSelect,
  masteringToggleHeader,
  masteringContent,
  masteringSection,
  masteringToggleArrow,
  modClean,
  modComp,
  modSat,
  modWidth,
  modMax,
  pwrClean,
  pwrComp,
  pwrSat,
  pwrWidth,
  pwrMax,
  satBadgeOS
} from './dom';

let activeKnob: HTMLElement | null = null;
let syncPopover = () => {};

// --- Update Mastering UI Elements ---
export function updateMasteringUIState() {
  const m = state.mastering;

  // Master Power button (Replaces legacy "Bypass" concept with intuitive ON / OFF)
  const isMasteringOn = !m.bypass;
  if (globalBypassBtn) {
    globalBypassBtn.classList.toggle('active', isMasteringOn);
    if (globalBypassText) {
      globalBypassText.textContent = isMasteringOn ? 'MASTERING: ON' : 'MASTERING: OFF';
    }
  }

  // Gain match button
  if (gainMatchBtn) {
    gainMatchBtn.classList.toggle('active', m.gainMatch);
  }

  // Status Summary
  if (masteringStatusSummary) {
    const activeCount = [m.clean.enabled, m.comp.enabled, m.sat.enabled, m.width.enabled, m.max.enabled].filter(Boolean).length;
    if (isMasteringOn) {
      masteringStatusSummary.textContent = `${activeCount} Modules Active (ON)`;
      masteringStatusSummary.style.color = 'var(--accent-cyan)';
    } else {
      masteringStatusSummary.textContent = 'OFF (Bypassed)';
      masteringStatusSummary.style.color = 'var(--text-muted)';
    }
  }

  // Module Cards & Power Buttons
  const modules = [
    { card: modClean, pwr: pwrClean, enabled: m.clean.enabled },
    { card: modComp, pwr: pwrComp, enabled: m.comp.enabled },
    { card: modSat, pwr: pwrSat, enabled: m.sat.enabled },
    { card: modWidth, pwr: pwrWidth, enabled: m.width.enabled },
    { card: modMax, pwr: pwrMax, enabled: m.max.enabled }
  ];
  modules.forEach(mod => {
    if (mod.card) {
      mod.card.classList.toggle('bypassed', !mod.enabled || m.bypass);
    }
  });

  // Update Knobs UI
  const knobConfigs = [
    { id: 'knobTone', val: m.clean.tone, unit: 'dB', sign: true },
    { id: 'knobAir', val: m.clean.air, unit: 'dB', sign: true },
    { id: 'knobThreshold', val: m.comp.threshold, unit: 'dB', sign: false },
    { id: 'knobCompMix', val: m.comp.mix, unit: '%', sign: false },
    { id: 'knobDrive', val: m.sat.drive, unit: '%', sign: false },
    { id: 'knobWarmth', val: m.sat.warmth, unit: 'dB', sign: true },
    { id: 'knobSpread', val: m.width.spread, unit: '%', sign: false },
    { id: 'knobBoost', val: m.max.boost, unit: 'dB', sign: true },
    { id: 'knobCeiling', val: m.max.ceiling, unit: 'dB', sign: false }
  ];

  knobConfigs.forEach(kc => {
    const el = document.getElementById(kc.id);
    if (!el) return;
    const min = parseFloat(el.getAttribute('data-min') || '0');
    const max = parseFloat(el.getAttribute('data-max') || '100');
    const clamped = Math.max(min, Math.min(max, kc.val));
    el.setAttribute('data-val', clamped.toFixed(1));

    const pct = (clamped - min) / (max - min);
    const angle = -135 + pct * 270;
    const ind = el.querySelector<HTMLElement>('.knob-indicator');
    if (ind) ind.style.transform = `rotate(${angle}deg)`;

    const txt = el.querySelector('.knob-val');
    if (txt) {
      let str = clamped.toFixed(1) + ' ' + kc.unit;
      if (kc.sign && clamped > 0) str = '+' + str;
      txt.textContent = str;
    }
  });

  // Update Switches UI
  updateSwitchUI('swLowCut', m.clean.lowCut.toString());
  updateSwitchUI('swMonoMaker', m.clean.monoMaker.toString());
  updateSwitchUI('swRatio', m.comp.ratio.toString());
  updateSwitchUI('swSatMode', m.sat.mode);
  updateSwitchUI('swOversample', m.sat.oversample);
  updateSwitchUI('swLimiterResponse', m.max.response);

  // Oversample Badge
  if (satBadgeOS) satBadgeOS.textContent = (state.audioCtx && state.audioCtx.sampleRate >= 88200) ? '2x OS' : m.sat.oversample + ' OS';

  // Synchronize Popover if open
  if (activeKnob) syncPopover();
}

export function updateSwitchUI(switchContainerId: string, activeVal: string) {
  const container = document.getElementById(switchContainerId);
  if (!container) return;
  const buttons = container.querySelectorAll('.switch-opt');
  buttons.forEach(btn => {
    const val = btn.getAttribute('data-val');
    const isActive = (String(val) === String(activeVal));
    btn.classList.toggle('active', isActive);
  });
}

export function applyMasteringPreset(presetKey: string) {
  if (!MASTERING_PRESETS[presetKey]) return;
  const p = MASTERING_PRESETS[presetKey];
  state.mastering.preset = presetKey;
  state.mastering.clean = { ...state.mastering.clean, ...p.clean };
  state.mastering.comp = { ...state.mastering.comp, ...p.comp };
  state.mastering.sat = { ...state.mastering.sat, ...p.sat };
  state.mastering.width = { ...state.mastering.width, ...p.width };
  state.mastering.max = { ...state.mastering.max, ...p.max };

  if (presetSelect) presetSelect.value = presetKey;
  updateMasteringDSP();
}

// --- Init Mastering UI Event Listeners ---
export function initMasteringUI() {
  // Register callback so dsp/mastering can trigger UI updates
  setMasteringUIUpdateCallback(updateMasteringUIState);

  // Toggle Rack Accordion
  if (masteringToggleHeader) {
    masteringToggleHeader.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('select') || target.closest('input')) {
        return;
      }
      const isCollapsed = masteringContent?.classList.toggle('collapsed');
      if (masteringSection) masteringSection.classList.toggle('collapsed', isCollapsed);
      if (masteringToggleArrow) {
        masteringToggleArrow.textContent = isCollapsed ? '▼' : '▲';
      }
    });
  }

  // Presets
  if (presetSelect) {
    presetSelect.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLSelectElement;
      if (target.value !== 'custom') {
        applyMasteringPreset(target.value);
      }
    });
  }

  // Bypass (Always Accessible from Header Tier 2)
  if (globalBypassBtn) {
    globalBypassBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.mastering.bypass = !state.mastering.bypass;
      updateMasteringDSP();
    });
  }

  // Auto-Gain Match (Always Accessible from Header Tier 2)
  if (gainMatchBtn) {
    gainMatchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.mastering.gainMatch = !state.mastering.gainMatch;
      updateMasteringDSP();
    });
  }

  // Module Power Buttons
  const pwrMap: { btn: HTMLElement | null; mod: 'clean' | 'comp' | 'sat' | 'width' | 'max' }[] = [
    { btn: pwrClean, mod: 'clean' },
    { btn: pwrComp, mod: 'comp' },
    { btn: pwrSat, mod: 'sat' },
    { btn: pwrWidth, mod: 'width' },
    { btn: pwrMax, mod: 'max' }
  ];
  pwrMap.forEach(item => {
    if (item.btn) {
      item.btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.mastering[item.mod].enabled = !state.mastering[item.mod].enabled;
        // If user explicitly enables a module while master power is OFF, turn master power ON
        if (state.mastering[item.mod].enabled && state.mastering.bypass) {
          state.mastering.bypass = false;
        }
        if (presetSelect) presetSelect.value = 'custom';
        updateMasteringDSP();
      });
    }
  });

  // Segmented Switches
  const switchHandlers = [
    { id: 'swLowCut', fn: (v: string) => { state.mastering.clean.lowCut = parseFloat(v); } },
    { id: 'swMonoMaker', fn: (v: string) => { state.mastering.clean.monoMaker = parseFloat(v); } },
    { id: 'swRatio', fn: (v: string) => { state.mastering.comp.ratio = parseFloat(v); } },
    { id: 'swSatMode', fn: (v: string) => { state.mastering.sat.mode = v as any; } },
    { id: 'swOversample', fn: (v: string) => { state.mastering.sat.oversample = v as any; } },
    { id: 'swLimiterResponse', fn: (v: string) => { state.mastering.max.response = v as any; } }
  ];
  switchHandlers.forEach(sh => {
    const container = document.getElementById(sh.id);
    if (container) {
      container.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        const btn = target.closest('.switch-opt') as HTMLElement;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const val = btn.getAttribute('data-val');
        if (!val) return;
        // Immediate exclusive radio-button highlight
        container.querySelectorAll('.switch-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        sh.fn(val);
        if (presetSelect) presetSelect.value = 'custom';
        updateMasteringDSP();
      });
    }
  });

  // =========================================================================
  // Floating Parameter Precision Popover & Knobs Handling
  // =========================================================================
  const popover = document.getElementById('paramPopover') as HTMLElement | null;
  const popoverTitle = document.getElementById('popoverTitle') as HTMLElement | null;
  const popoverResetBtn = document.getElementById('popoverResetBtn') as HTMLElement | null;
  const popoverValDisplay = document.getElementById('popoverValDisplay') as HTMLElement | null;
  const popoverMinusBtn = document.getElementById('popoverMinusBtn') as HTMLElement | null;
  const popoverPlusBtn = document.getElementById('popoverPlusBtn') as HTMLElement | null;
  const popoverSlider = document.getElementById('popoverSlider') as HTMLInputElement | null;
  const popoverMinLabel = document.getElementById('popoverMinLabel') as HTMLElement | null;
  const popoverMidLabel = document.getElementById('popoverMidLabel') as HTMLElement | null;
  const popoverMaxLabel = document.getElementById('popoverMaxLabel') as HTMLElement | null;

  activeKnob = null;

  function getMasteringParam(kid: string): number {
    const m = state.mastering;
    if (kid === 'tone') return m.clean.tone;
    if (kid === 'air') return m.clean.air;
    if (kid === 'threshold') return m.comp.threshold;
    if (kid === 'compMix') return m.comp.mix;
    if (kid === 'drive') return m.sat.drive;
    if (kid === 'warmth') return m.sat.warmth;
    if (kid === 'spread') return m.width.spread;
    if (kid === 'boost') return m.max.boost;
    if (kid === 'ceiling') return m.max.ceiling;
    return 0;
  }

  function setMasteringParam(kid: string, newVal: number) {
    if (kid === 'tone') state.mastering.clean.tone = newVal;
    else if (kid === 'air') state.mastering.clean.air = newVal;
    else if (kid === 'threshold') state.mastering.comp.threshold = newVal;
    else if (kid === 'compMix') state.mastering.comp.mix = newVal;
    else if (kid === 'drive') state.mastering.sat.drive = newVal;
    else if (kid === 'warmth') state.mastering.sat.warmth = newVal;
    else if (kid === 'spread') state.mastering.width.spread = newVal;
    else if (kid === 'boost') state.mastering.max.boost = newVal;
    else if (kid === 'ceiling') state.mastering.max.ceiling = newVal;

    if (presetSelect) presetSelect.value = 'custom';
    updateMasteringDSP();
  }

  function formatParamVal(val: number, unit: string, min: number): string {
    const sign = (min < 0 && val > 0) ? '+' : '';
    const decimals = unit === '%' ? 0 : 1;
    return `${sign}${val.toFixed(decimals)} ${unit}`;
  }

  syncPopover = function() {
    if (!activeKnob || !popover || !popoverSlider || !popoverValDisplay) return;
    const kid = activeKnob.getAttribute('data-id') || '';
    const val = getMasteringParam(kid);
    const min = parseFloat(activeKnob.getAttribute('data-min') || '0');
    const max = parseFloat(activeKnob.getAttribute('data-max') || '100');
    const unit = activeKnob.getAttribute('data-unit') || '';
    const step = parseFloat(activeKnob.getAttribute('data-step') || '0.1');

    popoverSlider.min = min.toString();
    popoverSlider.max = max.toString();
    popoverSlider.step = step.toString();
    popoverSlider.value = val.toString();
    popoverValDisplay.textContent = formatParamVal(val, unit, min);

    // Dynamic track fill with matching module accent color
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    const accent = activeKnob.querySelector<HTMLElement>('.knob-val')?.style.color || 'var(--accent-cyan)';
    popoverSlider.style.background = `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}%, #090e17 ${pct}%, #090e17 100%)`;
    popoverValDisplay.style.color = accent;
    popoverValDisplay.style.textShadow = `0 0 14px ${accent}`;
  };

  function openPopover(knob: HTMLElement) {
    if (!popover) return;
    if (activeKnob === knob && popover.style.display !== 'none') {
      closePopover();
      return;
    }

    if (activeKnob) {
      activeKnob.classList.remove('popover-active');
    }

    activeKnob = knob;
    activeKnob.classList.add('popover-active');

    // Make visible first so layout and styles apply immediately
    popover.style.display = 'flex';

    const label = knob.getAttribute('data-label') || knob.querySelector('.knob-label')?.textContent || '';
    const min = parseFloat(knob.getAttribute('data-min') || '0');
    const max = parseFloat(knob.getAttribute('data-max') || '100');
    const unit = knob.getAttribute('data-unit') || '';
    const def = parseFloat(knob.getAttribute('data-default') || '0');

    if (popoverTitle) popoverTitle.textContent = label;
    if (popoverResetBtn) popoverResetBtn.textContent = `Default (${formatParamVal(def, unit, min)})`;
    if (popoverMinLabel) popoverMinLabel.textContent = formatParamVal(min, unit, min);
    if (popoverMaxLabel) popoverMaxLabel.textContent = formatParamVal(max, unit, min);
    const midVal = (min + max) / 2;
    if (popoverMidLabel) popoverMidLabel.textContent = formatParamVal(midVal, unit, min);

    syncPopover();

    // Smart Positioning
    const rect = knob.getBoundingClientRect();
    const popoverWidth = Math.min(320, window.innerWidth - 24);
    const popoverHeight = 180;

    let top = rect.top - popoverHeight - 12;
    if (top < 10) {
      top = rect.bottom + 12;
    }

    let left = rect.left + (rect.width / 2) - (popoverWidth / 2);
    left = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, left));

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function closePopover() {
    if (!popover) return;
    popover.style.display = 'none';
    if (activeKnob) {
      activeKnob.classList.remove('popover-active');
      activeKnob = null;
    }
  }

  // Popover slider event
  if (popoverSlider) {
    popoverSlider.addEventListener('input', (e: Event) => {
      if (!activeKnob) return;
      const kid = activeKnob.getAttribute('data-id') || '';
      setMasteringParam(kid, parseFloat((e.target as HTMLInputElement).value));
    });
  }

  // Popover step +/- repeat
  function attachStepRepeat(btn: HTMLElement | null, direction: number) {
    if (!btn) return;
    let timer: any = null;
    let repeatTimer: any = null;

    const doStep = () => {
      if (!activeKnob) return;
      const kid = activeKnob.getAttribute('data-id') || '';
      const cur = parseFloat(activeKnob.getAttribute('data-val') || '0');
      const stepVal = parseFloat(activeKnob.getAttribute('data-step') || '0.1');
      const min = parseFloat(activeKnob.getAttribute('data-min') || '0');
      const max = parseFloat(activeKnob.getAttribute('data-max') || '100');
      const next = Math.max(min, Math.min(max, cur + direction * stepVal));
      setMasteringParam(kid, next);
    };

    const start = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      doStep();
      timer = setTimeout(() => {
        repeatTimer = setInterval(doStep, 60);
      }, 350);
    };

    const stop = () => {
      clearTimeout(timer);
      clearInterval(repeatTimer);
    };

    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  }

  attachStepRepeat(popoverMinusBtn, -1);
  attachStepRepeat(popoverPlusBtn, 1);

  // Popover Reset Button
  if (popoverResetBtn) {
    popoverResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!activeKnob) return;
      const kid = activeKnob.getAttribute('data-id') || '';
      const def = parseFloat(activeKnob.getAttribute('data-default') || '0');
      setMasteringParam(kid, def);
    });
  }

  // Light Dismiss (Close popover when tapping outside)
  document.addEventListener('pointerdown', (e: Event) => {
    if (!popover || popover.style.display === 'none') return;
    const target = e.target as HTMLElement;
    if (popover.contains(target) || target.closest('.knob-control')) {
      return;
    }
    closePopover();
  });

  // Escape key to close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });

  // Window resize update
  window.addEventListener('resize', () => {
    if (activeKnob && popover && popover.style.display !== 'none') {
      openPopover(activeKnob);
    }
  });

  // Rotary Knobs Click & Drag Handling
  const knobEls = document.querySelectorAll<HTMLElement>('.knob-control');
  knobEls.forEach(knob => {
    let isDragging = false;
    let startY = 0;
    let startVal = 0;
    let didDragMove = false;

    knob.addEventListener('pointerdown', (e: PointerEvent) => {
      isDragging = true;
      didDragMove = false;
      startY = e.clientY;
      startVal = parseFloat(knob.getAttribute('data-val') || '0') || 0;
      try { knob.setPointerCapture(e.pointerId); } catch(err){}
    });

    knob.addEventListener('pointermove', (e: PointerEvent) => {
      if (!isDragging) return;
      const deltaY = startY - e.clientY;
      if (Math.abs(deltaY) > 3) {
        didDragMove = true;
      }
      const min = parseFloat(knob.getAttribute('data-min') || '0');
      const max = parseFloat(knob.getAttribute('data-max') || '100');
      const step = (max - min) / 100;
      const newVal = Math.max(min, Math.min(max, startVal + deltaY * step * 0.7));

      const kid = knob.getAttribute('data-id') || '';
      setMasteringParam(kid, newVal);
    });

    knob.addEventListener('pointerup', (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      try { knob.releasePointerCapture(e.pointerId); } catch(err){}

      // If clicked/tapped without large drag, open popover
      if (!didDragMove) {
        openPopover(knob);
      }
    });

    knob.addEventListener('pointercancel', () => {
      isDragging = false;
    });
  });

  updateMasteringUIState();
}
