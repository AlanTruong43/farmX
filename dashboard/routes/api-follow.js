/**
 * Follow Check API
 * GET  /api/follow/stream    — SSE: scrape + hover từng user, stream progressive
 * POST /api/follow/unfollow  — unfollow selected users
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const GenLoginClient = require('../../core/genlogin');
const BrowserManager = require('../../core/browser');
const appState = require('../../core/state');
const log = require('../../utils/logger');

const CONFIG_PATH = path.resolve(__dirname, '../../config.json');

function readConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function connectProfile(profileId) {
    const config = readConfig();
    const genlogin = new GenLoginClient(config.genlogin_url);
    const { wsEndpoint } = await genlogin.startProfile(profileId);
    const fcWin = config.follow_check_window || {};
    const conn = await BrowserManager.connectFollowCheck(wsEndpoint, fcWin.width || 1280, fcWin.height || 900);
    return { genlogin, conn, config };
}

async function getXUsername(page) {
    page.once('dialog', async d => { await d.accept().catch(() => {}); });
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
    return page.$eval(
        '[data-testid="AppTabBar_Profile_Link"]',
        el => (el.getAttribute('href') || '').replace('/', '').split('?')[0]
    ).catch(() => null);
}

// Parse "1.2K" / "3M" / "456" → number
function parseCount(text) {
    if (!text) return null;
    text = text.trim().replace(/,/g, '');
    if (text.endsWith('K')) return Math.round(parseFloat(text) * 1000);
    if (text.endsWith('M')) return Math.round(parseFloat(text) * 1000000);
    const n = parseInt(text);
    return isNaN(n) ? null : n;
}

// Lấy stats từ hover card đang hiển thị trên page
async function getHoverCardStats(page) {
    return page.evaluate((parseCountSrc) => {
        const parse = new Function('return ' + parseCountSrc)();
        const card = document.querySelector('[data-testid="HoverCard"]');
        if (!card) return null;

        let following = null, followers = null;

        const followingLink = card.querySelector('a[href$="/following"]');
        if (followingLink) {
            const s = followingLink.querySelector('span[dir="ltr"] > span') || followingLink.querySelector('span');
            following = parse(s?.textContent);
        }
        for (const suffix of ['/verified_followers', '/followers_you_follow', '/followers']) {
            const link = card.querySelector(`a[href$="${suffix}"]`);
            if (link) {
                const s = link.querySelector('span[dir="ltr"] > span') || link.querySelector('span');
                const v = parse(s?.textContent);
                if (v !== null) { followers = v; break; }
            }
        }

        const followsYou =
            !!card.querySelector('[data-testid="userFollowIndicator"]') ||
            card.innerText.toLowerCase().includes('follows you');

        return { following, followers, followsYou };
    }, parseCount.toString());
}

// ─── GET /api/follow/stream (SSE) ────────────────────────
router.get('/stream', async (req, res) => {
    const { profileId, type } = req.query;
    if (!profileId || !['following', 'followers'].includes(type)) {
        return res.status(400).json({ error: 'Thiếu profileId hoặc type (following|followers)' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let clientClosed = false;
    req.on('close', () => { clientClosed = true; });

    const send = (event, data) => {
        if (clientClosed) return;
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    // Reject nếu profile đang được farming
    if (appState.farmingActive) {
        for (const [tag, data] of appState.activeProfiles) {
            if (data.status === 'farming' || data.status === 'starting') {
                if (tag === profileId || profileId.toString().startsWith(tag)) {
                    send('error', { message: `Profile đang được farming (${tag}). Dừng farming trước hoặc chọn profile khác.` });
                    res.end();
                    return;
                }
            }
        }
    }

    let conn = null;
    let genlogin = null;
    try {
        const { conn: c, genlogin: g } = await connectProfile(profileId);
        conn = c;
        genlogin = g;
        const page = conn.page;

        const xUsername = await getXUsername(page);
        if (!xUsername) { send('error', { message: 'Không lấy được username X. Profile chưa login?' }); return; }

        log.info(`follow/stream: @${xUsername} — ${type} (profile ${profileId})`);
        send('meta', { xUsername, type });

        page.once('dialog', async d => { await d.accept().catch(() => {}); });
        await page.goto(`https://x.com/${xUsername}/${type}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2500);

        const seen = new Set();
        let noNewCount = 0;

        while (noNewCount < 4) {
            if (clientClosed || res.writableEnded) break;

            // Lấy tất cả UserCell trong primaryColumn (tránh sidebar)
            const cells = await page.evaluate(() => {
                const primary = document.querySelector('[data-testid="primaryColumn"]') || document;
                return [...primary.querySelectorAll('[data-testid="UserCell"]')].map(cell => {
                    // username
                    let username = null;
                    for (const link of cell.querySelectorAll('a[href^="/"][role="link"]')) {
                        const parts = (link.getAttribute('href') || '').split('/').filter(Boolean);
                        if (parts.length === 1 && !link.href.includes('/i/')) { username = parts[0]; break; }
                    }
                    if (!username) return null;

                    // display name
                    const nameEl = cell.querySelector('div[dir="ltr"] span span');
                    const displayName = nameEl?.textContent.trim() || username;

                    // avatar
                    const img = cell.querySelector('img[src*="profile_images"]') || cell.querySelector('img[src*="pbs.twimg"]');
                    const avatarUrl = img ? img.src.replace('_normal', '_bigger') : null;

                    // verified type:
                    // - Gold tick dùng <linearGradient> bên trong SVG (không có fill màu đơn)
                    // - Blue tick dùng SVG với path fill đơn màu xanh
                    let verifiedType = null;
                    const verifiedEl = cell.querySelector('[data-testid="icon-verified"]');
                    if (verifiedEl) {
                        const svgHtml = verifiedEl.innerHTML;
                        // Gold: có linearGradient hoặc stop-color vàng
                        const isGold = svgHtml.includes('linearGradient')
                            || /stop-color.*#f4e|stop-color.*#cd8|stop-color.*#cb7/i.test(svgHtml)
                            || /ffd400|f4e72a|cd8105|cb7b00/i.test(svgHtml);
                        verifiedType = isGold ? 'gold' : 'blue';
                    }

                    // vị trí để hover (giữa phần tên)
                    const nameLink = cell.querySelector('a[href^="/"][role="link"]');
                    const rect = nameLink ? nameLink.getBoundingClientRect() : cell.getBoundingClientRect();
                    const vh = window.innerHeight;

                    return {
                        username,
                        displayName,
                        avatarUrl,
                        verifiedType,
                        hoverX: rect.left + rect.width / 2,
                        hoverY: rect.top + rect.height / 2,
                        inViewport: rect.top >= 0 && rect.bottom <= vh,
                    };
                }).filter(Boolean);
            }).catch(() => []);

            let added = 0;
            for (const cell of cells) {
                if (!cell.username || seen.has(cell.username.toLowerCase())) continue;
                if (!cell.inViewport) continue;

                seen.add(cell.username.toLowerCase());
                added++;

                // Emit user ngay — frontend hiện row
                log.debug(`follow/stream: user #${seen.size} @${cell.username}${cell.verifiedType ? ' [' + cell.verifiedType + ']' : ''}`);
                send('user', {
                    username: cell.username,
                    displayName: cell.displayName,
                    avatarUrl: cell.avatarUrl,
                    verifiedType: cell.verifiedType,
                });

                // Hover để lấy stats
                try {
                    await page.mouse.move(cell.hoverX, cell.hoverY);
                    const hoverCard = await page.waitForSelector('[data-testid="HoverCard"]', { timeout: 3000 }).catch(() => null);

                    if (hoverCard) {
                        await sleep(400); // chờ số liệu render
                        const stats = await getHoverCardStats(page);
                        if (stats) {
                            log.debug(`follow/stream: stats @${cell.username} — following=${stats.following} followers=${stats.followers} followsYou=${stats.followsYou}`);
                            send('stats', { username: cell.username, ...stats, error: false });
                        } else {
                            log.warn(`follow/stream: không lấy được stats @${cell.username}`);
                            send('stats', { username: cell.username, following: null, followers: null, followsYou: null, error: true });
                        }
                        // Dismiss hover card
                        await page.mouse.move(10, 400);
                        await sleep(300);
                    } else {
                        log.warn(`follow/stream: không thấy hover card @${cell.username}`);
                        send('stats', { username: cell.username, following: null, followers: null, followsYou: null, error: true });
                    }
                } catch {
                    send('stats', { username: cell.username, following: null, followers: null, followsYou: false });
                }

                await sleep(300);
            }

            if (added === 0) noNewCount++;
            else noNewCount = 0;

            await page.evaluate(() => window.scrollBy(0, 900));
            await sleep(1500);
        }

        log.info(`follow/stream: hoàn thành — ${seen.size} người (profile ${profileId})`);
        send('done', { total: seen.size });
    } catch (err) {
        log.error(`follow/stream: ${err.message}`);
        send('error', { message: err.message });
    } finally {
        res.end();
        if (conn?.browser) await BrowserManager.disconnect(conn.browser).catch(() => {});
        if (genlogin) await genlogin.stopProfile(profileId).catch(() => {});
    }
});

// ─── POST /api/follow/unfollow (SSE stream) ──────────────
// Scroll qua danh sách, click nút "Following" inline, stream progress về client.
// Client có thể abort (close connection) để dừng.
router.post('/unfollow', async (req, res) => {
    const { profileId, usernames, xUsername, type, batchSize = 10, batchDelaySec = 10 } = req.body;
    if (!profileId || !Array.isArray(usernames) || usernames.length === 0 || !xUsername || !type) {
        return res.status(400).json({ error: 'Thiếu profileId, usernames[], xUsername hoặc type' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    // Dùng res.destroyed thay vì req.on('close') —
    // req close có thể fire ngay sau khi body được đọc (Express body-parser),
    // còn res.destroyed chỉ true khi client thực sự ngắt kết nối.
    const isStopped = () => res.destroyed || res.writableEnded;

    const send = (event, data) => {
        if (isStopped()) return;
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    let conn = null;
    let genlogin = null;
    try {
        const { conn: c, genlogin: g } = await connectProfile(profileId);
        conn = c;
        genlogin = g;
        const page = conn.page;

        log.info(`follow/unfollow: bắt đầu ${usernames.length} người từ ${type} của @${xUsername} (batch=${batchSize} delay=${batchDelaySec}s)`);

        page.once('dialog', async d => { await d.accept().catch(() => {}); });
        await page.goto(`https://x.com/${xUsername}/${type}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2500);

        // Map lowercase → username gốc để giữ đúng case khi trả về
        const usernameMap = new Map(usernames.map(u => [u.toLowerCase(), u]));
        const toUnfollow = new Set(usernameMap.keys());
        const unfollowed = [], failed = [];
        const total = usernames.length;
        const seenCells = new Set(); // tất cả username đã thấy — để phát hiện cuối trang
        let noNewCells = 0;         // consecutive scrolls không có cell mới = cuối trang
        let doneCount = 0;

        // Scroll qua toàn bộ danh sách như scan loop — dừng khi không có cell mới
        while (toUnfollow.size > 0 && noNewCells < 5) {
            if (isStopped()) { send('stopped', {}); break; }

            // Lấy tất cả UserCell hiện tại trong primaryColumn
            const cells = await page.evaluate(() => {
                const primary = document.querySelector('[data-testid="primaryColumn"]') || document;
                const vh = window.innerHeight;
                return [...primary.querySelectorAll('[data-testid="UserCell"]')].map(cell => {
                    let username = null;
                    for (const link of cell.querySelectorAll('a[href^="/"][role="link"]')) {
                        const parts = (link.getAttribute('href') || '').split('/').filter(Boolean);
                        if (parts.length === 1 && !link.href.includes('/i/')) { username = parts[0]; break; }
                    }
                    if (!username) return null;
                    const btn = cell.querySelector('[data-testid$="-unfollow"]');
                    const rect = btn ? btn.getBoundingClientRect() : cell.getBoundingClientRect();
                    return {
                        username,
                        hasBtn: !!btn,
                        inViewport: rect.top >= 0 && rect.bottom <= vh,
                    };
                }).filter(Boolean);
            }).catch(() => []);

            // Đếm cell mới để phát hiện cuối trang
            let newCellCount = 0;
            for (const c of cells) {
                if (!seenCells.has(c.username.toLowerCase())) {
                    seenCells.add(c.username.toLowerCase());
                    newCellCount++;
                }
            }

            // Tìm target đầu tiên trong viewport và unfollow
            let clicked = false;
            for (const cell of cells) {
                if (!cell.inViewport || !cell.hasBtn) continue;
                if (!toUnfollow.has(cell.username.toLowerCase())) continue;

                const clickedUsername = cell.username;
                await page.evaluate((uname) => {
                    const primary = document.querySelector('[data-testid="primaryColumn"]') || document;
                    for (const cell of primary.querySelectorAll('[data-testid="UserCell"]')) {
                        let u = null;
                        for (const link of cell.querySelectorAll('a[href^="/"][role="link"]')) {
                            const parts = (link.getAttribute('href') || '').split('/').filter(Boolean);
                            if (parts.length === 1 && !link.href.includes('/i/')) { u = parts[0]; break; }
                        }
                        if (u?.toLowerCase() === uname) {
                            const btn = cell.querySelector('[data-testid$="-unfollow"]');
                            if (btn) btn.click();
                            break;
                        }
                    }
                }, clickedUsername.toLowerCase());

                await sleep(2000); // chờ dialog
                if (isStopped()) { send('stopped', {}); break; }

                const confirmBtn = await page.waitForSelector('[data-testid="confirmationSheetConfirm"]', { timeout: 4000 }).catch(() => null);
                if (confirmBtn) {
                    await confirmBtn.click();
                    await sleep(2000);
                    const key = clickedUsername.toLowerCase();
                    toUnfollow.delete(key);
                    const orig = usernameMap.get(key) || clickedUsername;
                    unfollowed.push(orig);
                    doneCount++;
                    log.debug(`follow/unfollow: ✓ @${orig} (${doneCount}/${total}, còn ${toUnfollow.size})`);
                    send('progress', { username: orig, done: doneCount, total, remaining: toUnfollow.size });

                    if (doneCount % batchSize === 0 && toUnfollow.size > 0) {
                        log.info(`follow/unfollow: nghỉ ${batchDelaySec}s sau ${doneCount} lần`);
                        send('waiting', { seconds: batchDelaySec, after: doneCount });
                        for (let i = 0; i < batchDelaySec; i++) {
                            if (isStopped()) break;
                            await sleep(1000);
                        }
                    }
                } else {
                    const key = clickedUsername.toLowerCase();
                    toUnfollow.delete(key);
                    failed.push(usernameMap.get(key) || clickedUsername);
                    log.warn(`follow/unfollow: không thấy confirm cho @${clickedUsername}`);
                }
                clicked = true;
                break; // xử lý từng người một
            }

            if (newCellCount === 0 && !clicked) {
                noNewCells++;
            } else {
                noNewCells = 0;
            }

            if (!clicked) {
                // Scroll xuống để tải thêm
                await page.evaluate(() => window.scrollBy(0, 900));
                await sleep(1500);
            }
        }

        for (const key of toUnfollow) failed.push(usernameMap.get(key) || key);

        log.info(`follow/unfollow: xong — ${unfollowed.length} thành công, ${failed.length} không tìm thấy`);
        send('done', { unfollowed, failed, ok: true });
    } catch (err) {
        log.error(`follow/unfollow: ${err.message}`);
        send('error', { message: err.message });
    } finally {
        res.end();
        if (conn?.browser) await BrowserManager.disconnect(conn.browser).catch(() => {});
        if (genlogin) await genlogin.stopProfile(profileId).catch(() => {});
    }
});

module.exports = router;
