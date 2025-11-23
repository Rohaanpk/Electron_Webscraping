const url = require('url')
const path = require('path')
const { app, BrowserWindow, ipcMain } = require('electron')
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

let mainWindow = null
let childWindow = null

// MONGODB FUNCTIONS
// console.log(process.env.MONGO_URI);
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        await client.close();
    }
}

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
        minWidth: 1920,
        minHeight: 1080,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            sandbox: false,
        }
    })

    // COMMENT OUT IN FINAL BUILD
    // Opening devtools for testing purposes
    mainWindow.webContents.openDevTools()

    // Load Site URL
    mainWindow.loadURL(mainUrl)

    // Run on Main Window Page load
    mainWindow.webContents.on('dom-ready', function () {
        console.log('user-agent:', mainWindow.webContents.getUserAgent());
        mainWindow.webContents.openDevTools()
        mainWindow.setResizable(true);
        mainWindow.show()
    })

    // Quit App on Main Window Closed
    mainWindow.on('closed', function () {
        mainWindow = null
        app.quit()
    })


    // Define Hidden Child window 
    // Initialise in function call later ? 
    childWindow = new BrowserWindow({
        parent: mainWindow,
        center: true,
        show: false,
        resizable: false,
        movable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            sandbox: false,
        }
    })


    // COMMENT OUT IN FINAL BUILD
    // Opening devtools for testing purposes
    childWindow.webContents.openDevTools()

    // childWindow.webContents.on('did-finish-load', function () {
    // })

    // Hide Child window on close
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
ipcMain.on('childWindowClose', () => {
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
ipcMain.on('mainPage', () => {
    mainWindow.loadFile('app/index.html')
})

// Load new project window
ipcMain.on('newProject', () => {
    mainWindow.loadFile('app/new_project/html/new_project.html')
})


// Loads select link page
ipcMain.on('newLinkElement', (event, arg) => {
    childWindow.loadFile('app/new_project/html/select_link.html')

    childWindow.webContents.on('dom-ready', function () {
        console.log('childWindow DOM-READY => send back html')
        childWindow.send('loadLinkUrl', arg)
        console.log(arg)

        childWindow.show()
    })
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


// Displays Searchbar select error
ipcMain.on('wrongSearchClick', (event, arg) => {
    childWindow.webContents.send('wrong-search', arg);
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

// Sends link Xpath to Mainwindow to be stored as a var
ipcMain.on('linkXpathMain', (event, arg) => {
    console.log(arg);
    mainWindow.send('linkXpathRenderer', arg);
})


// Logs the Xpath of a selected text element to console (when recieved)
ipcMain.on('textXpathMain', (event, arg) => {
    mainWindow.send('textXpathRenderer', arg)
    console.log(arg)
})

// Logs the Xpath of a selected image to console (when recieved)
ipcMain.on('imgXpathMain', (event, arg) => {
    mainWindow.send('imgXpathRenderer', arg)
    console.log(arg)
})


// Top-level code
run().catch(console.dir);