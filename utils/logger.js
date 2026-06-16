/**
 * Logger utility
 * Colored console logging với timestamp và profile context
 * Push logs vào AppState cho SSE streaming
 */
const chalk = require('chalk');

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SUCCESS: 4 };
let currentLevel = LOG_LEVELS.INFO;

// Lazy-load state để tránh circular dependency
let _appState = null;
function getState() {
    if (!_appState) {
        try { _appState = require('../core/state'); } catch { _appState = null; }
    }
    return _appState;
}

function setLevel(level) {
    currentLevel = LOG_LEVELS[level?.toUpperCase()] ?? LOG_LEVELS.INFO;
}

function timestamp() {
    return new Date().toLocaleTimeString('vi-VN', { hour12: false });
}

function formatProfileTag(profileTag) {
    return profileTag ? chalk.cyan(`[${profileTag}]`) : '';
}

function pushToState(level, msg, profileTag) {
    const state = getState();
    if (state) {
        state.pushLog({
            timestamp: new Date().toISOString(),
            level,
            message: msg,
            profileTag: profileTag || '',
        });
    }
}

function debug(msg, profileTag = '') {
    pushToState('DEBUG', msg, profileTag);
    if (currentLevel <= LOG_LEVELS.DEBUG) {
        console.log(`${chalk.gray(timestamp())} ${formatProfileTag(profileTag)} ${chalk.gray(msg)}`);
    }
}

function info(msg, profileTag = '') {
    pushToState('INFO', msg, profileTag);
    if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`${chalk.gray(timestamp())} ${formatProfileTag(profileTag)} ${chalk.white(msg)}`);
    }
}

function warn(msg, profileTag = '') {
    pushToState('WARN', msg, profileTag);
    if (currentLevel <= LOG_LEVELS.WARN) {
        console.log(`${chalk.gray(timestamp())} ${formatProfileTag(profileTag)} ${chalk.yellow('⚠')} ${chalk.yellow(msg)}`);
    }
}

function error(msg, profileTag = '') {
    pushToState('ERROR', msg, profileTag);
    if (currentLevel <= LOG_LEVELS.ERROR) {
        console.log(`${chalk.gray(timestamp())} ${formatProfileTag(profileTag)} ${chalk.red('✖')} ${chalk.red(msg)}`);
    }
}

function success(msg, profileTag = '') {
    pushToState('SUCCESS', msg, profileTag);
    console.log(`${chalk.gray(timestamp())} ${formatProfileTag(profileTag)} ${chalk.green('✔')} ${chalk.green(msg)}`);
}

function action(msg, profileTag = '') {
    pushToState('ACTION', msg, profileTag);
    console.log(`${chalk.gray(timestamp())} ${formatProfileTag(profileTag)} ${chalk.magenta('▸')} ${chalk.magenta(msg)}`);
}

function banner(text) {
    const line = '═'.repeat(50);
    console.log(chalk.cyan(`\n╔${line}╗`));
    console.log(chalk.cyan(`║`) + chalk.bold.white(` ${text.padEnd(49)}`) + chalk.cyan(`║`));
    console.log(chalk.cyan(`╚${line}╝\n`));
}

module.exports = {
    setLevel,
    debug,
    info,
    warn,
    error,
    success,
    action,
    banner,
};
