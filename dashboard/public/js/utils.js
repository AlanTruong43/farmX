/**
 * Shared UI utilities cho dashboard components
 */

/**
 * Set textContent cho element by id
 */
export function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

/**
 * Status badge HTML — merge cả X farming và TG statuses
 */
export function getBadge(status) {
    const map = {
        // X farming
        starting:           '<span class="badge badge-info">starting</span>',
        farming:            '<span class="badge badge-success">farming</span>',
        done:               '<span class="badge badge-muted">done</span>',
        error:              '<span class="badge badge-error">error</span>',
        // TG
        joining:            '<span class="badge badge-info" style="background:rgba(188,140,255,0.15);color:var(--purple)">Joining</span>',
        viewing:            '<span class="badge badge-success">Viewing</span>',
        fetching_id:        '<span class="badge badge-info">Fetching ID</span>',
        logged_out:         '<span class="badge badge-error">Logged Out</span>',
        needs_verification: '<span class="badge badge-error badge-needs-code">Needs Code</span>',
    };
    return map[status] || `<span class="badge badge-muted">${status || '?'}</span>`;
}

/**
 * Format timestamp thành "Xs ago", "Xm ago", "Xh ago"
 */
export function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
}
