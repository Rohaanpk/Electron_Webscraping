// ------------------------------------------------------------------------------
// Twitter : @JeffProd
// Web     : https://jeffprod.com
// ------------------------------------------------------------------------------

const url = require('url')
const path = require('path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { argv0 } = require('process')
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
    show: false
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
  childWindow.webContents.on('dom-ready', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('sendbackhtml');
    childWindow.show()
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
  // childWindow.loadURL(arg, { userAgent: 'My Super Browser v2.0 Youpi Tralala !' })
  childWindow.send('load-url', arg)
  childWindow.show()
  childWindow.webContents.on('dom-ready', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('load-url', arg)
    console.log(arg)
    childWindow.show()
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


// ipcMain.once('')

