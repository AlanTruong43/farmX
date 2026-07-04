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

        send('meta', { xUsername, type });

        page.once('dialog', async d => { await d.accept().catch(() => {}); });
        await page.goto(`https://x.com/${xUsername}/${type}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2500);

        const seen = new Set();
        let noNewCount = 0;

        while (noNewCount < 4) {
            if (clientClosed || res.writableEnded) break;

            // Lấy tất cả UserCell hiện tại + toạ độ viewport của chúng
            const cells = await page.evaluate(() => {
                return [...document.querySelectorAll('[data-testid="UserCell"]')].map(cell => {
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

                    // verified type
                    let verifiedType = null;
                    const verifiedEl = cell.querySelector('[data-testid="icon-verified"]');
                    if (verifiedEl) {
                        verifiedType = /FFD400|ffd400/i.test(verifiedEl.innerHTML) ? 'gold' : 'blue';
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
                        if (stats) send('stats', { username: cell.username, ...stats });
                        else send('stats', { username: cell.username, following: null, followers: null, followsYou: false });
                        // Dismiss hover card
                        await page.mouse.move(10, 400);
                        await sleep(300);
                    } else {
                        send('stats', { username: cell.username, following: null, followers: null, followsYou: false });
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

// ─── POST /api/follow/unfollow ───────────────────────────
router.post('/unfollow', async (req, res) => {
    const { profileId, usernames } = req.body;
    if (!profileId || !Array.isArray(usernames) || usernames.length === 0) {
        return res.status(400).json({ error: 'Thiếu profileId hoặc usernames[]' });
    }

    let conn = null;
    let genlogin = null;
    try {
        const { conn: c, genlogin: g } = await connectProfile(profileId);
        conn = c;
        genlogin = g;
        const page = conn.page;
        const unfollowed = [], failed = [];

        for (const username of usernames) {
            try {
                page.once('dialog', async d => { await d.accept().catch(() => {}); });
                await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await sleep(2000);

                const unfollowBtn = await page.$('[data-testid$="-unfollow"]');
                if (!unfollowBtn) { failed.push(username); continue; }

                await unfollowBtn.click();
                await sleep(1000);
                const confirmBtn = await page.$('[data-testid="confirmationSheetConfirm"]');
                if (confirmBtn) { await confirmBtn.click(); await sleep(1000); }

                unfollowed.push(username);
                await sleep(1500);
            } catch { failed.push(username); }
        }

        res.json({ ok: true, unfollowed, failed });
    } catch (err) {
        log.error(`follow/unfollow: ${err.message}`);
        res.status(500).json({ error: err.message });
    } finally {
        if (conn?.browser) await BrowserManager.disconnect(conn.browser).catch(() => {});
        if (genlogin) await genlogin.stopProfile(profileId).catch(() => {});
    }
});

module.exports = router;
