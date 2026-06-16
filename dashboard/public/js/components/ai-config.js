/**
 * AI Config Component — AI provider selection (Gemini/EzAI)
 */
import { api } from '../api.js';
import { toast } from '../app.js';

export function render() {
    return `
        <div class="page-header">
            <h2>AI Provider</h2>
            <p>Cấu hình AI cho comment tự động</p>
        </div>

        <div class="card" id="ai-config-card">
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
        const ai = config.ai_provider || config.gemini || {};

        setVal('ai-type', ai.type || 'gemini');
        setVal('ai-key', ai.api_key || '');
        setVal('ai-model', ai.model || '');
        setVal('ai-tokens', ai.max_tokens || 100);
        setVal('ai-prompt', ai.comment_prompt || '');
    } catch (err) {
        toast('Lỗi tải config: ' + err.message, 'error');
    }

    document.getElementById('ai-form').addEventListener('submit', handleSave);

    document.getElementById('ai-type').addEventListener('change', async (e) => {
        const hint = document.getElementById('model-hint');
        const type = e.target.value;
        if (hint) {
            hint.textContent = type === 'ezai'
                ? 'EzAI models: gpt-4.1-nano (rẻ/nhanh), gpt-4.1-mini, gpt-4o-mini, gemini-2.5-pro'
                : 'Gemini models: gemini-2.0-flash (nhanh), gemini-1.5-pro';
        }

        // Auto-fill key/model từ saved config khi switch provider
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

async function handleSave(e) {
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
