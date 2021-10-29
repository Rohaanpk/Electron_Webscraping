const { val } = require('cheerio/lib/api/attributes');
const { text } = require('cheerio/lib/api/manipulation');
const { ipcRenderer, webFrame, webContents } = require('electron')

function check_url(str){
    var pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name
    '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
    '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
    '(\\#[-a-z\\d_]*)?$','i'); // fragment locator
    return !!pattern.test(str);
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

document.getElementById("preview").addEventListener("dom-ready", event => {
    var newProject = document.getElementById("new_project");
    newProject.style.display =  "none";
    var webPreview = document.getElementById("site_preview");
    webPreview.style.display = "inline";
})

function mainpage(){
    ipcRenderer.send('main-page');
}

function testing(){
    var webContent = document.getElementById("new_project");
    webContent.style.display =  "none";
}

function newlink(){
    var newProject = document.getElementById("new_project");
    newProject.style.display =  "inline";
    var webPreview = document.getElementById("webpage_preview");
    webPreview.style.display = "none";
}

function selectsheet(){
    document.getElementById("site_preview").style.display = "none";
    document.getElementById("select_sheet").style.display = "inline";
}

function confirmsheet(){
    document.getElementById('file_input').click();
    // var selectedFile = document.getElementById('file_input').selectedFile;
    // print('test')
    // document.getElementById("select_sheet").style.display = "none";
    // document.getElementById("spreadsheet_preview").style.display = "inline";
    // document.getElementById("sheet_preview").setAttribute("src", "https://view.officeapps.live.com/op/embed.aspx?src=file:///C:/Users/rohaa/Documents/loading/ashdene/ladelle.xlsx");
    // var url = document.getElementById("input_url").value;
    // ipcRenderer.send('load-url', url);
}

const input = document.getElementById("file_input");

input.addEventListener('input', load_new_page);

function load_new_page(e) {
    var url = document.getElementById("input_url").value;
    document.getElementById("web_preview").setAttribute('src', url)
}

function select_sheet_later(){
    var url = document.getElementById("input_url").value;
    document.getElementById("web_preview").setAttribute('src', url)
}

document.getElementById("web_preview").addEventListener("dom-ready", event => {
    var url = document.getElementById("input_url").value;
    // document.getElementById("select_sheet").style.display = "none";
    // document.getElementById("select_data").style.display = "inline";
    ipcRenderer.send('scrapeurl', url);
})

// webpreview.addEventListener('dom-ready', () => {
//     webview.setZoomFactor(0.5)
// })

const webpreview = document.getElementById("web_preview");

// webpreview.webContents.on('dom-ready', function () {
//     var input = document.getElementById("file_input").value;
//     ipcRenderer.send('scrapeurl', input)
// })

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

