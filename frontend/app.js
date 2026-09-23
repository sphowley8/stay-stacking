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
  activities: [],
  runs: [],
  runDetail: null,
  runXAxis: 'time',       // 'time' | 'distance'
  runSplitsMode: 'mile',  // 'mile' | 'lap'
  planEntries: [],
  chart: null,
  chartToggles: { distance: true, elevation: false, time: false, zones: false, paceZones: false, powerZones: false, gradeZones: false },
  thresholdMode: { zones: false, powerZones: false, paceZones: false },
  thresholdBoundary: { zones: 2, powerZones: 3, paceZones: 450 },
  summaryFilter: ['Run'],
  modalDate: null,
  costs: [],
  costsUsers: [],
  costsLastUpdated: null,
  costsChart: null,
  costsEnv: null,
  liCharts: {},
  liActiveCategory: 'aerobic',
  liIndex: null,
  actDistanceUnit: 'mi',
  actElevationUnit: 'ft',
  editingActivity: null,
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

const IS_COSTS_PAGE = window.location.pathname === '/costs';

// ============================================================
// HELP MODAL
// ============================================================

function showHelpModal() {
  document.getElementById('help-modal').classList.remove('hidden');
}

function hideHelpModal() {
  document.getElementById('help-modal').classList.add('hidden');
}

document.getElementById('btn-help').addEventListener('click', showHelpModal);

document.getElementById('help-modal-close').addEventListener('click', hideHelpModal);
document.getElementById('help-modal-cta').addEventListener('click', () => {
  localStorage.setItem('onboarding_shown', '1');
  hideHelpModal();
});
document.getElementById('help-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideHelpModal();
});

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('costs-page').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  if (IS_COSTS_PAGE) {
    document.getElementById('costs-page').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  } else {
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('costs-page').classList.add('hidden');
  }
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
    const userName = [state.user.firstName, state.user.lastName].filter(Boolean).join(' ');
    document.querySelectorAll('.staging-banner').forEach(el => {
      el.textContent = userName ? `STAGING — ${userName}` : 'STAGING';
    });
    showApp();
    if (IS_COSTS_PAGE) {
      initCostsPage();
    } else {
      activateTab(state.activeTab);
      if (!localStorage.getItem('onboarding_shown')) {
        setTimeout(showHelpModal, 400);
      }
    }
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

  if (tabId === 'run')     loadRunTab();
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
// PER-RUN ANALYSIS TAB
// ============================================================

let runHrChart = null;

async function loadRunTab() {
  const select = document.getElementById('run-select');
  try {
    const data = await apiFetch('/activities/runs?days=14');
    const runs = data.runs || [];
    state.runs = runs;

    select.innerHTML = '<option value="">— Select a run —</option>';
    for (const r of runs) {
      const opt = document.createElement('option');
      opt.value = r.activityId;
      const distMi = r.distance ? (r.distance / 1609.344).toFixed(1) + ' mi' : '';
      opt.textContent = [formatFullDate(r.date), r.name, distMi].filter(Boolean).join(' · ');
      select.appendChild(opt);
    }

    const hasRuns = runs.length > 0;
    document.getElementById('run-select-row').classList.toggle('hidden', !hasRuns);
    document.getElementById('run-empty').classList.toggle('hidden', hasRuns);
    document.getElementById('run-detail').classList.add('hidden');

    // Auto-load the most recent run
    if (hasRuns) {
      select.value = runs[0].activityId;
      loadRunDetail(runs[0].activityId);
    }
  } catch (err) {
    if (err.message !== 'unauthorized') showToast('Failed to load runs', 'error');
  }
}

async function loadRunDetail(activityId) {
  const detailEl = document.getElementById('run-detail');
  const loadingEl = document.getElementById('run-loading');
  if (!activityId) {
    detailEl.classList.add('hidden');
    return;
  }
  loadingEl.classList.remove('hidden');
  detailEl.classList.add('hidden');
  try {
    const d = await apiFetch(`/activities/detail?activityId=${encodeURIComponent(activityId)}`);
    renderRunDetail(d);
    detailEl.classList.remove('hidden');
  } catch (err) {
    if (err.message === 'reauth_required') {
      showToast('Write access required — sign out and reconnect Strava', 'error');
    } else if (err.message !== 'unauthorized') {
      showToast('Failed to load run: ' + err.message, 'error');
    }
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function renderRunDetail(d) {
  state.runDetail = d;

  const distMi = (d.distanceMeters || 0) / 1609.344;
  const elevFt = Math.round((d.elevationMeters || 0) * 3.28084);

  document.getElementById('run-stat-distance').textContent = distMi ? distMi.toFixed(2) + ' mi' : '—';
  document.getElementById('run-stat-time').textContent = d.elapsedTime ? formatDuration(d.elapsedTime) : '—';
  document.getElementById('run-stat-pace').textContent =
    (distMi > 0 && d.elapsedTime) ? formatPace(d.elapsedTime / distMi) + '/mi' : '—';
  document.getElementById('run-stat-elev').textContent = elevFt ? elevFt + ' ft' : '—';

  // X-axis toggle: only offer Miles if the run has usable distance samples
  const hasDist = !!(d.hrSeries && Array.isArray(d.hrSeries.dist) && d.hrSeries.dist.some(v => v != null && v > 0));
  if (state.runXAxis === 'distance' && !hasDist) state.runXAxis = 'time';
  const milesBtn = document.querySelector('#run-xaxis-toggle [data-xaxis="distance"]');
  if (milesBtn) milesBtn.disabled = !hasDist;
  syncRunToggle('run-xaxis-toggle', 'xaxis', state.runXAxis);
  syncRunToggle('run-splits-toggle', 'splits', state.runSplitsMode);

  renderRunHrChart();
  renderRunZones(d.hrZoneRanges, d.zoneTimes);
  renderRunSplits(state.runSplitsMode);
}

// Reflect the active option on a toggle button group
function syncRunToggle(groupId, attr, value) {
  document.querySelectorAll(`#${groupId} .run-toggle-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset[attr] === value);
  });
}

function renderRunZones(ranges, times) {
  const container = document.getElementById('run-zones');
  const emptyEl = document.getElementById('run-zones-empty');
  container.innerHTML = '';

  const total = Array.isArray(times) ? times.reduce((a, b) => a + (b || 0), 0) : 0;
  if (total <= 0) {
    container.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  container.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  for (let z = 0; z < ZONE_NAMES.length; z++) {
    const secs = times[z] || 0;
    const pct = (secs / total) * 100;

    let rangeLabel = '—';
    if (Array.isArray(ranges) && ranges[z]) {
      const { min, max } = ranges[z];
      rangeLabel = (max == null || max <= 0 || max < min) ? `${min}+ bpm` : `${min}–${max} bpm`;
    }

    const row = document.createElement('div');
    row.className = 'zone-row';
    row.innerHTML = `
      <span class="zone-name"><span class="zone-swatch" style="background:${ZONE_REDS[z]}"></span>${ZONE_NAMES[z]}</span>
      <span class="zone-range">${rangeLabel}</span>
      <span class="zone-bar-wrap"><span class="zone-bar" style="width:${pct.toFixed(1)}%;background:${ZONE_REDS[z]}"></span></span>
      <span class="zone-pct">${pct.toFixed(0)}%</span>
      <span class="zone-time">${formatDuration(secs)}</span>
    `;
    container.appendChild(row);
  }
}

function formatPace(secPerMile) {
  if (!isFinite(secPerMile) || secPerMile <= 0) return '—';
  let m = Math.floor(secPerMile / 60);
  let s = Math.round(secPerMile % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderRunHrChart() {
  const d = state.runDetail;
  const hrSeries = d && d.hrSeries;
  const hasHeartrate = d && d.hasHeartrate;
  const ranges = d && d.hrZoneRanges;
  const wrap = document.querySelector('.run-hr-chart-wrap');
  const emptyEl = document.getElementById('run-hr-empty');

  if (!hasHeartrate || !hrSeries || !Array.isArray(hrSeries.hr) || hrSeries.hr.length === 0) {
    if (runHrChart) { runHrChart.destroy(); runHrChart = null; }
    wrap.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  // X-axis: elapsed minutes, or cumulative miles when the Miles toggle is active
  const useMiles = state.runXAxis === 'distance'
    && Array.isArray(hrSeries.dist) && hrSeries.dist.some(v => v != null && v > 0);
  const points = hrSeries.t.map((sec, i) => ({
    x: useMiles ? (hrSeries.dist[i] || 0) / 1609.344 : sec / 60,
    y: hrSeries.hr[i],
  }));
  const xTitle = useMiles ? 'Distance (mi)' : 'Time (min)';

  // Zone-limit lines: the lower bound of Z2..Z5 (each is the boundary between adjacent zones)
  const zoneLimits = [];
  if (Array.isArray(ranges)) {
    for (let z = 1; z < ranges.length; z++) {
      const min = ranges[z] && ranges[z].min;
      if (typeof min === 'number' && min > 0) {
        zoneLimits.push({ value: min, label: ZONE_NAMES[z], color: ZONE_REDS[z] });
      }
    }
  }

  // Inline plugin: draw dotted horizontal lines at each zone limit over the chart
  const zoneLinePlugin = {
    id: 'zoneLimitLines',
    afterDatasetsDraw(chart) {
      const y = chart.scales.y;
      const area = chart.chartArea;
      if (!y || !area) return;
      const ctx2 = chart.ctx;
      ctx2.save();
      for (const lim of zoneLimits) {
        if (lim.value < y.min || lim.value > y.max) continue;
        const py = y.getPixelForValue(lim.value);
        ctx2.beginPath();
        ctx2.setLineDash([4, 4]);
        ctx2.lineWidth = 1;
        ctx2.strokeStyle = lim.color;
        ctx2.moveTo(area.left, py);
        ctx2.lineTo(area.right, py);
        ctx2.stroke();
        ctx2.setLineDash([]);
        ctx2.font = '10px sans-serif';
        ctx2.fillStyle = lim.color;
        ctx2.textAlign = 'right';
        ctx2.textBaseline = 'bottom';
        ctx2.fillText(`${lim.label} ${lim.value}`, area.right - 4, py - 1);
      }
      ctx2.restore();
    },
  };

  if (runHrChart) runHrChart.destroy();
  const ctx = document.getElementById('run-hr-chart').getContext('2d');
  runHrChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Heart Rate',
        data: points,
        borderColor: '#e8503a',
        backgroundColor: 'rgba(232, 80, 58, 0.12)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.25,
      }],
    },
    plugins: [zoneLinePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            title: (items) => useMiles
              ? `${items[0].parsed.x.toFixed(2)} mi`
              : `${Math.round(items[0].parsed.x)} min`,
            label: (item) => `${Math.round(item.parsed.y)} bpm`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: xTitle, color: '#7a8f9c', font: { size: 11 } },
          grid: { display: false },
          ticks: { color: '#7a8f9c', font: { size: 11 }, callback: (v) => useMiles ? v.toFixed(1) : Math.round(v) },
        },
        y: {
          title: { display: true, text: 'BPM', color: '#7a8f9c', font: { size: 11 } },
          grid: { color: 'rgba(181, 203, 216, 0.4)' },
          ticks: { color: '#7a8f9c', font: { size: 11 } },
        },
      },
    },
  });
}

function renderRunSplits(mode) {
  const isLap = mode === 'lap';
  const d = state.runDetail;
  const rows = isLap ? (d && d.laps) : (d && d.splits);
  const container = document.getElementById('run-splits');
  const emptyEl = document.getElementById('run-splits-empty');
  container.innerHTML = '';
  container.classList.toggle('lap-mode', isLap);

  if (!Array.isArray(rows) || rows.length === 0) {
    container.classList.add('hidden');
    emptyEl.textContent = isLap
      ? 'No lap data recorded for this run.'
      : 'No distance data — mile splits unavailable for this run.';
    emptyEl.classList.remove('hidden');
    return;
  }
  container.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  // Pace-scaled bars: faster split → longer bar
  const paces = rows.map(s => s.distanceMeters > 0 ? s.timeSec / (s.distanceMeters / 1609.344) : 0)
    .filter(p => p > 0);
  const maxPace = paces.length ? Math.max(...paces) : 1;
  const minPace = paces.length ? Math.min(...paces) : 1;

  const header = document.createElement('div');
  header.className = 'split-row split-head' + (isLap ? ' lap-row' : '');
  header.innerHTML = isLap
    ? `<span class="split-mile">Lap</span><span class="split-dist">Dist</span><span class="split-pace">Pace</span><span class="split-hr">Avg HR</span><span class="split-elev">Elev +/−</span>`
    : `<span class="split-mile">Mile</span><span class="split-pace">Pace</span><span class="split-hr">Avg HR</span><span class="split-elev">Elev +/−</span>`;
  container.appendChild(header);

  for (const s of rows) {
    const mi = s.distanceMeters / 1609.344;
    const secPerMi = mi > 0 ? s.timeSec / mi : 0;
    const gainFt = Math.round(s.elevGainMeters * 3.28084);
    const lossFt = Math.round(s.elevLossMeters * 3.28084);
    // Normalize bar length between 25% (slowest) and 100% (fastest)
    const norm = maxPace > minPace ? (maxPace - secPerMi) / (maxPace - minPace) : 1;
    const barPct = 25 + 75 * Math.max(0, Math.min(1, norm));

    const label = isLap
      ? `${s.lap}`
      : (s.partial ? `${mi.toFixed(2)} <span class="split-partial">partial</span>` : `${s.mile}`);
    const distCell = isLap ? `<span class="split-dist">${mi.toFixed(2)} mi</span>` : '';

    const row = document.createElement('div');
    row.className = 'split-row' + (isLap ? ' lap-row' : '');
    row.innerHTML = `
      <span class="split-mile">${label}</span>
      ${distCell}
      <span class="split-pace">
        <span class="split-bar" style="width:${barPct.toFixed(0)}%"></span>
        <span class="split-pace-val">${formatPace(secPerMi)}</span>
      </span>
      <span class="split-hr">${s.avgHr != null ? s.avgHr + ' bpm' : '—'}</span>
      <span class="split-elev"><span class="elev-gain">+${gainFt}</span> <span class="elev-loss">−${lossFt}</span> ft</span>
    `;
    container.appendChild(row);
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

// Load index — HR zone weights for aerobic load (EPOC proxy: Z1=easy → Z5=max)
const AEROBIC_HR_WEIGHTS = [1, 2, 3, 5, 8];

// Returns how many days have elapsed in the week starting on weekStartStr (YYYY-MM-DD).
// Monday of current week = 1 day, Sunday = 7 days. Historical weeks always return 7.
function getDaysElapsedInWeek(weekStartStr) {
  const [y, m, d] = weekStartStr.split('-').map(Number);
  const weekStart = new Date(y, m - 1, d); // local midnight
  const daysSince = Math.floor((Date.now() - weekStart.getTime()) / 86400000);
  return Math.min(7, Math.max(1, daysSince + 1));
}

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
    renderLoadIndexSection();
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
          label: `G${z + 1} ${GRADE_ZONE_NAMES[z]} (hrs)`,
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
  renderLoadIndexSection();
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
      `<span>G${i + 1} ${name}: ${GRADE_ZONE_LABELS[i]} (hrs)</span>` +
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
// LOAD INDEX (ATL / CTL / TSB)
// ============================================================

function computeLoadIndex(weeks) {
  const cats = ['aerobic', 'muscular', 'structural'];
  const result = { aerobic: [], muscular: [], structural: [] };

  for (const [wi, w] of weeks.entries()) {
    // Aerobic: zone-weighted HR hours (EPOC proxy)
    const aerobic = AEROBIC_HR_WEIGHTS.reduce((sum, wt, i) => {
      return sum + ((Array.isArray(w.hrZones) ? (w.hrZones[i] || 0) : 0) / 3600) * wt;
    }, 0);

    // Muscular: zone-weighted pace + power (Z3×1, Z4×2, Z5×3, Z6×5, Z7×8) + grade stress
    const MUSCULAR_ZONE_WEIGHTS = [1, 2, 3, 5, 8]; // applied to zones[2..6]
    const muscular = (
      (Array.isArray(w.paceZones)
        ? w.paceZones.slice(2).reduce((a, v, i) => a + (v / 3600) * MUSCULAR_ZONE_WEIGHTS[i], 0)
        : 0) +
      (Array.isArray(w.powerZones)
        ? w.powerZones.slice(2).reduce((a, v, i) => a + (v / 3600) * MUSCULAR_ZONE_WEIGHTS[i], 0)
        : 0) +
      (Array.isArray(w.gradeZones) ? (w.gradeZones[2] || 0) : 0) / 3600 * 1 +  // G3 ×1
      (Array.isArray(w.gradeZones) ? (w.gradeZones[3] || 0) : 0) / 3600 * 2    // G4 ×2
    );

    // Structural: time-based impact + eccentric load
    const runHrs   = (w.byType?.Run?.time     || 0) / 3600;
    const cycleHrs = (w.byType?.Cycling?.time || 0) / 3600;
    const g3Hrs    = (Array.isArray(w.gradeZones) ? (w.gradeZones[2] || 0) : 0) / 3600;
    const g4Hrs    = (Array.isArray(w.gradeZones) ? (w.gradeZones[3] || 0) : 0) / 3600;
    const structural = runHrs * 3 + cycleHrs * 1 + g3Hrs * 10 + g4Hrs * 5;

    const loads = { aerobic, muscular, structural };

    // For the most recent (possibly partial) week, step the EMA by actual days elapsed
    // so values reflect today's training state, not just the last day of the week.
    const isCurrentWeek = wi === weeks.length - 1;
    const daysElapsed = isCurrentWeek ? getDaysElapsedInWeek(w.weekStart) : 7;
    const α_ctl = 1 - Math.exp(-daysElapsed / 42);
    const α_atl = 1 - Math.exp(-daysElapsed / 7);

    for (const cat of cats) {
      const load = loads[cat];
      if (wi === 0) {
        result[cat].push({ weekStart: w.weekStart, load: parseFloat(load.toFixed(2)), ctl: parseFloat(load.toFixed(1)), atl: parseFloat(load.toFixed(1)), tsb: 0, acwr: 1 });
      } else {
        const prev = result[cat][wi - 1];
        const ctl  = α_ctl * load + (1 - α_ctl) * prev.ctl;
        const atl  = α_atl * load + (1 - α_atl) * prev.atl;
        const tsb  = prev.ctl - prev.atl;
        const acwr = ctl > 0 ? parseFloat((atl / ctl).toFixed(2)) : null;
        result[cat].push({ weekStart: w.weekStart, load: parseFloat(load.toFixed(2)), ctl: parseFloat(ctl.toFixed(1)), atl: parseFloat(atl.toFixed(1)), tsb: parseFloat(tsb.toFixed(1)), acwr });
      }
    }
  }

  return result;
}

const LI_CAT_COLORS = { aerobic: '#c62828', muscular: '#6a1b9a', structural: '#1565c0' };
const LI_CAT_LABELS = { aerobic: 'Aerobic', muscular: 'Muscular', structural: 'Structural' };

function renderLoadIndexSection() {
  const section = document.getElementById('load-index-section');
  const weeks = state.activities;
  if (!weeks.length) { section.classList.add('hidden'); return; }

  state.liIndex = computeLoadIndex(weeks);
  section.classList.remove('hidden');

  // Wire category toggle buttons (only on first render — check for existing listeners via flag)
  if (!section.dataset.listenersAttached) {
    section.querySelectorAll('.load-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.liActiveCategory = btn.dataset.cat;
        renderLoadIndexCard();
      });
    });
    section.dataset.listenersAttached = 'true';
  }

  renderLoadIndexCard();
  renderLoadMatrix();
}

function renderLoadIndexCard() {
  const cat = state.liActiveCategory;
  const series = state.liIndex[cat];
  const last = series[series.length - 1] || {};
  const { ctl = 0, atl = 0, tsb = 0, acwr = null } = last;
  const color = LI_CAT_COLORS[cat];

  // Update toggle button states
  document.querySelectorAll('.load-cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === cat);
  });

  // Category label
  document.getElementById('li-cat-label').textContent = LI_CAT_LABELS[cat];

  // Badge — ACWR overrides TSB when in danger zone
  let badgeClass, badgeText;
  if (acwr !== null && acwr > 1.5)      { badgeClass = 'tsb-fatigued'; badgeText = 'Injury Risk'; }
  else if (acwr !== null && acwr > 1.3) { badgeClass = 'tsb-training'; badgeText = 'Caution'; }
  else if (tsb > 10)                    { badgeClass = 'tsb-peak';     badgeText = 'Peak Form'; }
  else if (tsb >= 0)                    { badgeClass = 'tsb-fresh';    badgeText = 'Fresh'; }
  else if (tsb >= -10)                  { badgeClass = 'tsb-training'; badgeText = 'Training'; }
  else                                  { badgeClass = 'tsb-fatigued'; badgeText = 'Fatigued'; }

  const badge = document.getElementById('li-badge');
  badge.className = `tsb-badge ${badgeClass}`;
  badge.textContent = badgeText;

  document.getElementById('li-ctl').textContent = ctl.toFixed(1);
  document.getElementById('li-atl').textContent = atl.toFixed(1);

  const tsbEl = document.getElementById('li-tsb');
  tsbEl.textContent = (tsb >= 0 ? '+' : '') + tsb.toFixed(1);
  tsbEl.className = `li-value ${tsb >= 0 ? 'li-tsb-pos' : 'li-tsb-neg'}`;

  // ACWR
  const acwrEl = document.getElementById('li-acwr');
  if (acwr === null) {
    acwrEl.textContent = '—';
    acwrEl.className = 'li-value';
  } else {
    acwrEl.textContent = acwr.toFixed(2);
    acwrEl.className = acwr > 1.5 ? 'li-value li-acwr-danger'
                     : acwr > 1.3 ? 'li-value li-acwr-caution'
                     : acwr < 0.8 ? 'li-value li-acwr-low'
                     :              'li-value li-acwr-ok';
  }

  const TSB_COLOR = '#ffa91c';

  // Left legend — CTL (solid) / ATL (dashed) / TSB (dotted amber)
  document.getElementById('li-legend-left').innerHTML =
    `<div class="chart-legend-item">` +
    `<span class="chart-legend-swatch li-swatch-solid" style="background:${color}"></span>` +
    `<span>CTL (Fitness)</span></div>` +
    `<div class="chart-legend-item">` +
    `<span class="chart-legend-swatch li-swatch-dashed" style="border-color:${color}"></span>` +
    `<span>ATL (Fatigue)</span></div>` +
    `<div class="chart-legend-item">` +
    `<span class="chart-legend-swatch li-swatch-dotted" style="border-color:${TSB_COLOR}"></span>` +
    `<span>TSB (Form)</span></div>`;

  // Chart — destroy and redraw
  if (state.liCharts.main) {
    state.liCharts.main.destroy();
    delete state.liCharts.main;
  }

  const labels  = series.map(s => formatWeekLabel(s.weekStart));
  const ctlData = series.map(s => s.ctl);
  const atlData = series.map(s => s.atl);
  const tsbData = series.map(s => s.tsb);

  const ctx = document.querySelector('.li-sparkline-wrap canvas').getContext('2d');
  state.liCharts.main = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'CTL',
          data: ctlData,
          borderColor: color,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          yAxisID: 'y',
        },
        {
          label: 'ATL',
          data: atlData,
          borderColor: color,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          tension: 0.3,
          yAxisID: 'y',
        },
        {
          label: 'TSB',
          data: tsbData,
          borderColor: TSB_COLOR,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [2, 2],
          pointRadius: 0,
          tension: 0.3,
          yAxisID: 'y-tsb',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: {
            color: '#7a8f9c',
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
          },
        },
        y: {
          display: true,
          position: 'left',
          beginAtZero: false,
          grid: { color: 'rgba(181, 203, 216, 0.4)' },
          ticks: {
            color: color,
            font: { size: 10 },
            maxTicksLimit: 5,
          },
          title: {
            display: true,
            text: 'Load',
            color: '#7a8f9c',
            font: { size: 10 },
          },
        },
        'y-tsb': {
          display: true,
          position: 'right',
          beginAtZero: false,
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#ffa91c',
            font: { size: 10 },
            maxTicksLimit: 5,
          },
          title: {
            display: true,
            text: 'Form',
            color: '#ffa91c',
            font: { size: 10 },
          },
        },
      },
    },
  });
}

function renderLoadMatrix() {
  const rows = [
    { metric: 'HR Z1 time (hrs)',       aerobic: '\u00d71', muscular: '\u2014',       structural: '\u2014'   },
    { metric: 'HR Z2 time (hrs)',       aerobic: '\u00d72', muscular: '\u2014',       structural: '\u2014'   },
    { metric: 'HR Z3 time (hrs)',       aerobic: '\u00d73', muscular: '\u2014',       structural: '\u2014'   },
    { metric: 'HR Z4 time (hrs)',       aerobic: '\u00d75', muscular: '\u2014',       structural: '\u2014'   },
    { metric: 'HR Z5 time (hrs)',       aerobic: '\u00d78', muscular: '\u2014',       structural: '\u2014'   },
    { metric: 'Pace Z3 time (hrs)',     aerobic: '\u2014',  muscular: '\u00d71',      structural: '\u2014'   },
    { metric: 'Pace Z4 time (hrs)',     aerobic: '\u2014',  muscular: '\u00d72',      structural: '\u2014'   },
    { metric: 'Pace Z5 time (hrs)',     aerobic: '\u2014',  muscular: '\u00d73',      structural: '\u2014'   },
    { metric: 'Pace Z6 time (hrs)',     aerobic: '\u2014',  muscular: '\u00d75',      structural: '\u2014'   },
    { metric: 'Pace Z7 time (hrs)',     aerobic: '\u2014',  muscular: '\u00d78',      structural: '\u2014'   },
    { metric: 'Power Z3 time (hrs)',    aerobic: '\u2014',  muscular: '\u00d71',      structural: '\u2014'   },
    { metric: 'Power Z4 time (hrs)',    aerobic: '\u2014',  muscular: '\u00d72',      structural: '\u2014'   },
    { metric: 'Power Z5 time (hrs)',    aerobic: '\u2014',  muscular: '\u00d73',      structural: '\u2014'   },
    { metric: 'Power Z6 time (hrs)',    aerobic: '\u2014',  muscular: '\u00d75',      structural: '\u2014'   },
    { metric: 'Power Z7 time (hrs)',    aerobic: '\u2014',  muscular: '\u00d78',      structural: '\u2014'   },
    { metric: 'Grade G3 time (hrs)',    aerobic: '\u2014',  muscular: '\u00d71',      structural: '\u00d710' },
    { metric: 'Grade G4 time (hrs)',    aerobic: '\u2014',  muscular: '\u00d72',      structural: '\u00d75'  },
    { metric: 'Running time (hrs)',     aerobic: '\u2014',  muscular: '\u2014',       structural: '\u00d73'  },
    { metric: 'Cycling time (hrs)',     aerobic: '\u2014',  muscular: '\u2014',       structural: '\u00d71'  },
  ];

  document.getElementById('load-matrix-table').innerHTML = `
    <table class="load-matrix">
      <thead><tr><th>Metric</th><th>Aerobic</th><th>Muscular</th><th>Structural</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r.metric}</td>
        <td class="${r.aerobic !== '\u2014' ? 'load-matrix-active' : ''}">${r.aerobic}</td>
        <td class="${r.muscular !== '\u2014' ? 'load-matrix-active' : ''}">${r.muscular}</td>
        <td class="${r.structural !== '\u2014' ? 'load-matrix-active' : ''}">${r.structural}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="load-formula-section">
      <div class="load-formula-item">
        <span class="load-formula-term">CTL</span>
        <span class="load-formula-name">Chronic Training Load &mdash; Fitness</span>
        <span class="load-formula-desc">A 42-day exponential moving average of your weekly load. Represents long-term fitness built over time. Rises slowly with consistent training, falls slowly with rest. The formula only references last week because an EMA is recursive &mdash; CTL<sub>last week</sub> already contains the weighted contribution of every prior week. The 42-day window means a week&rsquo;s load decays to ~37% of its value after 42 days, not that only 6 weeks of history are used. For the current partial week, the decay is scaled to the exact number of days elapsed so the value is accurate on any day of the week, not just at week&rsquo;s end.</span>
        <code class="load-formula-eq">CTL = (1&minus;e<sup>&minus;days/42</sup>) &times; load<sub>this period</sub> + e<sup>&minus;days/42</sup> &times; CTL<sub>last week</sub></code>
      </div>
      <div class="load-formula-item">
        <span class="load-formula-term">ATL</span>
        <span class="load-formula-name">Acute Training Load &mdash; Fatigue</span>
        <span class="load-formula-desc">A 7-day exponential moving average of your weekly load. Reflects short-term fatigue. Rises quickly after a hard week and drops quickly with rest.</span>
        <code class="load-formula-eq">ATL = 0.632 &times; load<sub>this week</sub> + 0.368 &times; ATL<sub>last week</sub></code>
      </div>
      <div class="load-formula-item">
        <span class="load-formula-term">TSB</span>
        <span class="load-formula-name">Training Stress Balance &mdash; Form</span>
        <span class="load-formula-desc">The difference between last week&rsquo;s fitness and fatigue. Positive means you are rested and ready to perform. Negative means you are carrying fatigue from recent training.</span>
        <code class="load-formula-eq">TSB = CTL<sub>last week</sub> &minus; ATL<sub>last week</sub></code>
      </div>
      <div class="load-formula-item">
        <span class="load-formula-term">ACWR</span>
        <span class="load-formula-name">Acute:Chronic Workload Ratio &mdash; Injury Risk</span>
        <span class="load-formula-desc">The ratio of short-term fatigue to long-term fitness. Developed by Tim Gabbett, it is the most clinically validated injury risk signal in load monitoring. A value near 1.0 means your recent training matches your fitness base. Spikes above 1.5 &mdash; common after returning from a rest period or suddenly ramping volume &mdash; are strongly associated with soft tissue injury.</span>
        <code class="load-formula-eq">ACWR = ATL &divide; CTL</code>
        <div class="acwr-thresholds">
          <span class="acwr-threshold acwr-threshold-low">< 0.8 &mdash; Undertraining</span>
          <span class="acwr-threshold acwr-threshold-ok">0.8 &ndash; 1.3 &mdash; Sweet spot</span>
          <span class="acwr-threshold acwr-threshold-caution">1.3 &ndash; 1.5 &mdash; Caution</span>
          <span class="acwr-threshold acwr-threshold-danger">> 1.5 &mdash; Injury Risk</span>
        </div>
      </div>
    </div>`;
}

// ============================================================
// ACTIVITY LOG TAB
// ============================================================

async function loadPlanTab() {
  try {
    const data = await apiFetch('/activities/manual');
    renderManualActivityRegistry(data.activities || []);
  } catch (err) {
    if (err.message !== 'unauthorized') showToast('Failed to load activity log', 'error');
  }
}

function renderManualActivityRegistry(activities) {
  const registry = document.getElementById('manual-activity-registry');
  const empty = document.getElementById('registry-empty');

  // Remove existing rows (but keep empty message)
  registry.querySelectorAll('.registry-row').forEach(el => el.remove());

  if (activities.length === 0) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  for (const act of activities) {
    const row = document.createElement('div');
    row.className = 'registry-row';

    // Format meta
    const distMi = act.distance ? (act.distance / 1609.344).toFixed(1) + ' mi' : '';
    const elevFt = act.elevation ? Math.round(act.elevation * 3.28084) + ' ft' : '';
    const dur = act.elapsedTime ? formatDuration(act.elapsedTime) : '';
    const dateFmt = act.startDate ? formatFullDate(act.startDate) : '';
    const metaParts = [act.activityType, dateFmt, dur, distMi, elevFt].filter(Boolean);

    row.innerHTML = `
      <div class="registry-info">
        <span class="registry-name">${escapeHtml(act.name || act.activityType)}</span>
        <span class="registry-meta">${metaParts.join(' · ')}</span>
      </div>
      <div class="registry-actions">
        <button class="btn btn-small btn-edit" data-edit-id="${act.activityId}">Edit</button>
        <button class="btn btn-small btn-danger" data-activity-id="${act.activityId}">Delete</button>
      </div>
    `;
    registry.appendChild(row);
  }

  registry.querySelectorAll('[data-activity-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteManualActivity(btn.dataset.activityId));
  });

  const actMap = Object.fromEntries(activities.map(a => [a.activityId, a]));
  registry.querySelectorAll('[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => openEditActivityModal(actMap[btn.dataset.editId]));
  });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s > 0 ? s + 's' : ''}`.trim();
  return `${s}s`;
}

async function deleteManualActivity(activityId) {
  if (!confirm('Delete this activity from Strava and StayStacking?')) return;
  try {
    const result = await apiFetch(`/activities/manual/${activityId}`, { method: 'DELETE' });
    showToast('Activity deleted', 'success');
    if (result.weeks) {
      state.activities = result.weeks;
      if (state.activeTab === 'load') renderLoadChart();
    }
    await loadPlanTab();
  } catch (err) {
    if (err.message === 'reauth_required') {
      showToast('Write access required — sign out and reconnect Strava', 'error');
    } else if (err.message !== 'unauthorized') {
      showToast('Failed to delete activity: ' + err.message, 'error');
    }
  }
}

// ============================================================
// ADD ACTIVITY MODAL
// ============================================================

function openAddActivityModal() {
  state.editingActivity = null;
  document.getElementById('add-activity-modal-title').textContent = 'Log Activity';
  document.getElementById('btn-submit-activity').textContent = 'Save to Strava';
  document.getElementById('act-datetime-group').classList.remove('hidden');
  const today = getTodayStr();
  document.getElementById('act-date').value = today;
  document.getElementById('act-time').value = '08:00';
  document.getElementById('act-name').value = '';
  document.getElementById('act-type').value = 'Run';
  document.getElementById('act-dur-h').value = '';
  document.getElementById('act-dur-m').value = '';
  document.getElementById('act-dur-s').value = '';
  document.getElementById('act-distance').value = '';
  document.getElementById('act-elevation').value = '';
  document.getElementById('act-avg-hr').value = '';
  document.getElementById('act-avg-pace').value = '';
  document.getElementById('act-avg-power').value = '';
  document.getElementById('act-description').value = '';
  document.getElementById('act-mute').checked = false;
  document.getElementById('add-activity-reauth-msg').classList.add('hidden');
  document.getElementById('add-activity-form-wrap').classList.remove('hidden');
  document.querySelector('.add-activity-modal-card').scrollTop = 0;
  updateActivityTypeFields('Run');
  document.getElementById('add-activity-modal').classList.remove('hidden');
}

function openEditActivityModal(act) {
  state.editingActivity = act;
  document.getElementById('add-activity-modal-title').textContent = 'Edit Activity';
  document.getElementById('btn-submit-activity').textContent = 'Update on Strava';
  document.getElementById('act-datetime-group').classList.add('hidden');
  document.getElementById('act-name').value = act.name || '';
  document.getElementById('act-type').value = act.activityType || 'Run';
  const h = Math.floor((act.elapsedTime || 0) / 3600);
  const m = Math.floor(((act.elapsedTime || 0) % 3600) / 60);
  const s = (act.elapsedTime || 0) % 60;
  document.getElementById('act-dur-h').value = h || '';
  document.getElementById('act-dur-m').value = m || '';
  document.getElementById('act-dur-s').value = s || '';
  const distMi = act.distance ? (act.distance / 1609.344).toFixed(2) : '';
  document.getElementById('act-distance').value = distMi;
  state.actDistanceUnit = 'mi';
  document.querySelectorAll('#act-distance-unit-toggle .unit-toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.unit === 'mi');
  });
  const elevFt = act.elevation ? Math.round(act.elevation * 3.28084) : '';
  document.getElementById('act-elevation').value = elevFt;
  state.actElevationUnit = 'ft';
  document.querySelectorAll('#act-elevation-unit-toggle .unit-toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.unit === 'ft');
  });
  document.getElementById('act-avg-hr').value = '';
  document.getElementById('act-avg-pace').value = '';
  document.getElementById('act-avg-power').value = '';
  document.getElementById('act-description').value = act.description || '';
  document.getElementById('act-mute').checked = act.hideFromHome || false;
  document.getElementById('add-activity-reauth-msg').classList.add('hidden');
  document.getElementById('add-activity-form-wrap').classList.remove('hidden');
  document.querySelector('.add-activity-modal-card').scrollTop = 0;
  updateActivityTypeFields(act.activityType || 'Run');
  document.getElementById('add-activity-modal').classList.remove('hidden');
}

function closeAddActivityModal() {
  document.getElementById('add-activity-modal').classList.add('hidden');
  state.editingActivity = null;
}

function updateActivityTypeFields(type) {
  const paceGroup = document.getElementById('act-avg-pace-group');
  const powerGroup = document.getElementById('act-avg-power-group');
  const showPace = ['Run', 'Hike', 'Walk'].includes(type);
  const showPower = type === 'Ride';
  paceGroup.style.display = showPace ? '' : 'none';
  powerGroup.style.display = showPower ? '' : 'none';
}

async function submitAddActivity() {
  if (state.editingActivity) { await submitEditActivity(); return; }
  const name = document.getElementById('act-name').value.trim();
  const sport_type = document.getElementById('act-type').value;
  const date = document.getElementById('act-date').value;
  const time = document.getElementById('act-time').value || '08:00';
  const hours = parseInt(document.getElementById('act-dur-h').value || '0', 10);
  const minutes = parseInt(document.getElementById('act-dur-m').value || '0', 10);
  const seconds = parseInt(document.getElementById('act-dur-s').value || '0', 10);

  if (!name) { showToast('Activity name is required', 'error'); return; }
  if (!date) { showToast('Date is required', 'error'); return; }
  if (hours === 0 && minutes === 0 && seconds === 0) { showToast('Duration is required', 'error'); return; }

  const start_date_local = `${date}T${time}:00`;

  const body = {
    name,
    sport_type,
    start_date_local,
    hours,
    minutes,
    seconds,
    distanceValue: document.getElementById('act-distance').value || '',
    distanceUnit: state.actDistanceUnit,
    elevationValue: document.getElementById('act-elevation').value || '',
    elevationUnit: state.actElevationUnit,
    avgHr: parseInt(document.getElementById('act-avg-hr').value || '0', 10) || null,
    avgPace: document.getElementById('act-avg-pace').value.trim() || null,
    avgPower: parseInt(document.getElementById('act-avg-power').value || '0', 10) || null,
    description: document.getElementById('act-description').value.trim() || null,
    hideFromHome: document.getElementById('act-mute').checked,
  };

  const btn = document.getElementById('btn-submit-activity');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const result = await apiFetch('/activities/manual', { method: 'POST', body: JSON.stringify(body) });
    closeAddActivityModal();
    showToast('Activity saved to Strava!', 'success');
    if (result.weeks) {
      state.activities = result.weeks;
      if (state.activeTab === 'load') renderLoadChart();
    }
    await loadPlanTab();
  } catch (err) {
    if (err.message === 'reauth_required') {
      document.getElementById('add-activity-form-wrap').classList.add('hidden');
      document.getElementById('add-activity-reauth-msg').classList.remove('hidden');
      document.querySelector('.add-activity-modal-card').scrollTop = 0;
      showToast('Strava write access required — sign out and reconnect', 'error');
    } else if (err.message !== 'unauthorized') {
      showToast('Failed to save: ' + err.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save to Strava';
  }
}

async function submitEditActivity() {
  const act = state.editingActivity;
  const name = document.getElementById('act-name').value.trim();
  const sport_type = document.getElementById('act-type').value;
  const hours = parseInt(document.getElementById('act-dur-h').value || '0', 10);
  const minutes = parseInt(document.getElementById('act-dur-m').value || '0', 10);
  const seconds = parseInt(document.getElementById('act-dur-s').value || '0', 10);

  if (!name) { showToast('Activity name is required', 'error'); return; }
  if (hours === 0 && minutes === 0 && seconds === 0) { showToast('Duration is required', 'error'); return; }

  const body = {
    name,
    sport_type,
    hours,
    minutes,
    seconds,
    distanceValue: document.getElementById('act-distance').value || '',
    distanceUnit: state.actDistanceUnit,
    elevationValue: document.getElementById('act-elevation').value || '',
    elevationUnit: state.actElevationUnit,
    avgHr: parseInt(document.getElementById('act-avg-hr').value || '0', 10) || null,
    avgPace: document.getElementById('act-avg-pace').value.trim() || null,
    avgPower: parseInt(document.getElementById('act-avg-power').value || '0', 10) || null,
    description: document.getElementById('act-description').value.trim() || null,
    hideFromHome: document.getElementById('act-mute').checked,
  };

  const btn = document.getElementById('btn-submit-activity');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const result = await apiFetch(`/activities/manual/${act.activityId}`, { method: 'PUT', body: JSON.stringify(body) });
    closeAddActivityModal();
    showToast('Activity updated on Strava!', 'success');
    if (result.weeks) {
      state.activities = result.weeks;
      if (state.activeTab === 'load') renderLoadChart();
    }
    await loadPlanTab();
  } catch (err) {
    if (err.message === 'reauth_required') {
      document.getElementById('add-activity-form-wrap').classList.add('hidden');
      document.getElementById('add-activity-reauth-msg').classList.remove('hidden');
      document.querySelector('.add-activity-modal-card').scrollTop = 0;
      showToast('Strava write access required — sign out and reconnect', 'error');
    } else if (err.message !== 'unauthorized') {
      showToast('Failed to update: ' + err.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update on Strava';
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
// TOAST
// ============================================================

let toastTimer = null;
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  const duration = type === 'error' ? 5000 : 2800;
  toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
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

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

  // Per-Run Analysis — run selector
  document.getElementById('run-select').addEventListener('change', e => {
    loadRunDetail(e.target.value);
  });

  // Per-Run Analysis — HR chart x-axis toggle (Time / Miles)
  document.querySelectorAll('#run-xaxis-toggle .run-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled || state.runXAxis === btn.dataset.xaxis) return;
      state.runXAxis = btn.dataset.xaxis;
      syncRunToggle('run-xaxis-toggle', 'xaxis', state.runXAxis);
      renderRunHrChart();
    });
  });

  // Per-Run Analysis — splits toggle (Mile / Lap)
  document.querySelectorAll('#run-splits-toggle .run-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.runSplitsMode === btn.dataset.splits) return;
      state.runSplitsMode = btn.dataset.splits;
      syncRunToggle('run-splits-toggle', 'splits', state.runSplitsMode);
      renderRunSplits(state.runSplitsMode);
    });
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
  document.getElementById('btn-sign-out').addEventListener('click', clearAuth);

  // Add Activity modal
  document.getElementById('btn-add-activity').addEventListener('click', openAddActivityModal);
  document.getElementById('add-activity-modal-close').addEventListener('click', closeAddActivityModal);
  document.getElementById('btn-cancel-activity').addEventListener('click', closeAddActivityModal);
  document.getElementById('btn-submit-activity').addEventListener('click', submitAddActivity);
  document.getElementById('add-activity-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('add-activity-modal')) closeAddActivityModal();
  });

  // Activity type → show/hide pace/power fields
  document.getElementById('act-type').addEventListener('change', e => {
    updateActivityTypeFields(e.target.value);
  });

  // Distance unit toggle
  document.getElementById('act-distance-unit-toggle').querySelectorAll('.unit-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.actDistanceUnit = btn.dataset.unit;
      document.getElementById('act-distance-unit-toggle').querySelectorAll('.unit-toggle-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Elevation unit toggle
  document.getElementById('act-elevation-unit-toggle').querySelectorAll('.unit-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.actElevationUnit = btn.dataset.unit;
      document.getElementById('act-elevation-unit-toggle').querySelectorAll('.unit-toggle-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Re-auth sign-out button inside modal
  document.getElementById('btn-reauth-signout').addEventListener('click', () => {
    closeAddActivityModal();
    clearAuth();
  });

  // Init
  initAuth();
});

// ============================================================
// COSTS PAGE
// ============================================================

const COSTS_PASSCODE = 'stayhumblestackvert';
const COSTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CURRENT_ENV = window.location.hostname.includes('staging') ? 'staging' : 'prod';

function costsCacheKey(env) { return `costs_cache_v3_${env}`; }

const SERVICE_COLORS = {
  'AWS Lambda':                                '#FF9900',
  'Amazon DynamoDB':                           '#3F48CC',
  'Amazon API Gateway':                        '#E7157B',
  'Amazon CloudFront':                         '#8C4FFF',
  'Amazon Simple Storage Service (S3)':        '#3F8624',
  'AWS Secrets Manager':                       '#DD344C',
  'Amazon CloudWatch':                         '#E05243',
  'Amazon Route 53':                           '#00A1C9',
  'AWS Key Management Service':                '#7AA116',
};
const COLOR_OTHER = '#888888';

function shortSvc(name) {
  return name.replace('Amazon Simple Storage Service (S3)', 'S3')
             .replace('Amazon ', '').replace('AWS ', '');
}

function initCostsPage() {
  const unlocked = sessionStorage.getItem('costs_unlocked') === '1';
  if (unlocked) {
    showCostsContent();
  } else {
    showCostsLock();
  }
}

function showCostsLock() {
  document.getElementById('costs-lock').classList.remove('hidden');
  document.getElementById('costs-content').classList.add('hidden');

  const input = document.getElementById('costs-passcode-input');
  const btn = document.getElementById('costs-passcode-submit');
  const err = document.getElementById('costs-passcode-error');

  function attempt() {
    if (input.value === COSTS_PASSCODE) {
      sessionStorage.setItem('costs_unlocked', '1');
      showCostsContent();
    } else {
      err.classList.remove('hidden');
      input.value = '';
      input.focus();
    }
  }

  btn.addEventListener('click', attempt);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  input.focus();
}

function showCostsContent() {
  document.getElementById('costs-lock').classList.add('hidden');
  document.getElementById('costs-content').classList.remove('hidden');

  // Initialize env state and wire toggle buttons
  if (!state.costsEnv) state.costsEnv = CURRENT_ENV;
  document.querySelectorAll('.costs-env-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.env === state.costsEnv);
    btn.addEventListener('click', () => {
      if (btn.dataset.env === state.costsEnv) return;
      state.costsEnv = btn.dataset.env;
      document.querySelectorAll('.costs-env-btn').forEach(b => b.classList.toggle('active', b.dataset.env === state.costsEnv));
      loadCostsTab();
    });
  });

  loadCostsTab();
}

async function loadCostsTab() {
  const env = state.costsEnv || CURRENT_ENV;
  const cacheKey = costsCacheKey(env);
  document.getElementById('costs-summary').innerHTML = '<p class="muted" style="padding:16px">Loading cost data…</p>';
  try {
    // Check localStorage cache (24h TTL)
    let data;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < COSTS_CACHE_TTL_MS) {
        data = parsed.data;
      }
    }
    if (!data) {
      data = await apiFetch(`/costs?env=${env}`);
      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    }
    state.costs = data.months || [];
    state.costsUsers = data.users || [];
    const cacheEntry = JSON.parse(localStorage.getItem(cacheKey));
    state.costsLastUpdated = cacheEntry ? new Date(cacheEntry.ts) : new Date();
    renderCostsChart();
    renderCostsSummary();
    renderCostsUsers();
  } catch (err) {
    if (err.message !== 'unauthorized') {
      document.getElementById('costs-summary').innerHTML = '<p class="muted" style="padding:16px;color:var(--coral)">Failed to load cost data.</p>';
    }
  }
}

function renderCostsChart() {
  const ctx = document.getElementById('costs-chart').getContext('2d');
  if (state.costsChart) { state.costsChart.destroy(); state.costsChart = null; }

  const buckets = state.costs; // monthly buckets from API
  if (!buckets.length) return;

  const allSvcs = new Set(buckets.flatMap(b => Object.keys(b.byService)));
  const activeSvcs = [...allSvcs].filter(svc => {
    return buckets.reduce((s, b) => s + (b.byService[svc] || 0), 0) >= 0.001;
  });
  const namedSvcs = activeSvcs.filter(s => SERVICE_COLORS[s]);
  const otherSvcs  = activeSvcs.filter(s => !SERVICE_COLORS[s]);

  const labels = buckets.map(b => {
    const [y, m] = b.month.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });

  const datasets = namedSvcs.map(svc => ({
    label: shortSvc(svc),
    data: buckets.map(b => parseFloat((b.byService[svc] || 0).toFixed(2))),
    backgroundColor: SERVICE_COLORS[svc],
    borderWidth: 0, borderRadius: 2, stack: 'costs',
  }));

  if (otherSvcs.length) {
    datasets.push({
      label: 'Other',
      data: buckets.map(b => parseFloat(otherSvcs.reduce((s, svc) => s + (b.byService[svc] || 0), 0).toFixed(2))),
      backgroundColor: COLOR_OTHER,
      borderWidth: 0, borderRadius: 2, stack: 'costs',
    });
  }

  state.costsChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: c => ` ${c.dataset.label}: $${c.parsed.y.toFixed(2)}`,
            footer: items => ` Total: $${items.reduce((s, i) => s + i.parsed.y, 0).toFixed(2)}`,
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0 } },
        y: { stacked: true, ticks: { callback: v => `$${v.toFixed(2)}` }, grid: { color: 'rgba(0,0,0,0.06)' } },
      },
    },
  });
}

function renderCostsSummary() {
  const buckets = state.costs;
  if (!buckets.length) {
    document.getElementById('costs-summary').innerHTML = '<p class="muted" style="padding:16px">No cost data available.</p>';
    return;
  }

  const totalAll = buckets.reduce((s, b) => s + b.total, 0);
  const avg = totalAll / buckets.length;

  const rows = buckets.slice().reverse().map(b => {
    const [y, m] = b.month.split('-');
    const label = new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const top = Object.entries(b.byService)
      .filter(([, v]) => v >= 0.001).sort(([, a], [, b]) => b - a).slice(0, 2)
      .map(([svc, v]) => `${shortSvc(svc)}: $${v.toFixed(2)}`).join(', ');
    return `<tr><td>${label}</td><td class="costs-total">$${b.total.toFixed(2)}</td><td class="costs-breakdown">${top || '—'}</td></tr>`;
  }).join('');

  document.getElementById('costs-summary').innerHTML = `
    <div class="costs-summary-header">
      <span>12-month total: <strong>$${totalAll.toFixed(2)}</strong></span>
      <span>Monthly avg: <strong>$${avg.toFixed(2)}</strong></span>
      ${state.costsLastUpdated ? `<span class="costs-last-updated">Last updated: ${state.costsLastUpdated.toLocaleString()}</span>` : ''}
    </div>
    <table class="costs-table">
      <thead><tr><th>Month</th><th>Total</th><th>Top Services</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderCostsUsers() {
  const users = state.costsUsers || [];
  const rows = users.map(u => {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
    const synced = u.lastSynced
      ? new Date(u.lastSynced).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '—';
    return `<tr><td>${name}</td><td class="costs-breakdown">${u.stravaId || u.userId}</td><td class="costs-breakdown">${synced}</td></tr>`;
  }).join('');

  document.getElementById('costs-users').innerHTML = `
    <div class="costs-summary-header" style="margin-top:24px">
      <span>Users: <strong>${users.length}</strong></span>
    </div>
    <table class="costs-table">
      <thead><tr><th>Name</th><th>Strava ID</th><th>Last Synced</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="muted">No users found.</td></tr>'}</tbody>
    </table>`;
}
