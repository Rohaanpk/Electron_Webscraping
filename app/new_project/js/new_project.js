const { val } = require('cheerio/lib/api/attributes');
const { text } = require('cheerio/lib/api/manipulation');
const { get } = require('cheerio/lib/api/traversing');
const { ipcRenderer, webFrame, webContents, ipcMain } = require('electron')
const fs = require("fs");
const { parse } = require('path');
const XLSX = require("xlsx")
// Set array var's
var textArray = []
var imgArray = []
var search_array = []
const webPreview = document.getElementById("web_preview");
const wbInput = document.getElementById('file_input');
const wbChange = document.getElementById('file_change');

// Parses selected excel file
async function actOnXLSX (file) {
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
    console.log(data)
    // Reads array buffer as data
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    
    
    var columnA = []
    var intChecker = 1
    // iterate through the data and get the content within the first column and store it to an array
    for (let z in worksheet) {
        if(z.toString()[0] === 'A'){
            var x = parseInt(z.replace(/A/, ""))
            cellInt = x + 1
            while(true) {
                if (intChecker == cellInt - 1){
                    columnA.push(worksheet[z].v);
                    console.log(x, worksheet[z].v)
                    break
                }
                else{
                    columnA.push("")
                    console.log(intChecker, "")
                    intChecker ++
                }
            }
            intChecker = cellInt
        }
    }
    // log the first column data to console
    console.log(columnA);
}

// Click on (invisible) file input to change spreadsheet
function changeSheet() {
    wbChange.click();
}

// Check if valid URL
function checkUrl(str) {
    try {
        new URL(str);
    } catch (e) {
        return false;
    }
    return true;
}

// Go back to site link page
function changeSiteLink() {
    document.getElementById('site_preview').style.display = "none";
    document.getElementById('new_project').style.display = "inline";
}

// Load site link confirm page
function loadScrapeSelectPage() {
    var url = document.getElementById("input_url").value;
    document.getElementById("web_preview").setAttribute('src', url)
    ipcRenderer.send('loadSearchPreview', url);
}

// Open (go back to) main page
function mainPage() {
    ipcRenderer.send('mainPage');
}

// Open fullscreen preview window to select image element
function newImg() {
    var url = webPreview.getURL()
    ipcRenderer.send('newImgElement', url);
}

// Open fullscreen preview window to select text element
function newText() {
    var url = webPreview.getURL()
    ipcRenderer.send('newTextElement', url);
}

// Open site preview page
function previewSite() {
    var url = document.getElementById("input_url").value;
    if (checkUrl(url) === true){
        document.getElementById("preview").setAttribute("src", url);
        document.getElementById("url_heading").innerHTML = url;
        document.getElementById("new_project").style.display =  "none";
        document.getElementById("site_preview").style.display = "inline";
    }
    else {
        alert("Please enter a valid URL")
    }
    return url
}

// Open scraping preview page
function scrapingPreview() {
    document.getElementById("select_data").style.display = 'none';
    document.getElementById("scraping_preview").style.display = 'inline';
}

// Click on (invisible) file input to select spreadsheet
function selectSheet() {
    wbInput.click();  
}

// Load select sheet page 
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
ipcRenderer.on('loadWebview', event => {
    document.getElementById("select_sheet").style.display = "none";
    document.getElementById("select_data").style.display = "inline";
})

// Log searchbar xpath to console
ipcRenderer.on('printSearchXpath', (event, arg) => {
    console.log(arg)
})

// Save passed argument as searchbar Xpath
ipcRenderer.on('searchXPath', (event, arg) => {
    var searchbar_xpath = arg
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
wbChange.addEventListener("change", (evt) => {
    wbInput.files.length = 0
    if (wbChange.files.length === 0)
      return;
  
    actOnXLSX(wbChange.files[0]);
}, false);

wbInput.addEventListener("change", (evt) => {
    wbInput.files.length = 0
    if (wbInput.files.length === 0)
    return;
  
    actOnXLSX(wbInput.files[0]);
    loadScrapeSelectPage()
}, false);
