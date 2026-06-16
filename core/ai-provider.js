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
