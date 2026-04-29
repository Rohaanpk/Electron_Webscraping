// const { val } = require('cheerio/lib/api/attributes');
// const { text } = require('cheerio/lib/api/manipulation');
// const { get } = require('cheerio/lib/api/traversing');
const { ipcRenderer } = require('electron');
const XLSX = require("xlsx");
const { By, Builder, Browser, Key } = require('selenium-webdriver');


// Set array var's
var textArray = []
var imgArray = []
var searchbar_id = ""
var before_product = []
var codes = []
var link = ""
const webPreview = document.getElementById("web_preview");
const wbInput = document.getElementById('file_input');
const wbChange = document.getElementById('file_change');


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
    document.getElementById('new_project').style.display = "inline";
}

/**
 * Loads the URL entered by the user into the selection `webview` and notifies the
 * main process that the app is ready to move into the selector-prep step.
 *
 * Electron note:
 * - This uses IPC (`loadSearchPreview`) to coordinate UI state changes that are
 *   driven from the main process.
 *
 * @returns {void}
 */
function loadScrapeSelectPage() {
    link = document.getElementById("input_url").value;
    document.getElementById("web_preview").setAttribute('src', link)
    ipcRenderer.send('loadSearchPreview', link);
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
    document.getElementById("scraping_preview").style.display = 'inline';
    startScraping(link, searchbar_id, textArray);
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


/**
 * IPC: main process signals that the UI should reveal the selector-prep section.
 *
 * @listens ipcRenderer#loadWebview
 * @returns {void}
 */
ipcRenderer.on('loadWebview', () => {
    document.getElementById("select_sheet").style.display = "none";
    document.getElementById("select_data").style.display = "inline";
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
 * IPC: stores the selected searchbar XPath in `searchbar_id`.
 *
 * @listens ipcRenderer#searchXPath
 * @param {Electron.IpcRendererEvent} _event
 * @param {string} arg XPath for the search input element.
 * @returns {void}
 */
ipcRenderer.on('searchXPath', (event, arg) => {
    searchbar_id = arg
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
    before_product.push(arg);
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
    textArray.push(arg);
    console.log(textArray);
    const newDiv = document.createElement("p")
    const newContent = document.createTextNode(arg)
    newDiv.appendChild(newContent);
    const currentDiv = document.getElementById("scraping_list");
    newDiv.contentEditable = 'true'
    currentDiv.insertBefore(newDiv, currentDiv.lastElementChild.nextSibling);

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
    imgArray.push(arg);
    console.log(imgArray);
    const newDiv = document.createElement("p")
    const newContent = document.createTextNode(arg)
    newDiv.appendChild(newContent);
    const currentDiv = document.getElementById("scraping_list");
    newDiv.contentEditable = 'true'
    currentDiv.insertBefore(newDiv, currentDiv.lastElementChild.nextSibling);
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



// WORK ON LATER...
// SCRAPING FUNCTION, WORK IN PROGRESS
/**
 * Launches a Chrome Selenium session and performs a basic scraping loop:
 * - For each code in the spreadsheet, type it into the searchbar and submit.
 * - Optionally click through any configured "before product" elements.
 * - Extract text from each configured text XPath.
 *
 * @param {string} url Starting URL for the driver.
 * @param {string} searchbar XPath for the search input element.
 * @param {string[]} textarray List of XPaths to extract text from.
 * @returns {Promise<void>} Resolves when the driver quits.
 */
async function startScraping(url, searchbar, textarray) {
    let driver = await new Builder().forBrowser(Browser.CHROME).build();
    await driver.get(url);
    var length = codes.length;

    for (let i = 1; i < length; i++) {
        let search_elem = await driver.findElement(By.xpath(searchbar));


        await search_elem.sendKeys(codes[i]);
        await search_elem.sendKeys(Key.ENTER);

        for (let j = 0; j < before_product.length; j++) {
            let prod_link = await driver.findElement(By.xpath(before_product[j]));
            console.log(before_product[j]);
            await prod_link.click();
        }

        // let prod_link = await driver.findElement(By.xpath(`//h3[text()='${codes[i]}']`))
        // await prod_link.click();
        for (let k = 0; k < textarray.length; k++) {
            let text_elem = await driver.findElement(By.xpath(textarray[k]));
            let value = await text_elem.getText();
            console.log(value);
        }

    }
    await driver.quit();
}


