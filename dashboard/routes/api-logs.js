/**
 * API Routes: Logs
 * GET /api/logs/stream — SSE endpoint realtime logs + stats + farming-status
 * GET /api/logs/history — lấy log buffer hiện tại
 */
const express = require('express');
const router = express.Router();
const appState = require('../../core/state');

// GET /api/logs/stream — SSE
router.get('/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // Send initial status
    res.write(`event: stats\ndata: ${JSON.stringify(appState.getStatus())}\n\n`);

    // Listeners
    const onLog = (entry) => {
        res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    };

    const onStats = (status) => {
        res.write(`event: stats\ndata: ${JSON.stringify(status)}\n\n`);
    };

    const onFarmingStatus = (data) => {
        res.write(`event: farming-status\ndata: ${JSON.stringify(data)}\n\n`);
    };

    appState.on('log', onLog);
    appState.on('stats', onStats);
    appState.on('farming-status', onFarmingStatus);

    // Heartbeat mỗi 15s để giữ kết nối
    const heartbeat = setInterval(() => {
        res.write(`:heartbeat\n\n`);
    }, 15000);

    // Cleanup khi client disconnect
    req.on('close', () => {
        clearInterval(heartbeat);
        appState.off('log', onLog);
        appState.off('stats', onStats);
        appState.off('farming-status', onFarmingStatus);
    });
});

// GET /api/logs/history — log buffer
router.get('/history', (req, res) => {
    res.json(appState.logBuffer);
});

// GET /api/logs/status — runtime status
router.get('/status', (req, res) => {
    res.json(appState.getStatus());
});

module.exports = router;
