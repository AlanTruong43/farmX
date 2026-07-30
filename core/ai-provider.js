/**
 * AIProvider — Base class cho tất cả AI providers
 * Gemini, EzAI, hoặc provider khác đều extends class này
 */

class AIProvider {
    constructor(config = {}) {
        this.apiKey = config.api_key || '';
        this.model = config.model || '';
        this.systemPrompt = config.comment_prompt || 'Write a short, natural comment for this tweet.';
        this.maxTokens = config.max_tokens || 100;
        // Track recent comments để tránh trùng lặp (giữ 30 comment gần nhất)
        this._recentComments = [];
    }

    /**
     * Tạo comment dựa trên nội dung tweet — abstract method
     * @param {object} tweetData - { text, hasImage, hasVideo, imageAlt, authorName }
     * @param {string} profileTag
     * @returns {Promise<string>}
     */
    async generateComment(tweetData, profileTag = '') {
        throw new Error('generateComment() phải được implement bởi subclass');
    }

    /**
     * Detect ngôn ngữ tweet bằng AI
     * Return: 'vi' | 'en' | 'other'
     */
    async detectLanguage(tweetData, profileTag = '') {
        const text = tweetData.text || '';
        if (!text || text.trim().length < 5) return 'other';

        // Quick heuristic trước — chỉ dùng ký tự ĐẶC TRƯNG tiếng Việt (không có trong tiếng Pháp/Tây Ban Nha)
        // ă, â, ơ, ư, đ và các dấu đặc biệt như ọ, ộ, ợ, ứ, ự...
        const viPattern = /[ăắặằẳẵâầấậẩẫơờớợởỡưừứựửữđảạẻẹịọỏụủỵỷỹ]/i;
        if (viPattern.test(text)) return 'vi';

        const nonLatinRatio = (text.replace(/[a-zA-Z0-9\s.,!?'"@#$%&*()-]/g, '').length) / Math.max(text.length, 1);
        if (nonLatinRatio > 0.3) return 'other'; // Korean, Japanese, Chinese, Arabic...

        // Gọi AI để phân biệt English vs other Latin languages
        try {
            const result = await this._detectLangRequest(text);
            return result;
        } catch {
            // Fallback: nếu có nhiều chữ Latin → coi là en
            return 'en';
        }
    }

    // Override trong subclass nếu muốn dùng AI thật cho language detection
    async _detectLangRequest(text) {
        return 'en';
    }

    /**
     * Lưu comment vừa tạo vào lịch sử gần đây
     */
    _trackComment(comment) {
        if (!comment) return;
        this._recentComments.push(comment.toLowerCase().trim());
        if (this._recentComments.length > 30) this._recentComments.shift();
    }

    /**
     * Kiểm tra comment có bị trùng với lịch sử không
     */
    _isDuplicateComment(comment) {
        if (!comment) return false;
        const normalized = comment.toLowerCase().trim();
        return this._recentComments.some(c => {
            // Trùng chính xác
            if (c === normalized) return true;
            // Giống nhau > 80% (dùng Jaccard similarity trên words)
            const setA = new Set(c.split(/\s+/));
            const setB = new Set(normalized.split(/\s+/));
            const intersection = new Set([...setA].filter(w => setB.has(w)));
            const union = new Set([...setA, ...setB]);
            return union.size > 0 && (intersection.size / union.size) >= 0.8;
        });
    }

    /**
     * Xây dựng mô tả tweet cho AI prompt — shared helper
     */
    _buildTweetDescription(tweetData) {
        let desc = '';

        if (tweetData.text) {
            desc += `Nội dung tweet: "${tweetData.text}"`;
        }
        if (tweetData.hasImage) {
            desc += `\n[Tweet có kèm hình ảnh${tweetData.imageAlt ? ': ' + tweetData.imageAlt : ''}]`;
        }
        if (tweetData.hasVideo) {
            desc += '\n[Tweet có kèm video]';
        }
        if (tweetData.authorName) {
            desc += `\nTác giả: ${tweetData.authorName}`;
        }

        return desc.trim() || 'Một tweet ngắn trên timeline.';
    }

    /**
     * Fallback comment khi API lỗi — shared
     */
    _fallbackComment() {
        const fallbacks = [
            '🔥', '💯', 'Nice!', 'Interesting', '👏',
            'Great post!', 'Love this', '💪', 'Facts',
            'Well said', 'This is so true', '🙌',
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
}

module.exports = AIProvider;
