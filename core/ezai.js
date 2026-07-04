/**
 * DEMO API Client — OpenAI-compatible
 */
const https = require('https');
const AIProvider = require('./ai-provider');
const log = require('../utils/logger');

class DEMOClient extends AIProvider {
    constructor(config = {}) {
        super(config);
        this.model = config.model || 'gpt-4.1-nano';
        this.baseUrl = 'ezaiapi.com';
        this.basePath = '/v1/chat/completions';
    }

    // Throw lỗi thật để farmer.js xử lý — không fallback nữa
    async generateComment(tweetData, profileTag = '') {
        const tweetDescription = this._buildTweetDescription(tweetData);

        // Thêm hướng dẫn tránh trùng vào prompt nếu có lịch sử
        let userContent = tweetDescription;
        if (this._recentComments.length > 0) {
            const recent = this._recentComments.slice(-10).map(c => `- ${c}`).join('\n');
            userContent += `\n\n[Các comment gần đây (KHÔNG được lặp lại hoặc tương tự):\n${recent}]`;
        }

        const response = await this._request({
            model: this.model,
            messages: [
                { role: 'system', content: this.systemPrompt },
                { role: 'user', content: userContent },
            ],
            max_tokens: this.maxTokens,
            temperature: 0.9,
        });

        const comment = response?.choices?.[0]?.message?.content?.trim();
        if (!comment) throw new Error('API trả về rỗng');

        const cleaned = comment.replace(/^["']|["']$/g, '').trim();

        // Nếu trùng → thử thêm 1 lần với temperature cao hơn
        if (this._isDuplicateComment(cleaned)) {
            log.debug('Comment trùng, thử lại với temperature cao hơn...', profileTag);
            const retry = await this._request({
                model: this.model,
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'user', content: userContent + '\n\n[QUAN TRỌNG: Comment này PHẢI hoàn toàn khác với tất cả các comment trên]' },
                ],
                max_tokens: this.maxTokens,
                temperature: 1.1,
            });
            const retryComment = retry?.choices?.[0]?.message?.content?.trim()?.replace(/^["']|["']$/g, '').trim();
            if (retryComment) {
                this._trackComment(retryComment);
                log.debug(`DEMO comment (retry): "${retryComment}"`, profileTag);
                return retryComment;
            }
        }

        this._trackComment(cleaned);
        log.debug(`DEMO comment: "${cleaned}"`, profileTag);
        return cleaned;
    }

    // Language detection bằng AI — gọi riêng 1 request nhẹ
    async _detectLangRequest(text) {
        const response = await this._request({
            model: this.model,
            messages: [{
                role: 'user',
                content: `Detect the language of this text. Reply with only one word: "vi" for Vietnamese, "en" for English, or "other" for anything else.\n\nText: "${text.substring(0, 200)}"`,
            }],
            max_tokens: 5,
            temperature: 0,
        });
        const result = response?.choices?.[0]?.message?.content?.trim().toLowerCase() || 'en';
        if (result.includes('vi')) return 'vi';
        if (result.includes('en')) return 'en';
        return 'other';
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
                    'User-Agent': 'Mozilla/5.0',
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
                            reject(new Error(`HTTP ${res.statusCode}: ${json.error?.message || data.substring(0, 100)}`));
                        } else {
                            resolve(json);
                        }
                    } catch {
                        reject(new Error(`Parse lỗi: ${data.substring(0, 100)}`));
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

module.exports = DEMOClient;
