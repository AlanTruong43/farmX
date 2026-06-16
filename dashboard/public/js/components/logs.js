/**
 * Logs Component — Realtime log viewer
 */
import { api } from '../api.js';
import { on } from '../sse.js';

let activeLevel = 'ALL';
let activeProfile = 'ALL';
let autoScroll = true;
let logEntries = [];
const MAX_DISPLAY = 500;

export function render() {
    return `
        <div class="page-header">
            <h2>Logs</h2>
            <p>Xem logs realtime</p>
        </div>

        <div class="card">
            <div class="log-filters">
                <span style="color:var(--text-muted);font-size:11px;margin-right:4px">Level:</span>
                <button class="chip active" data-level="ALL">All</button>
                <button class="chip" data-level="INFO">Info</button>
                <button class="chip" data-level="SUCCESS">Success</button>
                <button class="chip" data-level="WARN">Warn</button>
                <button class="chip" data-level="ERROR">Error</button>
                <button class="chip" data-level="ACTION">Action</button>
                <button class="chip" data-level="DEBUG">Debug</button>

                <span style="color:var(--text-muted);font-size:11px;margin-left:12px;margin-right:4px">Profile:</span>
                <select class="form-control" id="log-profile-filter" style="width:140px;padding:3px 8px;font-size:11px">
                    <option value="ALL">Tất cả</option>
                </select>

                <label style="margin-left:auto;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);cursor:pointer">
                    <input type="checkbox" id="log-autoscroll" checked> Auto-scroll
                </label>

                <button class="btn btn-sm" id="log-clear">Clear</button>
            </div>

            <div class="log-viewer" id="log-viewer"></div>
        </div>
    `;
}

export async function init() {
    // Load history
    try {
        const history = await api.getLogHistory();
        logEntries = history.slice(-MAX_DISPLAY);
        renderLogs();
        populateProfileFilter();
    } catch { /* ignore */ }

    // Level filter chips
    document.querySelectorAll('.chip[data-level]').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.chip[data-level]').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeLevel = chip.dataset.level;
            renderLogs();
        });
    });

    // Profile filter
    document.getElementById('log-profile-filter').addEventListener('change', (e) => {
        activeProfile = e.target.value;
        renderLogs();
    });

    // Auto-scroll toggle
    document.getElementById('log-autoscroll').addEventListener('change', (e) => {
        autoScroll = e.target.checked;
    });

    // Clear
    document.getElementById('log-clear').addEventListener('click', () => {
        logEntries = [];
        renderLogs();
    });

    // SSE logs
    on('log', (entry) => {
        logEntries.push(entry);
        if (logEntries.length > MAX_DISPLAY) logEntries.shift();

        // Update profile filter if new profile
        addProfileOption(entry.profileTag);

        // Append single entry if matches filter
        if (matchesFilter(entry)) {
            appendLogEntry(entry);
        }
    });
}

function matchesFilter(entry) {
    if (activeLevel !== 'ALL' && entry.level !== activeLevel) return false;
    if (activeProfile !== 'ALL' && entry.profileTag !== activeProfile) return false;
    return true;
}

function renderLogs() {
    const viewer = document.getElementById('log-viewer');
    if (!viewer) return;

    const filtered = logEntries.filter(matchesFilter);
    viewer.innerHTML = filtered.map(formatEntry).join('');

    if (autoScroll) {
        viewer.scrollTop = viewer.scrollHeight;
    }
}

function appendLogEntry(entry) {
    const viewer = document.getElementById('log-viewer');
    if (!viewer) return;

    viewer.insertAdjacentHTML('beforeend', formatEntry(entry));

    if (autoScroll) {
        viewer.scrollTop = viewer.scrollHeight;
    }
}

function formatEntry(entry) {
    const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('vi-VN', { hour12: false }) : '';
    const tag = entry.profileTag ? `[${entry.profileTag}]` : '';
    const level = entry.level || 'INFO';
    return `<div class="log-entry level-${level}"><span class="ts">${ts}</span><span class="tag">${tag}</span><span class="msg">${escapeHtml(entry.message)}</span></div>`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function populateProfileFilter() {
    const profiles = new Set();
    logEntries.forEach(e => { if (e.profileTag) profiles.add(e.profileTag); });
    profiles.forEach(p => addProfileOption(p));
}

function addProfileOption(tag) {
    if (!tag) return;
    const select = document.getElementById('log-profile-filter');
    if (!select) return;
    // Check if already exists
    for (const opt of select.options) {
        if (opt.value === tag) return;
    }
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    select.appendChild(option);
}
