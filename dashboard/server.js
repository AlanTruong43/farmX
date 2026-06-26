/**
 * Dashboard Express Server
 * Serve static files + mount API routes + SSE
 */
const express = require('express');
const path = require('path');
const log = require('../utils/logger');

const apiConfig = require('./routes/api-config');
const apiProfiles = require('./routes/api-profiles');
const apiFarming = require('./routes/api-farming');
const apiLogs = require('./routes/api-logs');
const apiFollow = require('./routes/api-follow');

function createServer(port = 3000) {
    const app = express();

    // Middleware
    app.use(express.json());

    // Static files
    app.use(express.static(path.join(__dirname, 'public')));

    // API routes
    app.use('/api/config', apiConfig);
    app.use('/api/profiles', apiProfiles);
    app.use('/api/farming', apiFarming);
    app.use('/api/logs', apiLogs);
    app.use('/api/follow', apiFollow);

    // SPA fallback
    app.get('/{*splat}', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    const server = app.listen(port, () => {
        log.banner(`DASHBOARD — http://localhost:${port}`);
        log.info(`API: http://localhost:${port}/api/farming/status`);
        log.info(`SSE: http://localhost:${port}/api/logs/stream`);
    });

    return server;
}

module.exports = { createServer };
