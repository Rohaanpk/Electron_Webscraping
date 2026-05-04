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
// const { val } = require('cheerio/lib/api/attributes');
// const { text } = require('cheerio/lib/api/manipulation');
// const { get } = require('cheerio/lib/api/traversing');
const { ipcRenderer } = require('electron');
const XLSX = require("xlsx");
const { By, Builder, Browser, Key } = require('selenium-webdriver');

// =============================================================================
// DOM references & legacy parallel arrays (kept for older scraping paths / UI)
// =============================================================================
var textArray = []
var imgArray = []
var before_product = []
var codes = []
var link = ""
const webPreview = document.getElementById("web_preview");
/** @type {ResizeObserver | null} */
let guestWebviewResizeObserver = null;

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
    webPreview.style.display = "block";
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
 * @returns {{ key: string, identifierType: "xpath"|"css"|"id"|"className", identifierValue: string, xpath?: string, attr?: "src"|"href" }}
 */
function normalizeSelectorPayload(payload, key) {
    if (typeof payload === "string") {
        return {
            ...buildSelectorDescriptor(key, "xpath", payload),
            xpath: payload,
        };
    }

    if (payload && typeof payload === "object") {
        const candidate = /** @type {{identifierType?: string, identifierValue?: string, xpath?: string, attr?: "src"|"href"}} */ (payload);
        const identifierType = candidate.identifierType === "id" || candidate.identifierType === "className" || candidate.identifierType === "css"
            ? candidate.identifierType
            : "xpath";
        const identifierValue = typeof candidate.identifierValue === "string" && candidate.identifierValue.length > 0
            ? candidate.identifierValue
            : (candidate.xpath || "");

        return {
            ...buildSelectorDescriptor(key, identifierType, identifierValue),
            xpath: candidate.xpath,
            attr: candidate.attr,
        };
    }

    return {
        ...buildSelectorDescriptor(key, "xpath", ""),
        xpath: "",
    };
}

/**
 * Appends a selector descriptor to a field list in `scrapePlan.extraction`.
 *
 * @param {"textFields"|"imageFields"} target
 * @param {{ key?: string, identifierType: "xpath"|"css"|"id"|"className", identifierValue: string, xpath?: string, attr?: "src"|"href" }} selector
 * @param {{ attr?: "src"|"href", multiple?: boolean }} [options]
 * @returns {void}
 */
function addExtractionField(target, selector, options = {}) {
    if (!selector.identifierValue) return;
    const existing = scrapePlan.extraction[target].find(
        (f) => f.identifierType === selector.identifierType && f.identifierValue === selector.identifierValue
    );
    if (existing) return;

    if (target === "textFields") {
        scrapePlan.extraction.textFields.push(
            buildSelectorDescriptor(
                selector.key || `text_${scrapePlan.extraction.textFields.length + 1}`,
                selector.identifierType,
                selector.identifierValue
            )
        );
        return;
    }

    const d = scrapePlan.extraction.defaults || { imageAttr: "src", imageMultiple: true };
    scrapePlan.extraction.imageFields.push({
        ...buildSelectorDescriptor(
            selector.key || `images_${scrapePlan.extraction.imageFields.length + 1}`,
            selector.identifierType,
            selector.identifierValue
        ),
        multiple: options.multiple ?? selector.multiple ?? d.imageMultiple,
        attr: options.attr ?? selector.attr ?? d.imageAttr,
    });
}

/**
 * Adds a navigation selector if it does not already exist.
 *
 * @param {"openResultSelectors"|"preSearchClickSelectors"|"variantOptionSelectors"} target
 * @param {{ key?: string, identifierType: "xpath"|"css"|"id"|"className", identifierValue: string }} selector
 * @returns {void}
 */
function addNavigationField(target, selector) {
    if (!selector.identifierValue) return;
    const descriptor = buildSelectorDescriptor(
        selector.key || `nav_${selector.identifierType}_${selector.identifierValue}`,
        selector.identifierType,
        selector.identifierValue
    );

    if (target === "preSearchClickSelectors") {
        const exists = scrapePlan.site.preSearchClickSelectors.some(
            (f) => f.identifierType === descriptor.identifierType && f.identifierValue === descriptor.identifierValue
        );
        if (!exists) scrapePlan.site.preSearchClickSelectors.push(descriptor);
        return;
    }

    const list =
        target === "openResultSelectors"
            ? scrapePlan.navigation.openResultSelectors
            : scrapePlan.navigation.variantOptionSelectors;
    const exists = list.some(
        (f) => f.identifierType === descriptor.identifierType && f.identifierValue === descriptor.identifierValue
    );
    if (!exists) list.push(descriptor);
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
 * Writes a single selector description line to the selector list UI.
 *
 * @param {string} text
 * @returns {void}
 */
function appendSelectorUiLine(text) {
    if (!scrapingList) return;
    const li = document.createElement("li");
    li.className = "selector-line";
    li.appendChild(document.createTextNode(text));
    li.contentEditable = "true";
    scrapingList.insertBefore(li, scrapingList.lastElementChild?.nextSibling || null);
}

/**
 * Clears and repopulates the selector list UI from the current `scrapePlan`.
 *
 * @returns {void}
 */
function renderSelectorsFromPlan() {
    if (!scrapingList) return;
    const heading = document.getElementById("url_heading");
    scrapingList.innerHTML = "";
    if (heading) {
        const wrap = document.createElement("li");
        wrap.className = "url-heading-wrap";
        wrap.appendChild(heading);
        scrapingList.appendChild(wrap);
    }

    if (scrapePlan.site.searchInputSelector) {
        appendSelectorUiLine(
            `searchInput -> ${scrapePlan.site.searchInputSelector.identifierType}: ${scrapePlan.site.searchInputSelector.identifierValue}`
        );
    }

    for (const selector of scrapePlan.navigation.openResultSelectors) {
        appendSelectorUiLine(`openResult -> ${selector.identifierType}: ${selector.identifierValue}`);
    }

    for (const field of scrapePlan.extraction.textFields) {
        appendSelectorUiLine(`${field.key} -> ${field.identifierType}: ${field.identifierValue}`);
    }

    for (const field of scrapePlan.extraction.imageFields) {
        appendSelectorUiLine(`${field.key} -> ${field.identifierType}: ${field.identifierValue} (attr: ${field.attr || "src"})`);
    }
}

/**
 * Resets legacy compatibility arrays from the current `scrapePlan`.
 *
 * @returns {void}
 */
function syncLegacyArraysFromPlan() {
    before_product = scrapePlan.navigation.openResultSelectors.map((s) => s.identifierValue);
    textArray = scrapePlan.extraction.textFields.map((s) => s.identifierValue);
    imgArray = scrapePlan.extraction.imageFields.map((s) => s.identifierValue);
}

/**
 * Normalizes a selector-like object to the canonical descriptor shape.
 *
 * @param {unknown} selector
 * @param {string} fallbackKey
 * @returns {{ key: string, identifierType: "xpath"|"css"|"id"|"className", identifierValue: string, attr?: "src"|"href", multiple?: boolean } | null}
 */
function normalizeStoredSelector(selector, fallbackKey) {
    if (!selector || typeof selector !== "object") return null;
    const s = /** @type {{key?: string, identifierType?: string, identifierValue?: string, xpath?: string, attr?: "src"|"href", multiple?: boolean}} */ (selector);
    const type = s.identifierType === "id" || s.identifierType === "className" || s.identifierType === "css"
        ? s.identifierType
        : "xpath";
    const value = (typeof s.identifierValue === "string" && s.identifierValue) || s.xpath || "";
    if (!value) return null;
    return {
        key: s.key || fallbackKey,
        identifierType: type,
        identifierValue: value,
        attr: s.attr,
        multiple: s.multiple,
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

    syncLegacyArraysFromPlan();
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
    // Reads file
    const fileReader = new FileReader();

    const data = await new Promise((resolve, reject) => {
        fileReader.onload = () => {
            resolve(fileReader.result);
        };
        fileReader.onerror = reject;
        // Converts file to array buffer
        fileReader.readAsArrayBuffer(file);
    })
        .finally(() => {
            fileReader.onerror = fileReader.onload = null;
        });
    console.log(data);

    // Reads array buffer as data
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    console.log(worksheet);

    // var columnA = []
    var intChecker = 1
    // iterate through the data and get the content within the first column and store it to an array
    for (let z in worksheet) {
        if (z.toString()[0] === 'A') {
            var x = parseInt(z.replace(/A/, ""))
            let cellInt = x + 1
            while (true) {
                if (intChecker == cellInt - 1) {
                    codes.push(worksheet[z].v);
                    console.log(x, worksheet[z].v)
                    break
                }
                else {
                    codes.push("")
                    console.log(intChecker, "")
                    intChecker++
                }
            }
            intChecker = cellInt;
        }
    }
    // log the first column data to console
    console.log(codes);
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
    } catch (err) {
        console.log(err);
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
 * Loads the URL entered by the user into the selection `webview` and notifies the
 * main process that the app is ready to move into the selector-prep step.
 *
 * Electron note:
 * - This uses IPC (`loadSearchPreview`) to coordinate UI state changes that are
 *   driven from the main process.
 * - Sets the **guest** `<webview>` `src` to the target site; the guest loads in a
 *   separate process and runs `preload.js` for context-menu selector capture.
 *
 * @returns {void}
 */
function loadScrapeSelectPage() {
    link = document.getElementById("input_url").value;
    scrapePlan.site.baseUrl = link;
    document.getElementById("web_preview").setAttribute('src', link)
    ipcRenderer.send('loadSearchPreview', link);
    syncPlanSettingsFormFromPlan();
    burstSyncGuestWebviewBounds();
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
 * (Currently unused) Requests a separate selection flow for a "product link" element.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function newLink() {
    var url = webPreview.getURL()
    ipcRenderer.send('newLinkElement', url);
}

/**
 * (Currently unused) Requests a separate selection flow for a text element.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function newText() {
    var url = webPreview.getURL()
    ipcRenderer.send('newTextElement', url);
}

/**
 * (Currently unused) Requests a separate selection flow for an image element.
 *
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function newImg() {
    var url = webPreview.getURL()
    ipcRenderer.send('newImgElement', url);
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
        const response = await ipcRenderer.invoke('saveScrapePlan', {
            name: customName || buildDefaultPlanName(),
            plan: scrapePlan,
        });
        console.log("Saved scrape plan:", response?.insertedId || response);
    } catch (err) {
        console.log("Failed to save scrape plan:", err?.message || err);
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
        const response = await ipcRenderer.invoke('saveScrapeRun', {
            startedAt: startedAt,
            completedAt: new Date().toISOString(),
            rowCount: rows.length,
            planSnapshot: scrapePlan,
            rows: rows,
        });
        console.log("Saved scrape run:", response?.insertedId || response);
    } catch (err) {
        console.log("Failed to save scrape run:", err?.message || err);
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
// IPC — main process → host renderer (selector prep, forwarded guest events)
// =============================================================================
/**
 * IPC: main process signals that the UI should reveal the selector-prep section.
 *
 * @listens ipcRenderer#loadWebview
 * @returns {void}
 */
ipcRenderer.on('loadWebview', () => {
    document.getElementById("select_sheet").style.display = "none";
    // Match `#select_data` rules in `style.css` (`display: flex`); inline `block` would break the shell layout.
    document.getElementById("select_data").style.display = "flex";
    syncPlanSettingsFormFromPlan();
    refreshSavedPlans();
    burstSyncGuestWebviewBounds();
})

/**
 * IPC: debug log hook for the searchbar XPath.
 *
 * @listens ipcRenderer#printSearchXpath
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath string.
 * @returns {void}
 */
ipcRenderer.on('printSearchXpath', (event, arg) => {
    console.log(arg)
})

/**
 * IPC: stores the selected searchbar selector in `scrapePlan.site.searchInputSelector`.
 *
 * @listens ipcRenderer#searchXPath
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for the search input element.
 * @returns {void}
 */
ipcRenderer.on('searchXPath', (event, arg) => {
    const selector = normalizeSelectorPayload(arg, "search_input");
    scrapePlan.site.startMode = "searchInput";
    scrapePlan.site.searchInputSelector = buildSelectorDescriptor(
        "search_input",
        selector.identifierType,
        selector.identifierValue
    );
    syncPlanSettingsFormFromPlan();
})

/**
 * IPC: stores an XPath for an element to click before scraping (e.g., product link chain).
 *
 * @listens ipcRenderer#linkXpathRenderer
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for a clickable element.
 * @returns {void}
 */
ipcRenderer.on('linkXpathRenderer', (event, arg) => {
    const selector = normalizeSelectorPayload(arg, `link_${scrapePlan.navigation.openResultSelectors.length + 1}`);
    before_product.push(selector.xpath || selector.identifierValue);
    addNavigationField("openResultSelectors", selector);
})

/**
 * IPC: adds a selected text XPath to `textArray` and renders it into the UI list.
 *
 * @listens ipcRenderer#textXpathRenderer
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for a text-containing element.
 * @returns {void}
 */
ipcRenderer.on('textXpathRenderer', (event, arg) => {
    const selector = normalizeSelectorPayload(arg, `text_${scrapePlan.extraction.textFields.length + 1}`);
    textArray.push(selector.xpath || selector.identifierValue);
    addExtractionField("textFields", selector);
    console.log(textArray);
    const li = document.createElement("li");
    li.className = "selector-line";
    li.appendChild(document.createTextNode(`${selector.identifierType}: ${selector.identifierValue}`));
    const currentDiv = document.getElementById("scraping_list");
    li.contentEditable = "true";
    currentDiv.insertBefore(li, currentDiv.lastElementChild.nextSibling);

})

/**
 * IPC: adds a selected image XPath to `imgArray` and renders it into the UI list.
 *
 * @listens ipcRenderer#imgXpathRenderer
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for an image element.
 * @returns {void}
 */
ipcRenderer.on('imgXpathRenderer', (event, arg) => {
    const selector = normalizeSelectorPayload(arg, `images_${scrapePlan.extraction.imageFields.length + 1}`);
    imgArray.push(selector.xpath || selector.identifierValue);
    addExtractionField("imageFields", selector, { attr: selector.attr || "src" });
    console.log(imgArray);
    const li = document.createElement("li");
    li.className = "selector-line";
    li.appendChild(document.createTextNode(`${selector.identifierType}: ${selector.identifierValue} (attr: ${selector.attr || "src"})`));
    const currentDiv = document.getElementById("scraping_list");
    li.contentEditable = "true";
    currentDiv.insertBefore(li, currentDiv.lastElementChild.nextSibling);
})

/**
 * Handles replacing the currently loaded spreadsheet.
 *
 * @returns {void}
 */
wbChange.addEventListener("change", () => {
    wbInput.files.length = 0
    if (wbChange.files.length === 0)
        return;

    actOnXLSX(wbChange.files[0]);
}, false);

/**
 * Handles selecting the initial spreadsheet, then advances to selector prep.
 *
 * @returns {void}
 */
wbInput.addEventListener("change", () => {
    wbInput.files.length = 0
    if (wbInput.files.length === 0)
        return;

    actOnXLSX(wbInput.files[0]);
    loadScrapeSelectPage()
}, false);

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
            console.log("Click selector failed:", selector, err?.message || err);
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
                console.log("Scraped row:", i, outputRows[outputRows.length - 1]);
            } catch (rowErr) {
                console.log("Row scrape failed:", i, rowErr?.message || rowErr);
                if (!scrapePlan.behavior.continueOnRowError) throw rowErr;
            }
        }
    } finally {
        await driver.quit();
    }

    await saveScrapeRun(outputRows, startedAt);
    console.log("Scraping completed. Rows:", outputRows.length);
}
