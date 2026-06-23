/**
 * General + AI Config Component
 */
import { api } from '../api.js';
import { toast } from '../app.js';

export function render() {
    return `
        <div class="page-header">
            <h2>Cấu hình chung</h2>
            <p>Cài đặt đa luồng, delay và AI provider</p>
        </div>

        <div class="card">
            <form id="general-form">
                <h3 style="margin-bottom:12px">Đa luồng</h3>
                <div class="form-hint" style="margin-bottom:16px;color:var(--text-muted)">
                    Số profile chạy đồng thời và delay giữa các profile.
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Số profile chạy cùng lúc</label>
                        <input type="number" class="form-control" id="g-concurrent" min="1" max="50">
                        <div class="form-hint">VD: 5 = chạy 5 profiles song song</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Min delay giữa profiles (ms)</label>
                        <input type="number" class="form-control" id="g-min-profile-delay" min="1000">
                    </div>
                    <div class="form-group">
                        <label>Max delay giữa profiles (ms)</label>
                        <input type="number" class="form-control" id="g-max-profile-delay" min="2000">
                    </div>
                </div>

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

        <hr style="border-color:var(--border);margin:24px 0">

        <div class="page-header" style="margin-top:0">
            <h2>AI Provider</h2>
            <p>Cấu hình AI cho comment tự động</p>
        </div>

        <div class="card">
            <form id="ai-form">
                <div class="form-group">
                    <label>Provider</label>
                    <select class="form-control" id="ai-type">
                        <option value="gemini">Gemini (Google)</option>
                        <option value="ezai">EzAI (OpenAI-compatible)</option>
                    </select>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>API Key</label>
                        <input type="password" class="form-control" id="ai-key" placeholder="API key...">
                    </div>
                    <div class="form-group">
                        <label>Model</label>
                        <input type="text" class="form-control" id="ai-model" placeholder="gemini-2.0-flash">
                        <div class="form-hint" id="model-hint">Gemini: gemini-2.0-flash | EzAI: gpt-4.1-nano, gpt-4.1-mini, gpt-4o-mini</div>
                    </div>
                </div>

                <div class="form-group">
                    <label>Max Tokens</label>
                    <input type="number" class="form-control" id="ai-tokens" value="100" min="10" max="500" style="width:120px">
                </div>

                <div class="form-group">
                    <label>Comment Prompt</label>
                    <textarea class="form-control" id="ai-prompt" rows="4"></textarea>
                </div>

                <button type="submit" class="btn btn-primary">Lưu cấu hình AI</button>
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

        const ai = config.ai_provider || config.gemini || {};
        setVal('ai-type', ai.type || 'gemini');
        setVal('ai-key', ai.api_key || '');
        setVal('ai-model', ai.model || '');
        setVal('ai-tokens', ai.max_tokens || 100);
        setVal('ai-prompt', ai.comment_prompt || '');
    } catch (err) {
        toast('Lỗi tải config: ' + err.message, 'error');
    }

    document.getElementById('general-form').addEventListener('submit', handleSaveGeneral);
    document.getElementById('ai-form').addEventListener('submit', handleSaveAI);

    document.getElementById('ai-type').addEventListener('change', async (e) => {
        const hint = document.getElementById('model-hint');
        const type = e.target.value;
        if (hint) {
            hint.textContent = type === 'ezai'
                ? 'EzAI models: gpt-4.1-nano (rẻ/nhanh), gpt-4.1-mini, gpt-4o-mini, gemini-2.5-pro'
                : 'Gemini models: gemini-2.0-flash (nhanh), gemini-1.5-pro';
        }
        try {
            const config = await api.getConfig();
            if (type === 'ezai' && config.ezai) {
                setVal('ai-key', config.ezai.api_key || '');
                setVal('ai-model', config.ezai.model || 'gpt-4.1-nano');
            } else if (type === 'gemini' && config.gemini) {
                setVal('ai-key', config.gemini.api_key || '');
                setVal('ai-model', config.gemini.model || 'gemini-2.0-flash');
            }
        } catch { /* ignore */ }
    });
}

async function handleSaveGeneral(e) {
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

async function handleSaveAI(e) {
    e.preventDefault();
    try {
        await api.updateAI({
            type: getVal('ai-type'),
            api_key: getVal('ai-key'),
            model: getVal('ai-model'),
            max_tokens: getVal('ai-tokens'),
            comment_prompt: getVal('ai-prompt'),
        });
        toast('Đã lưu cấu hình AI', 'success');
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
