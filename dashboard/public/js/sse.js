/**
 * SSE Client — subscribe to realtime events
 */

let eventSource = null;
const listeners = {
    log: [],
    stats: [],
    'farming-status': [],
};

export function connect() {
    if (eventSource) eventSource.close();

    eventSource = new EventSource('/api/logs/stream');

    eventSource.addEventListener('log', (e) => {
        const data = JSON.parse(e.data);
        listeners.log.forEach(fn => fn(data));
    });

    eventSource.addEventListener('stats', (e) => {
        const data = JSON.parse(e.data);
        listeners.stats.forEach(fn => fn(data));
    });

    eventSource.addEventListener('farming-status', (e) => {
        const data = JSON.parse(e.data);
        listeners['farming-status'].forEach(fn => fn(data));
    });

    eventSource.onerror = () => {
        // Auto-reconnect sau 3s
        setTimeout(() => {
            if (eventSource.readyState === EventSource.CLOSED) {
                connect();
            }
        }, 3000);
    };
}

export function on(event, fn) {
    if (listeners[event]) listeners[event].push(fn);
}

export function off(event, fn) {
    if (listeners[event]) {
        listeners[event] = listeners[event].filter(f => f !== fn);
    }
}
