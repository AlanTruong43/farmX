/**
 * App.js — Hash-based SPA router + toast system
 */
import * as nav from './components/nav.js';
import * as dashboard from './components/dashboard.js';
import * as profiles from './components/profiles.js';
import * as generalConfig from './components/general-config.js';
import * as farmingConfig from './components/farming-config.js';
import * as followCheck from './components/follow-check.js';
import { connect as sseConnect } from './sse.js';

const routes = {
    '#dashboard':     dashboard,
    '#profiles':      profiles,
    '#farming':       farmingConfig,
    '#general':       generalConfig,
    '#follow-check':  followCheck,
};

let currentRoute = null;

// ─── Toast system ─────────────────────────────────────
let toastContainer = null;

export function toast(message, type = 'success') {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    toastContainer.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// ─── Router ───────────────────────────────────────────
function navigate() {
    const hash = window.location.hash || '#dashboard';
    const route = routes[hash] || dashboard;

    // Destroy previous route if it has cleanup
    if (currentRoute && typeof currentRoute.destroy === 'function') {
        currentRoute.destroy();
    }

    currentRoute = route;

    const content = document.getElementById('content');
    content.innerHTML = route.render();
    route.init();
}

// ─── Init ─────────────────────────────────────────────
function init() {
    // Render sidebar
    const sidebar = document.getElementById('sidebar');
    sidebar.innerHTML = nav.render();
    nav.init();

    // SSE connect
    sseConnect();

    // Initial route
    navigate();

    // Listen hash changes
    window.addEventListener('hashchange', navigate);
}

// Boot
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
