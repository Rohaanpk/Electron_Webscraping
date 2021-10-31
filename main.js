// ------------------------------------------------------------------------------
// Twitter : @JeffProd
// Web     : https://jeffprod.com
// ------------------------------------------------------------------------------

const url = require('url')
const path = require('path')
const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron')
const { argv0 } = require('process')
const { ECANCELED } = require('constants')
const { testElement } = require('domutils')
let mainWindow = null
let childWindow = null

// Index.html file

const mainUrl = url.format({
  protocol: 'file',
  slashes: true,
  pathname: path.join(__dirname, 'app/index.html')
})


app.on('ready', function () {
  // var x = 2
  // var modified_string = ["/html/body/div[",x,"]/a"].join("")
  // console.log(modified_string)
  mainWindow = new BrowserWindow({
    center: true,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    webPreferences: {
      nodeIntegration: true
    }
  })


  mainWindow.webContents.openDevTools()
  mainWindow.loadURL(mainUrl)
  

  mainWindow.webContents.on('dom-ready', function () {
    console.log('user-agent:', mainWindow.webContents.getUserAgent());
    mainWindow.webContents.openDevTools()
    mainWindow.setResizable(true);
    mainWindow.maximize()
    mainWindow.show()
  })


  mainWindow.on('closed', function () {
    mainWindow = null
    app.quit()
  })

  childWindow = new BrowserWindow({
      parent: mainWindow,
      center: true,
      show: false,
      fullscreen: true,
      webPreferences: {
        // nodeIntegration: true,
        // preload: path.join(__dirname, 'app/new_project/js/data_select.js')
        nodeIntegration: true,
        preload: path.join(__dirname, 'app/new_project/js/data_select.js')
      }
  })

  childWindow.webContents.openDevTools()
  childWindow.webContents.on('did-finish-load', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('sendbackhtml');

    // childWindow.show()
  })  

  childWindow.on('close', event => {
    event.preventDefault();
    childWindow.hide();
  });
}) 

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') { app.exit() }
})

// Load new project window
ipcMain.on('new_project', (event) =>{
    mainWindow.loadFile('app/new_project/html/new_project.html')
})

// Load site preview
// ipcMain.on('site_preview', (event, arg) =>{
//   mainWindow.loadFile('app/new_project/html/site_preview.html')
//   mainWindow.maximize()
//   event.sender.send('site_url', arg)
// })

// Load select data page
ipcMain.on('main-page', (event) => {
  mainWindow.loadFile('app/index.html')
})



// ipcMain.on('load-url', (event, arg) => {
//   mainWindow.loadFile('app/new_project/html/select_data.html')
//   console.log(arg)
//   console.log('test')
//   event.sender.send('pass-through-url', arg)
// })

ipcMain.on('scrapeurl', (event, arg) => {
  childWindow.loadFile('app/new_project/html/select_data.html')
  childWindow.send('load-url', arg)

  childWindow.webContents.on('dom-ready', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('load-url', arg)
    console.log(arg)
    childWindow.show()
    mainWindow.send('load-webview')
  })  
})

ipcMain.on('hereishtml', (event, html) => {
  mainWindow.send('extracthtml', html)
})

// Event handler for asynchronous incoming messages
ipcMain.on('asynchronous-message', (event, arg) => {
  console.log(arg)

  // Event emitter for sending asynchronous messages
  event.sender.send('asynchronous-reply', arg)
})

// Event handler for synchronous incoming messages
ipcMain.on('synchronous-message', (event, arg) => {
  console.log(arg) 

  // Synchronous event emmision
  event.returnValue = 'sync pong'
})

ipcMain.on('childWindow-close', (event, arg) => {
  childWindow.close()
})

// Displays Searchbar select error
ipcMain.on('no-searchclick', (event, arg) => {
  childWindow.webContents.send('wrong-search', arg);
})

ipcMain.on('search-test', (event, arg) => {
  mainWindow.webContents.send('print-search', arg)
})

ipcMain.on('new_text_element', (event, arg) => {
  childWindow.loadFile('app/new_project/html/select_text.html')
  childWindow.send('load-url', arg)

  childWindow.webContents.on('dom-ready', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('load-url', arg)
    console.log(arg)
    childWindow.show()
  }) 
})

ipcMain.on('new_img_element', (event, arg) => {
  childWindow.loadFile('app/new_project/html/select_img.html')
  childWindow.send('load-url', arg)

  childWindow.webContents.on('dom-ready', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('load-url', arg)
    console.log(arg)
    childWindow.show()
  }) 
})

ipcMain.on('img_xpath', (event, arg) => {
  mainWindow.send('img_xpath', arg)
})

ipcMain.on('text_xpath', (event, arg) => {
  mainWindow.send('text_xpath', arg)
})