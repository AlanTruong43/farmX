/**
 * AI Factory — Tạo AI provider phù hợp dựa trên config.ai_provider
 * Hỗ trợ: gemini, ezai
 */
const GeminiClient = require('./gemini');
const EzAIClient = require('./ezai');
const log = require('../utils/logger');

/**
 * Tạo AI provider instance từ config
 * @param {object} config - Toàn bộ config object
 * @returns {AIProvider} Instance của GeminiClient hoặc EzAIClient
 */
function createAIProvider(config = {}) {
    const ap = config.ai_provider || {};
    const type = (ap.type || 'gemini').toLowerCase();

    if (type === 'ezai') {
        log.debug(`AI Provider: EzAI (${ap.model || 'gpt-4.1-nano'})`);
        return new EzAIClient({
            api_key: ap.api_key || '',
            model: ap.model || 'gpt-4.1-nano',
            comment_prompt: ap.comment_prompt,
            max_tokens: ap.max_tokens || 100,
        });
    }

    // Default: gemini
    log.debug(`AI Provider: Gemini (${ap.model || 'gemini-2.0-flash'})`);
    return new GeminiClient({
        api_key: ap.api_key || '',
        model: ap.model || 'gemini-2.0-flash',
        comment_prompt: ap.comment_prompt,
        max_tokens: ap.max_tokens || 100,
    });
}

module.exports = { createAIProvider };
