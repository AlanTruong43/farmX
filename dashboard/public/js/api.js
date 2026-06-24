/**
 * API wrapper — fetch helper cho dashboard
 */

const BASE = '';

async function request(method, url, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE}${url}`, opts);
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

export const api = {
    getConfig:      ()          => request('GET', '/api/config'),
    updateAI:       (body)      => request('PUT', '/api/config/ai', body),
    updateFarming:  (body)      => request('PUT', '/api/config/farming', body),
    updateGeneral:  (body)      => request('PUT', '/api/config/general', body),
    updateSheets:   (body)      => request('PUT', '/api/config/sheets', body),
    testSheets:     ()          => request('POST', '/api/config/sheets-test'),
    getSheetsAuthUrl: ()        => request('GET', '/api/config/sheets-auth-url'),
    sheetsAuthCallback: (code)  => request('POST', '/api/config/sheets-auth-callback', { code }),
    getSheetsStatus: ()         => request('GET', '/api/config/sheets-status'),

    getProfiles:        ()          => request('GET', '/api/profiles'),
    toggleProfile:      (id)        => request('PUT', `/api/profiles/${id}/toggle`),
    importProfiles:     (text)      => request('POST', '/api/profiles/import', { text }),
    deleteProfile:      (id)        => request('DELETE', `/api/profiles/${id}`),
    enableAllProfiles:  ()          => request('PUT', '/api/profiles/enable-all'),
    disableAllProfiles: ()          => request('PUT', '/api/profiles/disable-all'),
    deleteAllProfiles:  ()          => request('DELETE', '/api/profiles/all'),
    saveProfileFarming: (id, body)  => request('PUT', `/api/profiles/${id}/farming`, body),
    resetProfileFarming:(id)        => request('DELETE', `/api/profiles/${id}/farming`),

    startFarming:   ()          => request('POST', '/api/farming/start'),
    stopFarming:    ()          => request('POST', '/api/farming/stop'),
    getFarmingStatus: ()        => request('GET', '/api/farming/status'),

    getLogHistory:  ()          => request('GET', '/api/logs/history'),
    getStatus:      ()          => request('GET', '/api/logs/status'),
};
