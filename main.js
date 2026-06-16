#!/usr/bin/env node
/**
 * X-Farmer CLI
 * Farm X (Twitter) accounts using GenLogin profiles + AI comments
 *
 * Usage:
 *   node main.js list                              — Liệt kê profiles GenLogin
 *   node main.js farm                              — Farm tất cả profiles (dùng config.json)
 *   node main.js farm --profile <id>               — Farm 1 profile
 *   node main.js farm --mode newsfeed              — Chế độ newsfeed
 *   node main.js farm --mode hashtag               — Chế độ hashtag
 *   node main.js farm --loops 5                    — Số vòng lặp
 *   node main.js farm --hashtags "#AI,#crypto"     — Hashtags (chế độ hashtag)
 *   node main.js stop                              — Stop tất cả profiles đang chạy
 *   node main.js server                            — Khởi động Web Dashboard
 *   node main.js server --port 8080                — Dashboard trên port khác
 */
const { program } = require('commander');
const fs = require('fs');
const path = require('path');

const GenLoginClient = require('./core/genlogin');
const WorkerPool = require('./core/pool');
const log = require('./utils/logger');

// ─── Load config ─────────────────────────────────────────────────────
function loadJSON(filePath) {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
        log.error(`File không tồn tại: ${fullPath}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

// ─── Command: list ───────────────────────────────────────────────────
async function cmdList() {
    log.banner('DANH SÁCH PROFILES GENLOGIN');

    const config = loadJSON('./config.json');
    const profilesData = loadJSON('./profiles.json');
    const genlogin = new GenLoginClient(config.genlogin_url);

    const healthy = await genlogin.healthCheck();
    if (!healthy) {
        log.error('Không kết nối được GenLogin! Đảm bảo app GenLogin đang chạy.');
        process.exit(1);
    }
    log.success('GenLogin đang chạy ✓');

    // Lấy thông tin từng profile đã cấu hình
    const entries = profilesData.profiles;
    console.log('');
    console.log(`  Profiles cấu hình: ${entries.length}`);
    console.log('');
    console.log('  ┌──────────────────┬──────────────────────┬──────────────────────┬────────────────┐');
    console.log('  │ GenLogin ID      │ Username             │ Tên Profile          │ Trạng thái     │');
    console.log('  ├──────────────────┼──────────────────────┼──────────────────────┼────────────────┤');

    for (const entry of entries) {
        const id = entry.genlogin_id.toString().padEnd(16);
        const username = (entry.username || '').padEnd(20);
        let profileName = 'N/A';
        let status = '⚪ Unknown';

        try {
            const data = await genlogin.getProfile(entry.genlogin_id);
            profileName = data?.profile_data?.name || 'N/A';
            try {
                const ws = await genlogin.getWsEndpoint(entry.genlogin_id);
                status = (ws && ws !== '') ? '🟢 Running' : '⚪ Stopped';
            } catch {
                status = '⚪ Stopped';
            }
        } catch {
            status = '❌ Not found';
        }

        console.log(`  │ ${id} │ ${username} │ ${profileName.substring(0, 20).padEnd(20)} │ ${status.padEnd(14)} │`);
    }

    console.log('  └──────────────────┴──────────────────────┴──────────────────────┴────────────────┘');
    console.log('');
}

// ─── Command: farm ───────────────────────────────────────────────────
async function cmdFarm(options) {
    const config = loadJSON('./config.json');
    const profilesData = loadJSON('./profiles.json');

    // Override config từ CLI options
    if (options.mode) config.farming.mode = options.mode;
    if (options.loops) config.farming.loop_count = parseInt(options.loops);
    if (options.hashtags) config.farming.hashtags = options.hashtags.split(',').map(h => h.trim());
    if (options.concurrent) config.max_concurrent_profiles = parseInt(options.concurrent);

    log.setLevel(config.log_level);

    // Kiểm tra GenLogin
    const genlogin = new GenLoginClient(config.genlogin_url);
    const healthy = await genlogin.healthCheck();
    if (!healthy) {
        log.error('Không kết nối được GenLogin! Đảm bảo app GenLogin đang chạy.');
        process.exit(1);
    }
    log.success('GenLogin đang chạy ✓');

    // Kiểm tra AI API key
    const aiType = config.ai_provider?.type || 'gemini';
    const aiKey = config.ai_provider?.api_key || config.gemini?.api_key;
    if (!aiKey) {
        log.warn(`Chưa cấu hình ${aiType.toUpperCase()} API key! Comment sẽ dùng fallback (emoji/short text)`);
    }

    const pool = new WorkerPool(config);

    if (options.profile) {
        const profileEntry = profilesData.profiles.find(
            p => p.genlogin_id.toString() === options.profile.toString() || p.username === options.profile
        );

        if (!profileEntry) {
            log.error(`Profile "${options.profile}" không tìm thấy trong profiles.json`);
            process.exit(1);
        }

        await pool.runSingle(profileEntry);
    } else {
        await pool.runAll(profilesData.profiles);
    }
}

// ─── Command: stop ───────────────────────────────────────────────────
async function cmdStop(options) {
    log.banner('STOP PROFILES');

    const config = loadJSON('./config.json');
    const genlogin = new GenLoginClient(config.genlogin_url);

    const healthy = await genlogin.healthCheck();
    if (!healthy) {
        log.error('Không kết nối được GenLogin!');
        process.exit(1);
    }

    if (options.profile) {
        log.info(`Stop profile: ${options.profile}`);
        await genlogin.stopProfile(options.profile);
        log.success('Đã stop profile');
    } else {
        const running = await genlogin.getRunningProfiles();
        const profiles = running || [];

        if (profiles.length === 0) {
            log.info('Không có profile nào đang chạy');
            return;
        }

        log.info(`Đang stop ${profiles.length} profiles...`);
        for (const p of profiles) {
            const id = p.id || p;
            try {
                await genlogin.stopProfile(id);
                log.success(`Stopped: ${id}`);
            } catch (err) {
                log.error(`Lỗi stop ${id}: ${err.message}`);
            }
        }
        log.success('Đã stop tất cả profiles');
    }
}

// ─── Command: server ─────────────────────────────────────────────────
function cmdServer(options) {
    const config = loadJSON('./config.json');
    const port = parseInt(options.port) || config.dashboard?.port || 3000;

    log.setLevel(config.log_level);

    const { createServer } = require('./dashboard/server');
    createServer(port);
}

// ─── CLI Setup ───────────────────────────────────────────────────────
program
    .name('x-farmer')
    .description('X (Twitter) farming toolkit — GenLogin + AI comments + Web Dashboard')
    .version('2.0.0');

program
    .command('list')
    .description('Liệt kê tất cả GenLogin profiles')
    .action(cmdList);

program
    .command('farm')
    .description('Bắt đầu farming')
    .option('-p, --profile <id>', 'Farm 1 profile cụ thể')
    .option('-m, --mode <mode>', 'Chế độ: newsfeed hoặc hashtag')
    .option('-l, --loops <count>', 'Số vòng lặp')
    .option('-t, --hashtags <tags>', 'Hashtags phân cách bởi dấu phẩy (vd: "#AI,#crypto")')
    .option('-c, --concurrent <n>', 'Số profile chạy đồng thời')
    .action(cmdFarm);

program
    .command('stop')
    .description('Stop profiles đang chạy')
    .option('-p, --profile <id>', 'Stop 1 profile cụ thể')
    .action(cmdStop);

program
    .command('server')
    .description('Khởi động Web Dashboard')
    .option('--port <port>', 'Port cho dashboard (mặc định: 3000)')
    .action(cmdServer);

program.parse();
