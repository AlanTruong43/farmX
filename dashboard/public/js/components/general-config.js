/**
 * General Config Component — Cấu hình chung áp dụng cho tất cả chế độ
 */
import { api } from '../api.js';
import { toast } from '../app.js';

export function render() {
    return `
        <div class="page-header">
            <h2>Cấu hình chung</h2>
            <p>Cài đặt đa luồng, delay — áp dụng cho cả X Farming và TG Buff View</p>
        </div>

        <div class="card">
            <form id="general-form">
                <h3 style="margin-bottom:12px">Đa luồng</h3>
                <div class="form-hint" style="margin-bottom:16px;color:var(--text-muted)">
                    Số profile chạy đồng thời và delay giữa các profile, áp dụng chung cho Farming lẫn TG Buff View.
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Số profile chạy cùng lúc</label>
                        <input type="number" class="form-control" id="g-concurrent" min="1" max="50">
                        <div class="form-hint">VD: 5 = chạy 5 profiles song song, profile nào xong thì cái tiếp vào ngay</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Min delay giữa profiles (ms)</label>
                        <input type="number" class="form-control" id="g-min-profile-delay" min="1000">
                        <div class="form-hint">Delay tối thiểu trước khi khởi động profile tiếp theo</div>
                    </div>
                    <div class="form-group">
                        <label>Max delay giữa profiles (ms)</label>
                        <input type="number" class="form-control" id="g-max-profile-delay" min="2000">
                    </div>
                </div>

                <hr style="border-color:var(--border);margin:20px 0">
                <h3 style="margin-bottom:12px">Khác</h3>

                <div class="form-row">
                    <div class="form-group">
                        <label>Tự động stop profile sau khi xong</label>
                        <select class="form-control" id="g-stop-after">
                            <option value="true">Có — stop profile GenLogin sau task</option>
                            <option value="false">Không — giữ profile chạy</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Log level</label>
                        <select class="form-control" id="g-log-level">
                            <option value="DEBUG">DEBUG</option>
                            <option value="INFO">INFO</option>
                            <option value="WARN">WARN</option>
                            <option value="ERROR">ERROR</option>
                        </select>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary">Lưu cấu hình chung</button>
            </form>
        </div>
    `;
}

export async function init() {
    try {
        const config = await api.getConfig();
        const dbp = config.delay_between_profiles || {};

        setVal('g-concurrent', config.max_concurrent_profiles || 3);
        setVal('g-min-profile-delay', dbp.min || 2000);
        setVal('g-max-profile-delay', dbp.max || 5000);
        setVal('g-stop-after', config.stop_profile_after_tasks !== false ? 'true' : 'false');
        setVal('g-log-level', config.log_level || 'INFO');
    } catch (err) {
        toast('Lỗi tải config: ' + err.message, 'error');
    }

    document.getElementById('general-form').addEventListener('submit', handleSave);
}

async function handleSave(e) {
    e.preventDefault();
    try {
        await api.updateGeneral({
            max_concurrent_profiles: parseInt(getVal('g-concurrent')) || 3,
            delay_between_profiles: {
                min: parseInt(getVal('g-min-profile-delay')) || 2000,
                max: parseInt(getVal('g-max-profile-delay')) || 5000,
            },
            stop_profile_after_tasks: getVal('g-stop-after') === 'true',
            log_level: getVal('g-log-level'),
        });
        toast('Đã lưu cấu hình chung', 'success');
    } catch (err) {
        toast(err.message, 'error');
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
