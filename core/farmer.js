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
        this.maxInteractsPerLoop = this.farming.max_interacts_per_loop ?? 0; // 0 = không giới hạn
        this.scrollDuration = this.farming.scroll_duration_seconds ?? 15;
        this.minActionDelay = this.farming.min_delay_between_actions_ms ?? 3000;
        this.maxActionDelay = this.farming.max_delay_between_actions_ms ?? 8000;
        this.languageFilter = this.farming.language_filter || '';
        log.debug(`Language filter: "${this.languageFilter || 'tất cả'}"`, profileTag);
        const actions = this.farming.actions || {};
        this.doLike    = actions.like    !== false;
        this.doComment = actions.comment !== false;
        this.doFollow  = actions.follow  !== false;

        // Loop tracking
        this._currentLoop = 1;
        this._totalLoops = 1;

        // Track tweets đã xử lý (tránh xử lý lại sau scroll)
        this._processedTweetIds = new Set();

        // URL hợp lệ cho chế độ hiện tại ('home' hoặc 'search')
        this._validUrlPattern = 'x.com/home';

        // API error tracking — dừng profile sau 5 loop lỗi liên tiếp
        this._apiErrorLoops = 0;
        this._apiDisabled = false;
    }

    // ─── Set loop context (gọi từ worker trước mỗi loop) ────────────
    setLoop(current, total) {
        this._currentLoop = current;
        this._totalLoops = total;
    }

    // ─── API có đang hoạt động không ────────────────────────────────
    isApiDown() {
        return this._apiDisabled;
    }

    // ═══════════════════════════════════════════════════════════════════
    // CHẾ ĐỘ 1: NEWSFEED
    // ═══════════════════════════════════════════════════════════════════
    async farmNewsfeed() {
        log.action('🌾 Chế độ NEWSFEED — lướt feed, like & comment', this.profileTag);

        await this.page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
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
            // Fallback: navigate trực tiếp — không có f=live để mặc định là Top
            log.debug('Không tìm thấy ô search, navigate trực tiếp...', this.profileTag);
            const encoded = encodeURIComponent(hashtag);
            await this.page.goto(`https://x.com/search?q=${encoded}&src=typed_query`, {
                waitUntil: 'networkidle2', timeout: 30000
            });
        } else {
            await searchInput.click();
            await sleep(500);
            await this.page.keyboard.type(hashtag, { delay: Math.floor(Math.random() * 100) + 50 });
            await sleep(800);
            await this.page.keyboard.press('Enter');
            await randomDelay(3000, 5000);
            // Giữ nguyên tab Top (mặc định) — không click Latest
        }

        // Lưu URL hiện tại để _gotoHome có thể quay về đúng trang search
        this._searchUrl = this.page.url();

        // Scroll warm-up
        log.info(`Warm-up: scroll kết quả ${this.scrollDuration}s...`, this.profileTag);
        await this._scrollFeed(this.scrollDuration);

        // Cho phép _ensureOnValidPage biết đang ở chế độ search
        this._validUrlPattern = 'x.com/search';

        // Farm tweets — không navigate về home giữa chừng
        const result = await this._processTweetsOnPage();

        // Reset lại sau khi xong
        this._validUrlPattern = 'x.com/home';
        this._searchUrl = null;
        return result;
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
        let interactedCount = 0;
        let loopHadApiError = false;
        const likedUrls = [];
        const commentedUrls = [];
        const loopTag = `Loop ${this._currentLoop}/${this._totalLoops}`;
        this._processedTweetIds.clear();

        // Scroll lên đầu page trước
        await this.page.evaluate(() => window.scrollTo(0, 0));
        await sleep(1000);

        for (let i = 0; i < this.maxTweetsPerLoop + 5; i++) {
            if (processedCount >= this.maxTweetsPerLoop) break;

            // Nếu bị redirect sang trang lạ → quay về home ngay
            await this._ensureOnValidPage();

            // Tìm tất cả tweet articles trên page
            const tweets = await this.page.$$(selectors.feed.tweetArticle);

            if (tweets.length === 0) {
                log.debug('Không tìm thấy tweet nào, scroll thêm...', this.profileTag, this._currentLoop);
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

                    // Detect ngôn ngữ — dùng cho cả filter lẫn comment matching
                    const detectedLang = await this.ai.detectLanguage(tweetData, this.profileTag);
                    tweetData.detectedLang = detectedLang; // truyền vào generateComment

                    const lang = this.languageFilter;
                    if (lang && lang !== '') {
                        let shouldSkip = false;
                        if (lang === 'vi' && detectedLang !== 'vi') shouldSkip = true;
                        if (lang === 'en' && detectedLang !== 'en') shouldSkip = true;
                        if (lang === 'vi+en' && detectedLang !== 'vi' && detectedLang !== 'en') shouldSkip = true;
                        if (shouldSkip) {
                            if (tweetId) this._processedTweetIds.add(tweetId);
                            log.info(`⏭ Skip (${detectedLang} ≠ ${lang})`, this.profileTag, this._currentLoop);
                            continue;
                        }
                    }

                    // Scroll vào giữa
                    if (tweetId) this._processedTweetIds.add(tweetId);
                    await tweet.evaluate(el => {
                        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        el.style.outline = '2px solid red';
                    }).catch(() => {});
                    await randomDelay(800, 1500);
                    await tweet.evaluate(el => { el.style.outline = ''; }).catch(() => {});

                    processedCount++;
                    const shouldInteract = Math.random() < this.interactProbability;

                    // Nếu sắp tương tác, check quảng cáo trước
                    if (shouldInteract) {
                        const isAd = await tweet.evaluate(el => {
                            return !!el.querySelector('[style="color: rgb(255, 255, 255); text-overflow: ellipsis;"]');
                        }).catch(() => false);
                        if (isAd) {
                            log.info(`[${loopTag}] → Bỏ qua bài viết ${processedCount}/${this.maxTweetsPerLoop} (quảng cáo)`, this.profileTag, this._currentLoop);
                            continue;
                        }
                        log.info(`[${loopTag}] → Đang xử lý bài viết thứ ${processedCount}/${this.maxTweetsPerLoop}`, this.profileTag, this._currentLoop);
                    } else {
                        log.info(`[${loopTag}] → Bỏ qua bài viết ${processedCount}/${this.maxTweetsPerLoop}`, this.profileTag, this._currentLoop);
                    }

                    // Kiểm tra giới hạn tương tác
                    const maxInteracts = this.maxInteractsPerLoop;
                    const overLimit = maxInteracts > 0 && interactedCount >= maxInteracts;
                    const doActions = shouldInteract && !overLimit;
                    if (shouldInteract && overLimit) {
                        log.info(`[${loopTag}] → Đã đạt giới hạn ${maxInteracts} tương tác, lướt tiếp`, this.profileTag, this._currentLoop);
                    }

                    // Pre-fetch AI comment song song với các actions khác
                    let commentPromise = null;
                    if (doActions && this.doComment && !this._apiDisabled) {
                        log.debug('Pre-fetch AI comment...', this.profileTag);
                        commentPromise = this.ai.generateComment(tweetData, this.profileTag)
                            .catch(err => {
                                log.warn(`API lỗi: ${err.message} — bỏ qua comment loop này`, this.profileTag);
                                return null;
                            });
                    }

                    // Like
                    if (doActions && this.doLike) {
                        const liked = await this._likeTweet(tweet);
                        if (liked) {
                            likedCount++;
                            if (tweetId) likedUrls.push('https://x.com' + tweetId);
                            await randomDelay(this.minActionDelay, this.maxActionDelay);
                        }
                    }

                    // Follow
                    if (doActions && this.doFollow) {
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
                        } else {
                            // null = API lỗi trong loop này
                            loopHadApiError = true;
                        }
                    }

                    if (shouldInteract && !overLimit) interactedCount++;

                } catch (err) {
                    log.debug(`Bỏ qua tweet: ${err.message}`, this.profileTag);
                }
            }

            // Scroll xuống tìm thêm tweets
            await humanScroll(this.page, { scrolls: 2, minPause: 1000, maxPause: 2500 });
            await randomDelay(1500, 3000);
        }

        // Cập nhật bộ đếm lỗi API liên tiếp
        if (loopHadApiError && commentedCount === 0) {
            this._apiErrorLoops++;
            log.warn(`API lỗi ${this._apiErrorLoops}/5 loop liên tiếp`, this.profileTag, this._currentLoop);
            if (this._apiErrorLoops >= 5) {
                this._apiDisabled = true;
                log.error('API lỗi 5 loop liên tiếp — dừng profile!', this.profileTag);
            }
        } else if (commentedCount > 0) {
            // Reset counter khi comment thành công
            this._apiErrorLoops = 0;
        }

        log.success(
            `Kết quả: ${processedCount} tweets xử lý | ${likedCount} liked | ${followedCount} followed | ${commentedCount} commented`,
            this.profileTag,
            this._currentLoop
        );

        return { processedCount, likedCount, commentedCount, followedCount, likedUrls, commentedUrls, apiDisabled: this._apiDisabled };
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
            await this._ensureOnValidPage();
            await this._dismissSaveDialog();
            const likeBtn = await tweetElement.$(selectors.tweet.likeBtn);
            if (!likeBtn) return false;
            await likeBtn.click();
            log.success('❤️  Liked', this.profileTag, this._currentLoop);
            return true;
        } catch (err) {
            log.debug(`Like lỗi: ${err.message}`, this.profileTag, this._currentLoop);
            return false;
        }
    }

    // ─── Detect tiếng Việt bằng regex ký tự có dấu ───────────────────
    _isVietnamese(text) {
        if (!text || text.trim().length < 5) return false;
        const viPattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸ]/;
        return viPattern.test(text);
    }

    // ─── Detect tiếng Anh (không có ký tự đặc biệt phi Latin) ─────────
    _isEnglish(text) {
        if (!text || text.trim().length < 5) return false;
        if (this._isVietnamese(text)) return false;
        // Phải có ít nhất 60% ký tự Latin a-z
        const letters = text.replace(/[^a-zA-ZÀ-ɏ]/g, '');
        const latin = text.replace(/[^a-zA-Z]/g, '');
        if (letters.length === 0) return false;
        return (latin.length / letters.length) >= 0.6;
    }

    // ─── Follow người đăng bài qua hover card ────────────────────────
    async _followUser(tweetElement) {
        try {
            await this._ensureOnValidPage();
            await this._dismissSaveDialog();
            const avatar = await tweetElement.$(selectors.tweet.userAvatar);
            if (!avatar) return false;

            // Hover để mở hover card
            await avatar.hover();
            await randomDelay(1200, 2000);

            // Chờ hover card xuất hiện (5s)
            let hoverCard = await this.page.waitForSelector(
                '[data-testid="HoverCard"]',
                { visible: true, timeout: 5000 }
            ).catch(() => null);

            // Nếu không thấy hover card (avt bị che) — scroll lên nhẹ rồi thử lại
            if (!hoverCard) {
                log.debug('Hover card không xuất hiện, nhích lên thử lại...', this.profileTag, this._currentLoop);
                await this.page.mouse.move(400, 400);
                await this.page.evaluate(() => window.scrollBy(0, -120));
                await randomDelay(800, 1200);
                await avatar.hover().catch(() => {});
                await randomDelay(1500, 2500);
                hoverCard = await this.page.waitForSelector(
                    '[data-testid="HoverCard"]',
                    { visible: true, timeout: 5000 }
                ).catch(() => null);
            }

            if (!hoverCard) {
                log.debug('Hover card vẫn không xuất hiện sau retry, bỏ qua follow', this.profileTag, this._currentLoop);
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
                log.success('➕ Followed', this.profileTag, this._currentLoop);
                await this.page.mouse.move(400, 400);
                await randomDelay(400, 700);
                return true;
            }

            await this.page.mouse.move(400, 400);
            return false;
        } catch (err) {
            log.debug(`Follow lỗi: ${err.message}`, this.profileTag, this._currentLoop);
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
            await this._ensureOnValidPage();
            await this._dismissSaveDialog();
            // Click nút reply trên tweet
            const replyBtn = await tweetElement.$(selectors.tweet.replyBtn);
            if (!replyBtn) {
                log.debug('Không tìm thấy nút reply', this.profileTag);
                return false;
            }

            // Scroll element vào giữa viewport trước khi click
            await replyBtn.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
            await sleep(600);
            await replyBtn.click();
            await randomDelay(1500, 3000);

            // Đợi reply DIALOG mở (trên feed) hoặc inline reply box (trên post detail)
            const [replyDialog, inlineBox] = await Promise.all([
                this.page.waitForSelector('[role="dialog"]', { visible: true, timeout: 10000 }).catch(() => null),
                this.page.waitForSelector('div[data-testid="tweetTextarea_0"][contenteditable="true"]', { visible: true, timeout: 10000 }).catch(() => null),
            ]);

            if (!replyDialog && !inlineBox) {
                log.debug('Reply dialog không xuất hiện', this.profileTag, this._currentLoop);
                await this._dismissDialog();
                return false;
            }

            // Nếu có dialog, tìm textarea trong dialog; nếu không có dialog thì dùng inline box
            const textArea = replyDialog
                ? await replyDialog.$(selectors.reply.textArea)
                : inlineBox;

            if (!textArea) {
                log.debug('Không tìm thấy ô nhập reply trong dialog', this.profileTag, this._currentLoop);
                await this._dismissDialog();
                return false;
            }

            // Gõ comment
            await textArea.click();
            await sleep(500);
            await this.page.keyboard.type(commentText, {
                delay: Math.floor(Math.random() * 80) + 30
            });
            await randomDelay(800, 1500);

            // Kiểm tra vượt giới hạn ký tự (indicator xuất hiện khi gần/quá 280 chars)
            const overLimit = await this.page.evaluate(() => {
                const el = document.querySelector('[data-testid="dual-phase-countdown-circle-text"]');
                if (!el) return false;
                const count = parseInt(el.textContent.trim(), 10);
                return !isNaN(count) && count < 0;
            }).catch(() => false);

            if (overLimit) {
                log.warn('Comment vượt giới hạn ký tự, quay về home', this.profileTag, this._currentLoop);
                await this._gotoHome();
                return false;
            }

            await randomDelay(500, 1000);

            // Submit — tìm trong dialog (feed) hoặc trên page (inline)
            const submitBtn = replyDialog
                ? await replyDialog.$(selectors.reply.replySubmitBtn)
                : await this.page.$(selectors.reply.replySubmitBtn);
            if (!submitBtn) {
                log.debug('Không tìm thấy nút Reply submit', this.profileTag, this._currentLoop);
                await this._dismissDialog();
                return false;
            }

            await submitBtn.click();

            // Đợi reply dialog đóng (verify submit thành công)
            const submitted = replyDialog ? await this._waitForDialogClose(6000) : await sleep(3000).then(() => true);
            if (submitted) {
                await sleep(1000);
                log.success(`💬 Commented: "${commentText.substring(0, 50)}..."`, this.profileTag, this._currentLoop);
                return true;
            }

            // Submit có thể đang pending — đợi thêm
            log.debug('Reply dialog chưa đóng, đợi thêm...', this.profileTag, this._currentLoop);
            const submitted2 = await this._waitForDialogClose(5000);
            if (submitted2) {
                await sleep(1000);
                log.success(`💬 Commented (chậm): "${commentText.substring(0, 50)}..."`, this.profileTag, this._currentLoop);
                return true;
            }

            // Vẫn không đóng — dismiss
            log.warn('Reply submit timeout, đóng dialog', this.profileTag, this._currentLoop);
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

    // ─── Navigate về trang feed hợp lệ, tự động accept "Leave site?" ─
    async _gotoHome() {
        try {
            this.page.once('dialog', async dialog => {
                await dialog.accept().catch(() => {});
            });
            // Nếu đang ở chế độ hashtag, giữ nguyên trang search
            const target = this._searchUrl || 'https://x.com/home';
            await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await randomDelay(2000, 3500);
        } catch {
            // Ignore
        }
    }

    // ─── Đảm bảo đang ở trang hợp lệ ───────────────────────────────
    async _ensureOnValidPage() {
        try {
            const url = this.page.url();
            const isValid = url.includes(this._validUrlPattern) || url.includes('x.com/compose/post');
            if (!isValid) {
                log.debug(`Đang ở trang lạ (${url}), quay về ${this._validUrlPattern}...`, this.profileTag);
                await this._gotoHome();
            }
        } catch {
            // Ignore
        }
    }

    // ─── Dismiss "Save post?" dialog nếu đang hiện ──────────────────
    // Phải gọi trước mỗi action để tránh các lỗi phía sau
    async _dismissSaveDialog() {
        try {
            const saveDialog = await this.page.$('[data-testid="confirmationSheetDialog"]');
            if (!saveDialog) return false;

            // Click Discard (confirmationSheetCancel)
            const discardBtn = await this.page.$('[data-testid="confirmationSheetCancel"]');
            if (discardBtn) {
                await discardBtn.click();
                await sleep(600);
                log.debug('Đã dismiss "Save post?" dialog', this.profileTag);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    // ─── Reply to comments on own posts ─────────────────────────────
    async replyToComments(ownUsername, postCount = 3) {
        log.info(`💬 Reply mode: kiểm tra ${postCount} bài của @${ownUsername}`, this.profileTag);

        // Vào profile lấy URLs bài đăng gần nhất
        this.page.once('dialog', d => d.accept().catch(() => {}));
        await this.page.goto(`https://x.com/${ownUsername}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2500);

        const postUrls = await this.page.evaluate((user, max) => {
            const seen = new Set();
            const result = [];
            const links = document.querySelectorAll('a[href*="/status/"]');
            for (const a of links) {
                const href = a.getAttribute('href') || '';
                if (!href.toLowerCase().startsWith(`/${user.toLowerCase()}/status/`)) continue;
                const m = href.match(/\/status\/(\d+)/);
                if (m && !seen.has(m[1])) {
                    seen.add(m[1]);
                    result.push(`https://x.com/${user}/status/${m[1]}`);
                    if (result.length >= max) break;
                }
            }
            return result;
        }, ownUsername, postCount);

        log.debug(`Tìm thấy ${postUrls.length} bài để check reply`, this.profileTag);

        let totalReplied = 0;
        for (const url of postUrls) {
            if (this._stopRequested) break;
            totalReplied += await this._replyToCommentsOnPost(url, ownUsername);
        }

        log.info(`Reply hoàn tất: ${totalReplied} comment mới`, this.profileTag);

        // Quay về home
        await this.page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await sleep(2000);
    }

    async _replyToCommentsOnPost(postUrl, ownUsername) {
        const prevPattern = this._validUrlPattern;
        this._validUrlPattern = 'x.com';
        try {
            log.debug(`Check reply: ${postUrl}`, this.profileTag);
            this.page.once('dialog', d => d.accept().catch(() => {}));
            await this.page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(2500);

            // Scroll nhẹ để load comments
            for (let i = 0; i < 3; i++) {
                await this.page.evaluate(() => window.scrollBy(0, 600));
                await sleep(800);
            }
            await this.page.evaluate(() => window.scrollTo(0, 0));
            await sleep(500);

            // Thu thập metadata từ các comment cards (không giữ ElementHandle)
            const commentInfos = await this.page.evaluate((ownUser) => {
                const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
                const results = [];
                for (let i = 1; i < articles.length; i++) { // bỏ bài gốc (index 0)
                    const el = articles[i];
                    // Dùng link trên <time> để lấy permalink chính xác của tweet
                    const timeEl = el.querySelector('time');
                    const permalinkAnchor = timeEl ? timeEl.closest('a') : null;
                    const href = permalinkAnchor ? permalinkAnchor.getAttribute('href') : '';
                    const m = href ? href.match(/\/([^/]+)\/status\/(\d+)/) : null;
                    if (!m) continue;
                    const tweetAuthor = m[1];
                    const tweetId = m[2];
                    // Kiểm tra có phải của mình không
                    const isOwn = Array.from(el.querySelectorAll('a[href]'))
                        .some(a => a.getAttribute('href').toLowerCase() === `/${ownUser.toLowerCase()}`);
                    // Nội dung text
                    const textEl = el.querySelector('div[data-testid="tweetText"]');
                    const text = textEl ? textEl.innerText.trim() : '';
                    results.push({ tweetId, tweetAuthor, tweetUrl: `https://x.com${href}`, isOwn, text, index: i });
                }
                return results;
            }, ownUsername);

            if (!commentInfos.length) return 0;

            let repliedCount = 0;

            for (let i = 0; i < commentInfos.length; i++) {
                if (this._stopRequested) break;
                const info = commentInfos[i];
                if (info.isOwn) continue;

                // Nếu tweet tiếp theo là của mình → đã reply rồi
                const nextInfo = commentInfos[i + 1];
                if (nextInfo?.isOwn) { i++; continue; }

                if (!info.text) continue;

                const tweetData = { text: info.text, authorName: info.tweetAuthor };
                const detectedLang = await this.ai.detectLanguage(tweetData, this.profileTag).catch(() => 'en');
                tweetData.detectedLang = detectedLang;

                const commentText = await this.ai.generateComment(tweetData, this.profileTag).catch(err => {
                    log.warn(`AI lỗi khi reply: ${err.message}`, this.profileTag);
                    return null;
                });
                if (!commentText) continue;

                // Click reply trực tiếp trên comment article (ở lại trang post gốc)
                const success = await this._replyOnPostPage(info.tweetId, commentText);
                if (success) {
                    repliedCount++;
                    log.success(`💬 Reply: "${commentText.substring(0, 50)}..."`, this.profileTag);
                    await randomDelay(this.minActionDelay, this.maxActionDelay);
                    break;
                }
            }

            return repliedCount;
        } catch (err) {
            log.warn(`Reply lỗi tại ${postUrl}: ${err.message}`, this.profileTag);
            return 0;
        } finally {
            this._validUrlPattern = prevPattern;
        }
    }

    // ─── Click reply trực tiếp trên comment article trong trang post ────
    async _replyOnPostPage(tweetId, commentText) {
        try {
            // Tìm reply button của comment có tweetId khớp
            const replyBtn = await this.page.evaluateHandle((id) => {
                const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
                for (const el of articles) {
                    const timeEl = el.querySelector('time');
                    const a = timeEl ? timeEl.closest('a') : null;
                    if (a && (a.getAttribute('href') || '').includes(`/status/${id}`)) {
                        return el.querySelector('button[data-testid="reply"]');
                    }
                }
                return null;
            }, tweetId);

            const btnNull = await replyBtn.evaluate(el => el === null);
            if (btnNull) {
                log.debug(`Không tìm thấy reply button cho tweet ${tweetId}`, this.profileTag);
                return false;
            }

            await replyBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));
            await sleep(600);
            await replyBtn.click();
            await sleep(2000);

            // Tìm dialog reply hoặc inline textarea
            const replyDialog = await this.page.$('[role="dialog"]');
            const textArea = replyDialog
                ? await replyDialog.$('div[data-testid="tweetTextarea_0"]')
                : await this.page.$('div[data-testid="tweetTextarea_0"][contenteditable="true"]');

            if (!textArea) {
                log.debug('Không tìm thấy textarea reply', this.profileTag);
                await this._dismissDialog();
                return false;
            }

            await textArea.click();
            await sleep(300);
            await this.page.keyboard.type(commentText, { delay: Math.floor(Math.random() * 60) + 20 });
            await sleep(800);

            const submitBtn = replyDialog
                ? await replyDialog.$('button[data-testid="tweetButton"]')
                : await this.page.$('button[data-testid="tweetButton"]');
            if (!submitBtn) { await this._dismissDialog(); return false; }

            await submitBtn.click();
            await sleep(2500);
            return true;
        } catch (err) {
            log.debug(`_replyOnPostPage lỗi: ${err.message}`, this.profileTag);
            await this._dismissDialog();
            return false;
        }
    }

    // ─── Navigate đến tweet và reply bằng nút Reply trên post detail ─
    async _replyByNavigate(tweetUrl, commentText) {
        try {
            log.debug(`Mở tweet để reply: ${tweetUrl}`, this.profileTag);
            this.page.once('dialog', d => d.accept().catch(() => {}));
            await this.page.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            log.debug('Đã tải trang tweet', this.profileTag);
            await sleep(2000);

            // Tìm article khớp với tweetUrl (không phải firstArticle vì X hiển thị parent tweet trước)
            const tweetIdMatch = tweetUrl.match(/\/status\/(\d+)/);
            const targetTweetId = tweetIdMatch ? tweetIdMatch[1] : null;

            const targetArticle = targetTweetId
                ? await this.page.evaluateHandle((tweetId) => {
                    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
                    for (const el of articles) {
                        const timeEl = el.querySelector('time');
                        const a = timeEl ? timeEl.closest('a') : null;
                        if (a && a.getAttribute('href') && a.getAttribute('href').includes(`/status/${tweetId}`)) {
                            return el;
                        }
                    }
                    return null;
                }, targetTweetId)
                : null;

            const targetEl = (targetArticle && (await targetArticle.evaluate(el => el !== null)))
                ? targetArticle
                : await this.page.$('article[data-testid="tweet"]');
            if (!targetEl) return false;

            const replyBtn = await targetEl.$('button[data-testid="reply"]');
            if (!replyBtn) return false;

            await replyBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));
            await sleep(600);
            await replyBtn.click();
            await sleep(2000);

            // Tìm dialog hoặc inline textarea
            const replyDialog = await this.page.$('[role="dialog"]');
            const textArea = replyDialog
                ? await replyDialog.$('div[data-testid="tweetTextarea_0"]')
                : await this.page.$('div[data-testid="tweetTextarea_0"][contenteditable="true"]');

            if (!textArea) {
                log.debug('Không tìm thấy textarea sau khi click Reply', this.profileTag);
                await this._dismissDialog();
                return false;
            }

            await textArea.click();
            await sleep(300);
            await this.page.keyboard.type(commentText, { delay: Math.floor(Math.random() * 60) + 20 });
            await sleep(800);

            // Submit
            const submitBtn = replyDialog
                ? await replyDialog.$('button[data-testid="tweetButton"]')
                : await this.page.$('button[data-testid="tweetButton"]');
            if (!submitBtn) {
                await this._dismissDialog();
                return false;
            }

            await submitBtn.click();
            await sleep(2500);
            return true;
        } catch (err) {
            log.debug(`_replyByNavigate lỗi: ${err.message}`, this.profileTag);
            await this._dismissDialog();
            return false;
        }
    }

    // ─── Dismiss dialog + handle "Discard post?" popup ──────────────
    async _dismissDialog() {
        try {
            await this.page.keyboard.press('Escape');
            await sleep(800);

            // Retry tìm Discard tối đa 3 lần
            for (let attempt = 0; attempt < 3; attempt++) {
                // Thử selector chính thức trước
                const discardBtn = await this.page.$('button[data-testid="confirmationSheetConfirm"]');
                if (discardBtn) {
                    await discardBtn.click();
                    log.debug('Đã click Discard để đóng dialog', this.profileTag);
                    await sleep(800);
                    return;
                }

                // Fallback: tìm theo text
                const clicked = await this.page.evaluate(() => {
                    const buttons = document.querySelectorAll('button[role="button"]');
                    for (const btn of buttons) {
                        const t = btn.textContent.trim();
                        if (t === 'Discard' || t === 'Leave' || t === 'Rời đi') {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                });
                if (clicked) {
                    log.debug('Đã click Discard (by text) để đóng dialog', this.profileTag);
                    await sleep(800);
                    return;
                }

                // Chưa thấy dialog — Escape thêm và thử lại
                if (attempt < 2) {
                    await this.page.keyboard.press('Escape');
                    await sleep(600);
                }
            }

            // Escape lần cuối
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
