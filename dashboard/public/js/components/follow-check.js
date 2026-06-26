/**
 * Follow Check — scrape following/followers, show stats, bulk unfollow
 */
import { api } from '../api.js';
import { toast } from '../app.js';

// ─── extend api ──────────────────────────────────────────
const followApi = {
    scrape:   (profileId, type)       => _req('POST', '/api/follow/scrape',   { profileId, type }),
    stats:    (profileId, usernames)  => _req('POST', '/api/follow/stats',    { profileId, usernames }),
    unfollow: (profileId, usernames)  => _req('POST', '/api/follow/unfollow', { profileId, usernames }),
};

async function _req(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// ─── State ───────────────────────────────────────────────
let state = {
    profiles: [],
    selectedProfile: null,
    activeTab: 'following',
    users: [],           // full list (current tab)
    stats: {},           // username -> { following, followers }
    statsLoading: false,
    selected: new Set(),
    search: '',
    filterFollowsBack: false,
    loading: false,
    xUsername: null,
};

// ─── Render ──────────────────────────────────────────────
export function render() {
    return `
    <div class="page-header">
        <h2>Follow Check</h2>
        <p>Kiểm tra following/followers và unfollow hàng loạt</p>
    </div>

    <div class="card" style="padding:0;overflow:hidden">

        <!-- Toolbar top -->
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <select id="fc-profile" class="form-control" style="width:200px">
                <option value="">Chọn profile...</option>
            </select>
            <button id="fc-load" class="btn btn-primary" style="min-width:90px">
                <span id="fc-load-text">Load</span>
            </button>
            <div id="fc-xuser" style="font-size:12px;color:var(--text-secondary)"></div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
                <span id="fc-sel-count" style="font-size:12px;color:var(--text-secondary)"></span>
                <button id="fc-unfollow-btn" class="btn btn-danger" style="display:none">
                    Unfollow (<span id="fc-sel-num">0</span>)
                </button>
            </div>
        </div>

        <!-- Tabs -->
        <div style="display:flex;border-bottom:1px solid var(--border)">
            <button class="fc-tab active" data-tab="following" style="padding:10px 20px;background:none;border:none;border-bottom:2px solid var(--accent);color:var(--text-primary);cursor:pointer;font-size:13px">
                Following <span id="fc-following-count" class="fc-badge"></span>
            </button>
            <button class="fc-tab" data-tab="followers" style="padding:10px 20px;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary);cursor:pointer;font-size:13px">
                Followers <span id="fc-followers-count" class="fc-badge"></span>
            </button>
        </div>

        <!-- Filter bar -->
        <div style="padding:10px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)">
            <input id="fc-search" class="form-control" placeholder="Tìm @username hoặc tên..." style="flex:1;max-width:300px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;color:var(--text-secondary)">
                <input type="checkbox" id="fc-filter-follows-back"> Follows you
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;color:var(--text-secondary);margin-left:auto">
                <input type="checkbox" id="fc-select-all"> Chọn tất cả
            </label>
        </div>

        <!-- User list -->
        <div id="fc-list" style="min-height:300px;max-height:520px;overflow-y:auto">
            <div id="fc-empty" style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">
                Chọn profile và nhấn Load để tải danh sách
            </div>
        </div>

        <!-- Stats loading bar -->
        <div id="fc-stats-bar" style="display:none;padding:8px 20px;border-top:1px solid var(--border);font-size:12px;color:var(--text-secondary);background:var(--bg-tertiary)">
            <span id="fc-stats-text">Đang tải thống kê...</span>
        </div>
    </div>`;
}

// ─── Init ─────────────────────────────────────────────────
export async function init() {
    // Reset state
    state.users = [];
    state.stats = {};
    state.selected = new Set();
    state.search = '';
    state.filterFollowsBack = false;
    state.xUsername = null;

    // Load profiles
    try {
        const data = await api.getProfiles();
        state.profiles = (data.profiles || []).filter(p => p.enabled !== false);
        const sel = document.getElementById('fc-profile');
        for (const p of state.profiles) {
            const opt = document.createElement('option');
            opt.value = p.genlogin_id;
            opt.textContent = p.username || p.genlogin_id;
            sel.appendChild(opt);
        }
        if (state.profiles.length > 0) {
            sel.value = state.profiles[0].genlogin_id;
            state.selectedProfile = state.profiles[0].genlogin_id;
        }
    } catch (err) {
        toast('Lỗi tải profiles: ' + err.message, 'error');
    }

    bindEvents();
}

function bindEvents() {
    document.getElementById('fc-profile').addEventListener('change', e => {
        state.selectedProfile = e.target.value;
    });

    document.getElementById('fc-load').addEventListener('click', loadList);

    document.querySelectorAll('.fc-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === state.activeTab) return;
            state.activeTab = btn.dataset.tab;
            state.users = [];
            state.stats = {};
            state.selected.clear();
            document.querySelectorAll('.fc-tab').forEach(b => {
                b.style.borderBottomColor = 'transparent';
                b.style.color = 'var(--text-secondary)';
                b.classList.remove('active');
            });
            btn.style.borderBottomColor = 'var(--accent)';
            btn.style.color = 'var(--text-primary)';
            btn.classList.add('active');
            loadList();
        });
    });

    document.getElementById('fc-search').addEventListener('input', e => {
        state.search = e.target.value.toLowerCase();
        renderList();
    });

    document.getElementById('fc-filter-follows-back').addEventListener('change', e => {
        state.filterFollowsBack = e.target.checked;
        renderList();
    });

    document.getElementById('fc-select-all').addEventListener('change', e => {
        const visible = getFiltered();
        if (e.target.checked) visible.forEach(u => state.selected.add(u.username));
        else visible.forEach(u => state.selected.delete(u.username));
        renderList();
        updateSelCount();
    });

    document.getElementById('fc-unfollow-btn').addEventListener('click', doUnfollow);
}

// ─── Load list ───────────────────────────────────────────
async function loadList() {
    if (!state.selectedProfile) { toast('Chọn profile trước', 'error'); return; }
    if (state.loading) return;

    state.loading = true;
    state.users = [];
    state.stats = {};
    state.selected.clear();

    const loadBtn = document.getElementById('fc-load');
    const loadText = document.getElementById('fc-load-text');
    loadBtn.disabled = true;
    loadText.textContent = 'Đang tải...';
    document.getElementById('fc-empty').textContent = `Đang scrape ${state.activeTab}...`;
    document.getElementById('fc-list').innerHTML = `
        <div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">
            Đang scrape ${state.activeTab}... (có thể mất 1-3 phút tuỳ số lượng)
        </div>`;
    document.getElementById('fc-xuser').textContent = '';

    try {
        const res = await followApi.scrape(state.selectedProfile, state.activeTab);
        state.users = res.users || [];
        state.xUsername = res.xUsername;

        document.getElementById('fc-xuser').textContent = `@${res.xUsername} — ${state.activeTab}`;
        document.getElementById(`fc-${state.activeTab}-count`).textContent = ` ${state.users.length}`;

        renderList();
        updateSelCount();

        // Load stats in background
        loadStatsBackground();

    } catch (err) {
        toast('Lỗi scrape: ' + err.message, 'error');
        document.getElementById('fc-list').innerHTML = `
            <div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">
                Lỗi: ${err.message}
            </div>`;
    } finally {
        state.loading = false;
        loadBtn.disabled = false;
        loadText.textContent = 'Load';
    }
}

// ─── Load stats in batches of 8 ──────────────────────────
async function loadStatsBackground() {
    if (state.statsLoading) return;
    state.statsLoading = true;

    const allUsernames = state.users.map(u => u.username);
    const BATCH = 8;
    const statsBar = document.getElementById('fc-stats-bar');
    const statsText = document.getElementById('fc-stats-text');
    statsBar.style.display = 'block';

    let done = 0;
    for (let i = 0; i < allUsernames.length; i += BATCH) {
        const batch = allUsernames.slice(i, i + BATCH);
        statsText.textContent = `Đang tải thống kê... ${done}/${allUsernames.length}`;

        try {
            const res = await followApi.stats(state.selectedProfile, batch);
            Object.assign(state.stats, res.stats || {});
            done += batch.length;
            updateStatsInList(batch);
        } catch {
            done += batch.length;
        }
    }

    statsBar.style.display = 'none';
    state.statsLoading = false;
}

// Update only stat cells for loaded usernames
function updateStatsInList(usernames) {
    for (const username of usernames) {
        const el = document.getElementById(`fc-stats-${username}`);
        if (!el) continue;
        const s = state.stats[username];
        if (!s) continue;
        const fing = s.following !== null ? formatCount(s.following) : '—';
        const fers = s.followers !== null ? formatCount(s.followers) : '—';
        el.innerHTML = `<span><strong>${fing}</strong> following</span><span><strong>${fers}</strong> followers</span>`;
    }
}

// ─── Render list ─────────────────────────────────────────
function getFiltered() {
    return state.users.filter(u => {
        if (state.search) {
            const q = state.search;
            if (!u.username.toLowerCase().includes(q) && !u.displayName.toLowerCase().includes(q)) return false;
        }
        if (state.filterFollowsBack && !u.followsYou) return false;
        return true;
    });
}

function renderList() {
    const list = document.getElementById('fc-list');
    const filtered = getFiltered();

    if (filtered.length === 0 && state.users.length === 0) {
        list.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">Chưa có dữ liệu</div>`;
        return;
    }
    if (filtered.length === 0) {
        list.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">Không tìm thấy kết quả</div>`;
        return;
    }

    list.innerHTML = filtered.map(u => userRowHtml(u)).join('');

    // Bind checkboxes
    list.querySelectorAll('.fc-user-check').forEach(cb => {
        cb.addEventListener('change', e => {
            const username = e.target.dataset.username;
            if (e.target.checked) state.selected.add(username);
            else state.selected.delete(username);
            updateSelCount();
            // Highlight row
            const row = document.getElementById(`fc-row-${username}`);
            if (row) row.style.background = e.target.checked ? 'rgba(88,166,255,0.06)' : '';
        });
    });
}

function userRowHtml(u) {
    const isSelected = state.selected.has(u.username);
    const s = state.stats[u.username];
    const statsHtml = s
        ? `<span><strong>${s.following !== null ? formatCount(s.following) : '—'}</strong> following</span>
           <span><strong>${s.followers !== null ? formatCount(s.followers) : '—'}</strong> followers</span>`
        : `<span style="color:var(--text-muted)">Đang tải...</span>`;

    const verifiedIcon = u.isVerified
        ? `<svg viewBox="0 0 22 22" width="14" height="14" style="fill:#58a6ff;vertical-align:-2px;margin-left:4px"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>`
        : '';

    const followsYouBadge = u.followsYou
        ? `<span style="font-size:11px;padding:1px 7px;background:rgba(88,166,255,.12);color:var(--accent);border-radius:10px;margin-left:6px">Follows you</span>`
        : '';

    const initials = (u.displayName || u.username).substring(0, 2).toUpperCase();
    const avatarColor = strToColor(u.username);

    return `
    <div id="fc-row-${u.username}" style="display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--border);${isSelected ? 'background:rgba(88,166,255,0.06)' : ''}">
        <input type="checkbox" class="fc-user-check" data-username="${u.username}" ${isSelected ? 'checked' : ''}
               style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent);flex-shrink:0">
        <div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;${avatarColor}">${initials}</div>
        <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;display:flex;align-items:center;flex-wrap:wrap;gap:2px">
                ${escHtml(u.displayName)}${verifiedIcon}${followsYouBadge}
            </div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:1px">@${escHtml(u.username)}</div>
            <div id="fc-stats-${u.username}" style="display:flex;gap:14px;font-size:12px;color:var(--text-secondary);margin-top:3px">
                ${statsHtml}
            </div>
        </div>
        <a href="https://x.com/${u.username}" target="_blank"
           style="padding:5px 14px;border:1px solid var(--border);border-radius:20px;font-size:12px;color:var(--text-secondary);text-decoration:none;flex-shrink:0">
            View
        </a>
    </div>`;
}

function updateSelCount() {
    const n = state.selected.size;
    const countEl = document.getElementById('fc-sel-count');
    const btn = document.getElementById('fc-unfollow-btn');
    const numEl = document.getElementById('fc-sel-num');

    if (n > 0) {
        countEl.textContent = `${n} đã chọn`;
        btn.style.display = 'inline-flex';
        numEl.textContent = n;
    } else {
        countEl.textContent = '';
        btn.style.display = 'none';
    }
}

// ─── Unfollow ────────────────────────────────────────────
async function doUnfollow() {
    const usernames = Array.from(state.selected);
    if (usernames.length === 0) return;
    if (!confirm(`Unfollow ${usernames.length} tài khoản?`)) return;

    const btn = document.getElementById('fc-unfollow-btn');
    btn.disabled = true;
    btn.textContent = 'Đang unfollow...';

    try {
        const res = await followApi.unfollow(state.selectedProfile, usernames);
        toast(`Đã unfollow ${res.unfollowed?.length || 0} tài khoản`, 'success');
        if (res.failed?.length) toast(`Thất bại: ${res.failed.join(', ')}`, 'error');

        // Remove unfollowed from list
        const done = new Set(res.unfollowed || []);
        state.users = state.users.filter(u => !done.has(u.username));
        state.selected.clear();
        renderList();
        updateSelCount();
        document.getElementById(`fc-${state.activeTab}-count`).textContent = ` ${state.users.length}`;
    } catch (err) {
        toast('Lỗi unfollow: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        document.getElementById('fc-sel-num').textContent = state.selected.size;
        updateSelCount();
    }
}

// ─── Helpers ─────────────────────────────────────────────
function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatCount(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
    return n.toString();
}

const AVATAR_COLORS = [
    'background:#1d4ed8;color:#93c5fd',
    'background:#166534;color:#86efac',
    'background:#7c2d12;color:#fca5a5',
    'background:#4c1d95;color:#c4b5fd',
    'background:#134e4a;color:#5eead4',
    'background:#713f12;color:#fde68a',
    'background:#831843;color:#fbcfe8',
    'background:#1e3a5f;color:#93c5fd',
];

function strToColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function destroy() {
    state.users = [];
    state.selected = new Set();
    state.stats = {};
}
