/**
 * AppState — Shared runtime state (EventEmitter singleton)
 * Trung tâm dữ liệu realtime cho dashboard SSE (X farming)
 */
const EventEmitter = require('events');

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
        this.logBuffer = []; // last 500 logs
    }

    // ═══════════════════════════════════════════════════════
    //  SHARED: Logs
    // ═══════════════════════════════════════════════════════

    pushLog(entry) {
        this.logBuffer.push(entry);
        if (this.logBuffer.length > 500) {
            this.logBuffer.shift();
        }
        this.emit('log', entry);
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
