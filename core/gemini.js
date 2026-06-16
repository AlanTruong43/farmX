/**
 * Gemini API Client
 * Gọi Google Gemini để tạo comment thông minh dựa trên nội dung tweet
 * Extends AIProvider base class
 */
const https = require('https');
const AIProvider = require('./ai-provider');
const log = require('../utils/logger');

class GeminiClient extends AIProvider {
    constructor(config = {}) {
        super(config);
        this.model = config.model || 'gemini-2.0-flash';
    }

    async generateComment(tweetData, profileTag = '') {
        const tweetDescription = this._buildTweetDescription(tweetData);

        const requestBody = {
            contents: [{
                parts: [{
                    text: `${this.systemPrompt}\n\n${tweetDescription}`
                }]
            }],
            generationConfig: {
                maxOutputTokens: this.maxTokens,
                temperature: 0.9,
                topP: 0.95,
            }
        };

        try {
            const response = await this._request(requestBody);
            const comment = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (!comment) {
                log.warn('Gemini trả về rỗng, dùng comment mặc định', profileTag);
                return this._fallbackComment();
            }

            const cleaned = comment.replace(/^["']|["']$/g, '').trim();
            log.debug(`Gemini comment: "${cleaned}"`, profileTag);
            return cleaned;
        } catch (err) {
            log.error(`Gemini API lỗi: ${err.message}`, profileTag);
            return this._fallbackComment();
        }
    }

    _request(body) {
        return new Promise((resolve, reject) => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
            const urlObj = new URL(url);
            const postData = JSON.stringify(body);

            const options = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
                timeout: 30000,
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`HTTP ${res.statusCode}: ${json.error?.message || data.substring(0, 200)}`));
                        } else {
                            resolve(json);
                        }
                    } catch (e) {
                        reject(new Error(`Parse lỗi: ${data.substring(0, 200)}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout 30s')); });
            req.write(postData);
            req.end();
        });
    }
}

module.exports = GeminiClient;
