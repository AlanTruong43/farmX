/**
 * EzAI API Client
 * OpenAI-compatible API tại ezaiapi.com
 */
const https = require('https');
const AIProvider = require('./ai-provider');
const log = require('../utils/logger');

class EzAIClient extends AIProvider {
    constructor(config = {}) {
        super(config);
        this.model = config.model || 'gpt-4o-mini';
        this.baseUrl = 'ezaiapi.com';
        this.basePath = '/v1/chat/completions';
    }

    async generateComment(tweetData, profileTag = '') {
        const tweetDescription = this._buildTweetDescription(tweetData);

        const requestBody = {
            model: this.model,
            messages: [
                { role: 'system', content: this.systemPrompt },
                { role: 'user', content: tweetDescription }
            ],
            max_tokens: this.maxTokens,
            temperature: 0.9,
        };

        try {
            const response = await this._request(requestBody);
            const comment = response?.choices?.[0]?.message?.content?.trim();

            if (!comment) {
                log.warn('EzAI trả về rỗng, dùng comment mặc định', profileTag);
                return this._fallbackComment();
            }

            const cleaned = comment.replace(/^["']|["']$/g, '').trim();
            log.debug(`EzAI comment: "${cleaned}"`, profileTag);
            return cleaned;
        } catch (err) {
            log.error(`EzAI API lỗi: ${err.message}`, profileTag);
            return this._fallbackComment();
        }
    }

    _request(body) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify(body);

            const options = {
                hostname: this.baseUrl,
                port: 443,
                path: this.basePath,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'User-Agent': 'EzAI/1.0',
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

module.exports = EzAIClient;
