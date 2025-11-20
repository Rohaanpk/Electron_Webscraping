// const { val } = require('cheerio/lib/api/attributes');
// const { text } = require('cheerio/lib/api/manipulation');
// const { get } = require('cheerio/lib/api/traversing');
const { ipcRenderer } = require('electron')
// const fs = require("fs");
// const { parse } = require('path');
const XLSX = require("xlsx")
const {By, Builder, Browser, Key} = require('selenium-webdriver');

// Set array var's
var textArray = []
var imgArray = []
var searchbar_id = ""
var codes = []
var link = ""
const webPreview = document.getElementById("web_preview");
const wbInput = document.getElementById('file_input');
const wbChange = document.getElementById('file_change');


// Parses selected excel file
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

// Click on (invisible) file input to change spreadsheet
 // eslint-disable-next-line no-unused-vars
function changeSheet() {
    wbChange.click();
}

// Check if valid URL
function checkUrl(str) {
    try {
        new URL(str);
    } catch (err) {
        console.log(err);
        return false;
    }
    return true;
}

// Go back to site link page
 // eslint-disable-next-line no-unused-vars
function changeSiteLink() {
    document.getElementById('site_preview').style.display = "none";
    document.getElementById('new_project').style.display = "inline";
}

// Load site link confirm page
function loadScrapeSelectPage() {
    link = document.getElementById("input_url").value;
    document.getElementById("web_preview").setAttribute('src', link)
    ipcRenderer.send('loadSearchPreview', link);
}

// Open (go back to) main page
 // eslint-disable-next-line no-unused-vars
function mainPage() {
    ipcRenderer.send('mainPage');
}

// Open fullscreen preview window to select image element
 // eslint-disable-next-line no-unused-vars
function newImg() {
    var url = webPreview.getURL()
    ipcRenderer.send('newImgElement', url);
}

// Open fullscreen preview window to select text element
 // eslint-disable-next-line no-unused-vars
function newText() {
    var url = webPreview.getURL()
    console.log(url);
    ipcRenderer.send('newTextElement', url);
}

// Open site preview page
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

// Open scraping preview page
 // eslint-disable-next-line no-unused-vars
function scrapingPreview() {
    document.getElementById("select_data").style.display = 'none';
    document.getElementById("scraping_preview").style.display = 'inline';
    startScraping(link, searchbar_id, textArray);
}

// Click on (invisible) file input to select spreadsheet
 // eslint-disable-next-line no-unused-vars
function selectSheet() {
    wbInput.click();
}

// Load select sheet page 
 // eslint-disable-next-line no-unused-vars
function selectSheetPage() {
    document.getElementById("site_preview").style.display = "none";
    document.getElementById("select_sheet").style.display = "flex";
}

// Prints image xpath in data select page (in white box) and sets element attributes
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

// Show data select page webview element
ipcRenderer.on('loadWebview', () => {
    document.getElementById("select_sheet").style.display = "none";
    document.getElementById("select_data").style.display = "inline";
})

// Log searchbar xpath to console
ipcRenderer.on('printSearchXpath', (event, arg) => {
    console.log(arg)
})

// Save passed argument as searchbar Xpath
ipcRenderer.on('searchXPath', (event, arg) => {
    searchbar_id = arg
})

// Prints text xpath in data select page (in white box) and sets element attributes
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

// Listen for file inputs and act if file is opened
wbChange.addEventListener("change", () => {
    wbInput.files.length = 0
    if (wbChange.files.length === 0)
        return;

    actOnXLSX(wbChange.files[0]);
}, false);

wbInput.addEventListener("change", () => {
    wbInput.files.length = 0
    if (wbInput.files.length === 0)
        return;

    actOnXLSX(wbInput.files[0]);
    loadScrapeSelectPage()
}, false);


// SCRAPING FUNCTION, WORK IN PROGRESS
async function startScraping(url, searchbar, textarray) {
    let driver = await new Builder().forBrowser(Browser.CHROME).build();
    await driver.get(url);
    var length = codes.length;

    for (let i = 1; i < length; i++) {
        let search_elem = await driver.findElement(By.xpath(searchbar));


        await search_elem.sendKeys(codes[i]);
        await search_elem.sendKeys(Key.ENTER);

        let prod_link = await driver.findElement(By.xpath(`//h3[text()='${codes[i]}']`))
        await prod_link.click();

        let text_elem = await driver.findElement(By.xpath(textarray[0]));
        let value = await text_elem.getText();
        console.log(value);
    }
    await driver.quit();
} 



