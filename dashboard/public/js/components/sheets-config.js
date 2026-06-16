/**
 * Sheets Config Component — Google Sheets reporting settings
 * Dùng OAuth2: user authorize qua trình duyệt 1 lần, sau đó tự động
 */
import { api } from '../api.js';
import { toast } from '../app.js';

export function render() {
    return `
        <div class="page-header">
            <h2>Google Sheets</h2>
            <p>Cấu hình báo cáo tự động lên Google Sheets</p>
        </div>

        <!-- Auth Status -->
        <div class="card" id="auth-card">
            <h3 style="margin-bottom:12px">Bước 1: Đăng nhập Google</h3>
            <div id="auth-status" style="margin-bottom:12px">
                <span style="color:var(--text-muted)">Đang kiểm tra...</span>
            </div>
            <div id="auth-actions" style="display:none">
                <button class="btn btn-primary" id="auth-btn">Authorize Google Sheets</button>
            </div>
            <div id="auth-code-panel" style="display:none;margin-top:12px">
                <p style="color:var(--text-secondary);margin-bottom:8px">
                    1. Bấm nút trên → mở trang Google đăng nhập<br>
                    2. Cho phép quyền truy cập Google Sheets<br>
                    3. Copy <strong>authorization code</strong> từ trang redirect<br>
                    4. Paste code vào ô bên dưới → bấm "Xác nhận"
                </p>
                <div style="display:flex;gap:8px;align-items:center">
                    <input type="text" class="form-control" id="auth-code-input"
                           placeholder="Paste authorization code tại đây..." style="flex:1">
                    <button class="btn btn-primary" id="auth-code-submit">Xác nhận</button>
                </div>
                <div id="auth-code-result" style="margin-top:8px"></div>
            </div>
        </div>

        <!-- Config -->
        <div class="card" style="margin-top:16px">
            <h3 style="margin-bottom:12px">Bước 2: Cấu hình</h3>
            <form id="sheets-form">
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="sheets-enabled"> Bật báo cáo Google Sheets
                    </label>
                </div>

                <div class="form-group">
                    <label>Spreadsheet ID</label>
                    <input type="text" class="form-control" id="sheets-id"
                           placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms">
                    <div class="form-hint">Lấy từ URL Google Sheet: docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit</div>
                </div>

                <div class="form-group">
                    <label>Credentials File Path</label>
                    <input type="text" class="form-control" id="sheets-creds"
                           placeholder="./google-credentials.json">
                    <div class="form-hint">Đường dẫn tới file JSON OAuth2 credentials (dạng "installed" từ Google Cloud Console)</div>
                </div>

                <div class="form-group">
                    <label>Sheet Name</label>
                    <input type="text" class="form-control" id="sheets-name"
                           placeholder="Farming Report" style="width:300px">
                    <div class="form-hint">Tên sheet (tab) trong Google Sheets. Sẽ tự tạo nếu chưa có.</div>
                </div>

                <div style="display:flex;gap:10px;margin-top:16px">
                    <button type="submit" class="btn btn-primary">Lưu cấu hình</button>
                    <button type="button" class="btn btn-outline" id="sheets-test-btn">Test Connection</button>
                </div>
            </form>

            <div id="sheets-test-result" style="margin-top:12px"></div>
        </div>

        <div class="card" style="margin-top:16px">
            <h3 style="margin-bottom:12px">Hướng dẫn cài đặt</h3>
            <ol style="line-height:2;color:var(--text-secondary)">
                <li>Vào <a href="https://console.cloud.google.com" target="_blank" style="color:var(--primary)">Google Cloud Console</a> → chọn/tạo Project</li>
                <li>Bật <strong>Google Sheets API</strong> trong APIs & Services → Library</li>
                <li>Vào APIs & Services → <strong>Credentials</strong> → Create Credentials → <strong>OAuth client ID</strong></li>
                <li>Application type: <strong>Desktop app</strong> → Create → <strong>Download JSON</strong></li>
                <li>Đặt file JSON vào thư mục project, đặt tên <code>google-credentials.json</code></li>
                <li>Vào form trên → bấm <strong>Authorize</strong> → đăng nhập Google → paste code</li>
                <li>Tạo Google Sheet → copy <strong>Spreadsheet ID</strong> từ URL → paste vào form</li>
                <li>Bấm <strong>Test Connection</strong> → <strong>Lưu</strong></li>
            </ol>
        </div>
    `;
}

export async function init() {
    // Load config
    try {
        const config = await api.getConfig();
        const gs = config.google_sheets || {};

        const enabledEl = document.getElementById('sheets-enabled');
        if (enabledEl) enabledEl.checked = !!gs.enabled;
        setVal('sheets-id', gs.spreadsheet_id || '');
        setVal('sheets-creds', gs.credentials_path || './google-credentials.json');
        setVal('sheets-name', gs.sheet_name || 'Farming Report');
    } catch (err) {
        toast('Lỗi tải config: ' + err.message, 'error');
    }

    // Check auth status
    await checkAuthStatus();

    // Event listeners
    document.getElementById('sheets-form').addEventListener('submit', handleSave);
    document.getElementById('sheets-test-btn').addEventListener('click', handleTest);
    document.getElementById('auth-btn')?.addEventListener('click', handleAuthorize);
    document.getElementById('auth-code-submit')?.addEventListener('click', handleCodeSubmit);
}

async function checkAuthStatus() {
    const statusEl = document.getElementById('auth-status');
    const actionsEl = document.getElementById('auth-actions');
    const codePanelEl = document.getElementById('auth-code-panel');

    try {
        const result = await api.getSheetsStatus();
        if (result.authorized) {
            statusEl.innerHTML = '<span style="color:var(--success)">✓ Đã đăng nhập Google Sheets</span>';
            actionsEl.style.display = 'block';
            document.getElementById('auth-btn').textContent = 'Re-authorize (đăng nhập lại)';
            codePanelEl.style.display = 'none';
        } else {
            statusEl.innerHTML = '<span style="color:var(--warning)">⚠ Chưa đăng nhập. Bấm "Authorize" để bắt đầu.</span>';
            actionsEl.style.display = 'block';
        }
    } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${err.message}</span>`;
        actionsEl.style.display = 'block';
    }
}

async function handleAuthorize() {
    try {
        // Save credentials path trước
        await api.updateSheets({
            credentials_path: getVal('sheets-creds'),
        });

        const result = await api.getSheetsAuthUrl();
        // Mở URL trong tab mới
        window.open(result.authUrl, '_blank');

        // Hiện panel nhập code
        document.getElementById('auth-code-panel').style.display = 'block';
        document.getElementById('auth-code-input').focus();
    } catch (err) {
        toast('Lỗi: ' + err.message, 'error');
    }
}

async function handleCodeSubmit() {
    const code = getVal('auth-code-input').trim();
    const resultEl = document.getElementById('auth-code-result');

    if (!code) {
        resultEl.innerHTML = '<span style="color:var(--danger)">Chưa nhập code</span>';
        return;
    }

    resultEl.innerHTML = '<span style="color:var(--text-muted)">Đang xác thực...</span>';

    try {
        await api.sheetsAuthCallback(code);
        resultEl.innerHTML = '<span style="color:var(--success)">✓ Authorize thành công!</span>';
        // Refresh auth status
        await checkAuthStatus();
        toast('Đã đăng nhập Google Sheets thành công!', 'success');
    } catch (err) {
        resultEl.innerHTML = `<span style="color:var(--danger)">✗ ${err.message}</span>`;
    }
}

async function handleSave(e) {
    e.preventDefault();
    try {
        await api.updateSheets({
            enabled: document.getElementById('sheets-enabled').checked,
            spreadsheet_id: getVal('sheets-id'),
            credentials_path: getVal('sheets-creds'),
            sheet_name: getVal('sheets-name'),
        });
        toast('Đã lưu cấu hình Google Sheets', 'success');
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function handleTest() {
    const resultEl = document.getElementById('sheets-test-result');
    resultEl.innerHTML = '<span style="color:var(--text-muted)">Đang test kết nối...</span>';

    try {
        // Save config trước khi test
        await api.updateSheets({
            enabled: document.getElementById('sheets-enabled').checked,
            spreadsheet_id: getVal('sheets-id'),
            credentials_path: getVal('sheets-creds'),
            sheet_name: getVal('sheets-name'),
        });

        const result = await api.testSheets();
        resultEl.innerHTML = `
            <div style="color:var(--success);padding:8px 12px;background:rgba(52,211,153,0.1);border-radius:6px">
                ✓ Kết nối thành công!<br>
                <span style="color:var(--text-secondary)">
                    Spreadsheet: <strong>${result.title}</strong> |
                    Sheet: <strong>${result.sheetName}</strong> |
                    Rows: ${result.rowCount}
                </span>
            </div>
        `;
    } catch (err) {
        resultEl.innerHTML = `
            <div style="color:var(--danger);padding:8px 12px;background:rgba(239,68,68,0.1);border-radius:6px">
                ✗ Lỗi: ${err.message}
            </div>
        `;
    }
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}
