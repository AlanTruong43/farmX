/**
 * X-Farmer Engine
 * Hai chế độ farm:
 *   1. Newsfeed — lướt feed, random like, random comment (AI)
 *   2. Hashtag  — tìm theo hashtag, lướt + random like/comment
 */
const { sleep, randomDelay, humanScroll } = require('../utils/human');
const selectors = require('../utils/selectors');
const log = require('../utils/logger');
const { createAIProvider } = require('./ai-factory');

class Farmer {
    constructor(page, config, profileTag = '') {
        this.page = page;
        this.config = config;
        this.farming = config.farming || {};
        this.profileTag = profileTag;
        this.ai = createAIProvider(config);

        // Farming settings
        this.interactProbability = this.farming.interact_probability ?? 0.1;
        this.maxTweetsPerLoop = this.farming.max_tweets_per_loop ?? 10;
        this.scrollDuration = this.farming.scroll_duration_seconds ?? 15;
        this.minActionDelay = this.farming.min_delay_between_actions_ms ?? 3000;
        this.maxActionDelay = this.farming.max_delay_between_actions_ms ?? 8000;

        // Track tweets đã xử lý (tránh xử lý lại sau scroll)
        this._processedTweetIds = new Set();
    }

    // ═══════════════════════════════════════════════════════════════════
    // CHẾ ĐỘ 1: NEWSFEED
    // ═══════════════════════════════════════════════════════════════════
    async farmNewsfeed() {
        log.action('🌾 Chế độ NEWSFEED — lướt feed, like & comment', this.profileTag);

        await this.page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 30000 });
        await randomDelay(3000, 5000);

        // Scroll warm-up trước
        log.info(`Warm-up: scroll feed ${this.scrollDuration}s...`, this.profileTag);
        await this._scrollFeed(this.scrollDuration);

        // Bắt đầu farm
        return await this._processTweetsOnPage();
    }

    // ═══════════════════════════════════════════════════════════════════
    // CHẾ ĐỘ 2: HASHTAG
    // ═══════════════════════════════════════════════════════════════════
    async farmHashtag(hashtag) {
        log.action(`🔍 Chế độ HASHTAG — tìm kiếm: ${hashtag}`, this.profileTag);

        // Vào trang tìm kiếm
        await this.page.goto('https://x.com/explore', { waitUntil: 'networkidle2', timeout: 30000 });
        await randomDelay(2000, 4000);

        // Click vào ô tìm kiếm
        const searchInput = await this.page.waitForSelector(
            'input[data-testid="SearchBox_Search_Input"]',
            { visible: true, timeout: 10000 }
        ).catch(() => null);

        if (!searchInput) {
            // Fallback: navigate trực tiếp
            log.debug('Không tìm thấy ô search, navigate trực tiếp...', this.profileTag);
            const encoded = encodeURIComponent(hashtag);
            await this.page.goto(`https://x.com/search?q=${encoded}&src=typed_query&f=live`, {
                waitUntil: 'networkidle2', timeout: 30000
            });
        } else {
            await searchInput.click();
            await sleep(500);
            await this.page.keyboard.type(hashtag, { delay: Math.floor(Math.random() * 100) + 50 });
            await sleep(800);
            await this.page.keyboard.press('Enter');
            await randomDelay(3000, 5000);

            // Click tab "Latest" để xem bài mới nhất
            try {
                const latestTab = await this.page.waitForSelector('a[href*="f=live"]', { timeout: 5000 });
                if (latestTab) {
                    await latestTab.click();
                    await randomDelay(2000, 3000);
                }
            } catch {
                // Tab có thể đã active sẵn
            }
        }

        // Scroll warm-up
        log.info(`Warm-up: scroll kết quả ${this.scrollDuration}s...`, this.profileTag);
        await this._scrollFeed(this.scrollDuration);

        // Farm tweets
        return await this._processTweetsOnPage();
    }

    // ═══════════════════════════════════════════════════════════════════
    // XỬ LÝ TWEETS TRÊN PAGE (dùng chung cho cả 2 chế độ)
    //
    // V2: Pre-fetch AI comment song song trong khi like + delay
    //     Like và AI request chạy đồng thời khi có thể
    // ═══════════════════════════════════════════════════════════════════
    async _processTweetsOnPage() {
        let processedCount = 0;
        let likedCount = 0;
        let commentedCount = 0;
        let followedCount = 0;
        const likedUrls = [];
        const commentedUrls = [];
        this._processedTweetIds.clear();

        // Scroll lên đầu page trước
        await this.page.evaluate(() => window.scrollTo(0, 0));
        await sleep(1000);

        for (let i = 0; i < this.maxTweetsPerLoop + 5; i++) {
            if (processedCount >= this.maxTweetsPerLoop) break;

            // Tìm tất cả tweet articles trên page
            const tweets = await this.page.$$(selectors.feed.tweetArticle);

            if (tweets.length === 0) {
                log.debug('Không tìm thấy tweet nào, scroll thêm...', this.profileTag);
                await humanScroll(this.page, { scrolls: 3 });
                await randomDelay(2000, 4000);
                continue;
            }

            // Xử lý tweet đang visible
            for (const tweet of tweets) {
                if (processedCount >= this.maxTweetsPerLoop) break;

                try {
                    // Check element vẫn còn trong DOM
                    const isAttached = await tweet.evaluate(el => el.isConnected).catch(() => false);
                    if (!isAttached) continue;

                    const isVisible = await tweet.isIntersectingViewport().catch(() => false);
                    if (!isVisible) continue;

                    // Tạo unique ID — check trước khi scroll
                    const tweetId = await tweet.evaluate(el => {
                        const link = el.querySelector('a[href*="/status/"]');
                        return link ? link.getAttribute('href') : null;
                    }).catch(() => null);

                    if (tweetId && this._processedTweetIds.has(tweetId)) continue;

                    // Đọc nội dung tweet
                    const tweetData = await this._extractTweetData(tweet);
                    if (!tweetData) continue;

                    // Language filter — check trước khi scroll
                    if (this.languageFilter === 'vi' && !this._isVietnamese(tweetData.text)) {
                        if (tweetId) this._processedTweetIds.add(tweetId);
                        log.info('⏭ Skip (không phải tiếng Việt)', this.profileTag);
                        continue;
                    }

                    // Chỉ scroll vào giữa khi thật sự tương tác
                    if (tweetId) this._processedTweetIds.add(tweetId);
                    await tweet.evaluate(el => {
                        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        el.style.outline = '2px solid red';
                    }).catch(() => {});
                    await randomDelay(800, 1500);
                    await tweet.evaluate(el => { el.style.outline = ''; }).catch(() => {});

                    processedCount++;
                    const shouldInteract = Math.random() < this.interactProbability;
                    if (shouldInteract) {
                        log.info(`→ Đang xử lý bài viết thứ ${processedCount}/${this.maxTweetsPerLoop}`, this.profileTag);
                    } else {
                        log.info(`→ Bỏ qua bài viết ${processedCount}/${this.maxTweetsPerLoop}`, this.profileTag);
                    }

                    // Pre-fetch AI comment song song với các actions khác
                    let commentPromise = null;
                    if (shouldInteract) {
                        log.debug('Pre-fetch AI comment...', this.profileTag);
                        commentPromise = this.ai.generateComment(tweetData, this.profileTag)
                            .catch(err => {
                                log.debug(`AI pre-fetch lỗi: ${err.message}`, this.profileTag);
                                return null;
                            });
                    }

                    // Like
                    if (shouldInteract) {
                        const liked = await this._likeTweet(tweet);
                        if (liked) {
                            likedCount++;
                            if (tweetId) likedUrls.push('https://x.com' + tweetId);
                            await randomDelay(this.minActionDelay, this.maxActionDelay);
                        }
                    }

                    // Follow
                    if (shouldInteract) {
                        const followed = await this._followUser(tweet);
                        if (followed) {
                            followedCount++;
                            await randomDelay(this.minActionDelay, this.maxActionDelay);
                        }
                    }

                    // Comment
                    if (commentPromise) {
                        const commentText = await commentPromise;
                        if (commentText) {
                            const commented = await this._submitComment(tweet, commentText);
                            if (commented) {
                                commentedCount++;
                                if (tweetId) commentedUrls.push('https://x.com' + tweetId);
                                await randomDelay(this.minActionDelay, this.maxActionDelay);
                            }
                        }
                    }

                } catch (err) {
                    log.debug(`Bỏ qua tweet: ${err.message}`, this.profileTag);
                }
            }

            // Scroll xuống tìm thêm tweets
            await humanScroll(this.page, { scrolls: 2, minPause: 1000, maxPause: 2500 });
            await randomDelay(1500, 3000);
        }

        log.success(
            `Kết quả: ${processedCount} tweets xử lý | ${likedCount} liked | ${followedCount} followed | ${commentedCount} commented`,
            this.profileTag
        );

        return { processedCount, likedCount, commentedCount, followedCount, likedUrls, commentedUrls };
    }

    // ─── Trích xuất nội dung tweet ───────────────────────────────────
    async _extractTweetData(tweetElement) {
        try {
            const data = await tweetElement.evaluate((el) => {
                const tweetTextEl = el.querySelector('div[data-testid="tweetText"]');
                const text = tweetTextEl ? tweetTextEl.innerText : '';
                const authorEl = el.querySelector('div[data-testid="User-Name"]');
                const authorName = authorEl ? authorEl.innerText.split('\n')[0] : '';
                const imgEl = el.querySelector('div[data-testid="tweetPhoto"] img');
                const hasImage = !!imgEl;
                const imageAlt = imgEl ? imgEl.getAttribute('alt') || '' : '';
                const videoEl = el.querySelector('div[data-testid="videoPlayer"]');
                const hasVideo = !!videoEl;
                const unlikeBtn = el.querySelector('button[data-testid="unlike"]');
                const alreadyLiked = !!unlikeBtn;
                return { text, authorName, hasImage, imageAlt, hasVideo, alreadyLiked };
            });
            return data;
        } catch {
            return null;
        }
    }

    // ─── Like tweet ──────────────────────────────────────────────────
    async _likeTweet(tweetElement) {
        try {
            const likeBtn = await tweetElement.$(selectors.tweet.likeBtn);
            if (!likeBtn) return false;
            await likeBtn.click();
            log.success('❤️  Liked', this.profileTag);
            return true;
        } catch (err) {
            log.debug(`Like lỗi: ${err.message}`, this.profileTag);
            return false;
        }
    }

    // ─── Detect tiếng Việt bằng regex ký tự có dấu ───────────────────
    _isVietnamese(text) {
        if (!text || text.trim().length < 5) return false;
        const viPattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸ]/;
        return viPattern.test(text);
    }

    // ─── Follow người đăng bài qua hover card ────────────────────────
    async _followUser(tweetElement) {
        try {
            const avatar = await tweetElement.$(selectors.tweet.userAvatar);
            if (!avatar) return false;

            // Hover để mở hover card
            await avatar.hover();
            await randomDelay(1200, 2000);

            // Chờ hover card xuất hiện
            const hoverCard = await this.page.waitForSelector(
                '[data-testid="HoverCard"]',
                { visible: true, timeout: 5000 }
            ).catch(() => null);

            if (!hoverCard) {
                log.debug('Hover card không xuất hiện', this.profileTag);
                await this.page.mouse.move(400, 400);
                return false;
            }

            // Kiểm tra trạng thái nút
            const btnText = await hoverCard.evaluate(card => {
                const buttons = card.querySelectorAll('button');
                for (const btn of buttons) {
                    const text = btn.textContent.trim();
                    if (text === 'Following' || text === 'Follow back') return text;
                    if (text === 'Follow') return 'Follow';
                }
                return null;
            });

            if (!btnText || btnText === 'Following') {
                if (btnText === 'Following') log.debug('Đã follow trước đó', this.profileTag);
                await this.page.mouse.move(400, 400);
                return false;
            }

            if (btnText === 'Follow back') {
                log.debug('Follow back — bỏ qua follow', this.profileTag);
                await this.page.mouse.move(400, 400);
                return false;
            }

            // Tìm và click nút Follow bằng Puppeteer (không dùng DOM click)
            const allBtns = await hoverCard.$$('button');
            let clicked = false;
            for (const btn of allBtns) {
                const text = await btn.evaluate(el => el.textContent.trim());
                if (text === 'Follow') {
                    await btn.click();
                    clicked = true;
                    break;
                }
            }

            if (clicked) {
                await randomDelay(800, 1500);
                log.success('➕ Followed', this.profileTag);
                await this.page.mouse.move(400, 400);
                await randomDelay(400, 700);
                return true;
            }

            await this.page.mouse.move(400, 400);
            return false;
        } catch (err) {
            log.debug(`Follow lỗi: ${err.message}`, this.profileTag);
            await this.page.mouse.move(400, 400).catch(() => {});
            return false;
        }
    }

    // ─── Comment tweet (AI-generated) ────────────────────────────────
    // Giữ lại cho backward compat (nếu gọi trực tiếp)
    async _commentTweet(tweetElement, tweetData) {
        try {
            log.debug('Đang gọi AI tạo comment...', this.profileTag);
            const commentText = await this.ai.generateComment(tweetData, this.profileTag);
            if (!commentText) return false;
            return await this._submitComment(tweetElement, commentText);
        } catch (err) {
            log.debug(`Comment lỗi: ${err.message}`, this.profileTag);
            await this._dismissDialog();
            return false;
        }
    }

    // ─── Submit comment text vào reply dialog ─────────────────────────
    // Tách riêng phần UI để dùng với pre-fetched AI text
    async _submitComment(tweetElement, commentText) {
        try {
            // Click nút reply trên tweet
            const replyBtn = await tweetElement.$(selectors.tweet.replyBtn);
            if (!replyBtn) {
                log.debug('Không tìm thấy nút reply', this.profileTag);
                return false;
            }

            await replyBtn.click();
            await randomDelay(1500, 3000);

            // Tìm text area trong reply dialog
            const textArea = await this.page.waitForSelector(
                selectors.reply.textArea,
                { visible: true, timeout: 8000 }
            ).catch(() => null);

            if (!textArea) {
                log.debug('Không tìm thấy ô nhập reply', this.profileTag);
                await this._dismissDialog();
                return false;
            }

            // Gõ comment
            await textArea.click();
            await sleep(500);
            await this.page.keyboard.type(commentText, {
                delay: Math.floor(Math.random() * 80) + 30
            });
            await randomDelay(1000, 2000);

            // Submit
            const submitBtn = await this.page.$(selectors.reply.replySubmitBtn);
            if (!submitBtn) {
                log.debug('Không tìm thấy nút Reply submit', this.profileTag);
                await this._dismissDialog();
                return false;
            }

            await submitBtn.click();

            // Đợi reply dialog đóng (verify submit thành công)
            const submitted = await this._waitForDialogClose(6000);
            if (submitted) {
                await sleep(1000);
                log.success(`💬 Commented: "${commentText.substring(0, 50)}..."`, this.profileTag);
                return true;
            }

            // Submit có thể đang pending — đợi thêm
            log.debug('Reply dialog chưa đóng, đợi thêm...', this.profileTag);
            const submitted2 = await this._waitForDialogClose(5000);
            if (submitted2) {
                await sleep(1000);
                log.success(`💬 Commented (chậm): "${commentText.substring(0, 50)}..."`, this.profileTag);
                return true;
            }

            // Vẫn không đóng — dismiss
            log.warn('Reply submit timeout, đóng dialog', this.profileTag);
            await this._dismissDialog();
            return false;

        } catch (err) {
            log.debug(`Submit comment lỗi: ${err.message}`, this.profileTag);
            await this._dismissDialog();
            return false;
        }
    }

    // ─── Đợi reply dialog đóng ──────────────────────────────────────
    async _waitForDialogClose(timeoutMs = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            // Nếu không còn reply textArea visible → dialog đã đóng
            const textArea = await this.page.$(selectors.reply.textArea);
            if (!textArea) return true;

            // Check nếu textArea đã biến mất khỏi viewport
            const isVisible = await textArea.isIntersectingViewport().catch(() => false);
            if (!isVisible) return true;

            await sleep(500);
        }
        return false;
    }

    // ─── Dismiss dialog + handle "Discard post?" popup ──────────────
    async _dismissDialog() {
        try {
            // Escape để đóng reply dialog
            await this.page.keyboard.press('Escape');
            await sleep(1000);

            // Check nếu "Discard post?" popup xuất hiện
            // Twitter dùng button "Discard" trong confirm dialog
            const discardBtn = await this.page.$('button[data-testid="confirmationSheetConfirm"]');
            if (discardBtn) {
                await discardBtn.click();
                log.debug('Đã click Discard để đóng dialog', this.profileTag);
                await sleep(800);
                return;
            }

            // Fallback: thử tìm nút Discard bằng text
            const discardByText = await this.page.evaluateHandle(() => {
                const buttons = document.querySelectorAll('button[role="button"]');
                for (const btn of buttons) {
                    if (btn.textContent.trim() === 'Discard') return btn;
                }
                return null;
            });

            if (discardByText && discardByText.asElement()) {
                await discardByText.asElement().click();
                log.debug('Đã click Discard (by text) để đóng dialog', this.profileTag);
                await sleep(800);
                return;
            }

            // Escape thêm lần nữa phòng trường hợp
            await this.page.keyboard.press('Escape');
            await sleep(500);

        } catch {
            // Ignore — best effort cleanup
        }
    }

    // ─── Scroll feed warm-up ─────────────────────────────────────────
    async _scrollFeed(durationSeconds) {
        const endTime = Date.now() + (durationSeconds * 1000);
        let scrolls = 0;

        while (Date.now() < endTime) {
            const distance = Math.floor(Math.random() * 400) + 200;
            await this.page.evaluate((d) => window.scrollBy(0, d), distance);
            scrolls++;

            // Random dừng đọc
            if (Math.random() < 0.3) {
                await randomDelay(3000, 6000);
            } else {
                await randomDelay(800, 2000);
            }

            // Random scroll ngược
            if (Math.random() < 0.1) {
                await this.page.evaluate((d) => window.scrollBy(0, -d), Math.floor(Math.random() * 150) + 50);
                await randomDelay(500, 1500);
            }
        }

        log.debug(`Đã scroll ${scrolls} lần`, this.profileTag);
    }
}

module.exports = Farmer;
