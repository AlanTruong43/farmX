/**
 * Nav Component — Sidebar navigation with grouped sections
 */

const sections = [
    {
        title: 'X Farming',
        routes: [
            { hash: '#dashboard',  icon: '⚡', label: 'Dashboard' },
            { hash: '#profiles',   icon: '👤', label: 'X Profiles' },
            { hash: '#farming',    icon: '🌾', label: 'Farming Config' },
            { hash: '#ai',         icon: '🤖', label: 'AI Config' },
        ],
    },
    {
        title: 'System',
        routes: [
            { hash: '#general', icon: '⚙', label: 'General Config' },
            { hash: '#logs',    icon: '📋', label: 'Logs' },
        ],
    },
];

export function render() {
    const navHtml = sections.map(section => `
        <div class="nav-section">
            <div class="nav-section-title">${section.title}</div>
            ${section.routes.map(r => `
                <a class="nav-link" href="${r.hash}" data-route="${r.hash}">
                    <span class="icon">${r.icon}</span>
                    <span>${r.label}</span>
                </a>
            `).join('')}
        </div>
    `).join('');

    return `
        <div class="nav-brand">
            <h1>X-Farmer</h1>
            <div class="version">v2.0 Dashboard</div>
        </div>
        <nav>
            ${navHtml}
        </nav>
    `;
}

export function init() {
    updateActive();
    window.addEventListener('hashchange', updateActive);
}

function updateActive() {
    const hash = window.location.hash || '#dashboard';
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.route === hash);
    });
}
