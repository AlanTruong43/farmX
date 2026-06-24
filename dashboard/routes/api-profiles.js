/**
 * API Routes: Profiles
 * GET    /api/profiles           — lấy danh sách profiles
 * PUT    /api/profiles/enable-all  — enable tất cả
 * PUT    /api/profiles/disable-all — disable tất cả
 * DELETE /api/profiles/all         — xóa tất cả
 * PUT    /api/profiles/:id/toggle  — toggle enable/disable
 * POST   /api/profiles/import      — import profiles từ text
 * DELETE /api/profiles/:id         — xóa profile
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const PROFILES_PATH = path.resolve(__dirname, '../../profiles.json');

function readProfiles() {
    return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf-8'));
}

function writeProfiles(data) {
    fs.writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 4), 'utf-8');
}

// GET /api/profiles
router.get('/', (req, res) => {
    try {
        const data = readProfiles();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Bulk routes TRƯỚC /:id routes ──────────────────────

// PUT /api/profiles/enable-all
router.put('/enable-all', (req, res) => {
    try {
        const data = readProfiles();
        let count = 0;
        for (const p of data.profiles) {
            if (p.enabled === false) { p.enabled = true; count++; }
        }
        writeProfiles(data);
        res.json({ ok: true, changed: count, total: data.profiles.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/profiles/disable-all
router.put('/disable-all', (req, res) => {
    try {
        const data = readProfiles();
        let count = 0;
        for (const p of data.profiles) {
            if (p.enabled !== false) { p.enabled = false; count++; }
        }
        writeProfiles(data);
        res.json({ ok: true, changed: count, total: data.profiles.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/profiles/all — xóa toàn bộ profiles
router.delete('/all', (req, res) => {
    try {
        const data = readProfiles();
        const count = data.profiles.length;
        data.profiles = [];
        writeProfiles(data);
        res.json({ ok: true, deleted: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/profiles/import — import profiles từ text (format: id|name)
router.post('/import', (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Không có dữ liệu import' });
        }

        const data = readProfiles();
        const existingIds = new Set(data.profiles.map(p => p.genlogin_id.toString()));
        const lines = text.trim().split('\n').filter(l => l.trim());
        let imported = 0, skipped = 0;

        for (const line of lines) {
            const parts = line.split('|').map(s => s.trim());
            const id = parts[0];
            const name = parts[1] || id;
            if (!id) continue;

            if (existingIds.has(id)) {
                skipped++;
                continue;
            }

            data.profiles.push({
                genlogin_id: id,
                username: name,
                enabled: true,
            });
            existingIds.add(id);
            imported++;
        }

        writeProfiles(data);
        res.json({ ok: true, imported, skipped, total: data.profiles.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Parameterized routes SAU bulk routes ───────────────

// PUT /api/profiles/:id/farming — lưu cấu hình farming riêng cho profile
router.put('/:id/farming', (req, res) => {
    try {
        const data = readProfiles();
        const targetId = req.params.id;
        const profile = data.profiles.find(p => p.genlogin_id.toString() === targetId);
        if (!profile) return res.status(404).json({ error: `Profile ${targetId} không tìm thấy` });

        profile.farming = req.body || {};
        writeProfiles(data);
        res.json({ ok: true, farming: profile.farming });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/profiles/:id/farming — reset về cấu hình mặc định
router.delete('/:id/farming', (req, res) => {
    try {
        const data = readProfiles();
        const targetId = req.params.id;
        const profile = data.profiles.find(p => p.genlogin_id.toString() === targetId);
        if (!profile) return res.status(404).json({ error: `Profile ${targetId} không tìm thấy` });

        delete profile.farming;
        writeProfiles(data);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/profiles/:id/toggle
router.put('/:id/toggle', (req, res) => {
    try {
        const data = readProfiles();
        const targetId = req.params.id;

        const profile = data.profiles.find(
            p => p.genlogin_id.toString() === targetId
        );

        if (!profile) {
            return res.status(404).json({ error: `Profile ${targetId} không tìm thấy` });
        }

        profile.enabled = !profile.enabled;
        writeProfiles(data);

        res.json({ ok: true, genlogin_id: profile.genlogin_id, enabled: profile.enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/profiles/:id — xóa profile
router.delete('/:id', (req, res) => {
    try {
        const data = readProfiles();
        const targetId = req.params.id;
        const before = data.profiles.length;
        data.profiles = data.profiles.filter(
            p => p.genlogin_id.toString() !== targetId
        );

        if (data.profiles.length === before) {
            return res.status(404).json({ error: `Profile ${targetId} không tìm thấy` });
        }

        writeProfiles(data);
        res.json({ ok: true, deleted: before - data.profiles.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
