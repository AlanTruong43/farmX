/**
 * Browser Manager
 * Kết nối Puppeteer đến GenLogin profile qua wsEndpoint
 * Hỗ trợ auto-arrange cửa sổ theo grid layout
 */
const puppeteer = require('puppeteer-core');
const { exec } = require('child_process');

// ─── Screen resolution cache ─────────────────────────
let _screenSize = null;

async function getScreenSize() {
    if (_screenSize) return _screenSize;

    try {
        const platform = process.platform;
        let result;

        if (platform === 'win32') {
            result = await new Promise((resolve, reject) => {
                exec(
                    'wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution /format:csv',
                    { timeout: 5000 },
                    (err, stdout) => {
                        if (err) return reject(err);
                        const lines = stdout.trim().split('\n').filter(l => l.trim());
                        for (const line of lines) {
                            const parts = line.split(',');
                            const w = parseInt(parts[1]);
                            const h = parseInt(parts[2]);
                            if (w > 0 && h > 0) return resolve({ width: w, height: h });
                        }
                        reject(new Error('No resolution found'));
                    }
                );
            });
        } else if (platform === 'darwin') {
            result = await new Promise((resolve, reject) => {
                exec(
                    'system_profiler SPDisplaysDataType | grep Resolution',
                    { timeout: 5000 },
                    (err, stdout) => {
                        if (err) return reject(err);
                        // Format: "Resolution: 2560 x 1600 Retina"
                        const match = stdout.match(/(\d+)\s*x\s*(\d+)/);
                        if (match) return resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
                        reject(new Error('No resolution found'));
                    }
                );
            });
        } else {
            // Linux
            result = await new Promise((resolve, reject) => {
                exec(
                    'xdpyinfo | grep dimensions',
                    { timeout: 5000 },
                    (err, stdout) => {
                        if (err) return reject(err);
                        // Format: "dimensions: 1920x1080 pixels"
                        const match = stdout.match(/(\d+)x(\d+)/);
                        if (match) return resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
                        reject(new Error('No resolution found'));
                    }
                );
            });
        }

        _screenSize = result;
    } catch {
        _screenSize = { width: 1920, height: 1080 };
    }

    return _screenSize;
}

// ─── Slot tracker cho window arrange ──────────────────
// Mỗi concurrent worker nhận 1 slot index, dùng để tính vị trí grid
let _nextSlotIndex = 0;
let _totalSlots = 1;
let _activeSlots = new Set();

class BrowserManager {
    /**
     * Reset grid layout khi bắt đầu session mới
     * @param {number} concurrentCount - Số profile chạy đồng thời
     */
    static resetGrid(concurrentCount) {
        _totalSlots = concurrentCount;
        _nextSlotIndex = 0;
        _activeSlots.clear();
    }

    /**
     * Lấy slot tiếp theo chưa dùng
     */
    static _acquireSlot() {
        // Tìm slot trống nhỏ nhất
        for (let i = 0; i < _totalSlots; i++) {
            if (!_activeSlots.has(i)) {
                _activeSlots.add(i);
                return i;
            }
        }
        // Fallback: dùng next index (wrap around)
        const slot = _nextSlotIndex % _totalSlots;
        _nextSlotIndex++;
        _activeSlots.add(slot);
        return slot;
    }

    /**
     * Trả slot khi worker xong
     */
    static releaseSlot(slotIndex) {
        _activeSlots.delete(slotIndex);
    }

    /**
     * Tính grid layout: chia màn hình thành grid cols × rows
     * @param {number} totalSlots - Tổng số slot concurrent
     * @returns {{ cols: number, rows: number }}
     */
    static _calcGrid(totalSlots) {
        if (totalSlots <= 1) return { cols: 1, rows: 1 };
        if (totalSlots <= 2) return { cols: 2, rows: 1 };
        if (totalSlots <= 4) return { cols: 2, rows: 2 };
        if (totalSlots <= 6) return { cols: 3, rows: 2 };
        if (totalSlots <= 9) return { cols: 3, rows: 3 };
        if (totalSlots <= 12) return { cols: 4, rows: 3 };
        if (totalSlots <= 16) return { cols: 4, rows: 4 };
        // > 16: tính dynamic
        const cols = Math.ceil(Math.sqrt(totalSlots));
        const rows = Math.ceil(totalSlots / cols);
        return { cols, rows };
    }

    /**
     * Kết nối đến profile GenLogin đã start
     * @param {string} wsEndpoint - WebSocket endpoint từ GenLogin
     * @returns {Promise<{browser: Browser, page: Page, slotIndex: number}>}
     */
    static async connect(wsEndpoint) {
        const browser = await puppeteer.connect({
            browserWSEndpoint: wsEndpoint,
            defaultViewport: null,      // Giữ nguyên viewport của GenLogin profile
            ignoreHTTPSErrors: true,
        });

        // Lấy page đang mở hoặc tạo mới
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();

        // Set timeout mặc định
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(30000);

        // Auto-arrange: lấy slot và di chuyển cửa sổ
        const slotIndex = this._acquireSlot();
        await this._arrangeWindow(browser, page, slotIndex);

        return { browser, page, slotIndex };
    }

    /**
     * Di chuyển + resize cửa sổ browser theo slot trong grid
     */
    static async _arrangeWindow(browser, page, slotIndex) {
        try {
            const screen = await getScreenSize();
            const { cols, rows } = this._calcGrid(_totalSlots);

            const cellW = Math.floor(screen.width / cols);
            const cellH = Math.floor(screen.height / rows);

            const col = slotIndex % cols;
            const row = Math.floor(slotIndex / cols);

            const x = col * cellW;
            const y = row * cellH;

            // Dùng CDP setWindowBounds
            const cdp = await page.createCDPSession();
            const { windowId } = await cdp.send('Browser.getWindowForTarget');
            await cdp.send('Browser.setWindowBounds', {
                windowId,
                bounds: {
                    left: x,
                    top: y,
                    width: cellW,
                    height: cellH,
                    windowState: 'normal',
                },
            });
            await cdp.detach();
        } catch {
            // Không arrange được thì thôi, không ảnh hưởng task
        }
    }

    /**
     * Disconnect khỏi browser (KHÔNG đóng browser - GenLogin quản lý)
     */
    static async disconnect(browser, slotIndex) {
        if (typeof slotIndex === 'number') {
            this.releaseSlot(slotIndex);
        }
        if (browser) {
            try {
                browser.disconnect();
            } catch {
                // Ignore disconnect errors
            }
        }
    }

    /**
     * Chờ page load xong
     */
    static async waitForPageReady(page) {
        try {
            await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 });
        } catch {
            // Timeout thì bỏ qua, page có thể vẫn đang load assets
        }
    }

    /**
     * Chụp screenshot để debug
     */
    static async screenshot(page, filename) {
        try {
            await page.screenshot({ path: filename, fullPage: false });
        } catch {
            // Ignore screenshot errors
        }
    }
}

module.exports = BrowserManager;
