/**
 * Profiles Component — Profile management table + import + bulk actions
 */
import { api } from '../api.js';
import { toast } from '../app.js';

let allProfiles = [];
let searchQuery = '';

export function render() {
    return `
        <div class="page-header">
            <h2>X Profiles</h2>
            <p>Quản lý GenLogin profiles cho farming X/Twitter</p>
        </div>

        <!-- Import Panel -->
        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <h3 style="margin:0">Import Profiles</h3>
                <button class="btn btn-outline btn-sm" id="toggle-import-btn">Mở Import</button>
            </div>
            <div id="import-panel" style="display:none;margin-top:12px">
                <div class="form-group">
                    <label>Paste danh sách profiles (mỗi dòng: <code>genlogin_id|tên</code>)</label>
                    <textarea class="form-control" id="import-text" rows="6"
                              placeholder="25810292|Profile 0001&#10;25810291|Profile 0002&#10;25810290|Profile 0003"></textarea>
                </div>
                <div style="display:flex;gap:10px;align-items:center">
                    <button class="btn btn-primary btn-sm" id="import-btn">Import</button>
                    <span id="import-result" style="color:var(--text-muted);font-size:13px"></span>
                </div>
            </div>
        </div>

        <!-- Profiles Table -->
        <div class="card">
            <div class="toolbar-actions">
                <div class="toolbar-left">
                    <h3 style="margin:0">Profiles (<span id="profiles-count">0</span>)</h3>
                    <div class="toolbar-stats">
                        <span class="badge badge-success" id="profiles-enabled-count">0 enabled</span>
                        <span class="badge badge-muted" id="profiles-disabled-count">0 disabled</span>
                    </div>
                </div>
                <div class="toolbar-right">
                    <input type="text" class="form-control search-input" id="profiles-search"
                           placeholder="Tìm kiếm..." style="width:180px;padding:5px 10px;font-size:12px">
                    <button class="btn btn-sm btn-success" id="btn-enable-all" title="Enable tất cả">✓ Enable All</button>
                    <button class="btn btn-sm btn-outline" id="btn-disable-all" title="Disable tất cả">✗ Disable All</button>
                    <button class="btn btn-sm btn-outline-danger" id="btn-delete-all" title="Xóa tất cả">🗑 Delete All</button>
                </div>
            </div>
            <div class="table-wrap" style="margin-top:12px">
                <table>
                    <thead>
                        <tr>
                            <th style="width:40px">#</th>
                            <th>GenLogin ID</th>
                            <th>Username</th>
                            <th>Config</th>
                            <th>Status</th>
                            <th style="width:60px"></th>
                        </tr>
                    </thead>
                    <tbody id="profiles-tbody">
                        <tr><td colspan="6" style="color:var(--text-muted)">Đang tải...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Per-profile Farming Config Modal -->
        <div id="farming-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;overflow-y:auto">
            <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:10px;width:560px;max-width:95vw;margin:40px auto;padding:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="margin:0">Farming Config — <span id="fm-profile-label" style="color:var(--accent);font-family:var(--mono)"></span></h3>
                    <button class="btn btn-sm btn-outline" id="fm-close">✕ Đóng</button>
                </div>

                <div style="margin-bottom:14px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--text-muted)">
                    <label class="toggle" style="display:flex;align-items:center;gap:10px;cursor:pointer">
                        <input type="checkbox" id="fm-use-custom">
                        <span class="slider"></span>
                        <span>Dùng cấu hình riêng (bỏ chọn = dùng Farming Config mặc định)</span>
                    </label>
                </div>

                <div id="fm-fields" style="opacity:0.4;pointer-events:none">
                    <div class="form-row">
                        <div class="form-group">
                            <label style="font-size:12px">Chế độ</label>
                            <select class="form-control" id="fm-mode" style="font-size:12px">
                                <option value="newsfeed">Newsfeed</option>
                                <option value="hashtag">Hashtag</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label style="font-size:12px">Số vòng lặp</label>
                            <input type="number" class="form-control" id="fm-loops" min="1" style="font-size:12px">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label style="font-size:12px">Interact probability (0-1)</label>
                            <input type="number" class="form-control" id="fm-prob" min="0" max="1" step="0.05" style="font-size:12px">
                        </div>
                        <div class="form-group">
                            <label style="font-size:12px">Max tương tác/loop (0=không giới hạn)</label>
                            <input type="number" class="form-control" id="fm-max-interacts" min="0" style="font-size:12px">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label style="font-size:12px">Max tweets/loop</label>
                            <input type="number" class="form-control" id="fm-max-tweets" min="1" style="font-size:12px">
                        </div>
                        <div class="form-group">
                            <label style="font-size:12px">Language filter</label>
                            <select class="form-control" id="fm-lang" style="font-size:12px">
                                <option value="">Tất cả</option>
                                <option value="vi">Chỉ tiếng Việt</option>
                                <option value="en">Chỉ tiếng Anh</option>
                                <option value="vi+en">Việt + Anh</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label style="font-size:12px">Scroll duration (giây)</label>
                            <input type="number" class="form-control" id="fm-scroll" min="5" style="font-size:12px">
                        </div>
                        <div class="form-group">
                            <label style="font-size:12px">Min/Max delay actions (ms)</label>
                            <div style="display:flex;gap:6px">
                                <input type="number" class="form-control" id="fm-min-action" min="500" placeholder="Min" style="font-size:12px">
                                <input type="number" class="form-control" id="fm-max-action" min="1000" placeholder="Max" style="font-size:12px">
                            </div>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label style="font-size:12px">Min/Max delay loops (ms)</label>
                            <div style="display:flex;gap:6px">
                                <input type="number" class="form-control" id="fm-min-loop" min="5000" placeholder="Min" style="font-size:12px">
                                <input type="number" class="form-control" id="fm-max-loop" min="10000" placeholder="Max" style="font-size:12px">
                            </div>
                        </div>
                    </div>
                </div>

                <div style="display:flex;gap:10px;margin-top:16px">
                    <button class="btn btn-primary" id="fm-save">Lưu</button>
                    <button class="btn btn-outline-danger btn-sm" id="fm-reset">Reset về mặc định</button>
                </div>
            </div>
        </div>
    `;
}

export async function init() {
    await loadProfiles();
    _initModal();

    // Toggle import panel
    document.getElementById('toggle-import-btn').addEventListener('click', () => {
        const panel = document.getElementById('import-panel');
        const btn = document.getElementById('toggle-import-btn');
        if (panel.style.display === 'none') {
            panel.style.display = 'block';
            btn.textContent = 'Đóng';
        } else {
            panel.style.display = 'none';
            btn.textContent = 'Mở Import';
        }
    });

    // Import button
    document.getElementById('import-btn').addEventListener('click', handleImport);

    // Bulk actions
    document.getElementById('btn-enable-all').addEventListener('click', handleEnableAll);
    document.getElementById('btn-disable-all').addEventListener('click', handleDisableAll);
    document.getElementById('btn-delete-all').addEventListener('click', handleDeleteAll);

    // Search
    document.getElementById('profiles-search').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderTable();
    });
}

async function loadProfiles() {
    try {
        const data = await api.getProfiles();
        allProfiles = data.profiles || [];
        updateCounts();
        renderTable();
    } catch (err) {
        toast(err.message, 'error');
    }
}

function updateCounts() {
    const countEl = document.getElementById('profiles-count');
    const enabledEl = document.getElementById('profiles-enabled-count');
    const disabledEl = document.getElementById('profiles-disabled-count');
    if (!countEl) return;

    const enabled = allProfiles.filter(p => p.enabled !== false).length;
    const disabled = allProfiles.length - enabled;

    countEl.textContent = allProfiles.length;
    enabledEl.textContent = `${enabled} enabled`;
    disabledEl.textContent = `${disabled} disabled`;
}

function renderTable() {
    const tbody = document.getElementById('profiles-tbody');
    if (!tbody) return;

    const filtered = searchQuery
        ? allProfiles.filter(p =>
            (p.genlogin_id || '').toString().toLowerCase().includes(searchQuery) ||
            (p.username || '').toLowerCase().includes(searchQuery)
        )
        : allProfiles;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted)">${
            allProfiles.length === 0 ? 'Không có profiles. Import để bắt đầu.' : 'Không tìm thấy kết quả.'
        }</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((p, i) => {
        const hasCustom = p.farming && Object.keys(p.farming).length > 0;
        const configBadge = hasCustom
            ? `<span style="color:var(--warning);font-size:11px;font-weight:600">Tuỳ chỉnh</span>`
            : `<span style="color:var(--text-muted);font-size:11px">Mặc định</span>`;
        return `
        <tr data-profile-id="${p.genlogin_id}">
            <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
            <td style="font-family:var(--mono);font-size:12px">${p.genlogin_id}</td>
            <td>${p.username || '—'}</td>
            <td>
                ${configBadge}
                <button class="btn btn-sm btn-outline" style="padding:2px 8px;font-size:11px;margin-left:6px"
                        onclick="window.__openFarmingModal('${p.genlogin_id}')">Cài đặt</button>
            </td>
            <td>
                <label class="toggle">
                    <input type="checkbox" ${p.enabled !== false ? 'checked' : ''}
                           data-id="${p.genlogin_id}" onchange="window.__toggleProfile(this)">
                    <span class="slider"></span>
                </label>
            </td>
            <td>
                <button class="btn btn-danger btn-sm" style="padding:2px 8px;font-size:11px"
                        onclick="window.__deleteProfile('${p.genlogin_id}')">Xóa</button>
            </td>
        </tr>`;
    }).join('');
}

async function handleImport() {
    const text = document.getElementById('import-text').value;
    const resultEl = document.getElementById('import-result');

    if (!text.trim()) {
        toast('Không có dữ liệu để import', 'error');
        return;
    }

    try {
        resultEl.textContent = 'Đang import...';
        const result = await api.importProfiles(text);
        resultEl.innerHTML = `<span style="color:var(--success)">✓ Imported ${result.imported}, skipped ${result.skipped} duplicates (total: ${result.total})</span>`;
        document.getElementById('import-text').value = '';
        await loadProfiles();
    } catch (err) {
        resultEl.innerHTML = `<span style="color:var(--danger)">✗ ${err.message}</span>`;
    }
}

async function handleEnableAll() {
    try {
        const result = await api.enableAllProfiles();
        toast(`Đã enable ${result.changed} profiles`, 'success');
        await loadProfiles();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleDisableAll() {
    if (!confirm('Disable tất cả profiles?')) return;
    try {
        const result = await api.disableAllProfiles();
        toast(`Đã disable ${result.changed} profiles`, 'success');
        await loadProfiles();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleDeleteAll() {
    if (!confirm('⚠️ Xóa TẤT CẢ profiles? Hành động này không thể hoàn tác!')) return;
    if (!confirm('Xác nhận lần nữa: Xóa toàn bộ profiles?')) return;
    try {
        const result = await api.deleteAllProfiles();
        toast(`Đã xóa ${result.deleted} profiles`, 'success');
        await loadProfiles();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// Global handler cho toggle
window.__toggleProfile = async function(el) {
    const id = el.dataset.id;
    try {
        const result = await api.toggleProfile(id);
        // Update local state
        const profile = allProfiles.find(p => p.genlogin_id.toString() === id);
        if (profile) profile.enabled = result.enabled;
        updateCounts();
        toast(`Profile ${id}: ${result.enabled ? 'Enabled' : 'Disabled'}`, 'success');
    } catch (err) {
        toast(err.message, 'error');
        el.checked = !el.checked;
    }
};

// Global handler cho delete
window.__deleteProfile = async function(id) {
    if (!confirm(`Xóa profile ${id}?`)) return;
    try {
        await api.deleteProfile(id);
        toast(`Đã xóa profile ${id}`, 'success');
        await loadProfiles();
    } catch (err) {
        toast(err.message, 'error');
    }
};

// ─── Per-profile farming modal ─────────────────────────────────
let _modalProfileId = null;
let _globalFarming = null;

window.__openFarmingModal = async function(id) {
    _modalProfileId = id;
    const profile = allProfiles.find(p => p.genlogin_id.toString() === id);
    if (!profile) return;

    // Load global farming config nếu chưa có
    if (!_globalFarming) {
        try {
            const cfg = await api.getConfig();
            _globalFarming = cfg.farming || {};
        } catch { _globalFarming = {}; }
    }

    const hasCustom = profile.farming && Object.keys(profile.farming).length > 0;
    const src = hasCustom ? profile.farming : _globalFarming;

    document.getElementById('fm-profile-label').textContent = profile.username || id;
    document.getElementById('fm-use-custom').checked = hasCustom;
    _toggleFmFields(hasCustom);

    // Điền giá trị
    _fmSet('fm-mode', src.mode || 'newsfeed');
    _fmSet('fm-loops', src.loop_count ?? 3);
    _fmSet('fm-prob', src.interact_probability ?? 0.1);
    _fmSet('fm-max-interacts', src.max_interacts_per_loop ?? 0);
    _fmSet('fm-max-tweets', src.max_tweets_per_loop ?? 10);
    _fmSet('fm-lang', src.language_filter || '');
    _fmSet('fm-scroll', src.scroll_duration_seconds ?? 15);
    _fmSet('fm-min-action', src.min_delay_between_actions_ms ?? 3000);
    _fmSet('fm-max-action', src.max_delay_between_actions_ms ?? 8000);
    _fmSet('fm-min-loop', src.min_delay_between_loops_ms ?? 30000);
    _fmSet('fm-max-loop', src.max_delay_between_loops_ms ?? 60000);

    document.getElementById('farming-modal-overlay').style.display = 'block';
};

function _toggleFmFields(enabled) {
    const fields = document.getElementById('fm-fields');
    if (!fields) return;
    fields.style.opacity = enabled ? '1' : '0.4';
    fields.style.pointerEvents = enabled ? 'auto' : 'none';
}

function _fmSet(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function _fmGet(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function _initModal() {
    document.getElementById('fm-close').addEventListener('click', () => {
        document.getElementById('farming-modal-overlay').style.display = 'none';
    });

    document.getElementById('farming-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            e.currentTarget.style.display = 'none';
        }
    });

    document.getElementById('fm-use-custom').addEventListener('change', (e) => {
        _toggleFmFields(e.target.checked);
    });

    document.getElementById('fm-save').addEventListener('click', async () => {
        if (!_modalProfileId) return;
        const useCustom = document.getElementById('fm-use-custom').checked;
        if (!useCustom) {
            // Reset về mặc định
            try {
                await api.resetProfileFarming(_modalProfileId);
                const profile = allProfiles.find(p => p.genlogin_id.toString() === _modalProfileId);
                if (profile) delete profile.farming;
                toast('Đã reset về cấu hình mặc định', 'success');
                document.getElementById('farming-modal-overlay').style.display = 'none';
                renderTable();
            } catch (err) { toast(err.message, 'error'); }
            return;
        }

        const body = {
            mode: _fmGet('fm-mode'),
            loop_count: parseInt(_fmGet('fm-loops')) || 3,
            interact_probability: parseFloat(_fmGet('fm-prob')) || 0.1,
            max_interacts_per_loop: parseInt(_fmGet('fm-max-interacts')) || 0,
            max_tweets_per_loop: parseInt(_fmGet('fm-max-tweets')) || 10,
            language_filter: _fmGet('fm-lang'),
            scroll_duration_seconds: parseInt(_fmGet('fm-scroll')) || 15,
            min_delay_between_actions_ms: parseInt(_fmGet('fm-min-action')) || 3000,
            max_delay_between_actions_ms: parseInt(_fmGet('fm-max-action')) || 8000,
            min_delay_between_loops_ms: parseInt(_fmGet('fm-min-loop')) || 30000,
            max_delay_between_loops_ms: parseInt(_fmGet('fm-max-loop')) || 60000,
        };

        try {
            await api.saveProfileFarming(_modalProfileId, body);
            const profile = allProfiles.find(p => p.genlogin_id.toString() === _modalProfileId);
            if (profile) profile.farming = body;
            toast('Đã lưu cấu hình riêng', 'success');
            document.getElementById('farming-modal-overlay').style.display = 'none';
            renderTable();
        } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('fm-reset').addEventListener('click', async () => {
        if (!_modalProfileId) return;
        if (!confirm('Reset profile này về cấu hình Farming mặc định?')) return;
        try {
            await api.resetProfileFarming(_modalProfileId);
            const profile = allProfiles.find(p => p.genlogin_id.toString() === _modalProfileId);
            if (profile) delete profile.farming;
            document.getElementById('fm-use-custom').checked = false;
            _toggleFmFields(false);
            toast('Đã reset về cấu hình mặc định', 'success');
            document.getElementById('farming-modal-overlay').style.display = 'none';
            renderTable();
        } catch (err) { toast(err.message, 'error'); }
    });
}
