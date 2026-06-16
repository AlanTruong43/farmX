/**
 * Google Sheets Reporter — Ghi báo cáo farming lên Google Sheets
 * Hỗ trợ OAuth2 (file credentials dạng "installed") — KHÔNG cần Service Account
 *
 * Flow:
 *   1. User cung cấp OAuth2 credentials JSON (dạng installed/desktop app)
 *   2. Lần đầu: gọi authorize() → mở URL trên trình duyệt → paste code → lưu token
 *   3. Lần sau: tự load token đã lưu, tự refresh khi hết hạn
 *
 * Columns: Date | Profile | Likes | Comments | Liked URLs | Commented URLs
 */
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');
const log = require('../utils/logger');

const HEADERS = ['Date', 'Profile', 'Likes', 'Comments', 'Liked URLs', 'Commented URLs'];
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Default token path (cùng thư mục project)
const DEFAULT_TOKEN_PATH = path.resolve('./sheets-token.json');

class SheetsReporter {
    constructor(config = {}) {
        this.spreadsheetId = config.spreadsheet_id || '';
        this.credentialsPath = path.resolve(config.credentials_path || './google-credentials.json');
        this.tokenPath = path.resolve(config.token_path || DEFAULT_TOKEN_PATH);
        this.sheetName = config.sheet_name || 'Farming Report';
        this.doc = null;
        this.sheet = null;
        this.oAuth2Client = null;
    }

    /**
     * Tạo OAuth2 client từ credentials file
     */
    _loadCredentials() {
        if (!fs.existsSync(this.credentialsPath)) {
            throw new Error(`File credentials không tồn tại: ${this.credentialsPath}`);
        }

        const raw = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));
        const creds = raw.installed || raw.web;

        if (!creds) {
            throw new Error('File credentials không hợp lệ. Cần file OAuth2 dạng "installed" hoặc "web" từ Google Cloud Console.');
        }

        this.oAuth2Client = new OAuth2Client(
            creds.client_id,
            creds.client_secret,
            creds.redirect_uris?.[0] || 'http://localhost'
        );
    }

    /**
     * Load token đã lưu (nếu có)
     * @returns {boolean} true nếu đã có token hợp lệ
     */
    _loadToken() {
        if (!fs.existsSync(this.tokenPath)) return false;

        try {
            const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
            this.oAuth2Client.setCredentials(token);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Lưu token xuống file
     */
    _saveToken(token) {
        fs.writeFileSync(this.tokenPath, JSON.stringify(token, null, 2), 'utf-8');
    }

    /**
     * Lấy URL để user mở trình duyệt authorize
     */
    getAuthUrl() {
        this._loadCredentials();
        return this.oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: SCOPES,
        });
    }

    /**
     * Đổi authorization code lấy token, lưu xuống file
     * @param {string} code — code từ redirect URL sau khi user authorize
     */
    async exchangeCode(code) {
        this._loadCredentials();
        const { tokens } = await this.oAuth2Client.getToken(code);
        this.oAuth2Client.setCredentials(tokens);
        this._saveToken(tokens);
        return tokens;
    }

    /**
     * Kiểm tra đã authorized chưa (đã có token file)
     */
    isAuthorized() {
        return fs.existsSync(this.tokenPath);
    }

    /**
     * Authenticate + load spreadsheet + get/create sheet
     */
    async init() {
        if (!this.spreadsheetId) {
            throw new Error('Spreadsheet ID chưa được cấu hình');
        }

        this._loadCredentials();

        if (!this._loadToken()) {
            throw new Error('Chưa authorize Google Sheets. Vào Dashboard → Sheets → bấm "Authorize" để đăng nhập.');
        }

        // Auto-refresh token khi hết hạn
        this.oAuth2Client.on('tokens', (newTokens) => {
            // Merge với token cũ (giữ refresh_token)
            const existing = {};
            try {
                Object.assign(existing, JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8')));
            } catch { /* ignore */ }
            const merged = { ...existing, ...newTokens };
            this._saveToken(merged);
        });

        this.doc = new GoogleSpreadsheet(this.spreadsheetId, this.oAuth2Client);
        await this.doc.loadInfo();

        // Tìm hoặc tạo sheet
        this.sheet = this.doc.sheetsByTitle[this.sheetName];
        if (!this.sheet) {
            this.sheet = await this.doc.addSheet({
                title: this.sheetName,
                headerValues: HEADERS,
            });
        }

        // Đảm bảo có headers
        await this.sheet.loadHeaderRow();
        if (!this.sheet.headerValues || this.sheet.headerValues.length === 0) {
            await this.sheet.setHeaderRow(HEADERS);
        }
    }

    /**
     * Ghi báo cáo actions cho 1 profile
     * Upsert: tìm row Date+Profile → update hoặc tạo mới
     */
    async reportActions(profileTag, likedUrls = [], commentedUrls = []) {
        if (likedUrls.length === 0 && commentedUrls.length === 0) {
            return; // Không có gì để report
        }

        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // Load tất cả rows để tìm existing
        const rows = await this.sheet.getRows();
        const existingRow = rows.find(
            r => r.get('Date') === today && r.get('Profile') === profileTag
        );

        if (existingRow) {
            // Cộng dồn counts
            const prevLikes = parseInt(existingRow.get('Likes')) || 0;
            const prevComments = parseInt(existingRow.get('Comments')) || 0;

            existingRow.set('Likes', prevLikes + likedUrls.length);
            existingRow.set('Comments', prevComments + commentedUrls.length);

            // Append URLs (nối thêm, newline-separated)
            const prevLikedUrls = existingRow.get('Liked URLs') || '';
            const prevCommentedUrls = existingRow.get('Commented URLs') || '';

            if (likedUrls.length > 0) {
                const combined = prevLikedUrls
                    ? prevLikedUrls + '\n' + likedUrls.join('\n')
                    : likedUrls.join('\n');
                existingRow.set('Liked URLs', combined);
            }

            if (commentedUrls.length > 0) {
                const combined = prevCommentedUrls
                    ? prevCommentedUrls + '\n' + commentedUrls.join('\n')
                    : commentedUrls.join('\n');
                existingRow.set('Commented URLs', combined);
            }

            await existingRow.save();
            log.debug(`Sheets: updated row ${today} / ${profileTag}`, profileTag);
        } else {
            // Tạo row mới
            await this.sheet.addRow({
                'Date': today,
                'Profile': profileTag,
                'Likes': likedUrls.length,
                'Comments': commentedUrls.length,
                'Liked URLs': likedUrls.join('\n'),
                'Commented URLs': commentedUrls.join('\n'),
            });
            log.debug(`Sheets: new row ${today} / ${profileTag}`, profileTag);
        }
    }

    /**
     * Test kết nối — dùng cho dashboard "Test Connection" button
     */
    async testConnection() {
        await this.init();
        return {
            title: this.doc.title,
            sheetName: this.sheet.title,
            rowCount: this.sheet.rowCount,
        };
    }
}

module.exports = SheetsReporter;
