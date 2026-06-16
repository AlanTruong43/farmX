/**
 * API Routes: Farming
 * POST /api/farming/start — bắt đầu farming (async, non-blocking)
 * POST /api/farming/stop — dừng farming
 * GET /api/farming/status — runtime status
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const appState = require('../../core/state');
const WorkerPool = require('../../core/pool');
const log = require('../../utils/logger');

const CONFIG_PATH = path.resolve(__dirname, '../../config.json');
const PROFILES_PATH = path.resolve(__dirname, '../../profiles.json');

function readJSON(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// POST /api/farming/start
router.post('/start', (req, res) => {
    if (appState.farmingActive) {
        return res.status(409).json({ error: 'Farming đang chạy rồi' });
    }

    try {
        const config = readJSON(CONFIG_PATH);
        const profilesData = readJSON(PROFILES_PATH);

        log.setLevel(config.log_level);

        const pool = new WorkerPool(config);

        // Chạy async, không block response
        pool.runAll(profilesData.profiles).catch(err => {
            log.error(`Farming lỗi: ${err.message}`);
            appState.setFarmingActive(false);
        });

        res.json({ ok: true, message: 'Farming đã bắt đầu' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/farming/stop
router.post('/stop', (req, res) => {
    if (!appState.farmingActive) {
        return res.status(409).json({ error: 'Farming không đang chạy' });
    }

    try {
        if (appState._pool) {
            appState._pool.stopAll();
        }
        res.json({ ok: true, message: 'Stop đã được yêu cầu' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/farming/status — chỉ trả X farming state
router.get('/status', (req, res) => {
    const status = appState.getStatus();
    res.json({
        farmingActive: status.farmingActive,
        activeProfiles: status.activeProfiles,
        globalStats: status.globalStats,
    });
});

module.exports = router;
