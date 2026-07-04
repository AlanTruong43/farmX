/**
 * Follow Check API
 * POST /api/follow/scrape   — scrape following/followers list (includes stats via GraphQL intercept)
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

/**
 * Duyệt đệ quy JSON response từ GraphQL của X để tìm user data
 * Điền vào gqlData map: username -> { avatarUrl, following, followers, isBlueVerified, isGoldVerified }
 */
function walkForUsers(obj, gqlData, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;

    // Pattern: { user_results: { result: { legacy: {...}, is_blue_verified, affiliates_highlighted_label } } }
    if (obj.user_results?.result?.legacy) {
        const result = obj.user_results.result;
        const legacy = result.legacy;
        const username = legacy?.screen_name;
        if (username) {
            gqlData.set(username.toLowerCase(), {
                avatarUrl: (legacy.profile_image_url_https || '').replace('_normal', '_bigger'),
                following: legacy.friends_count ?? null,
                followers: legacy.followers_count ?? null,
                isBlueVerified: result.is_blue_verified === true,
                isGoldVerified: !!(result.affiliates_highlighted_label?.label?.badge?.url),
            });
        }
        return;
    }

    if (Array.isArray(obj)) {
        for (const item of obj) walkForUsers(item, gqlData, depth + 1);
    } else {
        for (const val of Object.values(obj)) {
            if (val && typeof val === 'object') walkForUsers(val, gqlData, depth + 1);
        }
    }
}

async function scrapeList(page, xUsername, type) {
    const gqlData = new Map();

    // Intercept X GraphQL responses — lấy avatar, counts, verified type mà không cần navigate thêm
    const onResponse = async (res) => {
        const url = res.url();
        if (!url.includes('/graphql/')) return;
        const lower = url.toLowerCase();
        if (!lower.includes('following') && !lower.includes('followers')) return;
        try {
            const json = await res.json().catch(() => null);
            if (json) walkForUsers(json, gqlData);
        } catch {}
    };

    page.on('response', onResponse);

    try {
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
                    // Username từ link
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

                    // Display name
                    const nameEl = cell.querySelector('div[dir="ltr"] span span');
                    const displayName = nameEl ? nameEl.textContent.trim() : username;

                    // Avatar URL từ img tag
                    const img = cell.querySelector('img[src*="profile_images"]') || cell.querySelector('img[src*="pbs.twimg"]');
                    const avatarUrl = img ? img.src.replace('_normal', '_bigger') : null;

                    // Follows you
                    const followsYou = !!cell.querySelector('[data-testid="userFollowIndicator"]');

                    // Verified type — kiểm tra màu SVG (blue #1d9bf0, gold #FFD400)
                    let verifiedType = null;
                    const verifiedEl = cell.querySelector('[data-testid="icon-verified"]');
                    if (verifiedEl) {
                        const html = verifiedEl.innerHTML || '';
                        const outerHtml = verifiedEl.outerHTML || '';
                        if (/FFD400|ffd400|f4d144|gold/i.test(html + outerHtml)) {
                            verifiedType = 'gold';
                        } else {
                            verifiedType = 'blue';
                        }
                    }

                    out.push({ username, displayName, avatarUrl, followsYou, verifiedType });
                }
                return out;
            }).catch(() => []);

            let added = 0;
            for (const u of batch) {
                if (u.username && !users.has(u.username.toLowerCase())) {
                    users.set(u.username.toLowerCase(), u);
                    added++;
                }
            }

            if (added === 0) noNewCount++;
            else noNewCount = 0;

            await page.evaluate(() => window.scrollBy(0, 1200));
            await sleep(1600);
        }

        // Đợi thêm chút để các response cuối cùng về xong
        await sleep(1000);

        // Merge GQL data vào users
        const result = [];
        for (const [key, user] of users) {
            const gql = gqlData.get(key);
            if (gql) {
                if (!user.avatarUrl && gql.avatarUrl) user.avatarUrl = gql.avatarUrl;
                user.following = gql.following;
                user.followers = gql.followers;
                if (gql.isBlueVerified) user.verifiedType = 'blue';
                if (gql.isGoldVerified) user.verifiedType = 'gold';
            }
            result.push(user);
        }

        return result;
    } finally {
        page.off('response', onResponse);
    }
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
        return res.status(400).json({ error: 'Thiếu profileId hoặc type không hợp lệ (following | followers)' });
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
