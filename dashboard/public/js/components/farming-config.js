/**
 * Farming Config Component — farming settings
 */
import { api } from '../api.js';
import { toast } from '../app.js';

export function render() {
    return `
        <div class="page-header">
            <h2>Farming Config</h2>
            <p>Cấu hình chế độ farming, xác suất, delays</p>
        </div>

        <div class="card">
            <form id="farming-form">
                <h3 style="margin-bottom:12px">Chế độ farming</h3>

                <div class="form-row">
                    <div class="form-group">
                        <label>Chế độ</label>
                        <select class="form-control" id="f-mode">
                            <option value="newsfeed">Newsfeed</option>
                            <option value="hashtag">Hashtag</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Số vòng lặp</label>
                        <input type="number" class="form-control" id="f-loops" min="1" max="100">
                    </div>
                </div>

                <div class="form-group">
                    <label>Hashtags (phân cách bởi dấu phẩy)</label>
                    <input type="text" class="form-control" id="f-hashtags" placeholder="#AI, #crypto, #tech">
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Interact probability (0-1)</label>
                        <input type="number" class="form-control" id="f-interact-prob" min="0" max="1" step="0.05">
                    </div>
                    <div class="form-group">
                        <label>Language filter</label>
                        <select class="form-control" id="f-lang-filter">
                            <option value="">Tất cả ngôn ngữ</option>
                            <option value="vi">Chỉ tiếng Việt</option>
                            <option value="en">Chỉ tiếng Anh</option>
                            <option value="vi+en">Tiếng Việt + Tiếng Anh</option>
                        </select>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Scroll duration (giây)</label>
                        <input type="number" class="form-control" id="f-scroll" min="5" max="120">
                    </div>
                    <div class="form-group">
                        <label>Max tweets/loop</label>
                        <input type="number" class="form-control" id="f-max-tweets" min="1" max="100">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Min delay giữa actions (ms)</label>
                        <input type="number" class="form-control" id="f-min-action" min="500">
                    </div>
                    <div class="form-group">
                        <label>Max delay giữa actions (ms)</label>
                        <input type="number" class="form-control" id="f-max-action" min="1000">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Min delay giữa loops (ms)</label>
                        <input type="number" class="form-control" id="f-min-loop" min="5000">
                    </div>
                    <div class="form-group">
                        <label>Max delay giữa loops (ms)</label>
                        <input type="number" class="form-control" id="f-max-loop" min="10000">
                    </div>
                </div>

                <button type="submit" class="btn btn-primary">Lưu cấu hình Farming</button>
            </form>
        </div>
    `;
}

export async function init() {
    try {
        const config = await api.getConfig();
        const f = config.farming || {};

        setVal('f-mode', f.mode || 'newsfeed');
        setVal('f-loops', f.loop_count || 3);
        setVal('f-hashtags', (f.hashtags || []).join(', '));
        setVal('f-interact-prob', f.interact_probability ?? 0.1);
        setVal('f-lang-filter', f.language_filter || '');
        setVal('f-scroll', f.scroll_duration_seconds || 15);
        setVal('f-max-tweets', f.max_tweets_per_loop || 10);
        setVal('f-min-action', f.min_delay_between_actions_ms || 3000);
        setVal('f-max-action', f.max_delay_between_actions_ms || 8000);
        setVal('f-min-loop', f.min_delay_between_loops_ms || 30000);
        setVal('f-max-loop', f.max_delay_between_loops_ms || 60000);
    } catch (err) {
        toast('Lỗi tải config: ' + err.message, 'error');
    }

    document.getElementById('farming-form').addEventListener('submit', handleSave);
}

async function handleSave(e) {
    e.preventDefault();
    try {
        await api.updateFarming({
            mode: getVal('f-mode'),
            loop_count: getVal('f-loops'),
            hashtags: getVal('f-hashtags'),
            interact_probability: getVal('f-interact-prob'),
            language_filter: getVal('f-lang-filter'),
            scroll_duration_seconds: getVal('f-scroll'),
            max_tweets_per_loop: getVal('f-max-tweets'),
            min_delay_between_actions_ms: getVal('f-min-action'),
            max_delay_between_actions_ms: getVal('f-max-action'),
            min_delay_between_loops_ms: getVal('f-min-loop'),
            max_delay_between_loops_ms: getVal('f-max-loop'),
        });

        toast('Đã lưu cấu hình Farming', 'success');
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
