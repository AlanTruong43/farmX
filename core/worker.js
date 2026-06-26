/**
 * Worker — Quản lý lifecycle một profile GenLogin
 * Start profile -> connect browser -> farming loop -> disconnect -> stop profile
 */
const GenLoginClient = require('./genlogin');
const BrowserManager = require('./browser');
const Farmer = require('./farmer');
const appState = require('./state');
const log = require('../utils/logger');
const { randomDelay, sleep } = require('../utils/human');

class Worker {
    constructor(profileEntry, config = {}) {
        this.profileId = profileEntry.genlogin_id;
        this.profileTag = profileEntry.username || profileEntry.genlogin_id.toString().substring(0, 8);
        this.enabled = profileEntry.enabled !== false;
        this.config = config;
        this.farming = config.farming || {};

        this.genlogin = new GenLoginClient(config.genlogin_url);
        this.browser = null;
        this.page = null;
        this.slotIndex = null;
        this.isRunning = false;
        this._stopRequested = false;
    }

    /**
     * Request stop từ bên ngoài
     */
    requestStop() {
        this._stopRequested = true;
    }

    /**
     * Chạy farming loop trên profile này
     */
    async run() {
        if (!this.enabled) {
            log.warn('Profile bị disabled, bỏ qua', this.profileTag);
            return;
        }

        this.isRunning = true;
        this._stopRequested = false;
        appState.updateProfileStatus(this.profileTag, 'starting', { startedAt: Date.now() });
        log.info('═══ Bắt đầu farming ═══', this.profileTag);

        try {
            // 1. Start GenLogin profile
            log.info('Đang start profile GenLogin...', this.profileTag);
            const { wsEndpoint, alreadyRunning } = await this.genlogin.startProfile(this.profileId);
            log.success(
                alreadyRunning ? 'Profile đã chạy sẵn, kết nối lại' : 'Profile đã start',
                this.profileTag
            );

            // 2. Connect Puppeteer
            log.info('Đang kết nối Puppeteer...', this.profileTag);
            const conn = await BrowserManager.connect(wsEndpoint);
            this.browser = conn.browser;
            this.page = conn.page;
            this.slotIndex = conn.slotIndex;
            log.success('Đã kết nối browser', this.profileTag);

            // 3. Vào X.com
            log.info('Đang vào x.com...', this.profileTag);
            await this.page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await randomDelay(3000, 5000);

            // Bypass SSL/proxy warning nếu có
            await this._bypassSslWarning();

            // Kiểm tra đã login chưa
            const isLoggedIn = await this._checkLogin();
            if (!isLoggedIn) {
                log.error('Chưa đăng nhập X! Profile cần login sẵn trước.', this.profileTag);
                appState.updateProfileStatus(this.profileTag, 'error', { error: 'Not logged in' });
                return;
            }

            // Kiểm tra account bị suspended/locked
            const accountState = await this._checkAccountState();
            if (accountState !== 'ok') {
                log.error(`Account bị ${accountState}! Bỏ qua profile.`, this.profileTag);
                appState.updateProfileStatus(this.profileTag, 'error', { error: accountState });
                return;
            }

            log.success('Đã đăng nhập X ✓', this.profileTag);

            // 4. Pre-init SheetsReporter đã bị xóa

            // 5. Farming loop
            appState.updateProfileStatus(this.profileTag, 'farming');
            const farmer = new Farmer(this.page, this.config, this.profileTag);
            const loopCount = this.farming.loop_count || 3;
            const mode = this.farming.mode || 'newsfeed';
            const hashtags = this.farming.hashtags || [];

            log.info(`Chế độ: ${mode.toUpperCase()} | Loops: ${loopCount}`, this.profileTag);

            for (let loop = 1; loop <= loopCount; loop++) {
                if (this._stopRequested) {
                    log.warn('Stop requested, dừng farming', this.profileTag);
                    break;
                }

                log.info(`\n─── Loop ${loop}/${loopCount} ───`, this.profileTag);
                appState.updateProfileStatus(this.profileTag, 'farming', {
                    currentLoop: loop,
                    totalLoops: loopCount,
                });

                farmer.setLoop(loop, loopCount);

                let loopStats;
                if (mode === 'hashtag' && hashtags.length > 0) {
                    const hashtag = hashtags[Math.floor(Math.random() * hashtags.length)];
                    loopStats = await farmer.farmHashtag(hashtag);
                } else {
                    loopStats = await farmer.farmNewsfeed();
                }

                // Cập nhật stats
                if (loopStats) {
                    appState.updateProfileStats(this.profileTag, loopStats);
                }

                // Delay giữa các loop + thông báo nghỉ
                if (loop < loopCount && !this._stopRequested) {
                    const minLoopDelay = this.farming.min_delay_between_loops_ms || 30000;
                    const maxLoopDelay = this.farming.max_delay_between_loops_ms || 60000;
                    const waitMs = Math.floor(Math.random() * (maxLoopDelay - minLoopDelay + 1)) + minLoopDelay;
                    log.info(`☕ Nghỉ giải lao ${(waitMs / 1000).toFixed(0)}s trước loop ${loop + 1}/${loopCount}...`, this.profileTag);

                    // Interruptible sleep — kiểm tra _stopRequested mỗi 500ms
                    const tick = 500;
                    let elapsed = 0;
                    while (elapsed < waitMs && !this._stopRequested) {
                        await sleep(Math.min(tick, waitMs - elapsed));
                        elapsed += tick;
                    }

                    // Truy cập x.com/home trước loop mới — accept "Leave site?" nếu có
                    if (!this._stopRequested) {
                        log.info('🏠 Quay về home trước loop mới...', this.profileTag);
                        this.page.once('dialog', async dialog => {
                            await dialog.accept().catch(() => {});
                        });
                        await this.page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await randomDelay(2000, 4000);
                    }
                }
            }

            appState.updateProfileStatus(this.profileTag, 'done');
            appState.sessionCompleted();
            log.success('═══ Hoàn thành farming ═══', this.profileTag);

        } catch (err) {
            const isDetached = err.message?.includes('detached') || err.message?.includes('Navigating frame');
            if (isDetached) {
                log.warn('Browser bị detach (có thể do Stop), dừng farming', this.profileTag);
            } else {
                log.error(`Lỗi nghiêm trọng: ${err.message}`, this.profileTag);
            }
            appState.updateProfileStatus(this.profileTag, 'error', { error: err.message });

            if (this.config.screenshot_on_error && this.page) {
                const screenshotFile = `error_${this.profileTag}_${Date.now()}.png`;
                await BrowserManager.screenshot(this.page, screenshotFile);
                log.debug(`Screenshot: ${screenshotFile}`, this.profileTag);
            }
        } finally {
            await this.cleanup();
            this.isRunning = false;
        }
    }

    // Kiểm tra đã login X chưa
    async _checkLogin() {
        try {
            const profileLink = await this.page.$('a[data-testid="AppTabBar_Profile_Link"]');
            if (profileLink) return true;

            const loginBtn = await this.page.$('a[data-testid="loginButton"]');
            if (loginBtn) return false;

            const url = this.page.url();
            if (url.includes('/login') || url.includes('/i/flow/login')) return false;

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Bypass SSL/proxy warning page (NET::ERR_CERT)
     * Click Advanced → Continue to site
     */
    async _bypassSslWarning() {
        try {
            const isSslWarning = await this.page.evaluate(() => {
                const body = document.body?.innerText?.toLowerCase() || '';
                return body.includes('your connection is not private') ||
                       body.includes('not secure') ||
                       body.includes('err_cert') ||
                       body.includes('net::err_cert');
            });

            if (!isSslWarning) return;

            log.info('Phát hiện SSL warning, đang bypass...', this.profileTag);

            // Click "Advanced" button
            const clickedAdvanced = await this.page.evaluate(() => {
                const advBtn = document.getElementById('details-button');
                if (advBtn) { advBtn.click(); return true; }
                const btns = document.querySelectorAll('button');
                for (const b of btns) {
                    if (b.textContent.toLowerCase().includes('advanced')) {
                        b.click(); return true;
                    }
                }
                return false;
            });

            if (clickedAdvanced) await sleep(1000);

            // Click "Continue to site" / "Proceed"
            const proceeded = await this.page.evaluate(() => {
                const proceedLink = document.getElementById('proceed-link');
                if (proceedLink) { proceedLink.click(); return true; }
                const links = document.querySelectorAll('a');
                for (const a of links) {
                    const text = a.textContent.toLowerCase();
                    if (text.includes('continue') || text.includes('proceed')) {
                        a.click(); return true;
                    }
                }
                return false;
            });

            if (proceeded) {
                log.info('Đã bypass SSL warning, chờ X load...', this.profileTag);
                try {
                    await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                } catch (e) { /* có thể không trigger navigation event */ }
                await sleep(3000);
            } else {
                log.warn('Không tìm thấy nút Continue/Proceed', this.profileTag);
            }
        } catch (err) {
            log.debug(`Bypass SSL lỗi: ${err.message}`, this.profileTag);
        }
    }

    /**
     * Kiểm tra account bị suspended/locked
     * Return: 'ok' | 'suspended' | 'locked'
     */
    async _checkAccountState() {
        try {
            const state = await this.page.evaluate(() => {
                const body = document.body?.innerText || '';
                const bodyLower = body.toLowerCase();

                // Suspended account
                if (bodyLower.includes('account is suspended') ||
                    bodyLower.includes('your account is suspended') ||
                    bodyLower.includes('account has been suspended')) {
                    return 'suspended';
                }

                // Check banner/notice elements
                const banners = document.querySelectorAll('[data-testid="primaryColumn"] div, [role="alert"]');
                for (const el of banners) {
                    const text = el.textContent.toLowerCase();
                    if (text.includes('suspended')) return 'suspended';
                    if (text.includes('locked') && text.includes('account')) return 'locked';
                }

                // Locked account (cần xác minh phone/email)
                if (bodyLower.includes('account is locked') ||
                    bodyLower.includes('your account has been locked') ||
                    bodyLower.includes('we\'ve detected unusual activity')) {
                    return 'locked';
                }

                // URL check
                const url = window.location.href;
                if (url.includes('/account/access')) return 'locked';
                if (url.includes('/suspended')) return 'suspended';

                return 'ok';
            });

            return state;
        } catch (err) {
            log.debug(`Check account state lỗi: ${err.message}`, this.profileTag);
            return 'ok'; // Mặc định ok nếu không check được
        }
    }

    async cleanup() {
        if (this.browser) {
            await BrowserManager.disconnect(this.browser, this.slotIndex);
            this.browser = null;
            this.page = null;
            this.slotIndex = null;
            log.debug('Đã disconnect Puppeteer', this.profileTag);
        }

        if (this.config.stop_profile_after_tasks !== false) {
            try {
                await this.genlogin.stopProfile(this.profileId);
                log.info('Đã stop profile GenLogin', this.profileTag);
            } catch (err) {
                log.warn(`Không thể stop profile: ${err.message}`, this.profileTag);
            }
        }
    }
}

module.exports = Worker;
