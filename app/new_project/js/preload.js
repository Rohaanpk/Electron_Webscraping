/**
 * @file preload.js
 * Preload script injected into the **guest** `<webview>` that loads the target website
 * (`web_preview` in `new_project.html`).
 *
 * Role:
 * - Capture right-clicks, ask the **main** process to show a native context menu, then
 *   send structured selector payloads back through IPC (`searchXpath`, `linkXpathMain`, …).
 * - Main forwards those events to the host renderer (`new_project.js`), which merges them
 *   into `scrapePlan`.
 *
 * This consolidates the older per-mode preloads (`search_preload.js`, etc.) into one file.
 */
const { webFrame, ipcRenderer } = require('electron')

/** @type {Element|null} Element under the pointer when the context menu was opened */
let lastRightClickedElement = null;

/**
 * Normalizes a context-menu target to an `Element` (e.g. text nodes use their parent).
 *
 * @param {EventTarget|null} node
 * @returns {Element|null}
 */
// =============================================================================
// DOM helpers + selector construction (id / class / css / xpath)
// =============================================================================
function resolveContextElement(node) {
    if (!node || !(/** @type {any} */ (node)).nodeType) return null;
    const n = /** @type {Node} */ (node);
    if (n.nodeType === 1) return /** @type {Element} */ (n);
    return n.parentElement;
}

/**
 * Builds an XPath string for a DOM element.
 *
 * Notes:
 * - Prefers a unique `id("...")` segment when possible.
 * - Otherwise builds a positional XPath using sibling indices.
 *
 * @param {Element} elm DOM element to describe.
 * @returns {string|null} XPath expression, or null if not computable.
 */
function createXPathFromElement(elm) {
    var allNodes = document.getElementsByTagName('*');
    for (var segs = []; elm && elm.nodeType == 1; elm = elm.parentNode) {
        if (elm.hasAttribute('id')) {
            var uniqueIdCount = 0;
            for (var n = 0; n < allNodes.length; n++) {
                if (allNodes[n].hasAttribute('id') && allNodes[n].id == elm.id) uniqueIdCount++;
                if (uniqueIdCount > 1) break;
            }
            if (uniqueIdCount == 1) {
                segs.unshift('id("' + elm.getAttribute('id') + '")');
                return segs.join('/');
            }
        } else {
            var i, sib;
            for (i = 1, sib = elm.previousSibling; sib; sib = sib.previousSibling) {
                if (sib.localName == elm.localName) i++;
            }
            segs.unshift(elm.localName.toLowerCase() + '[' + i + ']');
        }
    }
    return segs.length ? '/' + segs.join('/') : null;
}

/**
 * Escapes a CSS token value for querySelector usage.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeCssToken(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return value.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
}

/**
 * Builds a selector payload that prefers id/class/css when stable, with XPath fallback.
 *
 * @param {Element} el
 * @param {{"src"|"href"|null} [forcedAttr]}
 * @returns {{ identifierType: "xpath"|"css"|"id"|"className", identifierValue: string, xpath: string|null, attr?: "src"|"href" }}
 */
function buildSelectorPayload(el, forcedAttr = null) {
    const xpath = createXPathFromElement(el);
    const id = (el.getAttribute('id') || '').trim();
    if (id && document.querySelectorAll(`#${escapeCssToken(id)}`).length === 1) {
        return { identifierType: 'id', identifierValue: id, xpath, ...(forcedAttr ? { attr: forcedAttr } : {}) };
    }

    const classTokens = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    for (const token of classTokens) {
        if (document.querySelectorAll(`.${escapeCssToken(token)}`).length === 1) {
            return { identifierType: 'className', identifierValue: token, xpath, ...(forcedAttr ? { attr: forcedAttr } : {}) };
        }
    }

    const dataTestId = (el.getAttribute('data-testid') || '').trim();
    if (dataTestId) {
        return {
            identifierType: 'css',
            identifierValue: `[data-testid="${dataTestId.replace(/"/g, '\\"')}"]`,
            xpath,
            ...(forcedAttr ? { attr: forcedAttr } : {}),
        };
    }

    return { identifierType: 'xpath', identifierValue: xpath || '', xpath, ...(forcedAttr ? { attr: forcedAttr } : {}) };
}

// =============================================================================
// Context-menu modes — validation mirrors legacy `*_preload.js` click handlers
// =============================================================================
/**
 * Mirrors `search_preload.js`: only `<input>` is accepted as the search bar.
 *
 * @param {Element} el The element the user right-clicked.
 * @returns {void}
 */
function applySearchBarSelection(el) {
    const selector = buildSelectorPayload(el);
    if (el.tagName === 'INPUT') {
        ipcRenderer.send('searchXpath', selector);
        ipcRenderer.send('childWindowClose', selector);
    } else {
        ipcRenderer.send('wrongSearchClick', selector.xpath || selector.identifierValue);
    }
}

/**
 * Mirrors `link_preload.js`: any element’s XPath is used as the product link target.
 *
 * @param {Element} el The element the user right-clicked.
 * @returns {void}
 */
function applyLinkSelection(el) {
    const selector = buildSelectorPayload(el);
    ipcRenderer.send('linkXpathMain', selector);
    ipcRenderer.send('childWindowClose', selector);
}

/**
 * Mirrors `text_preload.js`: elements with empty `innerHTML` are rejected; otherwise XPath is sent.
 *
 * @param {Element} el The element the user right-clicked.
 * @returns {void}
 */
function applyTextSelection(el) {
    if (el.innerHTML === '') {
        ipcRenderer.send('wrongSearchClick', el.tagName);
        return;
    }
    const selector = buildSelectorPayload(el);
    ipcRenderer.send('textXpathMain', selector);
    ipcRenderer.send('childWindowClose', selector);
}

/**
 * Mirrors `img_preload.js`: only `IMG` or `A` is accepted; other elements trigger `wrongSearchClick`.
 *
 * @param {Element} el The element the user right-clicked.
 * @returns {void}
 */
function applyImageSelection(el) {
    const tag = el.tagName;
    const attr = tag === 'A' ? 'href' : 'src';
    const selector = buildSelectorPayload(el, attr);
    if (tag === 'IMG' || tag === 'A') {
        ipcRenderer.send('imgXpathMain', selector);
        ipcRenderer.send('childWindowClose');
    } else {
        ipcRenderer.send('wrongSearchClick', selector.xpath || selector.identifierValue);
    }
}

// =============================================================================
// User events — context menu, main-process menu callbacks, hover highlight
// =============================================================================
/**
 * Right-click: store the target and open the app menu in the main process.
 * The menu items send back one of `ctxmenu-select-*` so we apply the same rules
 * as the four dedicated `*_preload.js` scripts (previously click-to-select).
 *
 * @param {MouseEvent} event
 * @returns {void}
 */
document.addEventListener('contextmenu', (event) => {
    lastRightClickedElement = resolveContextElement(event.target);
    event.preventDefault();
    ipcRenderer.send('show-ctxmenu');
});

/**
 * IPC: user chose "search bar" in the main-process context menu.
 *
 * @listens ipcRenderer#ctxmenu-select-search
 * @returns {void}
 */
ipcRenderer.on('ctxmenu-select-search', () => {
    if (!lastRightClickedElement) return;
    applySearchBarSelection(lastRightClickedElement);
});

/**
 * IPC: user chose "product link" in the main-process context menu.
 *
 * @listens ipcRenderer#ctxmenu-select-link
 * @returns {void}
 */
ipcRenderer.on('ctxmenu-select-link', () => {
    if (!lastRightClickedElement) return;
    applyLinkSelection(lastRightClickedElement);
});

/**
 * IPC: user chose "text to scrape" in the main-process context menu.
 *
 * @listens ipcRenderer#ctxmenu-select-text
 * @returns {void}
 */
ipcRenderer.on('ctxmenu-select-text', () => {
    if (!lastRightClickedElement) return;
    applyTextSelection(lastRightClickedElement);
});

/**
 * IPC: user chose "image" in the main-process context menu.
 *
 * @listens ipcRenderer#ctxmenu-select-img
 * @returns {void}
 */
ipcRenderer.on('ctxmenu-select-img', () => {
    if (!lastRightClickedElement) return;
    applyImageSelection(lastRightClickedElement);
});

// =============================================================================
// Guest page bootstrap (zoom, optional jQuery)
// =============================================================================
/**
 * Injects jQuery and sets zoom; same bootstrapping as the other `*_preload.js` files.
 *
 * @returns {void}
 */
window.onload = function () {
    webFrame.setZoomFactor(1);
    console.log('preload.js loaded');
    var scriptElt = document.createElement('script');
    scriptElt.type = 'text/javascript';
    scriptElt.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
    scriptElt.onload = function () {
        $('*').on('click', function (event) {
            if ($(this).is('[disabled]')) {
                event.preventDefault();
            }
        });
    };
    document.getElementsByTagName('head')[0].appendChild(scriptElt);
};

/**
 * Tracks hover movement and updates a visual overlay to highlight the element under the cursor.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
document.addEventListener('mouseover', function (e) {
    updateMask(e.target);
});

/**
 * Draws/updates an absolutely-positioned overlay matching the target element's bounding box.
 *
 * @param {Element} target DOM element to highlight.
 * @returns {void}
 */
function updateMask(target) {
    let elements = document.getElementsByClassName('highlight-wrap');
    let hObj;
    if (elements.length !== 0) {
        hObj = elements[0];
    } else {
        hObj = document.createElement('div');
        hObj.className = 'highlight-wrap';
        hObj.style.position = 'absolute';
        hObj.style.backgroundColor = '#A020F0';
        hObj.style.opacity = '0.5';
        hObj.style.cursor = 'default';
        hObj.style.pointerEvents = 'none';
        document.body.appendChild(hObj);
    }
    let rect = target.getBoundingClientRect();
    hObj.style.left = (rect.left + window.scrollX) + 'px';
    hObj.style.top = (rect.top + window.scrollY) + 'px';
    hObj.style.width = rect.width + 'px';
    hObj.style.height = rect.height + 'px';
}
