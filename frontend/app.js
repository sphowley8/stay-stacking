'use strict';

// API base URL is injected by deploy.sh
// During development, set this manually or use a .env equivalent
const API_URL = '__API_URL__';

// ============================================================
// STATE
// ============================================================

const state = {
  jwt: null,
  user: null,
  activeTab: 'load',
  activePlanSubtab: 'plan-entry',
  checkins: [],
  activities: [],
  planEntries: [],
  chart: null,
  chartToggles: { distance: true, elevation: false, time: false, zones: false, paceZones: false, powerZones: false, gradeZones: false },
  thresholdMode: { zones: false, powerZones: false, paceZones: false },
  thresholdBoundary: { zones: 2, powerZones: 3, paceZones: 450 },
  summaryFilter: ['Run'],
  modalDate: null,
  tenderToTouch: false,
};

// ============================================================
// API HELPERS
// ============================================================

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (state.jwt) headers['Authorization'] = `Bearer ${state.jwt}`;

  const res = await fetch(API_URL + path, { ...options, headers });

  if (res.status === 401) {
    clearAuth();
    throw new Error('unauthorized');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ============================================================
// AUTH
// ============================================================

function clearAuth() {
  state.jwt = null;
  state.user = null;
  localStorage.removeItem('jwt');
  showAuthScreen();
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

async function initAuth() {
  // Check for OAuth callback token in URL hash
  if (window.location.hash.startsWith('#token=')) {
    const token = window.location.hash.slice(7);
    localStorage.setItem('jwt', token);
    state.jwt = token;
    history.replaceState(null, '', window.location.pathname);
  }

  // Check for OAuth error in URL hash
  if (window.location.hash.startsWith('#error=')) {
    const error = window.location.hash.slice(7);
    history.replaceState(null, '', window.location.pathname);
    const errEl = document.getElementById('auth-error');
    errEl.textContent = error === 'access_denied'
      ? 'Strava access was denied. Please try again.'
      : 'Authentication failed. Please try again.';
    errEl.classList.remove('hidden');
    showAuthScreen();
    return;
  }

  // Load JWT from localStorage
  state.jwt = localStorage.getItem('jwt');

  if (!state.jwt) {
    showAuthScreen();
    return;
  }

  try {
    state.user = await apiFetch('/user');
    showApp();
    activateTab(state.activeTab);
  } catch {
    showAuthScreen();
  }
}

// ============================================================
// TAB NAVIGATION
// ============================================================

function activateTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-${tabId}`);
  });

  if (tabId === 'checkin') loadCheckinTab();
  if (tabId === 'load')    loadLoadTab();
  if (tabId === 'plan')    loadPlanTab();
}

function activateSubtab(subtabId) {
  state.activePlanSubtab = subtabId;

  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === subtabId);
  });

  document.querySelectorAll('.subtab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `subtab-${subtabId}`);
  });
}

// ============================================================
// DAILY CHECK-IN TAB
// ============================================================

async function loadCheckinTab() {
  try {
    const data = await apiFetch('/checkin?days=8');
    state.checkins = data.checkins || [];
    renderRecoveryScore();
    populateTodayCheckin();
    renderInjuryPanel();
  } catch (err) {
    if (err.message !== 'unauthorized') showToast('Failed to load check-in data', 'error');
  }
}

function populateTodayCheckin() {
  const today = getTodayStr();
  const todayCheckin = state.checkins.find(c => c.date === today);
  if (!todayCheckin) return;

  if (todayCheckin.morningStiffness != null) {
    const s = document.getElementById('morning-stiffness');
    s.value = todayCheckin.morningStiffness;
    document.getElementById('val-stiffness').textContent = todayCheckin.morningStiffness;
  }
  if (todayCheckin.morningPain != null) {
    const p = document.getElementById('morning-pain');
    p.value = todayCheckin.morningPain;
    document.getElementById('val-pain').textContent = todayCheckin.morningPain;
  }
  if (todayCheckin.archFeels) {
    document.getElementById('arch-feels').value = todayCheckin.archFeels;
  }
  if (todayCheckin.tenderToTouch != null) {
    state.tenderToTouch = todayCheckin.tenderToTouch;
    document.querySelectorAll('[data-field="tenderToTouch"]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === String(todayCheckin.tenderToTouch));
    });
  }
  if (todayCheckin.eveningPain != null) {
    const ep = document.getElementById('evening-pain');
    ep.value = todayCheckin.eveningPain;
    document.getElementById('val-evening-pain').textContent = todayCheckin.eveningPain;
  }
  if (todayCheckin.fatigue != null) {
    const f = document.getElementById('evening-fatigue');
    f.value = todayCheckin.fatigue;
    document.getElementById('val-fatigue').textContent = todayCheckin.fatigue;
  }
  if (todayCheckin.recoveryTools) {
    const tools = Array.isArray(todayCheckin.recoveryTools)
      ? todayCheckin.recoveryTools
      : Array.from(todayCheckin.recoveryTools); // Handle DynamoDB StringSet
    document.querySelectorAll('#tab-checkin input[type="checkbox"]').forEach(cb => {
      cb.checked = tools.includes(cb.value);
    });
  }
}

function renderRecoveryScore() {
  const banner = document.getElementById('recovery-banner');
  const icon   = document.getElementById('recovery-icon');
  const label  = document.getElementById('recovery-label');

  const status = computeRecoveryScore(state.checkins);

  banner.className = 'recovery-banner';
  if (status === 'green') {
    banner.classList.add('recovery-green');
    icon.textContent  = '🟢';
    label.textContent = 'Adapting — keep building.';
    renderSuggestions('green');
  } else if (status === 'yellow') {
    banner.classList.add('recovery-yellow');
    icon.textContent  = '🟡';
    label.textContent = 'Watch Load — stiffness trending up.';
    renderSuggestions('yellow');
  } else if (status === 'red') {
    banner.classList.add('recovery-red');
    icon.textContent  = '🔴';
    label.textContent = 'Reduce Density — 5-day upward trend detected.';
    renderSuggestions('red');
  } else {
    banner.classList.add('recovery-unknown');
    icon.textContent  = '—';
    label.textContent = 'Log morning check-in to see your recovery status.';
    renderSuggestions('unknown');
  }
}

function computeRecoveryScore(checkins) {
  const withStiffness = checkins
    .filter(c => c.morningStiffness != null)
    .slice(-5);

  if (withStiffness.length < 2) return 'unknown';

  const vals = withStiffness.map(c => c.morningStiffness);
  const last3 = vals.slice(-3);
  const allIncreasing3 = last3.length >= 3 && last3.every((v, i) => i === 0 || v >= last3[i - 1]);
  const allIncreasing5 = vals.length >= 5 && vals.every((v, i) => i === 0 || v >= vals[i - 1]);

  if (allIncreasing5) return 'red';
  if (allIncreasing3) return 'yellow';
  return 'green';
}

function renderSuggestions(status) {
  const container = document.getElementById('suggested-activities');
  const suggestions = {
    green:   ['Trail Run or Cycling', 'Strength Session', 'Maintain current load'],
    yellow:  ['Low-intensity cycling only', 'Isometrics + stretching', 'Avoid heavy downhill'],
    red:     ['Active recovery only', 'Contrast bath + Theragun', 'Reduce downhill by 30%'],
    unknown: [],
  };

  const items = suggestions[status] || [];
  if (items.length === 0) {
    container.innerHTML = '<p class="muted">Save morning check-in to see suggestions.</p>';
    return;
  }

  container.innerHTML = items.map(s =>
    `<div class="suggestion-item"><span>→</span><span>${s}</span></div>`
  ).join('');
}

function renderInjuryPanel() {
  const toggle = document.getElementById('injury-toggle');
  const panel  = document.getElementById('injury-panel');
  const hint   = document.getElementById('injury-toggle-hint');

  const injuryActive = state.user?.injuryActive || false;
  toggle.checked = injuryActive;

  if (injuryActive) {
    panel.classList.remove('hidden');
    hint.classList.add('hidden');
    updateLDI();
  } else {
    panel.classList.add('hidden');
    hint.classList.remove('hidden');
  }
}

function updateLDI() {
  const recent = state.checkins.slice(-3);
  const stiffnessVals = recent.filter(c => c.morningStiffness != null).map(c => c.morningStiffness);
  const avgStiffness = stiffnessVals.length
    ? stiffnessVals.reduce((a, b) => a + b, 0) / stiffnessVals.length
    : 0;

  const lastCheckin = recent[recent.length - 1] || {};
  const tools = lastCheckin.recoveryTools
    ? (Array.isArray(lastCheckin.recoveryTools) ? lastCheckin.recoveryTools : Array.from(lastCheckin.recoveryTools))
    : [];

  const recoveryWeights = { Contrast: 1, Ice: 1, Shockwave: 2, Theragun: 0.5, Graston: 1, Stretching: 0.5, 'Supportive shoes': 0.5 };
  const recoveryScore = tools.reduce((acc, t) => acc + (recoveryWeights[t] || 0), 0);

  const ldi = Math.max(0, avgStiffness - recoveryScore);
  const ldiStatus = ldi > 5 ? 'red' : ldi > 2 ? 'yellow' : 'green';

  document.getElementById('ldi-value').textContent = ldi.toFixed(1);

  const statusBadge = document.getElementById('ldi-status');
  statusBadge.className = 'ldi-status-badge';
  statusBadge.classList.add(`ldi-${ldiStatus}`);

  const adviceMap = {
    green:  'Load density is manageable. Continue current recovery protocol.',
    yellow: 'Consider adding a recovery session. Avoid stacking high-load days.',
    red:    'High load density detected. Reduce downhill volume by 30% and prioritize shockwave/contrast.',
  };

  document.getElementById('injury-advice').textContent = adviceMap[ldiStatus];

  if (ldiStatus === 'red') {
    statusBadge.textContent = '🔴 Reduce Load';
  } else if (ldiStatus === 'yellow') {
    statusBadge.textContent = '🟡 Watch';
  } else {
    statusBadge.textContent = '🟢 Adapting';
  }
}

// ============================================================
// PROGRESSIVE LOAD TAB
// ============================================================

async function loadLoadTab() {
  // Auto-sync if user has a valid token
  if (state.user?.hasValidToken) {
    const syncBtn = document.getElementById('btn-sync');
    syncBtn.textContent = 'Syncing...';
    syncBtn.classList.add('syncing');
    try {
      await apiFetch('/activities/sync', { method: 'POST' });
    } catch { /* Non-fatal — load existing data below */ }
    syncBtn.textContent = 'Sync';
    syncBtn.classList.remove('syncing');
  }

  initFtpInput();
  initVdotInput();

  try {
    const data = await apiFetch('/activities');
    state.activities = data.weeks || [];
    renderLoadChart();
    renderWeeklySummary();
  } catch (err) {
    if (err.message !== 'unauthorized') showToast('Failed to load activities', 'error');
  }
}

// Color shades per metric family. Each activity type gets the next shade by index.
const METRIC_SHADES = {
  distance: ['#ffd166', '#ffa91c', '#e08800', '#b57400', '#7a4d00'],
  elevation: ['#dce8ee', '#b5cbd8', '#7faabe', '#44525f', '#2a3840'],
  time:      ['#b8f0b0', '#79d66e', '#46b038', '#2a7a1f', '#144d0d'],
};

const METRIC_AXIS = {
  distance:   { unit: 'mi',  color: '#b57400' },
  elevation:  { unit: 'ft',  color: '#44525f' },
  time:       { unit: 'hrs', color: '#2a7a1f' },
  zones:      { unit: 'hrs', color: '#b71c1c' },
  paceZones:  { unit: 'hrs', color: '#0d47a1' },
  powerZones: { unit: 'hrs', color: '#6a1b9a' },
  gradeZones: { unit: 'hrs', color: '#2e7d32' },
};

// HR zone display constants (Z1=lightest at bottom, Z5=darkest at top)
const ZONE_NAMES = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
const ZONE_REDS  = ['#ffcdd2', '#ef9a9a', '#e57373', '#c62828', '#7f0000'];

// Pace zone constants — Daniels VDOT 57 (17:45 5K)
// 7 zones: Recovery | Steady State | Marathon | Half Marathon | 10K | 5K | Fast
const PACE_ZONE_NAMES   = ['Recovery', 'Steady State', 'Marathon', 'Half Marathon', '10K', '5K', 'Fast'];
const PACE_ZONE_LABELS  = ['<7:18/mi', '7:18\u20136:29/mi', '6:29\u20136:13/mi', '6:13\u20135:56/mi', '5:56\u20135:43/mi', '5:43\u20135:10/mi', '>5:10/mi'];
const PACE_BLUES        = ['#e3f2fd', '#bbdefb', '#90caf9', '#64b5f6', '#2196f3', '#1565c0', '#01579b'];
// Default pace zone velocity boundaries (m/s) for VDOT 57 — used as fallback in custom pace split
// Must match PACE_THRESHOLDS_MS in backend/lambdas/activities/index.js
const DEFAULT_PACE_THRESHOLDS_MS = [3.674, 4.137, 4.320, 4.520, 4.695, 5.191];

// Power zone constants — Coggan 7-zone model (thresholds as fraction of FTP)
const POWER_ZONE_NAMES  = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO\u2082max', 'Anaerobic', 'Neuro'];
const POWER_PURPLES     = ['#f3e5f5', '#e1bee7', '#ce93d8', '#ab47bc', '#8e24aa', '#6a1b9a', '#4a148c'];
const POWER_ZONE_PCTS   = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50]; // 6 thresholds → 7 zones

// Gradient zone constants — 4 buckets by absolute grade (combines up + down of same steepness)
const GRADE_ZONE_NAMES  = ['Flat', 'Easy Hill', 'Steep Hill', 'Power Hike'];
const GRADE_ZONE_LABELS = ['\u22122\u20132%', '2\u20135%', '5\u201312%', '>12%'];
const GRADE_GREENS      = ['#a5d6a7', '#ffe082', '#ffb74d', '#ef5350'];

function getActiveZoneMetric() {
  return ['zones', 'powerZones', 'paceZones'].find(m => state.chartToggles[m]);
}

function getThresholdBoundaryCount(metric) {
  if (metric === 'zones') return 4;      // 5 HR zones → 4 boundaries
  if (metric === 'powerZones') return 6; // 7 power zones → 6 boundaries
  if (metric === 'paceZones') return 6;  // 7 pace zones → 6 boundaries
  return 0;
}

function getThresholdCutLabel(metric, boundary) {
  if (metric === 'zones') return `Z${boundary + 1} | Z${boundary + 2}`;
  if (metric === 'powerZones') {
    const ftp = state.user?.ftp;
    const pct = POWER_ZONE_PCTS[boundary];
    return ftp ? `${Math.round(pct * ftp)} W` : `${Math.round(pct * 100)}% FTP`;
  }
  if (metric === 'paceZones') {
    // boundary is seconds-per-mile (300–600)
    const min = Math.floor(boundary / 60);
    const sec = boundary % 60;
    return `${min}:${String(sec).padStart(2, '0')}/mi`;
  }
  return '';
}

function updateThresholdRow() {
  const active = getActiveZoneMetric();
  const row = document.getElementById('threshold-row');
  if (!active) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  const inThreshold = state.thresholdMode[active];
  document.querySelectorAll('.threshold-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === (inThreshold ? 'threshold' : 'zones'));
  });
  const control = document.getElementById('threshold-control');
  control.classList.toggle('hidden', !inThreshold);
  if (inThreshold) {
    const slider = document.getElementById('threshold-slider');
    if (active === 'paceZones') {
      slider.min = 300;
      slider.max = 600;
      slider.step = 15;
      slider.value = state.thresholdBoundary.paceZones;
    } else {
      slider.min = 0;
      slider.step = 1;
      slider.max = getThresholdBoundaryCount(active) - 1;
      slider.value = Math.min(state.thresholdBoundary[active], getThresholdBoundaryCount(active) - 1);
    }
    document.getElementById('threshold-cut-label').textContent = getThresholdCutLabel(active, parseInt(slider.value));
  }
}

function renderLoadChart() {
  const weeks = state.activities;
  const empty = document.getElementById('load-empty');

  const hasData = weeks.some(w => w.totalDistance > 0 || w.totalElevation > 0 || w.totalTime > 0);
  if (!hasData) {
    empty.classList.remove('hidden');
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    document.getElementById('chart-legend-left').innerHTML = '';
    document.getElementById('chart-legend-right').innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  const labels = weeks.map(w => formatWeekLabel(w.weekStart));

  // Collect all activity types present in the data.
  // "Run" always goes first (bottom of stack); remaining types sorted alphabetically.
  const typeSet = new Set();
  for (const week of weeks) {
    for (const type of Object.keys(week.byType || {})) typeSet.add(type);
  }
  const allActivityTypes = [...typeSet].sort((a, b) => {
    if (a === 'Run') return -1;
    if (b === 'Run') return 1;
    return a.localeCompare(b);
  });

  // Apply sport filter: empty array = All; otherwise restrict to selected types
  const activityTypes = state.summaryFilter.length === 0
    ? allActivityTypes
    : allActivityTypes.filter(t => state.summaryFilter.includes(t));

  const activeMetrics = ['distance', 'elevation', 'time', 'zones', 'paceZones', 'powerZones', 'gradeZones'].filter(m => state.chartToggles[m]);
  const datasets = [];

  for (const metric of activeMetrics) {
    if (metric === 'zones') {
      if (state.thresholdMode.zones) {
        const b = state.thresholdBoundary.zones;
        datasets.push({
          label: 'Above threshold (hrs)', yAxisID: 'y-zones', stack: 'stack-zones',
          data: weeks.map(w => {
            const z = w.hrZones;
            return Array.isArray(z) ? parseFloat((z.slice(b + 1).reduce((a, v) => a + v, 0) / 3600).toFixed(1)) : 0;
          }),
          backgroundColor: '#c62828', borderWidth: 0, borderRadius: 0,
        });
        datasets.push({
          label: 'Below threshold (hrs)', yAxisID: 'y-zones', stack: 'stack-zones',
          data: weeks.map(w => {
            const z = w.hrZones;
            return Array.isArray(z) ? parseFloat((z.slice(0, b + 1).reduce((a, v) => a + v, 0) / 3600).toFixed(1)) : 0;
          }),
          backgroundColor: '#ffcdd2', borderWidth: 0, borderRadius: 0,
        });
      } else {
        // HR Zones: Z5 (hardest) at bottom → Z1 (easiest) at top
        for (let z = ZONE_NAMES.length - 1; z >= 0; z--) {
          datasets.push({
            label: `${ZONE_NAMES[z]} (hrs)`,
            yAxisID: 'y-zones',
            stack: 'stack-zones',
            data: weeks.map(w => {
              const zoneArr = w.hrZones;
              return Array.isArray(zoneArr) ? parseFloat((zoneArr[z] / 3600).toFixed(1)) : 0;
            }),
            backgroundColor: ZONE_REDS[z],
            borderWidth: 0,
            borderRadius: 0,
          });
        }
      }
    } else if (metric === 'paceZones') {
      if (state.thresholdMode.paceZones) {
        const cutoffSecPerMile = state.thresholdBoundary.paceZones;
        const cutoffMs = 1609.34 / cutoffSecPerMile; // m/s — higher = faster
        const thresholds = state.user?.vdotThresholds || DEFAULT_PACE_THRESHOLDS_MS;
        // Zone boundaries in m/s: zone i spans [loBounds[i], hiBounds[i]]
        const loBounds = [0, ...thresholds];
        const hiBounds = [...thresholds, thresholds[5] + (thresholds[5] - thresholds[4])];

        const splitData = weeks.map(w => {
          const z = w.paceZones;
          if (!Array.isArray(z)) return [0, 0];
          let above = 0, below = 0;
          for (let i = 0; i < z.length; i++) {
            const t = z[i] / 3600;
            const lo = loBounds[i], hi = hiBounds[i];
            if (lo >= cutoffMs)       above += t;
            else if (hi <= cutoffMs)  below += t;
            else { const f = (hi - cutoffMs) / (hi - lo); above += t * f; below += t * (1 - f); }
          }
          return [parseFloat(above.toFixed(2)), parseFloat(below.toFixed(2))];
        });

        datasets.push({
          label: 'Faster than cutoff (hrs)', yAxisID: 'y-paceZones', stack: 'stack-paceZones',
          data: splitData.map(d => d[0]),
          backgroundColor: '#1565c0', borderWidth: 0, borderRadius: 0,
        });
        datasets.push({
          label: 'Slower than cutoff (hrs)', yAxisID: 'y-paceZones', stack: 'stack-paceZones',
          data: splitData.map(d => d[1]),
          backgroundColor: '#bbdefb', borderWidth: 0, borderRadius: 0,
        });
      } else {
        // Pace Zones: fastest (P7) at bottom → slowest (P1 Recovery) at top
        for (let z = PACE_ZONE_NAMES.length - 1; z >= 0; z--) {
          datasets.push({
            label: `P${z + 1} ${PACE_ZONE_NAMES[z]} (hrs)`,
            yAxisID: 'y-paceZones',
            stack: 'stack-paceZones',
            data: weeks.map(w => {
              const zoneArr = w.paceZones;
              return Array.isArray(zoneArr) ? parseFloat((zoneArr[z] / 3600).toFixed(1)) : 0;
            }),
            backgroundColor: PACE_BLUES[z],
            borderWidth: 0,
            borderRadius: 0,
          });
        }
      }
    } else if (metric === 'powerZones') {
      if (state.thresholdMode.powerZones) {
        const b = state.thresholdBoundary.powerZones;
        datasets.push({
          label: 'Above threshold (hrs)', yAxisID: 'y-powerZones', stack: 'stack-powerZones',
          data: weeks.map(w => {
            const z = w.powerZones;
            return Array.isArray(z) ? parseFloat((z.slice(b + 1).reduce((a, v) => a + v, 0) / 3600).toFixed(1)) : 0;
          }),
          backgroundColor: '#6a1b9a', borderWidth: 0, borderRadius: 0,
        });
        datasets.push({
          label: 'Below threshold (hrs)', yAxisID: 'y-powerZones', stack: 'stack-powerZones',
          data: weeks.map(w => {
            const z = w.powerZones;
            return Array.isArray(z) ? parseFloat((z.slice(0, b + 1).reduce((a, v) => a + v, 0) / 3600).toFixed(1)) : 0;
          }),
          backgroundColor: '#e1bee7', borderWidth: 0, borderRadius: 0,
        });
      } else {
        // Power Zones: Z7 Neuromuscular (hardest) at bottom → Z1 Recovery at top
        for (let z = POWER_ZONE_NAMES.length - 1; z >= 0; z--) {
          datasets.push({
            label: `Z${z + 1} ${POWER_ZONE_NAMES[z]} (hrs)`,
            yAxisID: 'y-powerZones',
            stack: 'stack-powerZones',
            data: weeks.map(w => {
              const zoneArr = w.powerZones;
              return Array.isArray(zoneArr) ? parseFloat((zoneArr[z] / 3600).toFixed(1)) : 0;
            }),
            backgroundColor: POWER_PURPLES[z],
            borderWidth: 0,
            borderRadius: 0,
          });
        }
      }
    } else if (metric === 'gradeZones') {
      // Grade Zones: Power Hike (steepest) at bottom → Flat at top
      for (let z = GRADE_ZONE_NAMES.length - 1; z >= 0; z--) {
        datasets.push({
          label: `${GRADE_ZONE_NAMES[z]} (hrs)`,
          yAxisID: 'y-gradeZones',
          stack: 'stack-gradeZones',
          data: weeks.map(w => {
            const zoneArr = w.gradeZones;
            return Array.isArray(zoneArr) ? parseFloat((zoneArr[z] / 3600).toFixed(1)) : 0;
          }),
          backgroundColor: GRADE_GREENS[z],
          borderWidth: 0,
          borderRadius: 0,
        });
      }
    } else {
      const shades = METRIC_SHADES[metric];
      const unit = METRIC_AXIS[metric].unit;
      for (const [idx, type] of activityTypes.entries()) {
        datasets.push({
          label: `${type} (${unit})`,
          yAxisID: `y-${metric}`,
          stack: `stack-${metric}`,
          data: weeks.map(w => {
            const t = w.byType?.[type];
            if (!t) return 0;
            if (metric === 'distance') return parseFloat((t.distance / 1609.34).toFixed(2));
            if (metric === 'elevation') return Math.round(t.elevation * 3.28084);
            return parseFloat((t.time / 3600).toFixed(1));
          }),
          backgroundColor: shades[idx % shades.length],
          borderWidth: 0,
          borderRadius: 0,
        });
      }
    }
  }

  if (state.chart) state.chart.destroy();

  // One independent Y axis per active metric.
  // 1st → left (draws grid). 2nd → right. 3rd+ → hidden (still scales bars; values in tooltip).
  const scales = { x: { grid: { display: false } } };
  activeMetrics.forEach((metric, i) => {
    scales[`y-${metric}`] = {
      type: 'linear',
      position: i === 0 ? 'left' : 'right',
      display: i < 2,
      stacked: true,
      beginAtZero: true,
      grid: {
        color: 'rgba(181, 203, 216, 0.4)',
        drawOnChartArea: i === 0,
      },
      ticks: {
        color: METRIC_AXIS[metric].color,
        callback: (val) => METRIC_AXIS[metric].unit === 'hrs'
          ? formatHours(val)
          : `${val} ${METRIC_AXIS[metric].unit}`,
      },
    };
  });

  const ctx = document.getElementById('load-chart').getContext('2d');
  state.chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => {
              const val = context.parsed.y;
              if (!val) return null;
              const metric = (context.dataset.yAxisID || '').replace('y-', '');
              const label = context.dataset.label.replace(' (hrs)', '');
              if (METRIC_AXIS[metric]?.unit === 'hrs') return `${label}: ${formatHours(val)}`;
              return `${context.dataset.label}: ${val}`;
            },
          },
        },
      },
      scales,
    },
  });

  renderChartLegends(activeMetrics, activityTypes);
  renderSummaryFilter(allActivityTypes);
}

function renderSummaryFilter(activityTypes) {
  const row = document.getElementById('summary-filter');
  if (!activityTypes.length) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');

  // Order: All first, then Run, then remaining types alphabetically
  const options = ['All', 'Run', ...activityTypes.filter(t => t !== 'Run')];
  const isAll = state.summaryFilter.length === 0;

  row.innerHTML = options.map(opt => {
    const active = opt === 'All' ? isAll : state.summaryFilter.includes(opt);
    return `<button class="summary-filter-btn${active ? ' active' : ''}" data-type="${opt}">${opt}</button>`;
  }).join('');

  row.querySelectorAll('.summary-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      if (type === 'All') {
        state.summaryFilter = [];
      } else {
        const idx = state.summaryFilter.indexOf(type);
        if (idx === -1) {
          state.summaryFilter = [...state.summaryFilter, type];
        } else {
          const next = state.summaryFilter.filter(t => t !== type);
          state.summaryFilter = next.length > 0 ? next : [];
        }
      }
      renderLoadChart();
      renderWeeklySummary();
    });
  });
}

function renderChartLegends(activeMetrics, activityTypes) {
  document.getElementById('chart-legend-left').innerHTML  = legendHtml(activeMetrics[0], activityTypes);
  document.getElementById('chart-legend-right').innerHTML = legendHtml(activeMetrics[1], activityTypes);
}

function legendHtml(metric, activityTypes) {
  if (!metric) return '';
  if (metric === 'zones') {
    if (state.thresholdMode.zones) {
      const cut = getThresholdCutLabel('zones', state.thresholdBoundary.zones);
      return `<div class="chart-legend-item"><span class="chart-legend-swatch" style="background:#c62828"></span><span>Above ${cut} (hrs)</span></div>` +
             `<div class="chart-legend-item"><span class="chart-legend-swatch" style="background:#ffcdd2"></span><span>Below ${cut} (hrs)</span></div>`;
    }
    const zones = state.user?.hrZones;
    return ZONE_NAMES.map((name, i) => {
      let range = '';
      if (zones && zones[i]) {
        const min = zones[i].min;
        const max = zones[i].max;
        range = ` ${min}–${max === -1 ? `${min}+` : max}`;
      }
      return `<div class="chart-legend-item">` +
        `<span class="chart-legend-swatch" style="background:${ZONE_REDS[i]}"></span>` +
        `<span>${name}${range} (hrs)</span>` +
        `</div>`;
    }).join('');
  }
  if (metric === 'paceZones') {
    if (state.thresholdMode.paceZones) {
      const cut = getThresholdCutLabel('paceZones', state.thresholdBoundary.paceZones);
      return `<div class="chart-legend-item"><span class="chart-legend-swatch" style="background:#1565c0"></span><span>Faster than ${cut} (hrs)</span></div>` +
             `<div class="chart-legend-item"><span class="chart-legend-swatch" style="background:#bbdefb"></span><span>Slower than ${cut} (hrs)</span></div>`;
    }
    const thresholds = state.user?.vdotThresholds;
    const labels = thresholds ? paceZoneLabelsFromThresholds(thresholds) : PACE_ZONE_LABELS;
    const vdotNote = state.user?.vdot ? ` (VDOT ${Math.round(state.user.vdot)})` : '';
    return PACE_ZONE_NAMES.map((name, i) =>
      `<div class="chart-legend-item">` +
      `<span class="chart-legend-swatch" style="background:${PACE_BLUES[i]}"></span>` +
      `<span>P${i + 1} ${name}${i === 0 ? vdotNote : ''}: ${labels[i]} (hrs)</span>` +
      `</div>`
    ).join('');
  }
  if (metric === 'powerZones') {
    if (state.thresholdMode.powerZones) {
      const cut = getThresholdCutLabel('powerZones', state.thresholdBoundary.powerZones);
      return `<div class="chart-legend-item"><span class="chart-legend-swatch" style="background:#6a1b9a"></span><span>Above ${cut} (hrs)</span></div>` +
             `<div class="chart-legend-item"><span class="chart-legend-swatch" style="background:#e1bee7"></span><span>Below ${cut} (hrs)</span></div>`;
    }
    const ftp = state.user?.ftp;
    return POWER_ZONE_NAMES.map((name, i) => {
      let range = '';
      if (ftp) {
        const lo = i === 0 ? 0 : Math.round(POWER_ZONE_PCTS[i - 1] * ftp);
        if (i < POWER_ZONE_PCTS.length) {
          range = ` ${lo}–${Math.round(POWER_ZONE_PCTS[i] * ftp)}W`;
        } else {
          range = ` ${lo}+W`;
        }
      }
      return `<div class="chart-legend-item">` +
        `<span class="chart-legend-swatch" style="background:${POWER_PURPLES[i]}"></span>` +
        `<span>Z${i + 1} ${name}${range} (hrs)</span>` +
        `</div>`;
    }).join('');
  }
  if (metric === 'gradeZones') {
    return GRADE_ZONE_NAMES.map((name, i) =>
      `<div class="chart-legend-item">` +
      `<span class="chart-legend-swatch" style="background:${GRADE_GREENS[i]}"></span>` +
      `<span>${name}: ${GRADE_ZONE_LABELS[i]} (hrs)</span>` +
      `</div>`
    ).join('');
  }
  if (!activityTypes.length) return '';
  const shades = METRIC_SHADES[metric];
  const unit = METRIC_AXIS[metric].unit;
  return activityTypes.map((type, idx) =>
    `<div class="chart-legend-item">` +
    `<span class="chart-legend-swatch" style="background:${shades[idx % shades.length]}"></span>` +
    `<span>${type} (${unit})</span>` +
    `</div>`
  ).join('');
}

function renderWeeklySummary() {
  const summary = document.getElementById('load-summary');
  const weeks = state.activities;
  if (!weeks.length) { summary.classList.add('hidden'); return; }

  const currentWeek = weeks[weeks.length - 1] || {};
  summary.classList.remove('hidden');

  const filter = state.summaryFilter; // array; empty = All
  let distM = 0, elevM = 0, timeSec = 0;

  if (filter.length === 0) {
    distM   = currentWeek.totalDistance  || 0;
    elevM   = currentWeek.totalElevation || 0;
    timeSec = currentWeek.totalTime      || 0;
  } else {
    for (const type of filter) {
      const t = currentWeek.byType?.[type] || {};
      distM   += t.distance  || 0;
      elevM   += t.elevation || 0;
      timeSec += t.time      || 0;
    }
  }

  document.getElementById('summary-distance').textContent =
    `${(distM / 1609.34).toFixed(1)} mi`;
  document.getElementById('summary-elevation').textContent =
    `${Math.round(elevM * 3.28084)} ft`;
  document.getElementById('summary-time').textContent =
    formatDuration(timeSec);
}

// ============================================================
// TRAINING PLAN TAB
// ============================================================

async function loadPlanTab() {
  const startDate = getMondayStr(new Date());
  const endDate   = addDaysStr(startDate, 41);

  try {
    const [planData, actData] = await Promise.all([
      apiFetch(`/training-plan?startDate=${startDate}&endDate=${endDate}`),
      apiFetch('/activities'),
    ]);

    state.planEntries = planData.entries || [];
    state.activities  = actData.weeks || [];

    renderCalendar('calendar-plan', startDate, buildPlanMap(state.planEntries), true);
    renderCalendar('calendar-actual', startDate, buildActualMap(state.activities, startDate, endDate), false);
  } catch (err) {
    if (err.message !== 'unauthorized') showToast('Failed to load training plan', 'error');
  }
}

function buildPlanMap(entries) {
  const map = {};
  for (const e of entries) map[e.date] = e;
  return map;
}

function buildActualMap(weeks, startDate, endDate) {
  // Flatten weekly activities back to per-day using the activities endpoint data
  // Since activities endpoint returns weekly aggregates, for ACTUAL tab we'll
  // need per-day data. We'll re-fetch individual activities if needed.
  // For now, build a map of weekly totals distributed (approximation) or show
  // per-day from the existing data structure.
  // Note: to show per-day actual data, the activities endpoint would need to be extended.
  // For the current implementation, we show weekly totals on Monday of each week.
  const map = {};
  for (const week of weeks) {
    const weekStart = week.weekStart;
    if (weekStart >= startDate && weekStart <= endDate) {
      map[weekStart] = {
        distance: week.totalDistance,
        elevation: week.totalElevation,
        time: week.totalTime,
        isWeekTotal: true,
      };
    }
  }
  return map;
}

function renderCalendar(containerId, startDate, dataMap, isEditable) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const today = getTodayStr();
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Header row
  const header = document.createElement('div');
  header.className = 'week-header';
  header.innerHTML = '<div></div>' + DAY_LABELS.map(d => `<div class="week-day-label">${d}</div>`).join('');
  container.appendChild(header);

  for (let week = 0; week < 6; week++) {
    const row = document.createElement('div');
    row.className = 'week-row';

    // Week label
    const weekDate = addDaysStr(startDate, week * 7);
    const weekLabel = document.createElement('div');
    weekLabel.className = 'week-label';
    weekLabel.textContent = formatShortDate(weekDate);
    row.appendChild(weekLabel);

    for (let day = 0; day < 7; day++) {
      const dateStr = addDaysStr(startDate, week * 7 + day);
      const entry = dataMap[dateStr];

      const cell = document.createElement('div');
      cell.className = 'day-cell';
      if (dateStr === today) cell.classList.add('today');
      if (dateStr < today)   cell.classList.add('past');
      if (entry)             cell.classList.add('has-data');
      if (isEditable)        cell.classList.add('clickable');

      const dayNum = parseInt(dateStr.slice(8), 10);
      cell.innerHTML = `<span class="day-num">${dayNum}</span>`;

      if (entry) {
        const distMi = entry.isWeekTotal
          ? `${(entry.distance / 1609.34).toFixed(1)}mi wk`
          : `${entry.distance.toFixed(1)}mi`;
        const elev = entry.isWeekTotal
          ? `${Math.round(entry.elevation * 3.28084)}ft`
          : `${Math.round(entry.elevation)}ft`;
        const hrs  = entry.isWeekTotal
          ? formatDuration(entry.time)
          : `${entry.time}min`;

        cell.innerHTML += `
          <div class="day-data">
            <div class="day-data-row"><span class="day-data-icon">↔</span>${distMi}</div>
            <div class="day-data-row"><span class="day-data-icon">↑</span>${elev}</div>
            <div class="day-data-row"><span class="day-data-icon">⏱</span>${hrs}</div>
          </div>`;
      }

      if (isEditable) {
        cell.addEventListener('click', () => openDayModal(dateStr, entry));
      }

      row.appendChild(cell);
    }

    container.appendChild(row);
  }
}

// ============================================================
// DAY MODAL
// ============================================================

function openDayModal(dateStr, entry) {
  state.modalDate = dateStr;

  const title = document.getElementById('modal-title');
  title.textContent = `Plan — ${formatFullDate(dateStr)}`;

  document.getElementById('modal-distance').value = entry?.distance  ?? '';
  document.getElementById('modal-elevation').value = entry?.elevation ?? '';
  document.getElementById('modal-time').value      = entry?.time      ?? '';

  document.getElementById('day-modal').classList.remove('hidden');
}

function closeDayModal() {
  document.getElementById('day-modal').classList.add('hidden');
  state.modalDate = null;
}

async function saveDayModal(e) {
  e.preventDefault();
  if (!state.modalDate) return;

  const distance  = parseFloat(document.getElementById('modal-distance').value)  || 0;
  const elevation = parseFloat(document.getElementById('modal-elevation').value) || 0;
  const time      = parseFloat(document.getElementById('modal-time').value)       || 0;

  try {
    await apiFetch(`/training-plan/${state.modalDate}`, {
      method: 'POST',
      body: JSON.stringify({ distance, elevation, time }),
    });
    showToast('Saved', 'success');
    closeDayModal();
    loadPlanTab(); // Refresh calendar
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  }
}

async function deleteDayModal() {
  if (!state.modalDate) return;
  try {
    await apiFetch(`/training-plan/${state.modalDate}`, { method: 'DELETE' });
    showToast('Cleared', 'success');
    closeDayModal();
    loadPlanTab();
  } catch (err) {
    showToast('Failed to clear: ' + err.message, 'error');
  }
}

// ============================================================
// SYNC
// ============================================================

function setHrSyncStatus(state, elapsedSec) {
  const el = document.getElementById('hr-sync-status');
  if (!el) return;
  if (state === 'processing') {
    el.className = 'hr-sync-status processing';
    el.innerHTML = '<span class="hr-sync-dot"></span>HR data processing\u2026';
  } else if (state === 'done') {
    el.className = 'hr-sync-status done';
    el.textContent = `\u2713 HR data fetched \u2014 ${elapsedSec.toFixed(1)}s`;
  } else {
    el.className = 'hr-sync-status hidden';
  }
}

async function syncActivities() {
  const btn = document.getElementById('btn-sync');
  btn.textContent = 'Syncing...';
  btn.classList.add('syncing');
  btn.disabled = true;

  const t0 = Date.now();
  setHrSyncStatus('processing');

  try {
    const result = await apiFetch('/activities/sync', { method: 'POST' });
    const elapsed = (Date.now() - t0) / 1000;
    setHrSyncStatus('done', elapsed);
    showToast(`Synced ${result.synced} activities`, 'success');
    if (state.activeTab === 'load') loadLoadTab();
    if (state.activeTab === 'plan') loadPlanTab();
  } catch (err) {
    setHrSyncStatus('hidden');
    showToast('Sync failed: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Sync';
    btn.classList.remove('syncing');
    btn.disabled = false;
  }
}

// ============================================================
// MORNING CHECK-IN SAVE
// ============================================================

async function saveMorningCheckin() {
  const date = getTodayStr();
  const payload = {
    date,
    morningStiffness: parseInt(document.getElementById('morning-stiffness').value, 10),
    morningPain:      parseInt(document.getElementById('morning-pain').value, 10),
    tenderToTouch:    state.tenderToTouch,
    archFeels:        document.getElementById('arch-feels').value,
  };

  try {
    await apiFetch('/checkin', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Morning check-in saved', 'success');
    await loadCheckinTab();
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  }
}

// ============================================================
// EVENING CHECK-IN SAVE
// ============================================================

async function saveEveningCheckin() {
  const date = getTodayStr();
  const recoveryTools = Array.from(
    document.querySelectorAll('#tab-checkin input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const payload = {
    date,
    eveningPain:    parseInt(document.getElementById('evening-pain').value, 10),
    fatigue:        parseInt(document.getElementById('evening-fatigue').value, 10),
    recoveryTools,
  };

  try {
    await apiFetch('/checkin', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Evening check-in saved', 'success');
    await loadCheckinTab();
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  }
}

// ============================================================
// FTP SETTING
// ============================================================

async function saveFtp() {
  const input = document.getElementById('ftp-input');
  const savedEl = document.getElementById('ftp-saved');
  const val = parseInt(input.value, 10);
  if (!val || val <= 0) return;
  try {
    await apiFetch('/user', {
      method: 'POST',
      body: JSON.stringify({ ftp: val }),
    });
    state.user = { ...state.user, ftp: val };
    savedEl.classList.remove('hidden');
    setTimeout(() => savedEl.classList.add('hidden'), 4000);
    renderLoadChart(); // refresh legend watt ranges
  } catch (err) {
    showToast('Failed to save FTP: ' + err.message, 'error');
  }
}

function initFtpInput() {
  const input = document.getElementById('ftp-input');
  if (state.user?.ftp) input.value = state.user.ftp;
}

// ============================================================
// VDOT PACE ZONE SETTING
// ============================================================

function computeVDOT(distanceM, timeMin) {
  const vMpm = distanceM / timeMin;
  const vo2 = -4.60 + 0.182258 * vMpm + 0.000104 * vMpm * vMpm;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMin) + 0.2989558 * Math.exp(-0.1932605 * timeMin);
  return vo2 / pct;
}

function raceVelocityMs(vdot, distanceM) {
  // Binary search: find m/s where computeVDOT(distanceM, dist/(v*60)) == vdot
  let lo = 1.0, hi = 10.0;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (computeVDOT(distanceM, (distanceM / mid) / 60) < vdot) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function easyBoundaryMs(vdot) {
  // Upper easy-pace boundary ≈ 71% VO2max (no duration effect for E-pace)
  const vo2 = vdot * 0.71;
  const disc = 0.182258 * 0.182258 + 4 * 0.000104 * (vo2 + 4.60);
  return ((-0.182258 + Math.sqrt(disc)) / (2 * 0.000104)) / 60;
}

function vdotToThresholds(vdot) {
  return [
    easyBoundaryMs(vdot),
    raceVelocityMs(vdot, 42195),
    raceVelocityMs(vdot, 21097.5),
    raceVelocityMs(vdot, 10000),
    raceVelocityMs(vdot, 5000),
    raceVelocityMs(vdot, 1609.34),
  ];
}

function parseRaceTime(str) {
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN) || parts.some(p => p < 0)) return null;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  return null;
}

function msToPaceLabel(ms) {
  if (!ms || ms <= 0) return '—';
  const secPerMile = 1609.34 / ms;
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function paceZoneLabelsFromThresholds(thresholds) {
  const t = thresholds;
  return [
    `>${msToPaceLabel(t[0])}/mi`,
    `${msToPaceLabel(t[1])}\u2013${msToPaceLabel(t[0])}/mi`,
    `${msToPaceLabel(t[2])}\u2013${msToPaceLabel(t[1])}/mi`,
    `${msToPaceLabel(t[3])}\u2013${msToPaceLabel(t[2])}/mi`,
    `${msToPaceLabel(t[4])}\u2013${msToPaceLabel(t[3])}/mi`,
    `${msToPaceLabel(t[5])}\u2013${msToPaceLabel(t[4])}/mi`,
    `<${msToPaceLabel(t[5])}/mi`,
  ];
}

async function saveVdot() {
  const distEl  = document.getElementById('vdot-distance');
  const timeEl  = document.getElementById('vdot-time');
  const infoEl  = document.getElementById('vdot-info');

  const distM   = parseFloat(distEl.value);
  const timeMin = parseRaceTime(timeEl.value);
  if (!timeMin || timeMin <= 0) { showToast('Enter a valid time (e.g. 17:45)', 'error'); return; }

  const vdot       = computeVDOT(distM, timeMin);
  const thresholds = vdotToThresholds(vdot);

  try {
    await apiFetch('/user', {
      method: 'POST',
      body: JSON.stringify({ vdot, vdotThresholds: thresholds }),
    });
    state.user = { ...state.user, vdot, vdotThresholds: thresholds };
    infoEl.textContent = `VDOT ${Math.round(vdot)} saved — re-sync to update pace zones`;
    infoEl.classList.remove('hidden');
    setTimeout(() => infoEl.classList.add('hidden'), 5000);
    renderLoadChart(); // refresh legend with new pace labels
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  }
}

function initVdotInput() {
  const infoEl = document.getElementById('vdot-info');
  if (state.user?.vdot) {
    infoEl.textContent = `Current VDOT: ${Math.round(state.user.vdot)}`;
    infoEl.classList.remove('hidden');
  }
}

// ============================================================
// INJURY TOGGLE
// ============================================================

async function handleInjuryToggle(checked) {
  try {
    await apiFetch('/user', {
      method: 'POST',
      body: JSON.stringify({ injuryActive: checked }),
    });
    state.user = { ...state.user, injuryActive: checked };
    renderInjuryPanel();
  } catch (err) {
    showToast('Failed to update: ' + err.message, 'error');
    // Revert toggle
    document.getElementById('injury-toggle').checked = !checked;
  }
}

// ============================================================
// TOAST
// ============================================================

let toastTimer = null;
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
}

// ============================================================
// DATE UTILITIES
// ============================================================

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getMondayStr(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function formatWeekLabel(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatHours(decimalHours) {
  if (!decimalHours || decimalHours <= 0) return '0m';
  const totalMin = Math.round(decimalHours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

// ============================================================
// EVENT LISTENERS
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Auth
  document.getElementById('btn-connect-strava').addEventListener('click', () => {
    window.location.href = API_URL + '/auth/strava';
  });

  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  // Subtab navigation
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateSubtab(btn.dataset.subtab));
  });

  // Sliders — live display
  [
    ['morning-stiffness', 'val-stiffness'],
    ['morning-pain',      'val-pain'],
    ['evening-pain',      'val-evening-pain'],
    ['evening-fatigue',   'val-fatigue'],
  ].forEach(([sliderId, valId]) => {
    const slider = document.getElementById(sliderId);
    slider.addEventListener('input', () => {
      document.getElementById(valId).textContent = slider.value;
    });
  });

  // Tender to touch toggle
  document.querySelectorAll('[data-field="tenderToTouch"]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.tenderToTouch = btn.dataset.value === 'true';
      document.querySelectorAll('[data-field="tenderToTouch"]').forEach(b => {
        b.classList.toggle('active', b.dataset.value === btn.dataset.value);
      });
    });
  });

  // Check-in save buttons
  document.getElementById('btn-save-morning').addEventListener('click', saveMorningCheckin);
  document.getElementById('btn-save-evening').addEventListener('click', saveEveningCheckin);

  // Injury toggle
  document.getElementById('injury-toggle').addEventListener('change', e => {
    handleInjuryToggle(e.target.checked);
  });

  // Metric toggle buttons (Progressive Load)
  document.querySelectorAll('.metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const metric = btn.dataset.metric;
      state.chartToggles[metric] = !state.chartToggles[metric];
      btn.classList.toggle('active', state.chartToggles[metric]);
      // Show/hide FTP row when Power Zones is toggled
      document.getElementById('ftp-row').classList.toggle(
        'hidden', !state.chartToggles.powerZones
      );
      // Show/hide VDOT row when Pace Zones is toggled
      document.getElementById('vdot-row').classList.toggle(
        'hidden', !state.chartToggles.paceZones
      );
      updateThresholdRow();
      renderLoadChart();
    });
  });

  // Threshold mode toggle (Zones / Threshold)
  document.querySelectorAll('.threshold-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const active = getActiveZoneMetric();
      if (!active) return;
      state.thresholdMode[active] = btn.dataset.mode === 'threshold';
      updateThresholdRow();
      renderLoadChart();
    });
  });

  // Threshold slider
  document.getElementById('threshold-slider').addEventListener('input', e => {
    const active = getActiveZoneMetric();
    if (!active) return;
    state.thresholdBoundary[active] = parseInt(e.target.value);
    document.getElementById('threshold-cut-label').textContent = getThresholdCutLabel(active, state.thresholdBoundary[active]);
    renderLoadChart();
  });

  // FTP input — save on blur or Enter
  const ftpInput = document.getElementById('ftp-input');
  ftpInput.addEventListener('change', saveFtp);
  ftpInput.addEventListener('keydown', e => { if (e.key === 'Enter') ftpInput.blur(); });

  // VDOT save button and Enter key on time input
  document.getElementById('btn-save-vdot').addEventListener('click', saveVdot);
  const vdotTimeInput = document.getElementById('vdot-time');
  vdotTimeInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveVdot(); });

  // Sync button
  document.getElementById('btn-sync').addEventListener('click', syncActivities);

  // Day modal
  document.getElementById('day-form').addEventListener('submit', saveDayModal);
  document.getElementById('modal-close').addEventListener('click', closeDayModal);
  document.getElementById('modal-delete').addEventListener('click', deleteDayModal);
  document.getElementById('day-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('day-modal')) closeDayModal();
  });

  // Init
  initAuth();
});
