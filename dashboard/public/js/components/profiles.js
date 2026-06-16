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
                            <th>Status</th>
                            <th style="width:60px"></th>
                        </tr>
                    </thead>
                    <tbody id="profiles-tbody">
                        <tr><td colspan="5" style="color:var(--text-muted)">Đang tải...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

export async function init() {
    await loadProfiles();

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

    tbody.innerHTML = filtered.map((p, i) => `
        <tr data-profile-id="${p.genlogin_id}">
            <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
            <td style="font-family:var(--mono);font-size:12px">${p.genlogin_id}</td>
            <td>${p.username || '—'}</td>
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
        </tr>
    `).join('');
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
