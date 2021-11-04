const { val } = require('cheerio/lib/api/attributes');
const { text } = require('cheerio/lib/api/manipulation');
const { get } = require('cheerio/lib/api/traversing');
const { ipcRenderer, webFrame, webContents, ipcMain } = require('electron')
const fs = require("fs");
const { parse } = require('path');
const XLSX = require("xlsx")
const textArray = []
const imgArray = []
const webPreview = document.getElementById("web_preview");
const wbInput = document.getElementById('file_input');
const wbChange = document.getElementById('file_change');

async function actOnXLSX (file) {
    const fileReader = new FileReader();
  
    const data = await new Promise((resolve, reject) => {
        fileReader.onload = () => {
            resolve(fileReader.result);
        };
        fileReader.onerror = reject;
  
        fileReader.readAsArrayBuffer(file);
        })
    .finally(() => {
        fileReader.onerror = fileReader.onload = null;
      });
    console.log(data)
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    
    
    var columnA = []
    var intChecker = 1
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
}

function changeSheet() {
    wbChange.click();
}

function checkUrl(str) {
    try {
        new URL(str);
    } catch (e) {
        return false;
    }
    return true;
}

function changeSiteLink() {
    document.getElementById('site_preview').style.display = "none";
    document.getElementById('new_project').style.display = "inline";
}

function getElementByXpath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

function loadScrapeSelectPage() {
    var url = document.getElementById("input_url").value;
    document.getElementById("web_preview").setAttribute('src', url)
    ipcRenderer.send('loadSearchPreview', url);
}

// load main page
function mainPage() {
    ipcRenderer.send('mainPage');
}

function newImg() {
    var url = webPreview.getURL()
    ipcRenderer.send('newImgElement', url);
}

function newText() {
    var url = webPreview.getURL()
    ipcRenderer.send('newTextElement', url);
}

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

function scrapingPreview() {
    document.getElementById("select_data").style.display = 'none';
    document.getElementById("scraping_preview").style.display = 'inline';
}

function selectSheet() {
    wbInput.click();  
}

function selectSheetPage() {
    document.getElementById("site_preview").style.display = "none";
    document.getElementById("select_sheet").style.display = "flex";
}

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

ipcRenderer.on('loadWebview', event => {
    document.getElementById("select_sheet").style.display = "none";
    document.getElementById("select_data").style.display = "inline";
})

ipcRenderer.on('printSearchXpath', (event, arg) => {
    console.log(arg)
})

ipcRenderer.on('searchXPath', (event, arg) => {
    var searchbar_xpath = arg
})

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
