/**
 * Follow Check — scrape following/followers, hiển thị dạng table, bulk unfollow
 */
import { api } from '../api.js';
import { toast } from '../app.js';

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

const followApi = {
    unfollow: (profileId, usernames) => _req('POST', '/api/follow/unfollow', { profileId, usernames }),
    saveWindowSize: (width, height) => _req('PUT', '/api/config/follow-check', { width, height }),
};

let _activeStream = null;
let _unfollowStop = false;

// ─── State (giữ khi chuyển tab dashboard) ────────────────
let state = {
    profiles: [],
    selectedProfile: null,
    activeTab: 'following',
    users: [],
    selected: new Set(),
    search: '',
    filterFollowsBack: false,
    filterNotFollowBack: false,
    filterBlue: false,
    filterGold: false,
    loading: false,
    xUsername: null,
    // Cache riêng cho mỗi tab (following / followers)
    cache: { following: null, followers: null },
};

// ─── Render ──────────────────────────────────────────────
export function render() {
    return `
    <div class="page-header">
        <h2>Follow Check</h2>
        <p>Kiểm tra danh sách đang theo dõi / người theo dõi và unfollow hàng loạt</p>
    </div>

    <div class="card" style="padding:0;overflow:hidden">

        <!-- Toolbar -->
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <select id="fc-profile" class="form-control" style="width:200px">
                <option value="">Chọn profile...</option>
            </select>
            <button id="fc-load" class="btn btn-primary" style="min-width:110px">Tải danh sách</button>
            <button id="fc-stop" class="btn btn-danger" style="display:none;min-width:80px">⏹ Dừng</button>
            <div id="fc-xuser" style="font-size:12px;color:var(--text-secondary)"></div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span id="fc-sel-count" style="font-size:12px;color:var(--text-secondary)"></span>
                <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);white-space:nowrap">
                    Mỗi lần:
                    <input type="number" id="fc-batch-size" value="10" min="1" max="200"
                           style="width:52px;padding:3px 6px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary)">
                </label>
                <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);white-space:nowrap">
                    Nghỉ:
                    <input type="number" id="fc-delay-sec" value="30" min="0" max="3600"
                           style="width:52px;padding:3px 6px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary)">
                    giây
                </label>
                <button id="fc-unfollow-stop" class="btn btn-danger" style="display:none">⏹ Dừng</button>
                <button id="fc-unfollow-btn" class="btn btn-danger" style="display:none">
                    Bỏ theo dõi (<span id="fc-sel-num">0</span>)
                </button>
            </div>
        </div>

        <!-- Window size settings -->
        <div style="padding:10px 20px;border-bottom:1px solid var(--border);background:var(--bg-secondary);display:flex;align-items:center;gap:12px">
            <span style="font-size:12px;color:var(--text-secondary);white-space:nowrap">Kích thước cửa sổ:</span>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary)">
                Rộng
                <input type="number" id="fc-win-width" class="form-control" value="1280"
                       style="width:80px;padding:3px 6px;font-size:12px" min="400" max="3840">
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary)">
                Cao
                <input type="number" id="fc-win-height" class="form-control" value="900"
                       style="width:80px;padding:3px 6px;font-size:12px" min="300" max="2160">
            </label>
            <button id="fc-win-save" class="btn" style="padding:3px 10px;font-size:12px">Lưu</button>
            <span id="fc-win-saved" style="font-size:11px;color:#4ade80;display:none">✓ Đã lưu</span>
        </div>

        <!-- Tabs following / followers -->
        <div style="display:flex;border-bottom:1px solid var(--border)">
            <button class="fc-tab active" data-tab="following"
                style="padding:10px 20px;background:none;border:none;border-bottom:2px solid var(--accent);color:var(--text-primary);cursor:pointer;font-size:13px;font-weight:500">
                Đang theo dõi <span id="fc-following-count" style="font-size:11px;padding:1px 7px;background:var(--bg-tertiary);border-radius:10px;margin-left:4px"></span>
            </button>
            <button class="fc-tab" data-tab="followers"
                style="padding:10px 20px;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary);cursor:pointer;font-size:13px;font-weight:500">
                Người theo dõi <span id="fc-followers-count" style="font-size:11px;padding:1px 7px;background:var(--bg-tertiary);border-radius:10px;margin-left:4px"></span>
            </button>
        </div>

        <!-- Filter bar -->
        <div style="padding:10px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--border);background:var(--bg-secondary)">
            <input id="fc-search" class="form-control" placeholder="Tìm @username hoặc tên..." style="width:240px">
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:var(--text-secondary);white-space:nowrap">
                <input type="checkbox" id="fc-filter-follows-back"> Đã follow lại
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:var(--text-secondary);white-space:nowrap">
                <input type="checkbox" id="fc-filter-not-follow-back"> Chưa follow lại
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:var(--text-secondary);white-space:nowrap">
                <input type="checkbox" id="fc-filter-blue">
                <span style="display:inline-flex;align-items:center;gap:3px">${svgBlueTick()} Tick xanh</span>
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:var(--text-secondary);white-space:nowrap">
                <input type="checkbox" id="fc-filter-gold">
                <span style="display:inline-flex;align-items:center;gap:3px">${svgGoldTick()} Tick vàng</span>
            </label>
            <div id="fc-result-count" style="margin-left:auto;font-size:12px;color:var(--text-muted)"></div>
        </div>

        <!-- Table header -->
        <div id="fc-table-header" style="display:none;padding:8px 20px;background:var(--bg-tertiary);border-bottom:1px solid var(--border)">
            <div style="display:grid;grid-template-columns:36px 1fr 100px 100px 110px 70px;gap:8px;align-items:center;font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px">
                <label style="cursor:pointer;display:flex;align-items:center;justify-content:center">
                    <input type="checkbox" id="fc-select-all" style="width:14px;height:14px;accent-color:var(--accent)">
                </label>
                <span>Tài khoản</span>
                <span style="text-align:right">Đang theo dõi</span>
                <span style="text-align:right">Người theo dõi</span>
                <span style="text-align:center">Follow lại</span>
                <span style="text-align:center">Tick</span>
            </div>
        </div>

        <!-- Table body -->
        <div id="fc-list" style="min-height:300px;max-height:540px;overflow-y:auto">
            <div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">
                Chọn profile và nhấn <strong>Tải danh sách</strong>
            </div>
        </div>
    </div>

    <!-- Log panel -->
    <div class="card" style="margin-top:16px;padding:0;overflow:hidden">
        <div style="padding:8px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
            <span style="font-size:13px;font-weight:500;color:var(--text-secondary)">Logs</span>
            <button id="fc-log-clear" class="btn" style="padding:2px 8px;font-size:11px">Xóa</button>
        </div>
        <div id="fc-logs" style="font-family:monospace;font-size:11px;padding:8px 16px;max-height:180px;overflow-y:auto;color:var(--text-secondary);background:var(--bg-secondary)">
            <div id="fc-logs-empty" style="color:var(--text-muted)">Chưa có logs</div>
        </div>
    </div>`;
}

// ─── Init ─────────────────────────────────────────────────
export async function init() {
    // Load window size from config
    try {
        const cfg = await fetch('/api/config').then(r => r.json());
        const fcWin = cfg.follow_check_window || {};
        if (fcWin.width)  document.getElementById('fc-win-width').value  = fcWin.width;
        if (fcWin.height) document.getElementById('fc-win-height').value = fcWin.height;
    } catch {}

    // Load profiles nếu chưa có
    if (state.profiles.length === 0) {
        try {
            const data = await api.getProfiles();
            state.profiles = (data.profiles || []).filter(p => p.enabled !== false);
        } catch (err) {
            toast('Lỗi tải profiles: ' + err.message, 'error');
        }
    }

    // Populate profile dropdown
    const sel = document.getElementById('fc-profile');
    for (const p of state.profiles) {
        const opt = document.createElement('option');
        opt.value = p.genlogin_id;
        opt.textContent = p.username || p.genlogin_id;
        sel.appendChild(opt);
    }
    if (state.selectedProfile) {
        sel.value = state.selectedProfile;
    } else if (state.profiles.length > 0) {
        sel.value = state.profiles[0].genlogin_id;
        state.selectedProfile = state.profiles[0].genlogin_id;
    }

    bindEvents();

    // Restore UI nếu đã có data từ lần trước
    if (state.users.length > 0) {
        restoreUI();
    }
}

function restoreUI() {
    const tabLabel = state.activeTab === 'following' ? 'Đang theo dõi' : 'Người theo dõi';
    if (state.xUsername) {
        document.getElementById('fc-xuser').textContent = `@${state.xUsername} — ${tabLabel}`;
    }
    document.getElementById(`fc-${state.activeTab}-count`).textContent = state.users.length;
    document.getElementById('fc-table-header').style.display = 'block';
    document.querySelectorAll('.fc-tab').forEach(b => {
        const isActive = b.dataset.tab === state.activeTab;
        b.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        b.style.color = isActive ? 'var(--text-primary)' : 'var(--text-secondary)';
    });
    if (state.loading) {
        document.getElementById('fc-load').disabled = true;
        document.getElementById('fc-load').textContent = 'Đang tải...';
        document.getElementById('fc-stop').style.display = 'inline-flex';
    }
    renderList();
    updateSelCount();
}

// ─── Events ───────────────────────────────────────────────
function bindEvents() {
    document.getElementById('fc-profile').addEventListener('change', e => {
        state.selectedProfile = e.target.value;
    });

    document.getElementById('fc-load').addEventListener('click', loadList);
    document.getElementById('fc-stop').addEventListener('click', stopStream);

    // Window size save
    document.getElementById('fc-win-save').addEventListener('click', async () => {
        const w = parseInt(document.getElementById('fc-win-width').value)  || 1280;
        const h = parseInt(document.getElementById('fc-win-height').value) || 900;
        try {
            await followApi.saveWindowSize(w, h);
            const saved = document.getElementById('fc-win-saved');
            saved.style.display = 'inline';
            setTimeout(() => { saved.style.display = 'none'; }, 2000);
        } catch (err) {
            toast('Lỗi lưu: ' + err.message, 'error');
        }
    });

    document.querySelectorAll('.fc-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const newTab = btn.dataset.tab;
            if (newTab === state.activeTab) return;

            // Dừng stream đang chạy và lưu data tab hiện tại vào cache
            if (_activeStream) {
                _activeStream.close();
                _activeStream = null;
                state.loading = false;
                document.getElementById('fc-load').disabled = false;
                document.getElementById('fc-load').textContent = 'Tải danh sách';
                document.getElementById('fc-stop').style.display = 'none';
            }
            state.cache[state.activeTab] = {
                users: [...state.users],
                xUsername: state.xUsername,
                selected: new Set(state.selected),
            };

            // Chuyển sang tab mới
            state.activeTab = newTab;
            document.querySelectorAll('.fc-tab').forEach(b => {
                b.style.borderBottomColor = 'transparent';
                b.style.color = 'var(--text-secondary)';
            });
            btn.style.borderBottomColor = 'var(--accent)';
            btn.style.color = 'var(--text-primary)';

            // Restore cache nếu có, ngược lại hiện empty state
            const cached = state.cache[newTab];
            if (cached && cached.users.length > 0) {
                state.users = cached.users;
                state.xUsername = cached.xUsername;
                state.selected = cached.selected;
                document.getElementById(`fc-${newTab}-count`).textContent = state.users.length;
                if (state.xUsername) {
                    const label = newTab === 'following' ? 'Đang theo dõi' : 'Người theo dõi';
                    document.getElementById('fc-xuser').textContent = `@${state.xUsername} — ${label}`;
                }
                document.getElementById('fc-table-header').style.display = 'block';
                renderList();
                updateSelCount();
            } else {
                state.users = [];
                state.selected = new Set();
                state.xUsername = null;
                document.getElementById('fc-xuser').textContent = '';
                document.getElementById(`fc-following-count`).textContent = '';
                document.getElementById(`fc-followers-count`).textContent = '';
                document.getElementById('fc-table-header').style.display = 'none';
                document.getElementById('fc-list').innerHTML =
                    '<div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">Chọn profile và nhấn <strong>Tải danh sách</strong></div>';
                updateSelCount();
            }
        });
    });

    document.getElementById('fc-search').addEventListener('input', e => {
        state.search = e.target.value.toLowerCase();
        renderList();
    });

    document.getElementById('fc-filter-follows-back').addEventListener('change', e => {
        state.filterFollowsBack = e.target.checked;
        if (e.target.checked) { state.filterNotFollowBack = false; document.getElementById('fc-filter-not-follow-back').checked = false; }
        renderList();
    });

    document.getElementById('fc-filter-not-follow-back').addEventListener('change', e => {
        state.filterNotFollowBack = e.target.checked;
        if (e.target.checked) { state.filterFollowsBack = false; document.getElementById('fc-filter-follows-back').checked = false; }
        renderList();
    });

    document.getElementById('fc-filter-blue').addEventListener('change', e => {
        state.filterBlue = e.target.checked;
        if (e.target.checked) { state.filterGold = false; document.getElementById('fc-filter-gold').checked = false; }
        renderList();
    });

    document.getElementById('fc-filter-gold').addEventListener('change', e => {
        state.filterGold = e.target.checked;
        if (e.target.checked) { state.filterBlue = false; document.getElementById('fc-filter-blue').checked = false; }
        renderList();
    });

    document.getElementById('fc-select-all').addEventListener('change', e => {
        state.users.filter(u => userPassesFilter(u) && userPassesFollowFilter(u)).forEach(u => {
            if (e.target.checked) state.selected.add(u.username);
            else state.selected.delete(u.username);
        });
        renderList();
        updateSelCount();
    });

    document.getElementById('fc-unfollow-btn').addEventListener('click', doUnfollow);

    document.getElementById('fc-unfollow-stop').addEventListener('click', () => {
        _unfollowStop = true;
    });

    document.getElementById('fc-log-clear').addEventListener('click', () => {
        const el = document.getElementById('fc-logs');
        if (!el) return;
        el.innerHTML = '<div id="fc-logs-empty" style="color:var(--text-muted)">Chưa có logs</div>';
    });
}

// ─── Stop single stream ───────────────────────────────────
function stopStream() {
    if (_activeStream) { _activeStream.close(); _activeStream = null; }
    state.loading = false;
    document.getElementById('fc-load').disabled = false;
    document.getElementById('fc-load').textContent = 'Tải danh sách';
    document.getElementById('fc-stop').style.display = 'none';
    addLog(`Đã dừng tải (${state.users.length} người đã tải)`, 'warn');
    toast('Đã dừng tải danh sách', 'info');
}

// ─── Load single profile via SSE ─────────────────────────
function loadList() {
    if (!state.selectedProfile) { toast('Chọn profile trước', 'error'); return; }
    if (state.loading) return;

    if (_activeStream) { _activeStream.close(); _activeStream = null; }

    state.loading = true;
    state.users = [];
    state.selected.clear();
    state.cache[state.activeTab] = null; // xóa cache cũ khi load mới

    const loadBtn = document.getElementById('fc-load');
    const stopBtn = document.getElementById('fc-stop');
    const tabLabel = state.activeTab === 'following' ? 'đang theo dõi' : 'người theo dõi';

    loadBtn.disabled = true;
    loadBtn.textContent = 'Đang tải...';
    stopBtn.style.display = 'inline-flex';
    document.getElementById('fc-table-header').style.display = 'none';
    document.getElementById('fc-list').innerHTML = `
        <div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">
            ⏳ Đang mở danh sách ${tabLabel}...<br>
            <span style="font-size:11px;margin-top:6px;display:block">Kết quả hiển thị dần từng người</span>
        </div>`;
    document.getElementById('fc-xuser').textContent = '';

    const url = `/api/follow/stream?profileId=${encodeURIComponent(state.selectedProfile)}&type=${state.activeTab}`;
    const es = new EventSource(url);
    _activeStream = es;

    es.addEventListener('meta', e => {
        const d = JSON.parse(e.data);
        state.xUsername = d.xUsername;
        const label = state.activeTab === 'following' ? 'Đang theo dõi' : 'Người theo dõi';
        document.getElementById('fc-xuser').textContent = `@${d.xUsername} — ${label}`;
        document.getElementById('fc-table-header').style.display = 'block';
        document.getElementById('fc-list').innerHTML = '';
        addLog(`Bắt đầu tải ${label} của @${d.xUsername}`);
    });

    es.addEventListener('user', e => {
        const u = JSON.parse(e.data);
        u.following = null; u.followers = null; u.followsYou = null;
        state.users.push(u);
        document.getElementById(`fc-${state.activeTab}-count`).textContent = state.users.length;
        if (userPassesFilter(u)) appendUserRow(u);
        updateResultCount();
        const tick = u.verifiedType ? ` [${u.verifiedType}]` : '';
        addLog(`  #${state.users.length} @${u.username}${tick}`);
    });

    es.addEventListener('stats', e => {
        const d = JSON.parse(e.data);
        const u = state.users.find(x => x.username === d.username);
        if (u) { u.following = d.following; u.followers = d.followers; u.followsYou = d.followsYou; }
        updateStatsRow(d.username, d.following, d.followers, d.followsYou);
        // Ẩn/hiện row dựa theo filter follow
        const row = document.getElementById(`fc-row-${CSS.escape(d.username)}`);
        if (row && u) {
            const show = userPassesFollowFilter(u);
            row.style.display = show ? '' : 'none';
        }
        updateResultCount();
        const fy = d.followsYou === true ? 'có follow lại' : d.followsYou === false ? 'không follow lại' : '?';
        addLog(`    → following=${formatCount(d.following)} followers=${formatCount(d.followers)} — ${fy}`);
    });

    es.addEventListener('done', e => {
        const d = JSON.parse(e.data);
        addLog(`Hoàn thành: ${d.total || state.users.length} người`, 'success');
        toast(`Hoàn thành: ${d.total || state.users.length} người`, 'success');
        finishSingle();
        es.close();
        _activeStream = null;
    });

    es.addEventListener('error', e => {
        let msg = 'Kết nối bị đóng';
        try { const d = JSON.parse(e.data); msg = d.message || msg; } catch {}
        addLog(`Lỗi: ${msg}`, 'error');
        toast(msg, 'error');
        finishSingle();
        es.close();
        _activeStream = null;
    });
}

function finishSingle() {
    state.loading = false;
    document.getElementById('fc-load').disabled = false;
    document.getElementById('fc-load').textContent = 'Tải danh sách';
    document.getElementById('fc-stop').style.display = 'none';
    if (state.users.length === 0) {
        document.getElementById('fc-list').innerHTML =
            '<div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">Không có dữ liệu</div>';
    }
}

// ─── Table helpers ────────────────────────────────────────
function appendUserRow(u) {
    const list = document.getElementById('fc-list');
    const tmp = document.createElement('div');
    tmp.innerHTML = userRowHtml(u);
    const row = tmp.firstElementChild; // outer wrapper div (id=fc-row-*)
    list.appendChild(row);
    const cb = row.querySelector('.fc-user-check');
    if (cb) cb.addEventListener('change', onCheckboxChange);
}

function onCheckboxChange(e) {
    const username = e.target.dataset.username;
    if (e.target.checked) state.selected.add(username);
    else state.selected.delete(username);
    // fc-row-* is the outer wrapper div
    const row = document.getElementById(`fc-row-${CSS.escape(username)}`);
    if (row) row.style.background = e.target.checked ? 'rgba(88,166,255,0.07)' : '';
    updateSelCount();
}

function updateStatsRow(username, following, followers, followsYou) {
    const fEl  = document.getElementById(`fc-col-following-${CSS.escape(username)}`);
    const rEl  = document.getElementById(`fc-col-followers-${CSS.escape(username)}`);
    const fyEl = document.getElementById(`fc-col-followsyou-${CSS.escape(username)}`);
    if (fEl)  fEl.textContent  = following  !== null ? formatCount(following)  : '—';
    if (rEl)  rEl.textContent  = followers  !== null ? formatCount(followers)  : '—';
    if (fyEl) fyEl.innerHTML   = followsYou
        ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(88,166,255,.15)"><svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="1,6 5,10 11,2" stroke="#58a6ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
        : `<span style="color:var(--text-muted);font-size:11px">—</span>`;
}

function userPassesFilter(u) {
    if (state.search) {
        const q = state.search;
        if (!u.username.toLowerCase().includes(q) && !(u.displayName || '').toLowerCase().includes(q)) return false;
    }
    if (state.filterBlue && u.verifiedType !== 'blue') return false;
    if (state.filterGold && u.verifiedType !== 'gold') return false;
    return true;
}

function userPassesFollowFilter(u) {
    if (state.filterFollowsBack && !u.followsYou) return false;
    // "Chưa follow lại": stats đã load (followsYou không phải null) và = false
    if (state.filterNotFollowBack) {
        if (u.followsYou === null) return false; // chưa load stats — ẩn tạm
        if (u.followsYou === true) return false;
    }
    return true;
}

function renderList() {
    const list = document.getElementById('fc-list');
    if (!list) return;
    if (state.users.length === 0) {
        list.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text-muted);font-size:13px">Chưa có dữ liệu</div>`;
        return;
    }
    list.innerHTML = '';
    for (const u of state.users) {
        if (!userPassesFilter(u)) continue;
        if (!userPassesFollowFilter(u)) continue;
        const div = document.createElement('div');
        div.innerHTML = userRowHtml(u);
        const row = div.firstElementChild;
        list.appendChild(row);
        const cb = row.querySelector('.fc-user-check');
        if (cb) cb.addEventListener('change', onCheckboxChange);
    }
    updateResultCount();
}

function updateResultCount() {
    const el = document.getElementById('fc-result-count');
    if (!el) return;
    const visible = document.querySelectorAll('#fc-list > div[id^="fc-row-"]:not([style*="display: none"])').length;
    el.textContent = state.users.length > 0 ? `Hiển thị ${visible} / ${state.users.length}` : '';
}

function updateSelCount() {
    const n = state.selected.size;
    const countEl = document.getElementById('fc-sel-count');
    const btn = document.getElementById('fc-unfollow-btn');
    const numEl = document.getElementById('fc-sel-num');
    if (!countEl) return;
    if (n > 0) {
        countEl.textContent = `Đã chọn ${n}`;
        btn.style.display = 'inline-flex';
        numEl.textContent = n;
    } else {
        countEl.textContent = '';
        btn.style.display = 'none';
    }
}

function userRowHtml(u) {
    const isSelected = state.selected.has(u.username);
    const avatarColor = strToColor(u.username);
    const initials = (u.displayName || u.username).substring(0, 2).toUpperCase();
    const avatarHtml = u.avatarUrl
        ? `<img src="${escHtml(u.avatarUrl)}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">`
        : initialsAvatar(initials, avatarColor);

    const followingStr = u.following !== null && u.following !== undefined ? formatCount(u.following) : '—';
    const followersStr = u.followers !== null && u.followers !== undefined ? formatCount(u.followers) : '—';

    const followsYouHtml = u.followsYou === null
        ? `<span style="color:var(--text-muted);font-size:11px">...</span>`
        : u.followsYou
            ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:rgba(88,166,255,.15)"><svg viewBox="0 0 12 12" width="11" height="11" fill="none"><polyline points="1,6 5,10 11,2" stroke="#58a6ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
            : `<span style="color:var(--text-muted);font-size:11px">—</span>`;

    const tickHtml = u.verifiedType === 'blue' ? svgBlueTick()
        : u.verifiedType === 'gold' ? svgGoldTick()
        : `<span style="color:var(--text-muted);font-size:11px">—</span>`;

    return `<div id="fc-row-${escAttr(u.username)}" style="border-bottom:1px solid var(--border);${isSelected ? 'background:rgba(88,166,255,0.07)' : ''}"><div style="display:grid;grid-template-columns:36px 1fr 100px 100px 110px 70px;gap:8px;align-items:center;padding:9px 20px;box-sizing:border-box;width:100%"><div style="display:flex;align-items:center;justify-content:center"><input type="checkbox" class="fc-user-check" data-username="${escAttr(u.username)}" ${isSelected ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer;accent-color:var(--accent)"></div><div style="display:flex;align-items:center;gap:10px;min-width:0">${avatarHtml}<div style="min-width:0"><div style="font-size:13px;font-weight:500"><a href="https://x.com/${escAttr(u.username)}" target="_blank" style="color:var(--text-primary);text-decoration:none;max-width:200px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(u.displayName || u.username)}">${escHtml(u.displayName || u.username)}</a></div><div style="font-size:11px;color:var(--text-secondary);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">@${escHtml(u.username)}</div></div></div><div id="fc-col-following-${escAttr(u.username)}" style="text-align:right;font-size:12px;color:var(--text-secondary)">${followingStr}</div><div id="fc-col-followers-${escAttr(u.username)}" style="text-align:right;font-size:12px;color:var(--text-secondary)">${followersStr}</div><div id="fc-col-followsyou-${escAttr(u.username)}" style="display:flex;align-items:center;justify-content:center">${followsYouHtml}</div><div style="display:flex;align-items:center;justify-content:center">${tickHtml}</div></div></div>`;
}

// ─── Log panel ───────────────────────────────────────────
function addLog(msg, level = 'info') {
    const el = document.getElementById('fc-logs');
    if (!el) return;
    const empty = document.getElementById('fc-logs-empty');
    if (empty) empty.remove();
    const color = level === 'error' ? '#f87171' : level === 'success' ? '#4ade80' : level === 'warn' ? '#fbbf24' : 'var(--text-secondary)';
    const time = new Date().toLocaleTimeString('vi-VN');
    const row = document.createElement('div');
    row.style.cssText = `color:${color};margin-bottom:1px;white-space:pre-wrap;word-break:break-all`;
    row.textContent = `[${time}] ${msg}`;
    el.appendChild(row);
    while (el.children.length > 300) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
}

// ─── Unfollow ────────────────────────────────────────────
async function doUnfollow() {
    const usernames = Array.from(state.selected);
    if (usernames.length === 0) return;

    const batchSize = Math.max(1, parseInt(document.getElementById('fc-batch-size')?.value) || 10);
    const delaySec  = Math.max(0, parseInt(document.getElementById('fc-delay-sec')?.value)  || 30);
    const batches = [];
    for (let i = 0; i < usernames.length; i += batchSize) batches.push(usernames.slice(i, i + batchSize));

    if (!confirm(`Bỏ theo dõi ${usernames.length} tài khoản? (${batches.length} lần, nghỉ ${delaySec}s giữa mỗi lần)`)) return;

    _unfollowStop = false;
    const btn  = document.getElementById('fc-unfollow-btn');
    const stop = document.getElementById('fc-unfollow-stop');
    btn.disabled = true;
    btn.innerHTML = 'Đang xử lý...';
    stop.style.display = 'inline-flex';

    addLog(`Bắt đầu bỏ theo dõi ${usernames.length} người (${batches.length} lần × ${batchSize}, nghỉ ${delaySec}s)`, 'info');

    let totalDone = 0;
    try {
        for (let i = 0; i < batches.length; i++) {
            if (_unfollowStop) { addLog('Đã dừng unfollow', 'warn'); break; }
            const batch = batches[i];
            addLog(`Lần ${i + 1}/${batches.length}: bỏ theo dõi ${batch.length} người...`);
            try {
                const res = await followApi.unfollow(state.selectedProfile, batch);
                const done = new Set(res.unfollowed || []);
                totalDone += done.size;
                if (done.size) addLog(`  ✓ Thành công: ${[...done].join(', ')}`, 'success');
                if (res.failed?.length) addLog(`  ✗ Thất bại: ${res.failed.join(', ')}`, 'error');
                state.users = state.users.filter(u => !done.has(u.username));
                state.selected = new Set([...state.selected].filter(u => !done.has(u)));
                state.cache[state.activeTab] = null;
                renderList();
                updateSelCount();
                document.getElementById(`fc-${state.activeTab}-count`).textContent = state.users.length;
            } catch (err) {
                addLog(`  Lỗi lần ${i + 1}: ${err.message}`, 'error');
            }

            if (i < batches.length - 1 && !_unfollowStop) {
                addLog(`Nghỉ ${delaySec} giây...`, 'warn');
                await new Promise(r => setTimeout(r, delaySec * 1000));
            }
        }
        addLog(`Hoàn thành: đã bỏ theo dõi ${totalDone} người`, 'success');
        toast(`Đã bỏ theo dõi ${totalDone} tài khoản`, 'success');
    } finally {
        btn.disabled = false;
        stop.style.display = 'none';
        updateSelCount();
    }
}

// ─── Helpers ─────────────────────────────────────────────
function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
    return String(str || '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatCount(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0','') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0','') + 'K';
    return n.toLocaleString();
}
function initialsAvatar(initials, colorStyle) {
    return `<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;${colorStyle}">${initials}</div>`;
}
const AVATAR_COLORS = [
    'background:#1d4ed8;color:#93c5fd','background:#166534;color:#86efac',
    'background:#7c2d12;color:#fca5a5','background:#4c1d95;color:#c4b5fd',
    'background:#134e4a;color:#5eead4','background:#713f12;color:#fde68a',
    'background:#831843;color:#fbcfe8','background:#1e3a5f;color:#93c5fd',
];
function strToColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function svgBlueTick() {
    return `<svg viewBox="0 0 22 22" width="15" height="15" style="vertical-align:-2px"><path fill="#1d9bf0" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>`;
}
function svgGoldTick() {
    return `<svg viewBox="0 0 22 22" width="15" height="15" style="vertical-align:-2px"><path fill="#FFD400" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>`;
}

export function destroy() {
    // Chỉ đóng stream — giữ data để restore khi quay lại
    if (_activeStream) { _activeStream.close(); _activeStream = null; }
}
