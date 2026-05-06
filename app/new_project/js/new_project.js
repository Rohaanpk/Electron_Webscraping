/**
 * @file new_project.js
 * Renderer process script for the "new project" flow (`new_project.html`).
 *
 * Responsibilities:
 * - Build and edit `scrapePlan` (selectors, start mode, defaults) from the sidebar UI
 *   and from IPC events forwarded from the embedded `<webview>` preload (`preload.js`).
 * - Parse spreadsheet column A into `codes[]` for batch runs.
 * - Run Selenium-driven scraping (`startScraping`) and persist plans/runs via main-process
 *   IPC (`saveScrapePlan`, `saveScrapeRun`, `loadScrapePlans`).
 *
 * Electron architecture:
 * - This file runs in the **host** renderer (the window loading `new_project.html`).
 * - The site under test loads inside `<webview id="web_preview">` with its own guest
 *   process; guest → main → host IPC carries selector picks back here.
 */
const { ipcRenderer } = require('electron');
const XLSX = require("xlsx");
const { By, Builder, Browser, Key } = require('selenium-webdriver');

// =============================================================================
// DOM references
// =============================================================================
var codes = []
var link = ""
const webPreview = document.getElementById("web_preview");
/** @type {ResizeObserver | null} */
let guestWebviewResizeObserver = null;

/**
 * Sends a channel message to the guest `<webview>` preload (`preload.js`).
 *
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

/** @type {{ kind: "search" } | { kind: "openResult"; index: number } | { kind: "textFields"; index: number } | { kind: "imageFields"; index: number } | null} */
let selectorModalTarget = null;

/**
 * Returns the layout box that should define guest `<webview>` bounds.
 *
 * @returns {HTMLElement | null}
 */
function getGuestWebviewHost() {
    return document.querySelector("#select_data .select-data-webview-host");
}

/**
 * Electron `<webview>` often ignores percentage/flex sizing for the embedded page.
 * Copy the host element's border box to explicit pixel width/height on the tag.
 *
 * @returns {void}
 */
function syncGuestWebviewBounds() {
    const host = getGuestWebviewHost();
    if (!host || !webPreview) return;
    /* Prefer layout box from border-box; fall back to clientWidth/Height for sub-pixel stability */
    const r = host.getBoundingClientRect();
    let w = Math.max(1, Math.round(r.width));
    let h = Math.max(1, Math.round(r.height));
    if (h <= 2 || w <= 2) {
        w = Math.max(w, host.clientWidth || 1);
        h = Math.max(h, host.clientHeight || 1);
    }
    webPreview.style.boxSizing = "border-box";
    /* Do not set display:block — Electron's <webview> needs default flex so the guest iframe fills. */
    webPreview.style.width = `${w}px`;
    webPreview.style.height = `${h}px`;
}

/**
 * Subscribes to host size changes so the guest webview stays flush with `.select-data-webview-host`.
 *
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
 * Re-sync several frames — layout after `display:none` → `flex` often settles late.
 *
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

/** @type {ReturnType<typeof setTimeout> | null} */
let guestToastHideTimer = null;

/**
 * Brief toast over the guest webview when the user picks an invalid element for the current mode.
 *
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

const wbInput = document.getElementById('file_input');
const wbChange = document.getElementById('file_change');
const savedPlansSelect = document.getElementById('saved_plans_select');
const planStatus = document.getElementById('plan_status');
const scrapingList = document.getElementById("scraping_list");
let savedPlansCache = [];

const planNameInput = document.getElementById('plan_name_input');
const planStartModeEl = document.getElementById('plan_start_mode');
const planUrlTemplateEl = document.getElementById('plan_url_template');
const planImgAttrDefaultEl = document.getElementById('plan_img_attr_default');
const planImgMultipleDefaultEl = document.getElementById('plan_img_multiple_default');
const planWaitMsEl = document.getElementById('plan_wait_ms');
const planRetryCountEl = document.getElementById('plan_retry_count');
const planContinueOnErrorEl = document.getElementById('plan_continue_on_error');
const planColSkuEl = document.getElementById('plan_col_sku');
const planColLinkEl = document.getElementById('plan_col_link');
const planOutputPathEl = document.getElementById('plan_output_path');

// =============================================================================
// scrapePlan — canonical config object (Mongo-serializable)
// =============================================================================
/**
 * Central scraping configuration assembled from UI + context-menu selections.
 * This mirrors the intended Python-style loop, but keeps selectors dynamic per website.
 *
 * Persistence note:
 * - This structure is intentionally JSON/BSON-friendly so it can be saved directly to MongoDB.
 */
const scrapePlan = {
    site: {
        baseUrl: "",
        startMode: "searchInput", // "searchInput" | "generatedSearchUrl" | "directLink"
        searchInputSelector: null,
        generatedSearchUrlTemplate: "",
        preSearchClickSelectors: [],
    },
    navigation: {
        openResultSelectors: [],
        variantOptionSelectors: [],
    },
    extraction: {
        textFields: [],
        imageFields: [],
        /** Defaults applied when new image fields are added via context menu (if attr not set on element). */
        defaults: {
            imageAttr: "src",
            imageMultiple: true,
        },
    },
    input: {
        codeColumn: "A",
        linkColumnName: "LINKS",
        codeColumnName: "SKU",
    },
    output: {
        format: "xlsx",
        filePath: "./Output.xlsx",
    },
    behavior: {
        waitMs: 20000,
        retryCount: 2,
        continueOnRowError: true,
    }
};

// =============================================================================
// Selector helpers — normalize, dedupe, and append to scrapePlan / UI
// =============================================================================
/**
 * Builds a normalized selector descriptor.
 *
 * @param {string} key Logical key for this selector.
 * @param {"xpath"|"css"|"id"|"className"} identifierType Selector strategy.
 * @param {string} identifierValue Selector value (XPath/CSS/id/class name string).
 * @returns {{ key: string, identifierType: string, identifierValue: string }}
 */
function buildSelectorDescriptor(key, identifierType, identifierValue) {
    return {
        key: key,
        identifierType: identifierType,
        identifierValue: identifierValue,
    };
}

/**
 * Normalizes IPC selector payloads from preload scripts.
 * Supports both legacy string XPath payloads and object payloads.
 *
 * @param {unknown} payload
 * @param {string} key
 * @returns {{ key: string, identifierType: "xpath"|"css"|"id"|"className", identifierValue: string, xpath?: string|null, attr?: "src"|"href", attributes?: Record<string, string>, tagName?: string, displayName?: string }}
 */
function normalizeSelectorPayload(payload, key) {
    if (typeof payload === "string") {
        return {
            ...buildSelectorDescriptor(key, "xpath", payload),
            xpath: payload,
            attributes: {},
            tagName: "",
            displayName: "",
        };
    }

    if (payload && typeof payload === "object") {
        const candidate = /** @type {{identifierType?: string, identifierValue?: string, xpath?: string|null, attr?: "src"|"href", attributes?: Record<string, string>, tagName?: string, displayName?: string}} */ (payload);
        const identifierType = candidate.identifierType === "id" || candidate.identifierType === "className" || candidate.identifierType === "css"
            ? candidate.identifierType
            : "xpath";
        const identifierValue = typeof candidate.identifierValue === "string" && candidate.identifierValue.length > 0
            ? candidate.identifierValue
            : (candidate.xpath || "");

        const attributes =
            candidate.attributes && typeof candidate.attributes === "object" && !Array.isArray(candidate.attributes)
                ? { ...candidate.attributes }
                : {};

        return {
            ...buildSelectorDescriptor(key, identifierType, identifierValue),
            xpath: candidate.xpath != null ? candidate.xpath : null,
            attr: candidate.attr,
            attributes,
            tagName: typeof candidate.tagName === "string" ? candidate.tagName : "",
            displayName: typeof candidate.displayName === "string" ? candidate.displayName : "",
        };
    }

    return {
        ...buildSelectorDescriptor(key, "xpath", ""),
        xpath: "",
        attributes: {},
        tagName: "",
        displayName: "",
    };
}

/**
 * XPath string used for display in Plan settings and for guest highlight.
 *
 * @param {{ identifierType?: string, identifierValue?: string, xpath?: string|null } | null | undefined} sel
 * @returns {string}
 */
function getXPathForPlanDisplay(sel) {
    if (!sel) return "";
    if (sel.xpath != null && String(sel.xpath).trim() !== "") return String(sel.xpath).trim();
    if (sel.identifierType === "xpath" && sel.identifierValue) return String(sel.identifierValue);
    return "";
}

/**
 * Appends a selector descriptor to a field list in `scrapePlan.extraction`.
 *
 * @param {"textFields"|"imageFields"} target
 * @param {{ key?: string, identifierType: "xpath"|"css"|"id"|"className", identifierValue: string, xpath?: string|null, attr?: "src"|"href", attributes?: Record<string, string>, tagName?: string, displayName?: string }} selector
 * @param {{ attr?: "src"|"href", multiple?: boolean }} [options]
 * @returns {boolean} True if a new field was added.
 */
function addExtractionField(target, selector, options = {}) {
    if (!selector.identifierValue) return false;
    const existing = scrapePlan.extraction[target].find(
        (f) => f.identifierType === selector.identifierType && f.identifierValue === selector.identifierValue
    );
    if (existing) return false;

    const meta = {
        xpath: selector.xpath != null ? selector.xpath : null,
        attributes: selector.attributes || {},
        tagName: selector.tagName || "",
        displayName: selector.displayName || "",
    };

    if (target === "textFields") {
        scrapePlan.extraction.textFields.push({
            ...buildSelectorDescriptor(
                selector.key || `text_${scrapePlan.extraction.textFields.length + 1}`,
                selector.identifierType,
                selector.identifierValue
            ),
            ...meta,
        });
        return true;
    }

    const d = scrapePlan.extraction.defaults || { imageAttr: "src", imageMultiple: true };
    scrapePlan.extraction.imageFields.push({
        ...buildSelectorDescriptor(
            selector.key || `images_${scrapePlan.extraction.imageFields.length + 1}`,
            selector.identifierType,
            selector.identifierValue
        ),
        ...meta,
        multiple: options.multiple ?? selector.multiple ?? d.imageMultiple,
        attr: options.attr ?? selector.attr ?? d.imageAttr,
    });
    return true;
}

/**
 * Adds a navigation selector if it does not already exist.
 *
 * @param {"openResultSelectors"|"preSearchClickSelectors"|"variantOptionSelectors"} target
 * @param {{ key?: string, identifierType: "xpath"|"css"|"id"|"className", identifierValue: string, xpath?: string|null, attributes?: Record<string, string>, tagName?: string, displayName?: string }} selector
 * @returns {boolean} True if a new selector was added.
 */
function addNavigationField(target, selector) {
    if (!selector.identifierValue) return false;
    const descriptor = buildSelectorDescriptor(
        selector.key || `nav_${selector.identifierType}_${selector.identifierValue}`,
        selector.identifierType,
        selector.identifierValue
    );
    const row = {
        ...descriptor,
        xpath: selector.xpath != null ? selector.xpath : null,
        attributes: selector.attributes || {},
        tagName: selector.tagName || "",
        displayName: selector.displayName || "",
    };

    if (target === "preSearchClickSelectors") {
        const exists = scrapePlan.site.preSearchClickSelectors.some(
            (f) => f.identifierType === descriptor.identifierType && f.identifierValue === descriptor.identifierValue
        );
        if (!exists) scrapePlan.site.preSearchClickSelectors.push(row);
        return !exists;
    }

    const list =
        target === "openResultSelectors"
            ? scrapePlan.navigation.openResultSelectors
            : scrapePlan.navigation.variantOptionSelectors;
    const exists = list.some(
        (f) => f.identifierType === descriptor.identifierType && f.identifierValue === descriptor.identifierValue
    );
    if (!exists) list.push(row);
    return !exists;
}

/**
 * Updates the plan-status text in the selector prep UI.
 *
 * @param {string} text
 * @returns {void}
 */
function setPlanStatus(text) {
    if (!planStatus) return;
    planStatus.textContent = text;
}

/**
 * Writes current `scrapePlan` values into the Plan settings form.
 *
 * @returns {void}
 */
function syncPlanSettingsFormFromPlan() {
    if (planStartModeEl) planStartModeEl.value = scrapePlan.site.startMode || "searchInput";
    if (planUrlTemplateEl) planUrlTemplateEl.value = scrapePlan.site.generatedSearchUrlTemplate || "";
    const d = scrapePlan.extraction.defaults || { imageAttr: "src", imageMultiple: true };
    if (planImgAttrDefaultEl) planImgAttrDefaultEl.value = d.imageAttr === "href" ? "href" : "src";
    if (planImgMultipleDefaultEl) planImgMultipleDefaultEl.checked = d.imageMultiple !== false;
    if (planWaitMsEl) planWaitMsEl.value = String(scrapePlan.behavior.waitMs ?? 20000);
    if (planRetryCountEl) planRetryCountEl.value = String(scrapePlan.behavior.retryCount ?? 2);
    if (planContinueOnErrorEl) planContinueOnErrorEl.checked = scrapePlan.behavior.continueOnRowError !== false;
    if (planColSkuEl) planColSkuEl.value = scrapePlan.input.codeColumnName || "SKU";
    if (planColLinkEl) planColLinkEl.value = scrapePlan.input.linkColumnName || "LINKS";
    if (planOutputPathEl) planOutputPathEl.value = scrapePlan.output.filePath || "./Output.xlsx";
}

/**
 * Reads the Plan settings form into `scrapePlan`.
 *
 * @returns {void}
 */
function applyPlanSettingsFromForm() {
    if (planStartModeEl) {
        const mode = planStartModeEl.value;
        scrapePlan.site.startMode =
            mode === "generatedSearchUrl" || mode === "directLink" ? mode : "searchInput";
    }
    if (planUrlTemplateEl) scrapePlan.site.generatedSearchUrlTemplate = planUrlTemplateEl.value.trim();
    if (!scrapePlan.extraction.defaults) {
        scrapePlan.extraction.defaults = { imageAttr: "src", imageMultiple: true };
    }
    if (planImgAttrDefaultEl) {
        scrapePlan.extraction.defaults.imageAttr = planImgAttrDefaultEl.value === "href" ? "href" : "src";
    }
    if (planImgMultipleDefaultEl) {
        scrapePlan.extraction.defaults.imageMultiple = planImgMultipleDefaultEl.checked;
    }
    if (planWaitMsEl) scrapePlan.behavior.waitMs = Math.max(0, parseInt(planWaitMsEl.value, 10) || 0);
    if (planRetryCountEl) scrapePlan.behavior.retryCount = Math.max(0, parseInt(planRetryCountEl.value, 10) || 0);
    if (planContinueOnErrorEl) scrapePlan.behavior.continueOnRowError = planContinueOnErrorEl.checked;
    if (planColSkuEl) scrapePlan.input.codeColumnName = planColSkuEl.value.trim() || "SKU";
    if (planColLinkEl) scrapePlan.input.linkColumnName = planColLinkEl.value.trim() || "LINKS";
    if (planOutputPathEl) scrapePlan.output.filePath = planOutputPathEl.value.trim() || "./Output.xlsx";
    setPlanStatus("Plan settings applied to in-memory scrape plan.");
}

/**
 * Persists the current plan to Mongo (after applying form values).
 *
 * @returns {Promise<void>}
 */
async function savePlanToMongo() {
    applyPlanSettingsFromForm();
    await savePlanSnapshot();
    setPlanStatus("Plan saved to database.");
    await refreshSavedPlans();
}

if (typeof window !== 'undefined') {
    window.applyPlanSettingsFromForm = applyPlanSettingsFromForm;
    window.savePlanToMongo = savePlanToMongo;
}

/**
 * Rebuilds only the URL heading row in `#scraping_list`.
 *
 * @returns {void}
 */
function renderUrlHeadingOnly() {
    if (!scrapingList) return;
    const heading = document.getElementById("url_heading");
    scrapingList.innerHTML = "";
    if (heading) {
        const wrap = document.createElement("li");
        wrap.className = "url-heading-wrap";
        wrap.appendChild(heading);
        scrapingList.appendChild(wrap);
    }
}

/**
 * Refreshes Search bar panel + Plan settings XPath list from `scrapePlan`.
 *
 * @returns {void}
 */
function refreshCapturedSelectorsUi() {
    renderSearchBarPanel();
    renderPlanCapturedXpaths();
}

/**
 * Updates the Search bar panel (XPath only; details in modal).
 *
 * @returns {void}
 */
function renderSearchBarPanel() {
    const empty = document.getElementById("search_bar_empty");
    const active = document.getElementById("search_bar_active");
    const xpEl = document.getElementById("search_bar_xpath");
    const sel = scrapePlan.site.searchInputSelector;
    if (!empty || !active || !xpEl) return;
    if (!sel) {
        empty.hidden = false;
        active.hidden = true;
        return;
    }
    empty.hidden = true;
    active.hidden = false;
    xpEl.textContent = getXPathForPlanDisplay(sel) || "(no xpath)";
}

/**
 * Renders captured navigation + extraction entries under Plan settings (XPath lines only).
 *
 * @returns {void}
 */
function renderPlanCapturedXpaths() {
    const ul = document.getElementById("plan_captured_xpaths");
    if (!ul) return;
    ul.innerHTML = "";

    const pushRow = (label, xpathStr, highlightXPath, modalKind, index) => {
        const xpPath = highlightXPath || xpathStr;
        const li = document.createElement("li");
        li.className = "plan-captured-xpaths__item";
        const row = document.createElement("div");
        row.className = "plan-captured-xpaths__row";
        const nameEl = document.createElement("span");
        nameEl.className = "plan-captured-xpaths__name";
        if (label) nameEl.textContent = label;
        const code = document.createElement("code");
        code.className = "plan-captured-xpaths__xpath";
        code.textContent = xpathStr || "(no xpath)";
        code.tabIndex = 0;
        code.title = "Hover to highlight on preview; click for attributes";
        code.addEventListener("mouseenter", () => {
            if (xpPath) sendToGuest("highlight-xpath", xpPath);
        });
        code.addEventListener("mouseleave", () => sendToGuest("clear-xpath-highlight"));
        code.addEventListener("click", (ev) => {
            ev.preventDefault();
            if (modalKind === "openResult") openSelectorModal({ kind: "openResult", index });
            else if (modalKind === "textFields") openSelectorModal({ kind: "textFields", index });
            else if (modalKind === "imageFields") openSelectorModal({ kind: "imageFields", index });
        });
        row.appendChild(nameEl);
        row.appendChild(code);
        li.appendChild(row);
        ul.appendChild(li);
    };

    scrapePlan.navigation.openResultSelectors.forEach((sel, index) => {
        const xpathStr = getXPathForPlanDisplay(sel);
        const disp = sel.displayName ? String(sel.displayName) : "";
        pushRow(disp || `Open result ${index + 1}`, xpathStr, xpathStr, "openResult", index);
    });

    scrapePlan.extraction.textFields.forEach((sel, index) => {
        const xpathStr = getXPathForPlanDisplay(sel);
        const disp = sel.displayName ? String(sel.displayName) : "";
        pushRow(disp || sel.key || `Text ${index + 1}`, xpathStr, xpathStr, "textFields", index);
    });

    scrapePlan.extraction.imageFields.forEach((sel, index) => {
        const xpathStr = getXPathForPlanDisplay(sel);
        const disp = sel.displayName ? String(sel.displayName) : "";
        pushRow(disp || sel.key || `Image ${index + 1}`, xpathStr, xpathStr, "imageFields", index);
    });
}

/**
 * Clears and repopulates sidebar selector summary from the current `scrapePlan`.
 *
 * @returns {void}
 */
function renderSelectorsFromPlan() {
    renderUrlHeadingOnly();
    refreshCapturedSelectorsUi();
}

/**
 * Normalizes a selector-like object to the canonical descriptor shape.
 *
 * @param {unknown} selector
 * @param {string} fallbackKey
 * @returns {{ key: string, identifierType: "xpath"|"css"|"id"|"className", identifierValue: string, attr?: "src"|"href", multiple?: boolean, xpath?: string|null, attributes?: Record<string, string>, tagName?: string, displayName?: string } | null}
 */
function normalizeStoredSelector(selector, fallbackKey) {
    if (!selector || typeof selector !== "object") return null;
    const s = /** @type {{key?: string, identifierType?: string, identifierValue?: string, xpath?: string|null, attr?: "src"|"href", multiple?: boolean, attributes?: Record<string, string>, tagName?: string, displayName?: string}} */ (selector);
    const type = s.identifierType === "id" || s.identifierType === "className" || s.identifierType === "css"
        ? s.identifierType
        : "xpath";
    const value = (typeof s.identifierValue === "string" && s.identifierValue) || (typeof s.xpath === "string" ? s.xpath : "") || "";
    if (!value) return null;
    const attributes =
        s.attributes && typeof s.attributes === "object" && !Array.isArray(s.attributes) ? { ...s.attributes } : {};
    return {
        key: s.key || fallbackKey,
        identifierType: type,
        identifierValue: value,
        attr: s.attr,
        multiple: s.multiple,
        xpath: s.xpath != null ? s.xpath : null,
        attributes,
        tagName: typeof s.tagName === "string" ? s.tagName : "",
        displayName: typeof s.displayName === "string" ? s.displayName : "",
    };
}

// --- Rehydrate `scrapePlan` from a Mongo `scrapePlans` document (or nested `.plan`) ---
/**
 * Applies a saved plan document to the current in-memory `scrapePlan`.
 *
 * @param {unknown} rawPlan
 * @returns {void}
 */
function applyPlanData(rawPlan) {
    const p = /** @type {any} */ (rawPlan || {});

    scrapePlan.site.baseUrl = p.site?.baseUrl || "";
    scrapePlan.site.startMode = p.site?.startMode || "searchInput";
    scrapePlan.site.generatedSearchUrlTemplate = p.site?.generatedSearchUrlTemplate || "";
    scrapePlan.site.searchInputSelector = normalizeStoredSelector(p.site?.searchInputSelector, "search_input");
    scrapePlan.site.preSearchClickSelectors = (p.site?.preSearchClickSelectors || [])
        .map((s, i) => normalizeStoredSelector(s, `pre_search_${i + 1}`))
        .filter(Boolean);

    scrapePlan.navigation.openResultSelectors = (p.navigation?.openResultSelectors || [])
        .map((s, i) => normalizeStoredSelector(s, `open_result_${i + 1}`))
        .filter(Boolean);
    scrapePlan.navigation.variantOptionSelectors = (p.navigation?.variantOptionSelectors || [])
        .map((s, i) => normalizeStoredSelector(s, `variant_${i + 1}`))
        .filter(Boolean);

    scrapePlan.extraction.textFields = (p.extraction?.textFields || [])
        .map((s, i) => normalizeStoredSelector(s, `text_${i + 1}`))
        .filter(Boolean);
    scrapePlan.extraction.imageFields = (p.extraction?.imageFields || [])
        .map((s, i) => normalizeStoredSelector(s, `images_${i + 1}`))
        .filter(Boolean)
        .map((s) => ({ ...s, attr: s.attr || "src", multiple: s.multiple ?? true }));

    scrapePlan.extraction.defaults = {
        imageAttr: "src",
        imageMultiple: true,
        ...(p.extraction?.defaults || {}),
    };

    scrapePlan.input = { ...scrapePlan.input, ...(p.input || {}) };
    scrapePlan.output = { ...scrapePlan.output, ...(p.output || {}) };
    scrapePlan.behavior = { ...scrapePlan.behavior, ...(p.behavior || {}) };

    if (scrapePlan.site.baseUrl) {
        link = scrapePlan.site.baseUrl;
        const inputUrl = document.getElementById("input_url");
        if (inputUrl) inputUrl.value = scrapePlan.site.baseUrl;
        document.getElementById("url_heading").innerHTML = scrapePlan.site.baseUrl;
    }

    renderSelectorsFromPlan();
    syncPlanSettingsFormFromPlan();
}

// =============================================================================
// Saved plans — load from Mongo, apply selection into scrapePlan
// =============================================================================
/**
 * Loads plans from Mongo via IPC and refreshes the plan dropdown.
 *
 * @returns {Promise<void>}
 */
async function refreshSavedPlans() {
    if (!savedPlansSelect) return;
    setPlanStatus("Loading plans...");
    try {
        savedPlansCache = await ipcRenderer.invoke('loadScrapePlans');
        savedPlansSelect.innerHTML = "";
        if (!savedPlansCache.length) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No saved plans found";
            savedPlansSelect.appendChild(opt);
            setPlanStatus("No saved plans found.");
            return;
        }

        for (const doc of savedPlansCache) {
            const opt = document.createElement("option");
            opt.value = doc._id || "";
            const updated = doc.updatedAt ? ` (${new Date(doc.updatedAt).toLocaleString()})` : "";
            opt.textContent = `${doc.name || "unnamed_plan"}${updated}`;
            savedPlansSelect.appendChild(opt);
        }
        setPlanStatus(`Loaded ${savedPlansCache.length} plan(s).`);
    } catch (err) {
        setPlanStatus(`Failed to load plans: ${err?.message || err}`);
    }
}

/**
 * Applies the currently selected saved plan from the dropdown.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function applySelectedPlan() {
    if (!savedPlansSelect) return;
    const selectedId = savedPlansSelect.value;
    const doc = savedPlansCache.find((p) => p._id === selectedId) || null;
    if (!doc) {
        setPlanStatus("Select a plan to apply.");
        return;
    }

    applyPlanData(doc.plan || doc);
    setPlanStatus(`Applied plan: ${doc.name || doc._id}`);
}

// =============================================================================
// Spreadsheet ingestion — column A → codes[]
// =============================================================================
/**
 * Parses the first worksheet of an uploaded spreadsheet and extracts column A values
 * into the global `codes` array.
 *
 * Notes:
 * - Uses `FileReader` in the renderer process to read the file into an ArrayBuffer.
 * - Maintains row alignment by inserting empty strings for missing A-row cells.
 *
 * @param {File} file The user-selected `.xlsx`/`.csv` file.
 * @returns {Promise<void>} Resolves when parsing completes and `codes` is populated.
 */
async function actOnXLSX(file) {
    codes = [];
    const fileReader = new FileReader();

    const data = await new Promise((resolve, reject) => {
        fileReader.onload = () => resolve(fileReader.result);
        fileReader.onerror = () =>
            reject(new Error(fileReader.error?.message || "Could not read file."));
        fileReader.readAsArrayBuffer(file);
    }).finally(() => {
        fileReader.onerror = fileReader.onload = null;
    });

    const workbook = XLSX.read(data, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        throw new Error("No worksheets found in file.");
    }
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
        throw new Error("First worksheet is empty.");
    }

    let intChecker = 1;
    for (const z in worksheet) {
        if (!z || z[0] !== "A") continue;
        const x = parseInt(z.slice(1), 10);
        if (Number.isNaN(x)) continue;
        const cellInt = x + 1;
        const cell = worksheet[z];
        const value = cell && Object.prototype.hasOwnProperty.call(cell, "v") ? cell.v : "";

        while (true) {
            if (intChecker === cellInt - 1) {
                codes.push(value);
                break;
            }
            codes.push("");
            intChecker++;
        }
        intChecker = cellInt;
    }
}

// =============================================================================
// Wizard screens — URL entry, sheet pick, webview handoff
// =============================================================================
/**
 * Triggers the hidden "change spreadsheet" file input.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function changeSheet() {
    wbChange.click();
}

/**
 * Validates a string as a URL using the built-in `URL` constructor.
 *
 * @param {string} str The URL string from the input field.
 * @returns {boolean} True if `str` parses as a URL; otherwise false.
 */
function checkUrl(str) {
    try {
        new URL(str);
    } catch {
        return false;
    }
    return true;
}

/**
 * Returns the UI to the initial "enter URL" step.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function changeSiteLink() {
    document.getElementById('site_preview').style.display = "none";
    document.getElementById('new_project').style.display = "";
}

/**
 * Shows selector prep, loads the URL into the guest `<webview>`, and syncs layout.
 * Guest content runs `preload.js` for context-menu selector capture.
 *
 * @returns {void}
 */
function loadScrapeSelectPage() {
    link = document.getElementById("input_url").value;
    scrapePlan.site.baseUrl = link;
    document.getElementById("web_preview").setAttribute('src', link)
    revealSelectorPrep();
}

/**
 * Reveals `#select_data` (sidebar + webview) after spreadsheet selection.
 *
 * @returns {void}
 */
function revealSelectorPrep() {
    const sheet = document.getElementById("select_sheet");
    const data = document.getElementById("select_data");
    if (sheet) sheet.style.display = "none";
    if (data) data.style.display = "flex";
    syncPlanSettingsFormFromPlan();
    refreshSavedPlans();
    burstSyncGuestWebviewBounds();
    refreshCapturedSelectorsUi();
}

/**
 * Requests navigation back to the landing page.
 *
 * Electron note:
 * - The renderer cannot directly "navigate" the `BrowserWindow` to other files;
 *   it asks the main process to load the appropriate HTML.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function mainPage() {
    ipcRenderer.send('mainPage');
}

/**
 * Validates the entered URL and, if valid, shows a preview step with an embedded `webview`.
 *
 * @returns {string} The URL string from the input field.
 */
// eslint-disable-next-line no-unused-vars
function previewSite() {
    var url = document.getElementById("input_url").value;
    if (checkUrl(url) === true) {
        document.getElementById("preview").setAttribute("src", url);
        document.getElementById("url_heading").innerHTML = url;
        document.getElementById("new_project").style.display = "none";
        document.getElementById("site_preview").style.display = "flex";
    }
    else {
        alert("Please enter a valid URL")
    }
    return url
}

/**
 * Switches the UI into "scraping preview" mode and starts the scraping loop.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function scrapingPreview() {
    document.getElementById("select_data").style.display = 'none';
    document.getElementById("scraping_preview").style.display = "flex";
    startScraping();
}

// =============================================================================
// Mongo persistence — plan snapshots & run logs (ipcRenderer.invoke → main)
// =============================================================================
/**
 * Builds a stable default plan name from the current site and timestamp.
 *
 * @returns {string}
 */
function buildDefaultPlanName() {
    try {
        const host = new URL(scrapePlan.site.baseUrl || "https://local").hostname.replaceAll(".", "_");
        return `${host}_plan_${Date.now()}`;
    } catch {
        return `scrape_plan_${Date.now()}`;
    }
}

/**
 * Saves the current `scrapePlan` to MongoDB through main-process IPC.
 *
 * @returns {Promise<void>}
 */
async function savePlanSnapshot() {
    try {
        const customName = planNameInput && planNameInput.value.trim();
        await ipcRenderer.invoke('saveScrapePlan', {
            name: customName || buildDefaultPlanName(),
            plan: scrapePlan,
        });
    } catch (err) {
        console.warn("Failed to save scrape plan:", err?.message || err);
    }
}

/**
 * Saves a completed scrape run (including extracted rows) to MongoDB.
 *
 * @param {Array<Record<string, string | string[]>>} rows
 * @param {string} startedAt ISO timestamp string.
 * @returns {Promise<void>}
 */
async function saveScrapeRun(rows, startedAt) {
    try {
        await ipcRenderer.invoke('saveScrapeRun', {
            startedAt: startedAt,
            completedAt: new Date().toISOString(),
            rowCount: rows.length,
            planSnapshot: scrapePlan,
            rows: rows,
        });
    } catch (err) {
        console.warn("Failed to save scrape run:", err?.message || err);
    }
}

/**
 * Triggers the hidden spreadsheet file input.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function selectSheet() {
    wbInput.click();
}

/**
 * Moves the UI from site preview to the spreadsheet selection step.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function selectSheetPage() {
    document.getElementById("site_preview").style.display = "none";
    document.getElementById("select_sheet").style.display = "flex";
}

// =============================================================================
// Selector detail modal + hover highlight (guest webview)
// =============================================================================
/**
 * @param {{ kind: "search" } | { kind: "openResult"; index: number } | { kind: "textFields"; index: number } | { kind: "imageFields"; index: number } | null} target
 * @returns {object | null}
 */
function getDescriptorRecordForModal(target) {
    if (!target) return null;
    if (target.kind === "search") return scrapePlan.site.searchInputSelector;
    if (target.kind === "openResult") return scrapePlan.navigation.openResultSelectors[target.index] ?? null;
    if (target.kind === "textFields") return scrapePlan.extraction.textFields[target.index] ?? null;
    if (target.kind === "imageFields") return scrapePlan.extraction.imageFields[target.index] ?? null;
    return null;
}

/**
 * @param {{ kind: "search" } | { kind: "openResult"; index: number } | { kind: "textFields"; index: number } | { kind: "imageFields"; index: number }} target
 * @returns {void}
 */
function openSelectorModal(target) {
    selectorModalTarget = target;
    const dlg = document.getElementById("selector_detail_modal");
    if (!dlg || typeof dlg.showModal !== "function") return;
    fillSelectorModal();
    dlg.showModal();
}

/**
 * @returns {void}
 */
function closeSelectorModal() {
    const dlg = document.getElementById("selector_detail_modal");
    selectorModalTarget = null;
    if (dlg && typeof dlg.close === "function") dlg.close();
}

/**
 * @returns {void}
 */
function fillSelectorModal() {
    const title = document.getElementById("selector_detail_title");
    const sub = document.getElementById("selector_detail_subtitle");
    const tbody = document.getElementById("selector_detail_attrs_body");
    const nameInput = document.getElementById("selector_detail_name");
    if (!selectorModalTarget || !title || !tbody || !nameInput) return;
    const rec = getDescriptorRecordForModal(selectorModalTarget);
    if (!rec) {
        closeSelectorModal();
        return;
    }

    const modeSearch = selectorModalTarget.kind === "search";
    title.textContent = modeSearch ? "Search bar element" : "Captured element";
    if (sub) {
        const bits = [];
        if (rec.tagName) bits.push(`Tag <${String(rec.tagName).toLowerCase()}>`);
        const xp = getXPathForPlanDisplay(rec);
        if (xp) bits.push(`Locator uses: ${rec.identifierType}`);
        sub.textContent = bits.join(" · ");
        sub.hidden = bits.length === 0;
    }

    nameInput.value = rec.displayName || "";

    tbody.innerHTML = "";
    const xpathFull = getXPathForPlanDisplay(rec);
    if (xpathFull) {
        const trXp = document.createElement("tr");
        const tdXpN = document.createElement("td");
        tdXpN.textContent = "XPath";
        const tdXpV = document.createElement("td");
        const codeXp = document.createElement("code");
        codeXp.style.wordBreak = "break-all";
        codeXp.style.fontSize = "0.85em";
        codeXp.textContent = xpathFull;
        tdXpV.appendChild(codeXp);
        trXp.appendChild(tdXpN);
        trXp.appendChild(tdXpV);
        tbody.appendChild(trXp);
    }

    const attrs = rec.attributes && typeof rec.attributes === "object" ? rec.attributes : {};
    const entries = Object.entries(attrs);
    if (entries.length === 0 && !xpathFull) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 2;
        const em = document.createElement("em");
        em.textContent = "No DOM attributes recorded.";
        td.appendChild(em);
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        for (const [k, v] of entries.sort(([a], [b]) => a.localeCompare(b))) {
            const tr = document.createElement("tr");
            const tdN = document.createElement("td");
            tdN.textContent = k;
            const tdV = document.createElement("td");
            tdV.textContent = v;
            tr.appendChild(tdN);
            tr.appendChild(tdV);
            tbody.appendChild(tr);
        }
        if (entries.length === 0 && xpathFull) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 2;
            const em = document.createElement("em");
            em.textContent = "No other DOM attributes on this element.";
            td.appendChild(em);
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
    }
}

/**
 * @returns {void}
 */
function deleteModalEntry() {
    if (!selectorModalTarget) return;
    const t = selectorModalTarget;
    if (t.kind === "search") {
        scrapePlan.site.searchInputSelector = null;
    } else if (t.kind === "openResult") {
        scrapePlan.navigation.openResultSelectors.splice(t.index, 1);
    } else if (t.kind === "textFields") {
        scrapePlan.extraction.textFields.splice(t.index, 1);
    } else if (t.kind === "imageFields") {
        scrapePlan.extraction.imageFields.splice(t.index, 1);
    }
    closeSelectorModal();
    refreshCapturedSelectorsUi();
}

/**
 * @returns {void}
 */
function initSelectorDetailInteractions() {
    const dlg = document.getElementById("selector_detail_modal");
    const saveBtn = document.getElementById("selector_detail_save");
    const delBtn = document.getElementById("selector_detail_delete");
    const closeBtn = document.getElementById("selector_detail_close_btn");
    const closeX = document.getElementById("selector_detail_close_x");

    const xpSearch = document.getElementById("search_bar_xpath");
    if (xpSearch) {
        xpSearch.addEventListener("mouseenter", () => {
            const sel = scrapePlan.site.searchInputSelector;
            if (!sel) return;
            const p = getXPathForPlanDisplay(sel);
            if (p) sendToGuest("highlight-xpath", p);
        });
        xpSearch.addEventListener("mouseleave", () => sendToGuest("clear-xpath-highlight"));
        xpSearch.addEventListener("click", () => openSelectorModal({ kind: "search" }));
    }
    const searchDetailsBtn = document.getElementById("search_bar_details_btn");
    if (searchDetailsBtn) {
        searchDetailsBtn.addEventListener("click", () => openSelectorModal({ kind: "search" }));
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", () => {
            const nameInput = document.getElementById("selector_detail_name");
            const rec = getDescriptorRecordForModal(selectorModalTarget);
            if (rec && nameInput) rec.displayName = nameInput.value.trim();
            closeSelectorModal();
            refreshCapturedSelectorsUi();
        });
    }
    if (delBtn) delBtn.addEventListener("click", () => deleteModalEntry());
    if (closeBtn) closeBtn.addEventListener("click", () => closeSelectorModal());
    if (closeX) closeX.addEventListener("click", () => closeSelectorModal());
    if (dlg) {
        dlg.addEventListener("click", (e) => {
            if (e.target === dlg) closeSelectorModal();
        });
        dlg.addEventListener("close", () => {
            selectorModalTarget = null;
        });
    }
}

initSelectorDetailInteractions();

// =============================================================================
// IPC — main process → host renderer (forwarded guest events)
// =============================================================================
ipcRenderer.on("wrong-search", (_event, detail) => {
    const hint = detail != null && detail !== "" ? String(detail) : "";
    showGuestToast(
        hint
            ? `That element does not match this mode (${hint}). Try another element.`
            : "That element does not match this mode. Right-click a different element."
    );
});

/**
 * IPC: stores the selected searchbar selector in `scrapePlan.site.searchInputSelector`.
 *
 * @listens ipcRenderer#searchXPath
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for the search input element.
 * @returns {void}
 */
ipcRenderer.on('searchXPath', (_event, arg) => {
    const selector = normalizeSelectorPayload(arg, "search_input");
    scrapePlan.site.startMode = "searchInput";
    scrapePlan.site.searchInputSelector = {
        ...buildSelectorDescriptor(
            "search_input",
            selector.identifierType,
            selector.identifierValue
        ),
        xpath: selector.xpath != null ? selector.xpath : null,
        attributes: selector.attributes || {},
        tagName: selector.tagName || "",
        displayName: selector.displayName || "",
    };
    syncPlanSettingsFormFromPlan();
    refreshCapturedSelectorsUi();
})

/**
 * IPC: stores an XPath for an element to click before scraping (e.g., product link chain).
 *
 * @listens ipcRenderer#linkXpathRenderer
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for a clickable element.
 * @returns {void}
 */
ipcRenderer.on('linkXpathRenderer', (_event, arg) => {
    const selector = normalizeSelectorPayload(arg, `link_${scrapePlan.navigation.openResultSelectors.length + 1}`);
    if (addNavigationField("openResultSelectors", selector)) {
        refreshCapturedSelectorsUi();
    }
})

/**
 * IPC: adds a selected text field and appends a line to the selector list.
 *
 * @listens ipcRenderer#textXpathRenderer
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for a text-containing element.
 * @returns {void}
 */
ipcRenderer.on('textXpathRenderer', (_event, arg) => {
    const selector = normalizeSelectorPayload(arg, `text_${scrapePlan.extraction.textFields.length + 1}`);
    if (!addExtractionField("textFields", selector)) return;
    refreshCapturedSelectorsUi();
})

/**
 * IPC: adds a selected image field and appends a line to the selector list.
 *
 * @listens ipcRenderer#imgXpathRenderer
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for an image element.
 * @returns {void}
 */
ipcRenderer.on('imgXpathRenderer', (_event, arg) => {
    const selector = normalizeSelectorPayload(arg, `images_${scrapePlan.extraction.imageFields.length + 1}`);
    if (!addExtractionField("imageFields", selector, { attr: selector.attr || "src" })) return;
    refreshCapturedSelectorsUi();
})

/**
 * Handles replacing the currently loaded spreadsheet.
 *
 * @returns {void}
 */
wbChange.addEventListener(
    "change",
    async () => {
        const file = wbChange.files && wbChange.files[0];
        wbChange.value = "";
        if (!file) return;
        try {
            await actOnXLSX(file);
            setPlanStatus("Spreadsheet replaced.");
        } catch (err) {
            console.warn("Spreadsheet read failed:", err?.message || err);
            alert(`Could not read the spreadsheet: ${err?.message || err}`);
        }
    },
    false
);

/**
 * Handles selecting the initial spreadsheet, then advances to selector prep.
 *
 * @returns {void}
 */
wbInput.addEventListener(
    "change",
    async () => {
        const file = wbInput.files && wbInput.files[0];
        wbInput.value = "";
        if (!file) return;
        try {
            await actOnXLSX(file);
            loadScrapeSelectPage();
        } catch (err) {
            console.warn("Spreadsheet read failed:", err?.message || err);
            alert(`Could not read the spreadsheet: ${err?.message || err}`);
        }
    },
    false
);

// =============================================================================
// Selenium scrape engine — locator resolution, navigation, extraction, main loop
// =============================================================================
/**
 * Resolves a Selenium locator from a stored selector descriptor.
 *
 * @param {{identifierType: "xpath"|"css"|"id"|"className", identifierValue: string}} selector
 * @returns {ReturnType<typeof By.xpath>}
 */
function selectorToBy(selector) {
    switch (selector.identifierType) {
        case "id":
            return By.id(selector.identifierValue);
        case "className":
            return By.className(selector.identifierValue);
        case "css":
            return By.css(selector.identifierValue);
        case "xpath":
        default:
            return By.xpath(selector.identifierValue);
    }
}

/**
 * Clicks all selectors in order, ignoring individual failures.
 *
 * @param {import("selenium-webdriver").WebDriver} driver
 * @param {Array<{identifierType: "xpath"|"css"|"id"|"className", identifierValue: string}>} selectors
 * @returns {Promise<void>}
 */
async function clickSelectorChain(driver, selectors) {
    for (const selector of selectors) {
        try {
            const element = await driver.findElement(selectorToBy(selector));
            await element.click();
        } catch (err) {
            console.warn("Click selector failed:", selector.identifierValue, err?.message || err);
        }
    }
}

/**
 * Performs row startup navigation based on `scrapePlan.site.startMode`.
 *
 * @param {import("selenium-webdriver").WebDriver} driver
 * @param {string} sku
 * @returns {Promise<void>}
 */
async function navigateToRowTarget(driver, sku) {
    const startMode = scrapePlan.site.startMode;

    if (startMode === "directLink") {
        await driver.get(sku);
        return;
    }

    if (startMode === "generatedSearchUrl") {
        const template = scrapePlan.site.generatedSearchUrlTemplate || "";
        const generated = template
            .replaceAll("{sku}", encodeURIComponent(sku))
            .replaceAll("{baseUrl}", scrapePlan.site.baseUrl || "");
        if (!generated) throw new Error("generatedSearchUrlTemplate is empty.");
        await driver.get(generated);
        return;
    }

    if (!scrapePlan.site.searchInputSelector) {
        throw new Error("No searchInput selector configured.");
    }

    await driver.get(scrapePlan.site.baseUrl);
    await clickSelectorChain(driver, scrapePlan.site.preSearchClickSelectors);
    const searchElem = await driver.findElement(selectorToBy(scrapePlan.site.searchInputSelector));
    await searchElem.clear();
    await searchElem.sendKeys(sku);
    await searchElem.sendKeys(Key.ENTER);
}

/**
 * Extracts text and image data for the current page using `scrapePlan.extraction`.
 *
 * @param {import("selenium-webdriver").WebDriver} driver
 * @returns {Promise<Record<string, string | string[]>>}
 */
async function extractConfiguredFields(driver) {
    /** @type {Record<string, string | string[]>} */
    const row = {};

    for (const field of scrapePlan.extraction.textFields) {
        try {
            const el = await driver.findElement(selectorToBy(field));
            row[field.key] = await el.getText();
        } catch {
            row[field.key] = "";
        }
    }

    for (const field of scrapePlan.extraction.imageFields) {
        const attrName = field.attr || "src";
        try {
            if (field.multiple) {
                const els = await driver.findElements(selectorToBy(field));
                const values = [];
                for (const el of els) {
                    const attr = await el.getAttribute(attrName);
                    if (attr) values.push(attr);
                }
                row[field.key] = values;
            } else {
                const el = await driver.findElement(selectorToBy(field));
                row[field.key] = (await el.getAttribute(attrName)) || "";
            }
        } catch {
            row[field.key] = field.multiple ? [] : "";
        }
    }

    return row;
}

/**
 * Executes a dynamic scraping loop driven by `scrapePlan`.
 *
 * For each SKU row:
 * - Navigates using `startMode` (`searchInput`, `generatedSearchUrl`, `directLink`)
 * - Applies configured result-click selectors
 * - Extracts configured text/image fields into an output row
 *
 * @returns {Promise<void>}
 */
async function startScraping() {
    applyPlanSettingsFromForm();
    const driver = await new Builder().forBrowser(Browser.CHROME).build();
    /** @type {Array<Record<string, string | string[]>>} */
    const outputRows = [];
    const startedAt = new Date().toISOString();

    await savePlanSnapshot();

    try {
        for (let i = 1; i < codes.length; i++) {
            const sku = String(codes[i] || "").trim();
            if (!sku) continue;

            try {
                await navigateToRowTarget(driver, sku);
                await clickSelectorChain(driver, scrapePlan.navigation.openResultSelectors);
                const extracted = await extractConfiguredFields(driver);
                outputRows.push({ sku, ...extracted });
            } catch (rowErr) {
                console.warn("Row scrape failed:", i, rowErr?.message || rowErr);
                if (!scrapePlan.behavior.continueOnRowError) throw rowErr;
            }
        }
    } finally {
        await driver.quit();
    }

    await saveScrapeRun(outputRows, startedAt);
    console.info(`Scraping finished: ${outputRows.length} row(s).`);
}
