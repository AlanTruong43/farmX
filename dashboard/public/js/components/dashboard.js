/**
 * Dashboard Component — Overview + stats + start/stop
 * Hiển thị tổng quan X farming
 */
import { api } from '../api.js';
import { on, off } from '../sse.js';
import { toast } from '../app.js';
import { setText, getBadge } from '../utils.js';

let _onStats = null;
let _onFarmingStatus = null;
let _onLog = null;
let _logEntries = [];
const MAX_LOG = 100;

export function render() {
    return `
        <div class="page-header">
            <h2>Dashboard</h2>
            <p>Tổng quan trạng thái farming</p>
        </div>

        <!-- X Farming Banner -->
        <div id="farming-banner" class="farming-banner inactive">
            <span>X Farming chưa bắt đầu</span>
        </div>

        <div class="stat-grid" id="stat-grid">
            <div class="stat-card">
                <div class="label">Tweets xử lý</div>
                <div class="value accent" id="stat-processed">0</div>
            </div>
            <div class="stat-card">
                <div class="label">Liked</div>
                <div class="value success" id="stat-liked">0</div>
            </div>
            <div class="stat-card">
                <div class="label">Followed</div>
                <div class="value accent" id="stat-followed">0</div>
            </div>
            <div class="stat-card">
                <div class="label">Commented</div>
                <div class="value warning" id="stat-commented">0</div>
            </div>
            <div class="stat-card">
                <div class="label">Sessions</div>
                <div class="value purple" id="stat-sessions">0</div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h3>Điều khiển X Farming</h3>
            </div>
            <div class="controls-row">
                <button class="btn btn-success" id="btn-start">▶ Start Farming</button>
                <button class="btn btn-danger" id="btn-stop" disabled>■ Stop</button>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h3>Active X Profiles</h3>
            </div>
            <div id="active-profiles-list">
                <span class="text-muted">Không có profile nào đang chạy</span>
            </div>
        </div>

        <div class="card">
            <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
                <h3>Logs</h3>
                <button class="btn btn-sm" id="dash-log-clear">Clear</button>
            </div>
            <div class="log-viewer" id="dash-log-viewer" style="height:260px"></div>
        </div>
    `;
}

export async function init() {
    document.getElementById('btn-start').addEventListener('click', handleStart);
    document.getElementById('btn-stop').addEventListener('click', handleStop);
    document.getElementById('dash-log-clear').addEventListener('click', () => {
        _logEntries = [];
        const v = document.getElementById('dash-log-viewer');
        if (v) v.innerHTML = '';
    });

    // SSE listeners
    _onStats = updateStats;
    _onFarmingStatus = updateBanner;

    on('stats', _onStats);
    on('farming-status', _onFarmingStatus);

    // Load initial
    api.getStatus().then(data => {
        updateStats(data);
    }).catch(() => {});

    // Load log history
    try {
        const history = await api.getLogHistory();
        _logEntries = history.slice(-MAX_LOG);
        renderDashLogs();
    } catch { /* ignore */ }

    // Live logs
    _onLog = (entry) => {
        _logEntries.push(entry);
        if (_logEntries.length > MAX_LOG) _logEntries.shift();
        appendDashLog(entry);
    };
    on('log', _onLog);
}

export function destroy() {
    if (_onStats) { off('stats', _onStats); _onStats = null; }
    if (_onFarmingStatus) { off('farming-status', _onFarmingStatus); _onFarmingStatus = null; }
    if (_onLog) { off('log', _onLog); _onLog = null; }
}

async function handleStart() {
    try {
        await api.startFarming();
        toast('Farming bắt đầu!', 'success');
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleStop() {
    try {
        await api.stopFarming();
        toast('Đang dừng farming...', 'success');
    } catch (err) {
        toast(err.message, 'error');
    }
}

function updateStats(status) {
    const g = status.globalStats || {};
    setText('stat-processed', g.totalProcessed || 0);
    setText('stat-liked', g.totalLiked || 0);
    setText('stat-followed', g.totalFollowed || 0);
    setText('stat-commented', g.totalCommented || 0);
    setText('stat-sessions', g.sessionsCompleted || 0);

    // Buttons
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    if (btnStart && btnStop) {
        btnStart.disabled = status.farmingActive;
        btnStop.disabled = !status.farmingActive;
    }

    // Banner
    updateBanner({ active: status.farmingActive });

    // Active profiles
    const container = document.getElementById('active-profiles-list');
    if (!container) return;

    const profiles = status.activeProfiles || {};
    const entries = Object.entries(profiles);
    if (entries.length === 0) {
        container.innerHTML = '<span class="text-muted">Không có profile nào đang chạy</span>';
        return;
    }

    container.innerHTML = entries.map(([tag, data]) => {
        const statusBadge = getBadge(data.status);
        const loopInfo = data.currentLoop ? ` — Loop ${data.currentLoop}/${data.totalLoops}` : '';
        const stats = data.stats || {};
        return `<div class="profile-row">
            <strong class="profile-tag">${tag}</strong>
            ${statusBadge}
            <span class="text-secondary text-xs">${loopInfo}</span>
            <span class="profile-stats">
                P:${stats.processed||0} L:${stats.liked||0} F:${stats.followed||0} C:${stats.commented||0}
            </span>
        </div>`;
    }).join('');
}

function updateBanner(data) {
    const banner = document.getElementById('farming-banner');
    if (!banner) return;

    if (data.active) {
        banner.className = 'farming-banner active';
        banner.innerHTML = '<div class="pulse"></div><span>X Farming đang chạy...</span>';
    } else {
        banner.className = 'farming-banner inactive';
        banner.innerHTML = '<span>X Farming chưa bắt đầu</span>';
    }
}

function renderDashLogs() {
    const viewer = document.getElementById('dash-log-viewer');
    if (!viewer) return;
    viewer.innerHTML = _logEntries.map(formatLogEntry).join('');
    viewer.scrollTop = viewer.scrollHeight;
}

function appendDashLog(entry) {
    const viewer = document.getElementById('dash-log-viewer');
    if (!viewer) return;
    viewer.insertAdjacentHTML('beforeend', formatLogEntry(entry));
    viewer.scrollTop = viewer.scrollHeight;
}

function formatLogEntry(entry) {
    const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('vi-VN', { hour12: false }) : '';
    const tag = entry.profileTag ? `[${entry.profileTag}]` : '';
    const level = entry.level || 'INFO';
    const msg = escapeHtml(entry.message || '');
    return `<div class="log-entry level-${level}"><span class="ts">${ts}</span><span class="tag">${tag}</span><span class="msg">${msg}</span></div>`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
