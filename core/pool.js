/**
 * Worker Pool — Chạy nhiều profile đồng thời
 *
 * V3: True parallel launch
 * - Launch TẤT CẢ workers cùng lúc (trong giới hạn concurrency)
 * - Stagger delay chỉ áp dụng NHẸ (2-5s) để không overwhelm GenLogin
 * - Dùng proper semaphore với queue cho nhiều waiters
 */
const Worker = require('./worker');
const BrowserManager = require('./browser');
const appState = require('./state');
const log = require('../utils/logger');
const { randomDelay } = require('../utils/human');
const Semaphore = require('../utils/semaphore');

class WorkerPool {
    constructor(config = {}) {
        this.maxConcurrent = config.max_concurrent_profiles || 3;
        this.config = config;
        this.activeWorkers = new Set();
        this._stopRequested = false;

        // Lưu reference vào state để dashboard có thể gọi stopAll
        appState.setPool(this);
    }

    /**
     * Stop tất cả workers đang chạy
     */
    stopAll() {
        this._stopRequested = true;
        for (const worker of this.activeWorkers) {
            worker.requestStop();
        }
        log.warn('Stop ALL đã được yêu cầu');
    }

    /**
     * Chạy farming trên tất cả profiles — True parallel
     */
    async runAll(profileEntries) {
        const enabledProfiles = profileEntries.filter(p => p.enabled !== false);
        const mode = this.config.farming?.mode || 'newsfeed';
        const loops = this.config.farming?.loop_count || 3;

        this._stopRequested = false;
        appState.resetStats();
        appState.setFarmingActive(true);

        log.banner(`X-FARMER — ${enabledProfiles.length} profiles`);
        log.info(`Chế độ: ${mode.toUpperCase()}`);
        log.info(`Loops/profile: ${loops}`);
        log.info(`Concurrency: ${this.maxConcurrent} profiles đồng thời`);
        console.log('');

        // Reset grid layout cho auto-arrange cửa sổ browser
        BrowserManager.resetGrid(this.maxConcurrent);

        const sem = new Semaphore(this.maxConcurrent);
        const stagger = this.config.delay_between_profiles || { min: 2000, max: 5000 };

        // Launch tuần tự theo thứ tự — semaphore giới hạn concurrent
        const allPromises = [];

        for (let idx = 0; idx < enabledProfiles.length; idx++) {
            if (this._stopRequested) break;

            if (idx > 0) {
                await randomDelay(stagger.min, stagger.max);
            }

            if (this._stopRequested) break;

            await sem.acquire();

            if (this._stopRequested) {
                sem.release();
                break;
            }

            const profile = enabledProfiles[idx];
            log.info(`▶ [${idx + 1}/${enabledProfiles.length}] Khởi động: ${profile.username || profile.genlogin_id}`);

            const worker = new Worker(profile, this.config);
            this.activeWorkers.add(worker);

            const workerPromise = (async () => {
                try {
                    await worker.run();
                } finally {
                    this.activeWorkers.delete(worker);
                    sem.release();
                }
            })();

            allPromises.push(workerPromise);
        }

        await Promise.allSettled(allPromises);

        appState.setFarmingActive(false);
        log.banner('HOÀN THÀNH TẤT CẢ');
    }

    /**
     * Chạy farming trên một profile cụ thể
     */
    async runSingle(profileEntry) {
        appState.resetStats();
        appState.setFarmingActive(true);

        const worker = new Worker(profileEntry, this.config);
        this.activeWorkers.add(worker);

        try {
            await worker.run();
        } finally {
            this.activeWorkers.delete(worker);
            appState.setFarmingActive(false);
        }
    }
}

module.exports = WorkerPool;
