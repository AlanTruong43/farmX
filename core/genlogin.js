/**
 * GenLogin API Client
 * Kết nối đến GenLogin local API tại localhost:55550
 * Quản lý lifecycle profile: start, stop, get wsEndpoint
 */
const http = require('http');

const DEFAULT_BASE_URL = 'http://localhost:55550';
const BACKEND_PATH = '/backend/profiles';

class GenLoginClient {
    constructor(baseUrl = DEFAULT_BASE_URL) {
        this.baseUrl = baseUrl;
        this.backendUrl = `${this.baseUrl}${BACKEND_PATH}`;
    }

    // ─── HTTP helper với retry ────────────────────────────────────────
    async _request(method, path, { retries = 1, retryDelay = 2000, timeout = 15000 } = {}) {
        const url = `${this.backendUrl}${path}`;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const result = await this._httpRequest(method, url, timeout);
                return result;
            } catch (err) {
                const isLast = attempt === retries;
                if (isLast) {
                    throw new Error(`GenLogin API lỗi sau ${retries} lần thử: ${err.message} (${method} ${url})`);
                }
                console.log(`  ⚠ GenLogin API attempt ${attempt}/${retries} thất bại: ${err.message}. Retry sau ${retryDelay}ms...`);
                await this._sleep(retryDelay);
            }
        }
    }

    _httpRequest(method, url, timeout) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: method,
                timeout: timeout,
                headers: { 'Content-Type': 'application/json' }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
                        } else {
                            resolve(json);
                        }
                    } catch (e) {
                        reject(new Error(`Parse JSON thất bại: ${data.substring(0, 200)}`));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Timeout sau ${timeout}ms`));
            });
            req.end();
        });
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ─── Kiểm tra GenLogin có đang chạy không ────────────────────────
    async healthCheck() {
        try {
            await this._request('GET', '?limit=1&offset=0', { retries: 1, timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    // ─── Lấy danh sách profiles ──────────────────────────────────────
    async getProfiles(offset = 0, limit = 1000) {
        const res = await this._request('GET', `?limit=${limit}&offset=${offset}`);
        const data = res.data || res;
        return {
            profiles: data.items || data.profiles || [],
            pagination: data.pagination || null
        };
    }

    // ─── Lấy thông tin 1 profile ─────────────────────────────────────
    async getProfile(profileId) {
        const res = await this._request('GET', `/${profileId}`);
        return res.data || res;
    }

    // ─── Lấy WebSocket endpoint (profile đã chạy) ───────────────────
    async getWsEndpoint(profileId) {
        const res = await this._request('GET', `/${profileId}/ws-endpoint`);
        return res.data?.wsEndpoint || res.wsEndpoint || null;
    }

    // ─── Start profile → trả về wsEndpoint ──────────────────────────
    async startProfile(profileId) {
        // Kiểm tra xem profile đã chạy chưa
        try {
            const existingWs = await this.getWsEndpoint(profileId);
            if (existingWs && existingWs !== '') {
                return { success: true, wsEndpoint: existingWs, alreadyRunning: true };
            }
        } catch {
            // Profile chưa chạy, tiếp tục start
        }

        const res = await this._request('PUT', `/${profileId}/start`, { timeout: 30000 });
        
        if (res.success && res.data?.wsEndpoint) {
            return { success: true, wsEndpoint: res.data.wsEndpoint, alreadyRunning: false };
        }

        // Fallback: thử lấy wsEndpoint sau khi start
        await this._sleep(2000);
        const wsEndpoint = await this.getWsEndpoint(profileId);
        if (wsEndpoint && wsEndpoint !== '') {
            return { success: true, wsEndpoint, alreadyRunning: false };
        }

        throw new Error(`Không thể start profile ${profileId}. Profile có thể đang chạy ở thiết bị khác.`);
    }

    // ─── Stop profile ────────────────────────────────────────────────
    async stopProfile(profileId) {
        const res = await this._request('PUT', `/${profileId}/stop`);
        return res;
    }

    // ─── Lấy danh sách profile đang chạy ────────────────────────────
    async getRunningProfiles() {
        const res = await this._request('GET', '/running');
        return res.data || [];
    }
}

module.exports = GenLoginClient;
