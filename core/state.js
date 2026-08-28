/**
 * AppState — Shared runtime state (EventEmitter singleton)
 * Trung tâm dữ liệu realtime cho dashboard SSE (X farming)
 */
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'app-logs.jsonl');
const MAX_LOG_BUFFER = 5000; // in-memory limit
const MAX_LOG_FILE = 5000;   // file limit

function _loadLogsFromFile() {
    try {
        if (!fs.existsSync(LOG_FILE)) return [];
        const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
        const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        // Chỉ giữ MAX_LOG_FILE dòng cuối
        return entries.slice(-MAX_LOG_FILE);
    } catch {
        return [];
    }
}

class AppState extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50);

        // ─── X Farming state ────────────────────────────
        this.farmingActive = false;
        this.activeProfiles = new Map(); // profileTag → { status, stats, startedAt }
        this.globalStats = {
            totalProcessed: 0,
            totalLiked: 0,
            totalCommented: 0,
            totalFollowed: 0,
            sessionsCompleted: 0,
        };
        this._pool = null;

        // ─── Shared ─────────────────────────────────────
        // Load logs từ file khi khởi động — giữ nguyên qua các lần restart
        try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch {}
        this.logBuffer = _loadLogsFromFile();
        this._logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    }

    // ═══════════════════════════════════════════════════════
    //  SHARED: Logs
    // ═══════════════════════════════════════════════════════

    pushLog(entry) {
        this.logBuffer.push(entry);
        if (this.logBuffer.length > MAX_LOG_BUFFER) {
            this.logBuffer.shift();
        }
        // Ghi ra file để persist qua restart
        try { this._logStream.write(JSON.stringify(entry) + '\n'); } catch {}
        this.emit('log', entry);
    }

    clearLogs() {
        this.logBuffer = [];
        try {
            this._logStream.close();
            fs.writeFileSync(LOG_FILE, '');
            this._logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
        } catch {}
        this.emit('logs-cleared');
    }

    // ═══════════════════════════════════════════════════════
    //  X FARMING
    // ═══════════════════════════════════════════════════════

    updateProfileStatus(profileTag, status, extra = {}) {
        const existing = this.activeProfiles.get(profileTag) || {};
        this.activeProfiles.set(profileTag, {
            ...existing,
            status,
            ...extra,
            updatedAt: Date.now(),
        });
        this.emit('stats', this.getStatus());
    }

    updateProfileStats(profileTag, loopStats) {
        const existing = this.activeProfiles.get(profileTag) || {};
        const stats = existing.stats || { processed: 0, liked: 0, commented: 0, followed: 0 };

        stats.processed += loopStats.processedCount || 0;
        stats.liked += loopStats.likedCount || 0;
        stats.commented += loopStats.commentedCount || 0;
        stats.followed += loopStats.followedCount || 0;

        this.globalStats.totalProcessed += loopStats.processedCount || 0;
        this.globalStats.totalLiked += loopStats.likedCount || 0;
        this.globalStats.totalCommented += loopStats.commentedCount || 0;
        this.globalStats.totalFollowed += loopStats.followedCount || 0;

        this.activeProfiles.set(profileTag, {
            ...existing,
            stats,
            updatedAt: Date.now(),
        });

        this.emit('stats', this.getStatus());
    }

    setFarmingActive(active) {
        this.farmingActive = active;
        if (!active) {
            this.activeProfiles.clear();
        }
        this.emit('farming-status', { active });
        this.emit('stats', this.getStatus());
    }

    sessionCompleted() {
        this.globalStats.sessionsCompleted++;
    }

    setPool(pool) {
        this._pool = pool;
    }

    resetStats() {
        this.globalStats = {
            totalProcessed: 0,
            totalLiked: 0,
            totalCommented: 0,
            totalFollowed: 0,
            sessionsCompleted: 0,
        };
        this.activeProfiles.clear();
    }

    // ═══════════════════════════════════════════════════════
    //  COMBINED STATUS
    // ═══════════════════════════════════════════════════════

    getStatus() {
        const profiles = {};
        for (const [tag, data] of this.activeProfiles) {
            profiles[tag] = data;
        }

        return {
            farmingActive: this.farmingActive,
            activeProfiles: profiles,
            globalStats: { ...this.globalStats },
            logCount: this.logBuffer.length,
        };
    }
}

// Singleton
const appState = new AppState();
module.exports = appState;
