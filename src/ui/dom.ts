// @ts-nocheck

// --- DOM Elements ---
export const dropZone = document.getElementById('dropZone');
export const fileInput = document.getElementById('fileInput');
export const fileNameLabel = document.getElementById('fileNameLabel');
export const formatStats = document.getElementById('formatStats');
export const channelStats = document.getElementById('channelStats');
export const durationStats = document.getElementById('durationStats');

export const btnPlayPause = document.getElementById('btnPlayPause');
export const playIcon = document.getElementById('playIcon');
export const playText = document.getElementById('playText');
export const btnStop = document.getElementById('btnStop');
export const btnSkipBack = document.getElementById('btnSkipBack');
export const btnSkipForward = document.getElementById('btnSkipForward');
export const btnLoop = document.getElementById('btnLoop');
export const volSlider = document.getElementById('volSlider');
export const volValue = document.getElementById('volValue');
export const currentTimeSpan = document.getElementById('currentTime');
export const totalTimeSpan = document.getElementById('totalTime');

export const waveformContainer = document.getElementById('waveformContainer');
export const waveformCanvas = document.getElementById('waveformCanvas');
export const progressOverlay = document.getElementById('progressOverlay');
export const playhead = document.getElementById('playhead');

export const spectrumWrapper = document.getElementById('spectrumWrapper');
export const spectrumCanvas = document.getElementById('spectrumCanvas');
export const spectrumTooltip = document.getElementById('spectrumTooltip');
export const mainDisplayTitle = document.getElementById('mainDisplayTitle');
export const displayModeGroup = document.getElementById('displayModeGroup');
export const displayModeButtons = document.querySelectorAll('#displayModeGroup .btn-mode');
export const fftSizeItem = document.getElementById('fftSizeItem');
export const viewModeItem = document.getElementById('viewModeItem');
export const smoothingItem = document.getElementById('smoothingItem');
export const fftSizeSelect = document.getElementById('fftSizeSelect');
export const viewModeSelect = document.getElementById('viewModeSelect');
export const smoothingSelect = document.getElementById('smoothingSelect');

export const gonioCanvas = document.getElementById('gonioCanvas');
export const correlationVal = document.getElementById('correlationVal');
export const correlationBar = document.getElementById('correlationBar');
export const bandsContainer = document.getElementById('bandsContainer');
export const fpsBadge = document.getElementById('fpsBadge');
export const spectrumClipSummaryBadge = document.getElementById('spectrumClipSummaryBadge');
export const peakLevelBadge = document.getElementById('peakLevelBadge');
export const btnResetSpectrumPeak = document.getElementById('btnResetSpectrumPeak');
export const gonioPeakLevelBadge = document.getElementById('gonioPeakLevelBadge');
export const gonioHistoryBadge = document.getElementById('gonioHistoryBadge');
export const gonioMinPhaseBadge = document.getElementById('gonioMinPhaseBadge');
export const btnResetGonioPeak = document.getElementById('btnResetGonioPeak');

// --- Mastering Suite DOM Elements (v2.0.0) ---
export const masteringSection = document.getElementById('masteringSection');
export const masteringToggleHeader = document.getElementById('masteringToggleHeader');
export const masteringContent = document.getElementById('masteringContent');
export const masteringToggleArrow = document.getElementById('masteringToggleArrow');
export const masteringStatusSummary = document.getElementById('masteringStatusSummary');
export const presetSelect = document.getElementById('presetSelect');
export const globalBypassBtn = document.getElementById('globalBypassBtn');
export const globalBypassText = document.getElementById('globalBypassText');
export const gainMatchBtn = document.getElementById('gainMatchBtn');
export const btnExportWav = document.getElementById('btnExportWav');
export const dspEngineBadge = document.getElementById('dspEngineBadge');

// WAV Export Modal elements
export const exportWavModal = document.getElementById('exportWavModal');
export const btnExportModalClose = document.getElementById('btnExportModalClose');
export const btnExportModalCancel = document.getElementById('btnExportModalCancel');
export const btnExportModalExecute = document.getElementById('btnExportModalExecute');
export const exportSourceSpec = document.getElementById('exportSourceSpec');
export const exportSampleRateSelect = document.getElementById('exportSampleRateSelect');
export const exportBitDepthSelect = document.getElementById('exportBitDepthSelect');
export const exportEstimatedSize = document.getElementById('exportEstimatedSize');
export const exportRateHint = document.getElementById('exportRateHint');
export const exportBitHint = document.getElementById('exportBitHint');
export const exportLeadInSelect = document.getElementById('exportLeadInSelect');
export const exportLeadOutSelect = document.getElementById('exportLeadOutSelect');
export const exportMicroFadeCheck = document.getElementById('exportMicroFadeCheck');

export const modClean = document.getElementById('modClean');
export const modComp = document.getElementById('modComp');
export const modSat = document.getElementById('modSat');
export const modWidth = document.getElementById('modWidth');
export const modMax = document.getElementById('modMax');

export const pwrClean = document.getElementById('pwrClean');
export const pwrComp = document.getElementById('pwrComp');
export const pwrSat = document.getElementById('pwrSat');
export const pwrWidth = document.getElementById('pwrWidth');
export const pwrMax = document.getElementById('pwrMax');

export const grValText = document.getElementById('grValText');
export const grBarFill = document.getElementById('grBarFill');
export const satBadgeOS = document.getElementById('satBadgeOS');
export const widthPhaseStatus = document.getElementById('widthPhaseStatus');
export const widthPhaseBar = document.getElementById('widthPhaseBar');
export const lufsValue = document.getElementById('lufsValue');
export const lufsNum = document.getElementById('lufsNum');
export const truePeakValue = document.getElementById('truePeakValue');
