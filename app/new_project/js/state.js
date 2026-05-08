/**
 * @file state.js
 * Shared mutable state for the new-project renderer flow.
 */

/**
 * Central app state for `new_project.js`.
 * Kept as a single object so split modules can share live references.
 */
const state = {
    codes: [],
    link: "",
    savedPlansCache: [],
    scrapePlan: {
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
            /** Defaults applied when new image fields are added via context menu (if attr not set on element). */
            defaults: {
                imageAttr: "src",
                imageMultiple: true,
            },
            imageFields: [],
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
        },
    },
};

module.exports = state;
