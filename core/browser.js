/**
 * Browser Manager
 * Kết nối Puppeteer đến GenLogin profile qua wsEndpoint
 * Hỗ trợ auto-arrange cửa sổ theo grid layout
 */
const puppeteer = require('puppeteer-core');
const { exec } = require('child_process');
const log = require('../utils/logger');

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
let _farmWinW = 0;  // 0 = auto (fill grid cell)
let _farmWinH = 0;

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

    static setFarmingWindow(w, h) {
        _farmWinW = parseInt(w) || 0;
        _farmWinH = parseInt(h) || 0;
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

            const cellW = _farmWinW || Math.floor(screen.width / cols);
            const cellH = _farmWinH || Math.floor(screen.height / rows);

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
     * Kết nối cho Follow Check — window size riêng, đặt bên cạnh/dưới farming grid
     * @param {string} wsEndpoint
     * @param {number} winWidth
     * @param {number} winHeight
     * @returns {Promise<{browser: Browser, page: Page}>}
     */
    static async connectFollowCheck(wsEndpoint, winWidth = 1280, winHeight = 900) {
        const browser = await puppeteer.connect({
            browserWSEndpoint: wsEndpoint,
            defaultViewport: null,
            ignoreHTTPSErrors: true,
        });
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(30000);

        try {
            const screen = await getScreenSize();
            let x = 0, y = 0, w = winWidth, h = winHeight;

            if (_activeSlots.size > 0 && _totalSlots > 0) {
                const { cols, rows } = this._calcGrid(_totalSlots);
                const cellW = Math.floor(screen.width / cols);
                const cellH = Math.floor(screen.height / rows);
                const farmRight = cellW * cols;
                const farmBottom = cellH * rows;
                const rightSpace = screen.width - farmRight;

                if (rightSpace >= Math.min(winWidth, 480)) {
                    // Đặt bên phải farming grid
                    x = farmRight;
                    y = 0;
                    w = Math.min(winWidth, rightSpace);
                    h = Math.min(winHeight, screen.height);
                } else {
                    // Đặt dưới farming grid
                    const botSpace = screen.height - farmBottom;
                    if (botSpace >= Math.min(winHeight, 300)) {
                        x = 0;
                        y = farmBottom;
                        w = Math.min(winWidth, screen.width);
                        h = Math.min(winHeight, botSpace);
                    } else {
                        // Không còn chỗ — đặt góc phải dưới, chồng lên
                        x = Math.max(0, screen.width - winWidth);
                        y = Math.max(0, screen.height - winHeight);
                    }
                }
            }

            const cdp = await page.createCDPSession();
            const { windowId } = await cdp.send('Browser.getWindowForTarget');
            await cdp.send('Browser.setWindowBounds', {
                windowId,
                bounds: { left: x, top: y, width: w, height: h, windowState: 'normal' },
            });
            // Đọc lại bounds thực tế sau khi set để verify
            const actual = await cdp.send('Browser.getWindowBounds', { windowId });
            const b = actual.bounds;
            log.info(`Follow Check window: yêu cầu ${w}x${h} tại (${x},${y}) — thực tế: ${b.width}x${b.height} tại (${b.left},${b.top})`);
            await cdp.detach();
        } catch (err) {
            log.warn(`Follow Check window: không set được bounds — ${err.message}`);
        }

        return { browser, page };
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
