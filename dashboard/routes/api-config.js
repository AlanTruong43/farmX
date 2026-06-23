/**
 * API Routes: Config
 * GET /api/config — lấy toàn bộ config
 * PUT /api/config/ai — cập nhật AI provider
 * PUT /api/config/farming — cập nhật farming settings
 * PUT /api/config/general — cập nhật general settings
 * PUT /api/config/sheets — cập nhật Google Sheets settings
 * POST /api/sheets/test — test kết nối Google Sheets
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const CONFIG_PATH = path.resolve(__dirname, '../../config.json');

function readConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function writeConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');
}

// GET /api/config
router.get('/', (req, res) => {
    try {
        const config = readConfig();
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/config/ai — cập nhật ai_provider section
router.put('/ai', (req, res) => {
    try {
        const config = readConfig();
        const update = req.body;

        if (!config.ai_provider) {
            config.ai_provider = {};
        }

        // Merge fields
        if (update.type !== undefined) config.ai_provider.type = update.type;
        if (update.api_key !== undefined) config.ai_provider.api_key = update.api_key;
        if (update.model !== undefined) config.ai_provider.model = update.model;
        if (update.comment_prompt !== undefined) config.ai_provider.comment_prompt = update.comment_prompt;
        if (update.max_tokens !== undefined) config.ai_provider.max_tokens = parseInt(update.max_tokens);

        writeConfig(config);
        res.json({ ok: true, ai_provider: config.ai_provider });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/config/farming — cập nhật farming section
router.put('/farming', (req, res) => {
    try {
        const config = readConfig();
        const update = req.body;

        if (!config.farming) {
            config.farming = {};
        }

        // Merge fields
        const intFields = [
            'loop_count', 'scroll_duration_seconds', 'max_tweets_per_loop',
            'max_interacts_per_loop',
            'min_delay_between_actions_ms', 'max_delay_between_actions_ms',
            'min_delay_between_loops_ms', 'max_delay_between_loops_ms',
        ];
        const floatFields = ['interact_probability'];
        const stringFields = ['mode', 'language_filter'];
        const arrayFields = ['hashtags'];

        for (const field of intFields) {
            if (update[field] !== undefined) {
                const raw = String(update[field]);
                if (raw.includes(',')) return res.status(400).json({ error: `${field}: dùng dấu chấm thay vì dấu phẩy (ví dụ: 15 thay vì 15,5)` });
                const val = parseInt(raw);
                if (isNaN(val)) return res.status(400).json({ error: `${field}: giá trị không hợp lệ` });
                config.farming[field] = val;
            }
        }
        for (const field of floatFields) {
            if (update[field] !== undefined) {
                const raw = String(update[field]);
                if (raw.includes(',')) return res.status(400).json({ error: `${field}: dùng dấu chấm thay vì dấu phẩy (ví dụ: 0.35 thay vì 0,35)` });
                const val = parseFloat(raw);
                if (isNaN(val)) return res.status(400).json({ error: `${field}: giá trị không hợp lệ` });
                config.farming[field] = val;
            }
        }
        for (const field of stringFields) {
            if (update[field] !== undefined) config.farming[field] = update[field];
        }
        for (const field of arrayFields) {
            if (update[field] !== undefined) {
                config.farming[field] = Array.isArray(update[field])
                    ? update[field]
                    : update[field].split(',').map(s => s.trim());
            }
        }

        writeConfig(config);
        res.json({ ok: true, farming: config.farming });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/config/general — cập nhật general settings
router.put('/general', (req, res) => {
    try {
        const config = readConfig();
        const update = req.body;

        if (update.max_concurrent_profiles !== undefined) {
            config.max_concurrent_profiles = parseInt(update.max_concurrent_profiles);
        }
        if (update.log_level !== undefined) {
            config.log_level = update.log_level;
        }
        if (update.stop_profile_after_tasks !== undefined) {
            config.stop_profile_after_tasks = !!update.stop_profile_after_tasks;
        }
        if (update.screenshot_on_error !== undefined) {
            config.screenshot_on_error = !!update.screenshot_on_error;
        }
        if (update.delay_between_profiles !== undefined) {
            config.delay_between_profiles = {
                min: parseInt(update.delay_between_profiles.min) || 5000,
                max: parseInt(update.delay_between_profiles.max) || 15000,
            };
        }

        writeConfig(config);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/config/sheets — cập nhật Google Sheets settings
router.put('/sheets', (req, res) => {
    try {
        const config = readConfig();
        const update = req.body;

        if (!config.google_sheets) {
            config.google_sheets = {};
        }

        if (update.enabled !== undefined) config.google_sheets.enabled = !!update.enabled;
        if (update.spreadsheet_id !== undefined) config.google_sheets.spreadsheet_id = update.spreadsheet_id;
        if (update.credentials_path !== undefined) config.google_sheets.credentials_path = update.credentials_path;
        if (update.sheet_name !== undefined) config.google_sheets.sheet_name = update.sheet_name;

        writeConfig(config);
        res.json({ ok: true, google_sheets: config.google_sheets });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/config/sheets-auth-url — Lấy URL để user authorize Google Sheets
router.get('/sheets-auth-url', (req, res) => {
    try {
        const config = readConfig();
        const sheetsConfig = config.google_sheets || {};

        const SheetsReporter = require('../../core/sheets-reporter');
        const reporter = new SheetsReporter(sheetsConfig);
        const authUrl = reporter.getAuthUrl();

        res.json({ ok: true, authUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/config/sheets-auth-callback — Đổi auth code lấy token
router.post('/sheets-auth-callback', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ error: 'Thiếu authorization code' });
        }

        const config = readConfig();
        const sheetsConfig = config.google_sheets || {};

        const SheetsReporter = require('../../core/sheets-reporter');
        const reporter = new SheetsReporter(sheetsConfig);
        await reporter.exchangeCode(code);

        res.json({ ok: true, message: 'Đã authorize thành công!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/config/sheets-status — Kiểm tra đã authorize chưa
router.get('/sheets-status', (req, res) => {
    try {
        const config = readConfig();
        const sheetsConfig = config.google_sheets || {};

        const SheetsReporter = require('../../core/sheets-reporter');
        const reporter = new SheetsReporter(sheetsConfig);

        res.json({ ok: true, authorized: reporter.isAuthorized() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/config/sheets-test — Test kết nối Google Sheets
router.post('/sheets-test', async (req, res) => {
    try {
        const config = readConfig();
        const sheetsConfig = config.google_sheets || {};

        if (!sheetsConfig.spreadsheet_id) {
            return res.status(400).json({ error: 'Spreadsheet ID chưa được cấu hình' });
        }

        const SheetsReporter = require('../../core/sheets-reporter');
        const reporter = new SheetsReporter(sheetsConfig);
        const result = await reporter.testConnection();

        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
