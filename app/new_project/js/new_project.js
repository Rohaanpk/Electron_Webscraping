const { val } = require('cheerio/lib/api/attributes');
const { text } = require('cheerio/lib/api/manipulation');
const { get } = require('cheerio/lib/api/traversing');
const { ipcRenderer, webFrame, webContents, ipcMain } = require('electron')
const fs = require("fs")
const XLSX = require("xlsx")
const text_array = []
const img_array = []
const webpreview = document.getElementById("web_preview");
const wbInput = document.getElementById('file_input');

document.getElementById("preview").addEventListener("dom-ready", event => {
    var newProject = document.getElementById("new_project");
    newProject.style.display =  "none";
    var webPreview = document.getElementById("site_preview");
    webPreview.style.display = "inline";
})

function getElementByXpath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  }

// document.getElementById("web_preview").addEventListener("dom-ready", event => {
//     var url = document.getElementById("input_url").value;
//     // document.getElementById("select_sheet").style.display = "none";
//     // document.getElementById("select_data").style.display = "inline";
//     ipcRenderer.send('scrapeurl', url);
// })

function check_url(str) {
    try {
        new URL(str);
    } catch (e) {
        return false;
    }
    return true;
}

function previewsite(){
    var url = document.getElementById("input_url").value;
    console.log(check_url(url))
    if (check_url(url) === true){
        // ipcRenderer.send('site_preview')
        var webPreview = document.getElementById("webpage_preview");
        document.getElementById("preview").setAttribute("src", url);
        // webContent.display = "inline";
        // document.getElementById("preview").display = "inline";
        document.getElementById("url_heading").innerHTML = url;
    }
    else {
        alert("Please enter a valid URL")
    }
    return url
}

// load main page
function mainpage(){
    ipcRenderer.send('main-page');
}

function newlink(){
    document.getElementById("site_preview").style.display = "none";
    document.getElementById("new_project").style.display = "block";
}

function selectsheet(){
    document.getElementById("site_preview").style.display = "none";
    document.getElementById("select_sheet").style.display = "block";
}

function confirmsheet(){
    wbInput.click();
    // var workbook = XLSX.readFile(workbookpath)
    // print('test')
    // document.getElementById("select_sheet").style.display = "none";
    // document.getElementById("spreadsheet_preview").style.display = "inline";
    // document.getElementById("sheet_preview").setAttribute("src", "https://view.officeapps.live.com/op/embed.aspx?src=file:///C:/Users/rohaa/Documents/loading/ashdene/ladelle.xlsx");
    // var url = document.getElementById("input_url").value;
    // ipcRenderer.send('load-url', url);
}

// wbInput.addEventListener("change", async (evt) => {
//     if (wbInput.files.length === 0)
//       return;
//     const columnA = []
//     const file = wbInput.files[0];
//     console.log(file)
//     var data = new ArrayBuffer(file);
//     const worksheet = XLSX.read(data);
//     console.log(worksheet)
//     load_new_page()

//     for (let z in worksheet) {
//         if(z.toString()[0] === 'A'){
//           columnA.push(worksheet[z].v);
//         }
//       }
      
//     console.log(columnA);

//     // do stuff with workbook here or pass it to another function 
//   }, false);

wbInput.addEventListener("change", (evt) => {
    if (wbInput.files.length === 0)
      return;
  
    actOnXLSX(wbInput.files[0]);
  }, false);
  
  
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
  
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    console.log(worksheet)
    
    var columnA = []

    for (let z in worksheet) {
        if(z.toString()[0] === 'A'){
          columnA.push(worksheet[z].v);
        }
    }
      
    console.log(columnA);

    for (i  = 1; i < columnA.length; i++) {
        // const searchBar = getElementByXpath(searchbar_xpath)
        console.log(columnA[i])
    }
  
    // do stuff with workbook

    load_new_page();
}
  


function load_new_page(e) {
    var url = document.getElementById("input_url").value;
    document.getElementById("web_preview").setAttribute('src', url)
    ipcRenderer.send('scrapeurl', url);
}

function select_sheet_later(){
    var url = document.getElementById("input_url").value;
    document.getElementById("web_preview").setAttribute('src', url)
    ipcRenderer.send('scrapeurl', url);
}

function product_link(){
    var url = webpreview.getURL();
    ipcRenderer.send('product_link', url);
}

function new_text(){
    var url = webpreview.getURL()
    ipcRenderer.send('new_text_element', url);
}

function new_img(){
    var url = webpreview.getURL()
    ipcRenderer.send('new_img_element', url);
}

function scrape() {

    const columnA = [];

    const columnA = Object.keys(worksheet).filter(x => /^A\d+/.test(x)).map(x => worksheet[x].v)
    console.log(columnA)

    console.log('scraping')

    for (const element of txt_array) {
        txt_download(element)
    }
}

function txt_download(str) {
    var scraped_text = document.document.getElementById(str).innerHTML;
    // store scraped text in a external file based on location in arra
  }

ipcRenderer.on('load-url', (event, arg) =>{
    console.log(arg)
})

ipcRenderer.on('asynchronous-reply', (event, arg) =>{
    console.log(arg)
})


ipcRenderer.on('load-webview', event => {
    document.getElementById("select_sheet").style.display = "none";
    document.getElementById("select_data").style.display = "inline";
})


ipcRenderer.on('print-search', (event, arg) =>{
    console.log(arg)
})

ipcRenderer.on('img_xpath', (event, arg) => {
    img_array.push(arg);
})

ipcRenderer.on('searchXPath', (event, arg) => {
    var searchbar_xpath = arg
})

ipcRenderer.on('text_xpath', (event, arg) => {
    text_array.push(arg);
    console.log(text_array);
    const newDiv = document.createElement("p")
    const newContent = document.createTextNode(arg)
    newDiv.appendChild(newContent);
    const currentDiv = document.getElementById("scraping_list");
    newDiv.contentEditable = 'true'
    currentDiv.insertBefore(newDiv, currentDiv.lastElementChild.nextSibling);

})


// webpreview.addEventListener('dom-ready', () => {
//     webview.setZoomFactor(0.5)
// })



// webpreview.webContents.on('dom-ready', function () {
//     var input = document.getElementById("file_input").value;
//     ipcRenderer.send('scrapeurl', input)
// })

 