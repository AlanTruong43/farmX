/**
 * Human-like utilities
 * Delay ngẫu nhiên, gõ phím như người thật, scroll tự nhiên
 */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Delay ngẫu nhiên giữa min và max (ms)
 */
async function randomDelay(minMs = 1000, maxMs = 3000) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await sleep(delay);
    return delay;
}

/**
 * Gõ text như người thật — từng ký tự với delay ngẫu nhiên
 */
async function humanType(page, selector, text, { minDelay = 50, maxDelay = 150 } = {}) {
    await page.click(selector);
    await sleep(200);
    
    for (const char of text) {
        await page.keyboard.type(char, { delay: Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay });
    }
}

/**
 * Gõ text vào element đã có sẵn (không cần selector)
 */
async function humanTypeInElement(element, text, { minDelay = 50, maxDelay = 150 } = {}) {
    await element.click();
    await sleep(200);
    
    for (const char of text) {
        await element.type(char, { delay: Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay });
    }
}

/**
 * Scroll xuống từ từ (giả lập người đọc feed)
 */
async function humanScroll(page, { scrolls = 5, minDistance = 200, maxDistance = 600, minPause = 800, maxPause = 2500 } = {}) {
    for (let i = 0; i < scrolls; i++) {
        const distance = Math.floor(Math.random() * (maxDistance - minDistance)) + minDistance;
        await page.evaluate((d) => window.scrollBy(0, d), distance);
        await randomDelay(minPause, maxPause);
    }
}

/**
 * Di chuyển chuột đến element rồi click (tự nhiên hơn direct click)
 */
async function humanClick(page, selector, { timeout = 10000 } = {}) {
    const element = await page.waitForSelector(selector, { visible: true, timeout });
    const box = await element.boundingBox();
    
    if (box) {
        // Click vào vị trí ngẫu nhiên trong element (không phải luôn chính giữa)
        const x = box.x + box.width * (0.3 + Math.random() * 0.4);
        const y = box.y + box.height * (0.3 + Math.random() * 0.4);
        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 5) + 3 });
        await sleep(Math.floor(Math.random() * 200) + 100);
        await page.mouse.click(x, y);
    } else {
        await element.click();
    }
    
    return element;
}

module.exports = {
    sleep,
    randomDelay,
    humanType,
    humanTypeInElement,
    humanScroll,
    humanClick,
};
