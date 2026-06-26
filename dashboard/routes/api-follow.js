/**
 * Follow Check API
 * POST /api/follow/scrape   — scrape following/followers list
 * POST /api/follow/stats    — fetch following/followers count per user (batch)
 * POST /api/follow/unfollow — unfollow selected users
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const GenLoginClient = require('../../core/genlogin');
const BrowserManager = require('../../core/browser');
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
    const conn = await BrowserManager.connect(wsEndpoint);
    return { genlogin, conn, config };
}

async function getXUsername(page) {
    page.once('dialog', async d => { await d.accept().catch(() => {}); });
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
    const username = await page.$eval(
        '[data-testid="AppTabBar_Profile_Link"]',
        el => (el.getAttribute('href') || '').replace('/', '').split('?')[0]
    ).catch(() => null);
    return username;
}

async function scrapeList(page, xUsername, type) {
    page.once('dialog', async d => { await d.accept().catch(() => {}); });
    await page.goto(`https://x.com/${xUsername}/${type}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);

    const users = new Map();
    let noNewCount = 0;

    while (noNewCount < 4) {
        const batch = await page.evaluate(() => {
            const cells = document.querySelectorAll('[data-testid="UserCell"]');
            const out = [];
            for (const cell of cells) {
                let username = null;
                const links = cell.querySelectorAll('a[href^="/"][role="link"]');
                for (const link of links) {
                    const href = link.getAttribute('href') || '';
                    const parts = href.split('/').filter(Boolean);
                    if (parts.length === 1 && !href.includes('/i/')) {
                        username = parts[0];
                        break;
                    }
                }
                if (!username) continue;

                const nameEl = cell.querySelector('div[dir="ltr"] span span');
                const displayName = nameEl ? nameEl.textContent.trim() : username;
                const isVerified = !!cell.querySelector('[data-testid="icon-verified"]');
                const followsYou = !!cell.querySelector('[data-testid="userFollowIndicator"]');

                out.push({ username, displayName, isVerified, followsYou });
            }
            return out;
        }).catch(() => []);

        let added = 0;
        for (const u of batch) {
            if (u.username && !users.has(u.username)) {
                users.set(u.username, u);
                added++;
            }
        }

        if (added === 0) noNewCount++;
        else noNewCount = 0;

        await page.evaluate(() => window.scrollBy(0, 1200));
        await sleep(1600);
    }

    return Array.from(users.values());
}

async function fetchStats(page, usernames) {
    const stats = {};
    for (const username of usernames) {
        try {
            page.once('dialog', async d => { await d.accept().catch(() => {}); });
            await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(1200);

            const data = await page.evaluate(() => {
                const parse = (text) => {
                    if (!text) return null;
                    text = text.trim().replace(/,/g, '');
                    if (text.endsWith('K')) return Math.round(parseFloat(text) * 1000);
                    if (text.endsWith('M')) return Math.round(parseFloat(text) * 1000000);
                    const n = parseInt(text);
                    return isNaN(n) ? null : n;
                };

                let following = null, followers = null;

                const followingLink = document.querySelector('a[href$="/following"]');
                if (followingLink) {
                    const s = followingLink.querySelector('span[dir="ltr"] > span') ||
                              followingLink.querySelector('span');
                    following = parse(s?.textContent);
                }

                // followers: try verified_followers first, then followers
                for (const suffix of ['/verified_followers', '/followers_you_follow', '/followers']) {
                    const link = document.querySelector(`a[href$="${suffix}"]`);
                    if (link) {
                        const s = link.querySelector('span[dir="ltr"] > span') ||
                                  link.querySelector('span');
                        const v = parse(s?.textContent);
                        if (v !== null) { followers = v; break; }
                    }
                }

                return { following, followers };
            });

            stats[username] = data;
        } catch {
            stats[username] = { following: null, followers: null };
        }
    }
    return stats;
}

async function unfollowUsers(page, usernames) {
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
            if (confirmBtn) {
                await confirmBtn.click();
                await sleep(1000);
            }

            unfollowed.push(username);
            await sleep(1500);
        } catch {
            failed.push(username);
        }
    }

    return { unfollowed, failed };
}

// ─── POST /api/follow/scrape ─────────────────────────────
router.post('/scrape', async (req, res) => {
    const { profileId, type } = req.body;
    if (!profileId || !['following', 'followers'].includes(type)) {
        return res.status(400).json({ error: 'Thiếu profileId hoặc type không hợp lệ' });
    }

    let conn = null;
    try {
        const { conn: c } = await connectProfile(profileId);
        conn = c;

        const xUsername = await getXUsername(conn.page);
        if (!xUsername) return res.status(400).json({ error: 'Không lấy được username X. Profile chưa login?' });

        const users = await scrapeList(conn.page, xUsername, type);
        res.json({ ok: true, xUsername, type, users, total: users.length });
    } catch (err) {
        log.error(`follow/scrape: ${err.message}`);
        res.status(500).json({ error: err.message });
    } finally {
        if (conn?.browser) await BrowserManager.disconnect(conn.browser, conn.slotIndex).catch(() => {});
    }
});

// ─── POST /api/follow/stats ──────────────────────────────
router.post('/stats', async (req, res) => {
    const { profileId, usernames } = req.body;
    if (!profileId || !Array.isArray(usernames) || usernames.length === 0) {
        return res.status(400).json({ error: 'Thiếu profileId hoặc usernames[]' });
    }

    let conn = null;
    try {
        const { conn: c } = await connectProfile(profileId);
        conn = c;

        const stats = await fetchStats(conn.page, usernames);
        res.json({ ok: true, stats });
    } catch (err) {
        log.error(`follow/stats: ${err.message}`);
        res.status(500).json({ error: err.message });
    } finally {
        if (conn?.browser) await BrowserManager.disconnect(conn.browser, conn.slotIndex).catch(() => {});
    }
});

// ─── POST /api/follow/unfollow ───────────────────────────
router.post('/unfollow', async (req, res) => {
    const { profileId, usernames } = req.body;
    if (!profileId || !Array.isArray(usernames) || usernames.length === 0) {
        return res.status(400).json({ error: 'Thiếu profileId hoặc usernames[]' });
    }

    let conn = null;
    try {
        const { conn: c } = await connectProfile(profileId);
        conn = c;

        const result = await unfollowUsers(conn.page, usernames);
        res.json({ ok: true, ...result });
    } catch (err) {
        log.error(`follow/unfollow: ${err.message}`);
        res.status(500).json({ error: err.message });
    } finally {
        if (conn?.browser) await BrowserManager.disconnect(conn.browser, conn.slotIndex).catch(() => {});
    }
});

module.exports = router;
