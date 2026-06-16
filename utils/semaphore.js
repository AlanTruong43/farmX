/**
 * Semaphore — Giới hạn concurrency với proper queue
 * Dùng chung cho cả X farming pool và TG pool
 */
class Semaphore {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this._queue = [];
    }

    async acquire() {
        if (this.current < this.max) {
            this.current++;
            return;
        }
        // Chờ slot trống
        await new Promise(resolve => this._queue.push(resolve));
        this.current++;
    }

    release() {
        this.current--;
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            next();
        }
    }
}

module.exports = Semaphore;
