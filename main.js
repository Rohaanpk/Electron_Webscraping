const url = require('url')
const path = require('path')
const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron')
let mainWindow = null
let childWindow = null

// Set initial filepath for the Main Window
const mainUrl = url.format({
  protocol: 'file',
  slashes: true,
  pathname: path.join(__dirname, 'app/index.html')
})

// Set default window parameters when app starts
app.on('ready', function () {
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
      resizable: false,
      movable: false,
      webPreferences: {
        nodeIntegration: true
      }
  })

  childWindow.webContents.openDevTools()
  childWindow.webContents.on('did-finish-load', function () {
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

// Close childWindow (site overlay) when recieves the event 'childWindowClose')
ipcMain.on('childWindowClose', (event, arg) => {
  childWindow.close()
})

// Loads select search page
ipcMain.on('loadSearchPreview', (event, arg) => {
  childWindow.loadFile('app/new_project/html/select_search.html')

  childWindow.webContents.on('dom-ready', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('loadSearchUrl', arg)
    console.log(arg)
    childWindow.setBounds(mainWindow.getBounds())
    childWindow.show()
    mainWindow.send('loadWebview')
  })  
})

// Navigates back to main page
ipcMain.on('mainPage', (event) => {
  mainWindow.loadFile('app/index.html')
})

// Loads select image Page
ipcMain.on('newImgElement', (event, arg) => {
  childWindow.loadFile('app/new_project/html/select_img.html')

  childWindow.webContents.on('dom-ready', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('loadImgUrl', arg)
    console.log(arg)

    childWindow.show()
  }) 
})

// Load new project window
ipcMain.on('newProject', (event) =>{
    mainWindow.loadFile('app/new_project/html/new_project.html')
})

// Loads select text page
ipcMain.on('newTextElement', (event, arg) => {

  childWindow.loadFile('app/new_project/html/select_text.html')

  childWindow.webContents.on('dom-ready', function () {
    console.log('childWindow DOM-READY => send back html')
    childWindow.send('loadTextUrl', arg)
    console.log(arg)

    childWindow.show()
  }) 
})

// Displays Searchbar select error
ipcMain.on('wrongSearchClick', (event, arg) => {
  childWindow.webContents.send('wrong-search', arg);
})

// Logs the Xpath of a selected image to console (when recieved)
ipcMain.on('imgXpathMain', (event, arg) => {
  mainWindow.send('imgXpathRenderer', arg)
  console.log(arg)
})

// Logs a testing xpath in the main window
ipcMain.on('beforeSearch', (event, arg) => {
  mainWindow.webContents.send('printSearchXpath', arg)
})

// Sends searchbar Xpath to Mainwindow to be stored as a var
ipcMain.on('searchXpath', (event, arg) => {
  console.log(arg)
  mainWindow.send("searchXPath", arg)
})

// Logs the Xpath of a selected text element to console (when recieved)
ipcMain.on('textXpathMain', (event, arg) => {
  mainWindow.send('textXpathRenderer', arg)
  console.log(arg)
})
