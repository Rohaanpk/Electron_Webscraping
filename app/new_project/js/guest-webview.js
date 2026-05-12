/**
 * @file guest-webview.js
 * Guest `<webview>` sizing, resize sync, host→guest IPC, and feedback toast.
 */

/** @type {Electron.WebviewTag | null} */
let webPreview = null;

/** @type {ResizeObserver | null} */
let guestWebviewResizeObserver = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let guestToastHideTimer = null;

/**
 * @returns {HTMLElement | null}
 */
function getGuestWebviewHost() {
    return document.querySelector("#select_data .select-data-webview-host");
}

/**
 * @returns {void}
 */
function syncGuestWebviewBounds() {
    const host = getGuestWebviewHost();
    if (!host || !webPreview) return;
    const r = host.getBoundingClientRect();
    let w = Math.max(1, Math.round(r.width));
    let h = Math.max(1, Math.round(r.height));
    if (h <= 2 || w <= 2) {
        w = Math.max(w, host.clientWidth || 1);
        h = Math.max(h, host.clientHeight || 1);
    }
    webPreview.style.boxSizing = "border-box";
    webPreview.style.width = `${w}px`;
    webPreview.style.height = `${h}px`;
}

/**
 * @returns {void}
 */
function attachGuestWebviewResizeObserver() {
    const host = getGuestWebviewHost();
    if (!host || guestWebviewResizeObserver || typeof ResizeObserver === "undefined") return;
    guestWebviewResizeObserver = new ResizeObserver(() => {
        syncGuestWebviewBounds();
    });
    guestWebviewResizeObserver.observe(host);
}

/**
 * @returns {void}
 */
function burstSyncGuestWebviewBounds() {
    let frames = 0;
    const tick = () => {
        syncGuestWebviewBounds();
        if (++frames < 20) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/**
 * @param {string} channel
 * @param {...unknown} args
 * @returns {void}
 */
function sendToGuest(channel, ...args) {
    if (!webPreview || typeof webPreview.send !== "function") return;
    try {
        webPreview.send(channel, ...args);
    } catch (err) {
        console.warn("Guest webview IPC failed:", channel, err);
    }
}

/**
 * @param {string} message
 * @returns {void}
 */
function showGuestToast(message) {
    const el = document.getElementById("guest_feedback_toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("guest-feedback-toast--visible"));
    clearTimeout(guestToastHideTimer);
    guestToastHideTimer = setTimeout(() => {
        el.classList.remove("guest-feedback-toast--visible");
        guestToastHideTimer = setTimeout(() => {
            el.hidden = true;
        }, 230);
    }, 4200);
}

/**
 * @param {Electron.WebviewTag | null} guestWebviewEl `#web_preview`
 * @returns {void}
 */
function initGuestWebview(guestWebviewEl) {
    webPreview = guestWebviewEl;
    attachGuestWebviewResizeObserver();
    if (webPreview) {
        webPreview.addEventListener("dom-ready", () => {
            syncGuestWebviewBounds();
            burstSyncGuestWebviewBounds();
        });
        webPreview.addEventListener("did-stop-loading", () => {
            syncGuestWebviewBounds();
            burstSyncGuestWebviewBounds();
        });
    }
    window.addEventListener("resize", syncGuestWebviewBounds);
    syncGuestWebviewBounds();
}

module.exports = {
    initGuestWebview,
    sendToGuest,
    syncGuestWebviewBounds,
    burstSyncGuestWebviewBounds,
    showGuestToast,
};
