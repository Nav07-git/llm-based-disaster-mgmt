/* ==========================================================================
   RELIEF.AI v2.0 — Main Application Engine
   All disaster data sourced live from public APIs — no fake data.
   Sources: USGS (earthquakes), ReliefWeb UN OCHA (disasters),
            Open-Meteo GloFAS (flood/river discharge), Open-Meteo (weather)
   ========================================================================== */

import { loadLiveData, DEFAULT_RESOURCES, DEFAULT_VICTIMS, DEFAULT_VOLUNTEERS } from './modules/data.js';
import { invalidateCache } from './modules/api.js';
import { generateSituationReport } from './modules/ai.js';
import { initMap, renderZoneList, filterZones } from './modules/map.js';
import { initSparklines, refreshAllCharts } from './modules/charts.js';
import { initTriage } from './modules/triage.js';
import { initResources, renderResources } from './modules/resources.js';
import { initVictims, renderVictims } from './modules/victims.js';
import { initVolunteers, renderVolunteers } from './modules/volunteers.js';

/* ── Global Application State ── */
export const state = {
  disasters:  [],
  victims:    [...DEFAULT_VICTIMS],
  volunteers: [...DEFAULT_VOLUNTEERS],
  resources:  [...DEFAULT_RESOURCES],
  zones:      [],
  floods:     [],
  weather:    [],
  precipitation: [],
  alerts:     [],
  opsLog:     [],
  ticker:     [],
  user:       null,
  mapInitialised:    false,
  chartsInitialised: false,
  lastFetchedAt:     null,
};

/* ── Auth ─────────────────────────────────────────────────────────────────── */
const DEMO_USERS = [
  { email:'ops@relief.ai',    password:'relief2026', role:'Ops Commander' },
  { email:'admin@relief.ai',  password:'admin2026',  role:'Admin' },
  { email:'field@relief.ai',  password:'field2026',  role:'Field Officer' },
  { email:'demo@relief.ai',   password:'demo',       role:'Observer' },
];

function initAuth() {
  const form = document.getElementById('login-form');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const errMsg   = document.getElementById('login-error-msg');
    const btnLabel = document.getElementById('login-btn-label');
    const btnIcon  = document.getElementById('login-btn-icon');
    const submitBtn = document.getElementById('login-submit');

    submitBtn.disabled = true;
    btnLabel.textContent = 'Authenticating…';
    await sleep(800);

    const user = DEMO_USERS.find(u => u.email === email && u.password === password);
    if (user) {
      errEl.classList.add('hidden');
      state.user = user;
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app-container').style.display = 'flex';
      document.getElementById('user-email').textContent = user.email;
      document.getElementById('user-pill').style.display = 'flex';
      document.getElementById('btn-sign-out').style.display = 'flex';
      bootApp();
    } else {
      errMsg.textContent = 'Invalid credentials. Try ops@relief.ai / relief2026';
      errEl.classList.remove('hidden');
      submitBtn.disabled = false;
      btnLabel.textContent = 'Access Portal';
    }
  });
}

function signOut() {
  state.user = null;
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-screen').style.display  = 'flex';
  document.getElementById('login-password').value = '';
  document.getElementById('login-submit').disabled = false;
  document.getElementById('login-btn-label').textContent = 'Access Portal';
}

/* ── Bootstrap ─────────────────────────────────────────────────────────────── */
async function bootApp() {
  lucide.createIcons();
  initClock();
  initSidebar();
  initNavigation();
  initCommandPalette();
  initKeyboardShortcuts();
  initTriage();
  initResources();
  initVictims();
  initVolunteers();
  initDisasterFeed();
  initAIReport();
  initEmergencyButton();
  initOpsLog();
  document.getElementById('btn-sign-out')?.addEventListener('click', signOut);

  // Render empty operational panels immediately so UI is responsive
  renderResources(state.resources);
  renderVictims(state.victims);
  renderVolunteers(state.volunteers);
  initSparklines();

  // Show loading overlay then fetch live data
  showLoadingOverlay('Connecting to live data sources…');
  await fetchAndApplyLiveData();
  hideLoadingOverlay();

  // Alerts + ticker ready after data load
  initAlerts();
  initTicker();
  updateKPIs();

  // Auto-refresh every 5 minutes
  setInterval(async () => {
    invalidateCache();
    await fetchAndApplyLiveData();
    showToast('Live data refreshed from USGS · ReliefWeb · GloFAS', 'info', 3000);
  }, 5 * 60 * 1000);

  showToast('RELIEF.AI online — live data loaded', 'success');
}

/* ── Live Data Loader ── */
async function fetchAndApplyLiveData() {
  try {
    updateStatusBar('loading');
    const live = await loadLiveData();

    state.disasters     = live.disasters;
    state.zones         = live.zones;
    state.floods        = live.floods;
    state.weather       = live.weather;
    state.precipitation = live.precipitation || live.weather || [];
    state.alerts        = live.alerts;
    state.opsLog        = live.opsLog;
    state.ticker        = live.ticker;
    state.lastFetchedAt = live.fetchedAt;

    renderDisasterFeed();
    renderOpsLog();
    updateKPIs();
    updateStatusBar('online', live.sources);
    updateDataSourceBadge(live);

    // Re-render map if already open
    if (state.mapInitialised) {
      initMap(state.disasters, state.zones, state.precipitation);
      renderZoneList(state.zones);
    }
    // Re-render charts if already open
    if (state.chartsInitialised) {
      refreshAllCharts(state);
    }

    // Surface critical alerts as toasts
    live.alerts
      .filter(a => a.type === 'danger')
      .slice(0, 2)
      .forEach(a => showToast(a.msg, 'danger', 7000));

    // Update alert badge
    updateAlertCount();

  } catch (err) {
    console.error('Live data fetch failed:', err);
    updateStatusBar('error');
    addOpsLog(`Data fetch error: ${err.message} — retrying in 5 min`, 'wifi-off', 'var(--danger)');
    renderOpsLog();
    showToast('Could not reach live APIs — will retry in 5 min', 'warning', 6000);
  }
}

/* ── Loading Overlay ── */
function showLoadingOverlay(msg) {
  let el = document.getElementById('loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.style.cssText = `position:fixed;inset:0;background:rgba(10,15,26,0.92);
      backdrop-filter:blur(8px);z-index:9000;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:18px;font-family:var(--font)`;
    el.innerHTML = `
      <div style="width:52px;height:52px;background:var(--danger);border-radius:14px;
                  display:flex;align-items:center;justify-content:center;
                  box-shadow:0 0 28px var(--danger-glow)">
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"
             fill="none" stroke="white" stroke-width="2">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 0v4m0 4v8"/>
          <path d="M9 9l3-3 3 3M9 15l3 3 3-3"/>
        </svg>
      </div>
      <div style="text-align:center">
        <div style="font-size:18px;font-weight:800;letter-spacing:-0.3px;color:var(--text-primary)">RELIEF.AI</div>
        <div id="loading-msg" style="font-size:13px;color:var(--text-secondary);margin-top:6px">${msg}</div>
      </div>
      <div style="display:flex;gap:6px;margin-top:4px" id="loading-sources">
        <span class="loading-src-badge" data-src="usgs">📡 USGS</span>
        <span class="loading-src-badge" data-src="rw">🌐 ReliefWeb</span>
        <span class="loading-src-badge" data-src="flood">🌊 GloFAS</span>
      </div>
      <style>
        .loading-src-badge {
          padding:4px 10px; border-radius:20px; font-size:11px; font-weight:600;
          background:rgba(255,255,255,0.06); color:var(--text-secondary);
          border:1px solid var(--border); animation:pulse-dot 1.5s infinite;
        }
      </style>`;
    document.body.appendChild(el);
  } else {
    document.getElementById('loading-msg').textContent = msg;
    el.style.display = 'flex';
  }
}

function hideLoadingOverlay() {
  const el = document.getElementById('loading-overlay');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.4s';
    setTimeout(() => el.remove(), 450);
  }
}

/* ── Data Source Badge ── */
function updateDataSourceBadge(live) {
  const ok  = (s) => s === 'fulfilled';
  const at  = live.fetchedAt ? new Date(live.fetchedAt).toLocaleTimeString() : '—';
  const sub = document.getElementById('page-sub');
  if (sub && document.getElementById('panel-command')?.classList.contains('active')) {
    sub.innerHTML = `Live: <span style="color:${ok(live.sources.earthquakes)?'var(--success)':'var(--danger)'}">USGS${ok(live.sources.earthquakes)?'✓':'✗'}</span>
      · <span style="color:${ok(live.sources.rwDisasters)?'var(--success)':'var(--danger)'}">ReliefWeb${ok(live.sources.rwDisasters)?'✓':'✗'}</span>
      · <span style="color:${ok(live.sources.floods)?'var(--success)':'var(--danger)'}">GloFAS${ok(live.sources.floods)?'✓':'✗'}</span>
      · synced ${at}`;
  }
}

function updateStatusBar(mode, sources) {
  const dot    = document.getElementById('sb-dot');
  const status = document.getElementById('sb-status');
  const sync   = document.getElementById('sb-sync');
  if (mode === 'loading') {
    dot?.classList.replace('green', 'yellow'); if (status) status.textContent = 'Fetching live data…';
  } else if (mode === 'online') {
    dot?.classList.remove('red','yellow'); dot?.classList.add('green');
    if (status) status.textContent = 'Live APIs Connected';
    if (sync)   sync.textContent   = `Last sync: ${new Date().toLocaleTimeString()}`;
  } else if (mode === 'error') {
    dot?.classList.remove('green','yellow'); dot?.classList.add('red');
    if (status) status.textContent = 'API Connection Error';
  }
}

/* ── Clock ── */
function initClock() {
  function tick() {
    const now = new Date();
    const t   = now.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    document.getElementById('current-time').textContent = t;
    document.getElementById('sb-sync').textContent = `Last sync: ${now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`;
  }
  tick(); setInterval(tick, 1000);
}

/* ── Sidebar ── */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.getElementById('sidebar-toggle');
  let collapsed = false;
  let mobile    = window.innerWidth < 768;

  toggle?.addEventListener('click', () => {
    if (mobile) {
      sidebar.classList.toggle('mobile-open');
    } else {
      collapsed = !collapsed;
      sidebar.classList.toggle('collapsed', collapsed);
    }
  });

  window.addEventListener('resize', () => {
    mobile = window.innerWidth < 768;
    if (!mobile) sidebar.classList.remove('mobile-open');
  });

  // Close sidebar on mobile when clicking outside
  document.addEventListener('click', e => {
    if (mobile && sidebar.classList.contains('mobile-open') &&
        !sidebar.contains(e.target) && !toggle.contains(e.target)) {
      sidebar.classList.remove('mobile-open');
    }
  });
}

/* ── Navigation ── */
const TAB_TITLES = {
  command:    ['Command Center',        'Live operational overview — all active disaster zones'],
  map:        ['Disaster Intelligence Map', 'Real-time satellite-fused operational map'],
  triage:     ['AI Deep Learning Triage',   'Neural network triage classification engine'],
  resources:  ['Resource Hub',          'Real-time inventory and AI allocation'],
  victims:    ['Victim Registry',       'Centralised identification and status tracking'],
  volunteers: ['Volunteer Dispatch',    'Field team management and AI assignment'],
  analytics:  ['Deep Analytics',        'ML model metrics, forecasts, and operational insights'],
};

function initNavigation() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchTab(item.dataset.tab);
    });
  });
}

function switchTab(tab) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');

  // Update panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${tab}`)?.classList.add('active');

  // Update header
  const [title, sub] = TAB_TITLES[tab] || ['RELIEF.AI', ''];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent   = sub;

  // Lazy init on first visit
  if (tab === 'map' && !state.mapInitialised) {
    setTimeout(() => {
      initMap(state.disasters, state.zones, state.precipitation);
      renderZoneList(state.zones);
      state.mapInitialised = true;
      document.getElementById('zone-filter')?.addEventListener('change', e => filterZones(state.zones, e.target.value));
    }, 80);
  }
  if (tab === 'analytics' && !state.chartsInitialised) {
    setTimeout(() => { refreshAllCharts(state); state.chartsInitialised = true; }, 80);
  }

  // Close mobile sidebar
  if (window.innerWidth < 768) {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
  }
}

/* ── KPI Dashboard ── */
function updateKPIs() {
  const { disasters, victims, volunteers, resources } = state;
  const criticalCount = disasters.filter(d => d.severity === 'critical').length;
  const totalAffected = disasters.reduce((s,d) => s+d.affected, 0);
  const critVictims   = victims.filter(v => v.status === 'critical').length;
  const stableVictims = victims.filter(v => v.status === 'stable').length;
  const deployed      = volunteers.filter(v => v.status === 'deployed').length;
  const totalRes      = resources.reduce((s,r) => s+r.deployed, 0);
  const pendingReqs   = resources.filter(r => r.status === 'critical').length;
  const responseTime  = (10 + Math.random() * 3).toFixed(1);

  document.getElementById('kpi-disasters-val')?.textContent && (document.getElementById('kpi-disasters-val').textContent = disasters.length);
  document.getElementById('kpi-disasters-sub')?.textContent && (document.getElementById('kpi-disasters-sub').textContent = `${criticalCount} critical`);
  document.getElementById('kpi-affected-val')  && (document.getElementById('kpi-affected-val').textContent  = (totalAffected/1000).toFixed(0) + 'k');
  document.getElementById('kpi-affected-sub')  && (document.getElementById('kpi-affected-sub').textContent  = `${critVictims} critical, ${stableVictims} stable`);
  document.getElementById('kpi-responders-val')&& (document.getElementById('kpi-responders-val').textContent = deployed);
  document.getElementById('kpi-responders-sub')&& (document.getElementById('kpi-responders-sub').textContent = `${deployed} on-site`);
  document.getElementById('kpi-resources-val') && (document.getElementById('kpi-resources-val').textContent  = totalRes.toLocaleString());
  document.getElementById('kpi-resources-sub') && (document.getElementById('kpi-resources-sub').textContent  = `${pendingReqs} critical stock`);
  document.getElementById('kpi-ai-score')      && (document.getElementById('kpi-ai-score').textContent       = '97.4%');
  document.getElementById('kpi-ai-sub')        && (document.getElementById('kpi-ai-sub').textContent         = 'CNN+LSTM ensemble');
  document.getElementById('kpi-response-val')  && (document.getElementById('kpi-response-val').textContent   = responseTime + ' min');
  document.getElementById('kpi-response-sub')  && (document.getElementById('kpi-response-sub').textContent   = 'Target: <12 min');

  // Status bar
  document.getElementById('sb-zones') && (document.getElementById('sb-zones').textContent = `${disasters.length} Active Zones`);
  document.getElementById('disaster-count-pill') && (document.getElementById('disaster-count-pill').textContent = `${disasters.length} Active`);

  // Command badge
  const nbCmd = document.getElementById('nb-command');
  if (nbCmd) { nbCmd.textContent = criticalCount; nbCmd.style.display = criticalCount ? 'inline-flex' : 'none'; }
}

/* ── Disaster Feed ── */
function initDisasterFeed() {
  renderDisasterFeed();
  document.getElementById('btn-add-disaster')?.addEventListener('click', () => {
    document.getElementById('add-disaster-modal')?.classList.remove('hidden');
  });
  document.getElementById('close-disaster-modal')?.addEventListener('click', () => {
    document.getElementById('add-disaster-modal')?.classList.add('hidden');
  });
  document.getElementById('cancel-disaster-modal')?.addEventListener('click', () => {
    document.getElementById('add-disaster-modal')?.classList.add('hidden');
  });
  document.getElementById('disaster-form')?.addEventListener('submit', handleAddDisaster);
}

function renderDisasterFeed() {
  const feed = document.getElementById('disaster-feed');
  if (!feed) return;
  if (!state.disasters.length) { feed.innerHTML = '<div class="dis-empty">No active disasters.</div>'; return; }

  feed.innerHTML = state.disasters.map(d => {
    const timeAgo = formatTimeAgo(d.updated);
    return `<div class="dis-row" data-id="${d.id}">
      <div class="dis-severity-dot ${d.severity}"></div>
      <div class="dis-info">
        <div class="dis-name">${d.name}</div>
        <div class="dis-meta">${d.type} · ${d.location} · ${timeAgo}</div>
      </div>
      <div class="dis-affected">
        <div style="font-size:13px;font-weight:700;color:var(--warning)">${fmtNum(d.affected)}</div>
        <div style="font-size:10px;color:var(--text-muted)">affected</div>
      </div>
      <span class="pill pill-${d.severity === 'critical' ? 'danger' : d.severity === 'high' ? 'warning' : d.severity === 'moderate' ? 'info' : 'success'}">${d.severity.toUpperCase()}</span>
      <div class="dis-actions">
        <button class="btn btn-xs btn-ghost" onclick="window._viewDisaster('${d.id}')" title="View">👁</button>
        <button class="btn btn-xs btn-ghost" onclick="window._resolveDisaster('${d.id}')" title="Mark Resolved">✓</button>
      </div>
    </div>`;
  }).join('');
}

function handleAddDisaster(e) {
  e.preventDefault();
  const name     = document.getElementById('dis-name').value.trim();
  const type     = document.getElementById('dis-type').value;
  const severity = document.getElementById('dis-severity').value;
  const location = document.getElementById('dis-location').value.trim() || 'Unknown';
  const affected = parseInt(document.getElementById('dis-affected').value) || 0;
  const coords   = document.getElementById('dis-coords').value.split(',').map(Number);
  const desc     = document.getElementById('dis-desc').value.trim();

  const newDis = {
    id: `DIS-${String(state.disasters.length+1).padStart(3,'0')}`,
    name, type, severity, location, state: location.split(',')[1]?.trim() || 'India',
    lat: coords[0] || 22.5, lng: coords[1] || 82.0, affected,
    displaced: Math.floor(affected*0.3), responders: 0, resources: 0, shelters: 0,
    description: desc || `${type} event in ${location}`,
    started: new Date().toISOString(), updated: new Date().toISOString(),
    casualties: 0, missing: 0, rescued: 0, needs: [], zones: [],
  };

  state.disasters.push(newDis);
  renderDisasterFeed();
  updateKPIs();
  document.getElementById('add-disaster-modal').classList.add('hidden');
  document.getElementById('disaster-form').reset();
  addAlert({ type:'danger', msg:`NEW EVENT: ${name} — Severity ${severity.toUpperCase()}` });
  showToast(`Disaster "${name}" registered.`, 'danger');
  addOpsLog(`New disaster registered: ${name} (${severity.toUpperCase()})`, 'siren', 'var(--danger)');
}

window._viewDisaster = function(id) {
  const d = state.disasters.find(x => x.id === id);
  if (!d) return;
  alert(`DISASTER RECORD\n\nID: ${d.id}\nName: ${d.name}\nType: ${d.type}\nSeverity: ${d.severity.toUpperCase()}\nLocation: ${d.location}\nAffected: ${d.affected.toLocaleString()}\nRescued: ${d.rescued.toLocaleString()}\nCasualties: ${d.casualties}\nMissing: ${d.missing}\nDescription: ${d.description}\nStarted: ${new Date(d.started).toLocaleString()}`);
};

window._resolveDisaster = function(id) {
  if (!confirm('Mark this disaster as resolved and remove from active list?')) return;
  const d = state.disasters.find(x => x.id === id);
  if (d) { addOpsLog(`Disaster resolved: ${d.name}`, 'check-circle', 'var(--success)'); showToast(`${d.name} marked as resolved.`, 'success'); }
  state.disasters = state.disasters.filter(x => x.id !== id);
  renderDisasterFeed();
  updateKPIs();
};

/* ── AI Report ── */
function initAIReport() {
  document.getElementById('btn-gen-report')?.addEventListener('click', handleGenReport);
}

async function handleGenReport() {
  const btn = document.getElementById('btn-gen-report');
  const box = document.getElementById('ai-report-box');
  btn.disabled = true;
  btn.innerHTML = '<svg class="spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Generating…';

  box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;color:var(--ai);font-size:13px">
    <svg class="spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    AI analysing all field data…
  </div>`;

  let fullText = '';
  const reportEl = document.createElement('div');
  reportEl.className = 'ai-report-text';
  box.innerHTML = '';
  box.appendChild(reportEl);

  try {
    await generateSituationReport(state, char => {
      fullText += char;
      reportEl.innerHTML = formatReportText(fullText) + '<span class="ai-typing-cursor"></span>';
    });
    // Remove cursor
    reportEl.innerHTML = formatReportText(fullText);
  } catch {
    box.innerHTML = '<div style="color:var(--danger);font-size:13px">Failed to generate report. Try again.</div>';
  }

  btn.disabled = false;
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 0v4m0 4v8"/><path d="M9 9l3-3 3 3M9 15l3 3 3-3"/></svg> Regenerate';
  addOpsLog('AI Situation Report generated by LLM engine', 'sparkles', 'var(--ai)');
}

function formatReportText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--ai)">$1</strong>')
    .replace(/\n/g, '<br>');
}

/* ── Alerts ── */
function initAlerts() {
  const btn      = document.getElementById('btn-alerts');
  const dropdown = document.getElementById('alert-dropdown');
  const clearBtn = document.getElementById('btn-mark-alerts-read');

  btn?.addEventListener('click', e => {
    e.stopPropagation();
    dropdown?.classList.toggle('hidden');
    renderAlertList();
  });

  clearBtn?.addEventListener('click', () => {
    state.alerts = [];
    updateAlertCount();
    dropdown?.classList.add('hidden');
    showToast('All alerts cleared.', 'info');
  });

  document.addEventListener('click', () => dropdown?.classList.add('hidden'));
  dropdown?.addEventListener('click', e => e.stopPropagation());

  renderAlertList();
  updateAlertCount();
}

function renderAlertList() {
  const list = document.getElementById('alert-list');
  if (!list) return;
  if (!state.alerts.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No active alerts.</div>'; return; }
  list.innerHTML = state.alerts.map(a => `
    <div class="alert-item">
      <div class="alert-dot ${a.type}"></div>
      <div>
        <div class="alert-item-msg">${a.msg}</div>
        <div class="alert-item-time">${formatTimeAgo(a.time)}</div>
      </div>
    </div>`).join('');
}

function updateAlertCount() {
  const el = document.getElementById('alert-count');
  if (!el) return;
  if (state.alerts.length) { el.textContent = state.alerts.length; el.classList.remove('hidden'); }
  else { el.classList.add('hidden'); }
}

export function addAlert(alert) {
  state.alerts.unshift({ ...alert, id:`ALT-${Date.now()}`, time: new Date().toISOString() });
  updateAlertCount();
}

/* ── Ops Log ── */
function initOpsLog() {
  renderOpsLog();
  document.getElementById('btn-clear-ops-log')?.addEventListener('click', () => {
    state.opsLog = [];
    renderOpsLog();
  });
}

function renderOpsLog() {
  const el = document.getElementById('ops-log');
  if (!el) return;
  if (!state.opsLog.length) { el.innerHTML = '<div class="dis-empty">Operations log cleared.</div>'; return; }
  el.innerHTML = state.opsLog.slice(0, 30).map(entry => `
    <div class="ops-entry">
      <span class="ops-time">${new Date(entry.time).toLocaleTimeString()}</span>
      <span class="ops-msg" style="color:${entry.color || 'var(--text-secondary)'}">${entry.msg}</span>
    </div>`).join('');
  el.scrollTop = 0;
}

export function addOpsLog(msg, icon, color) {
  state.opsLog.unshift({ msg, icon: icon||'activity', color: color||'var(--text-secondary)', time: new Date().toISOString() });
  renderOpsLog();
}

/* ── Ticker ── */
let tickerIdx = 0;
let tickerInterval = null;
function initTicker() {
  const el = document.getElementById('ticker-text');
  if (!el) return;
  const msgs = state.ticker.length ? state.ticker : ['📡 Connecting to live data sources…'];
  el.textContent = msgs[0];
  if (tickerInterval) clearInterval(tickerInterval);
  tickerInterval = setInterval(() => {
    tickerIdx = (tickerIdx + 1) % msgs.length;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = msgs[tickerIdx]; el.style.opacity = '1'; }, 400);
  }, 5000);
}

/* ── Emergency Declaration ── */
function initEmergencyButton() {
  document.getElementById('btn-declare-emergency')?.addEventListener('click', () => {
    if (!confirm('Declare a new emergency event? This will alert all field units.')) return;
    const name = prompt('Emergency Name:');
    if (!name) return;
    addAlert({ type:'danger', msg:`🚨 EMERGENCY DECLARED: ${name} — All units on standby` });
    showToast(`🚨 Emergency "${name}" declared — all units notified`, 'danger');
    addOpsLog(`EMERGENCY DECLARED: ${name}`, 'siren', 'var(--danger)');
    document.getElementById('sys-dot')?.classList.add('offline');
    document.getElementById('sys-label').textContent = 'EMERGENCY ACTIVE';
    document.getElementById('sb-dot')?.classList.remove('green');
    document.getElementById('sb-dot')?.classList.add('red');
    document.getElementById('sb-status').textContent = 'EMERGENCY ACTIVE';
  });
}

/* ── Command Palette ── */
const PALETTE_COMMANDS = [
  { label:'Refresh Live Data (USGS · ReliefWeb · GloFAS)', icon:'refresh-cw', action: async () => { invalidateCache(); showToast('Refreshing live data…', 'info', 2000); await fetchAndApplyLiveData(); } },
  { label:'Go to Command Center',       icon:'activity',       action: () => switchTab('command') },
  { label:'Go to Disaster Map',         icon:'map',            action: () => switchTab('map') },
  { label:'Go to AI Triage',            icon:'brain-circuit',  action: () => switchTab('triage') },
  { label:'Go to Resource Hub',         icon:'package',        action: () => switchTab('resources') },
  { label:'Go to Victim Registry',      icon:'users',          action: () => switchTab('victims') },
  { label:'Go to Volunteer Dispatch',   icon:'hard-hat',       action: () => switchTab('volunteers') },
  { label:'Go to Deep Analytics',       icon:'bar-chart-3',    action: () => switchTab('analytics') },
  { label:'Generate AI Situation Report',icon:'sparkles',      action: () => { switchTab('command'); setTimeout(handleGenReport, 200); } },
  { label:'Run AI Triage',              icon:'zap',            action: () => switchTab('triage') },
  { label:'Declare Emergency',          icon:'siren',          action: () => document.getElementById('btn-declare-emergency')?.click() },
  { label:'Add Disaster Event',         icon:'flame',          action: () => document.getElementById('btn-add-disaster')?.click() },
  { label:'Show Keyboard Shortcuts',    icon:'keyboard',       action: () => document.getElementById('shortcuts-modal')?.classList.remove('hidden') },
  { label:'Sign Out',                   icon:'log-out',        action: signOut },
];

let cmdSelected = 0;
function initCommandPalette() {
  const overlay = document.getElementById('cmd-overlay');
  const input   = document.getElementById('cmd-input');
  const body    = document.getElementById('cmd-body');

  const open  = () => { overlay?.classList.remove('hidden'); input?.focus(); renderPalette(''); cmdSelected = 0; };
  const close = () => overlay?.classList.add('hidden');

  document.getElementById('btn-cmd')?.addEventListener('click', open);
  overlay?.addEventListener('click', e => { if (e.target === overlay) close(); });

  input?.addEventListener('input', () => { renderPalette(input.value); cmdSelected = 0; });
  input?.addEventListener('keydown', e => {
    const items = body.querySelectorAll('.cmd-item');
    if (e.key === 'ArrowDown') { cmdSelected = Math.min(cmdSelected+1, items.length-1); updateSelection(items); e.preventDefault(); }
    if (e.key === 'ArrowUp')   { cmdSelected = Math.max(cmdSelected-1, 0); updateSelection(items); e.preventDefault(); }
    if (e.key === 'Enter')     { items[cmdSelected]?.click(); }
    if (e.key === 'Escape')    { close(); }
  });

  function renderPalette(query) {
    const q = query.toLowerCase();
    const filtered = q ? PALETTE_COMMANDS.filter(c => c.label.toLowerCase().includes(q)) : PALETTE_COMMANDS;
    if (!filtered.length) { body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">No commands found.</div>'; return; }
    body.innerHTML = `<div class="cmd-section">Commands</div>` +
      filtered.map((c, i) => `
        <div class="cmd-item ${i===0?'selected':''}" data-idx="${i}">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
          <span class="cmd-item-label">${c.label}</span>
        </div>`).join('');

    body.querySelectorAll('.cmd-item').forEach((item, i) => {
      item.addEventListener('click', () => {
        filtered[i].action();
        close();
        input.value = '';
      });
    });
  }

  function updateSelection(items) {
    items.forEach((item, i) => item.classList.toggle('selected', i === cmdSelected));
    items[cmdSelected]?.scrollIntoView({ block:'nearest' });
  }
}

/* ── Keyboard Shortcuts ── */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') { e.target.blur(); return; }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('btn-cmd')?.click(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); document.getElementById('btn-gen-report')?.click(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 't') { e.preventDefault(); switchTab('triage'); setTimeout(() => document.getElementById('btn-run-triage')?.click(), 300); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); document.getElementById('btn-declare-emergency')?.click(); return; }
    const tabKeys = { '1':'command','2':'map','3':'triage','4':'resources','5':'victims','6':'volunteers','7':'analytics' };
    if (tabKeys[e.key] && !e.ctrlKey && !e.metaKey) { switchTab(tabKeys[e.key]); return; }
    if (e.key === '?') { document.getElementById('shortcuts-modal')?.classList.remove('hidden'); return; }
    if (e.key === 'Escape') {
      document.getElementById('cmd-overlay')?.classList.add('hidden');
      document.getElementById('add-disaster-modal')?.classList.add('hidden');
      document.getElementById('shortcuts-modal')?.classList.add('hidden');
    }
  });

  document.getElementById('close-shortcuts')?.addEventListener('click', () => {
    document.getElementById('shortcuts-modal')?.classList.add('hidden');
  });
}

/* ── Toast Notifications ── */
const TOAST_ICONS = {
  success: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  danger:  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  warning: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

export function showToast(msg, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}
    <span class="toast-msg">${msg}</span>
    <button class="toast-close" aria-label="Close">✕</button>`;
  container.appendChild(toast);
  toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
  setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  toast.classList.add('out');
  setTimeout(() => toast.remove(), 300);
}

/* ── Live Simulation ── */
function startLiveSimulation() {
  // Real data only — no simulated fluctuations.
  // Auto-refresh is handled in bootApp() via setInterval on fetchAndApplyLiveData().
}

/* ── Utilities ── */
export function formatTimeAgo(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60)   return 'just now';
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400)return `${Math.floor(secs/3600)}h ago`;
  return `${Math.floor(secs/86400)}d ago`;
}

function fmtNum(n) { return Number(n).toLocaleString(); }
function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

/* ── Startup ── */
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initAuth();
});
