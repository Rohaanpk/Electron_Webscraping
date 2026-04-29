const url = require('url')
const path = require('path')
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

let mainWindow = null
// let childWindow = null

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

/**
 * Verifies MongoDB connectivity by opening a connection, issuing a ping command,
 * then closing the client.
 *
 * Notes:
 * - This is currently a startup-side "smoke test" and does not keep a persistent connection.
 *
 * @returns {Promise<void>} Resolves after the ping completes and the client is closed.
 */
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


// Window Functions
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
            // Electron security note:
            // This project currently enables Node in the renderer and disables context isolation
            // so renderer pages can call `require('electron')` directly.
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
        // mainWindow = null
        app.quit()
    })
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') { app.exit() }
})

/**
 * IPC: renderer requests navigation back to the landing page.
 * @listens ipcMain#mainPage
 */
ipcMain.on('mainPage', () => {
    mainWindow.loadFile('app/index.html')
})

/**
 * IPC: renderer requests navigation to the "new project" flow.
 * @listens ipcMain#newProject
 */
ipcMain.on('newProject', () => {
    mainWindow.loadFile('app/new_project/html/new_project.html')
})

/**
 * IPC: shows a native context menu for a webContents (typically a `webview`).
 *
 * The `webview` preload triggers this on right-click. Choosing "Get XPath" sends
 * a `get-xpath` event back to the same sender so the preload can compute and return it.
 *
 * @listens ipcMain#show-ctxmenu
 * @param {Electron.IpcMainEvent} _e
 */
ipcMain.on('show-ctxmenu', (_e) => {
    const menu = Menu.buildFromTemplate([
        {
            label: 'Get XPath',
            click: () => {
                _e.sender.send('get-xpath')
            }
        }
    ]);
    menu.popup({
        window: BrowserWindow.fromWebContents(_e.sender)
    });
});

// Top-level code
run().catch(console.dir);


/**
 * IPC: receives an XPath string computed in a `webview` preload.
 * Currently it is only logged; in a fuller implementation this would be stored
 * and forwarded to the renderer to build up scraping selectors.
 *
 * @listens ipcMain#storeXpath
 * @param {Electron.IpcMainEvent} _e
 * @param {string} arg XPath expression for the last selected element.
 */
ipcMain.on('storeXpath', (_e, arg) => {
    console.log(arg);
})

// // PREVIOUS CODE FROM WHEN USING MULTIPLE WINDOWS

// // Close childWindow (site overlay) when recieves the event 'childWindowClose')
// ipcMain.on('childWindowClose', () => {
//     childWindow.close()
// })

// // Loads select search page
/**
 * IPC: indicates the user has selected a site URL and is ready to prepare selectors.
 * Current behavior: tells the renderer to reveal the `webview` used for element picking.
 *
 * @listens ipcMain#loadSearchPreview
 * @param {Electron.IpcMainEvent} _e
 * @param {string} arg Site URL to preview.
 */
ipcMain.on('loadSearchPreview', (_e, arg) => {
    console.log(arg);
    mainWindow.send('loadWebview');

    // childWindow.loadFile('app/new_project/html/select_search.html')

    // childWindow.webContents.on('dom-ready', function () {
    //     console.log('childWindow DOM-READY => send back html')
    //     childWindow.send('loadSearchUrl', arg)
    //     console.log(arg)
    //     childWindow.setBounds(mainWindow.getBounds())
    //     childWindow.show()
    //     mainWindow.send('loadWebview')
    // })
})


// // Loads select link page
// ipcMain.on('newLinkElement', (event, arg) => {
//     childWindow.loadFile('app/new_project/html/select_link.html')

//     childWindow.webContents.on('dom-ready', function () {
//         console.log('childWindow DOM-READY => send back html')
//         childWindow.send('loadLinkUrl', arg)
//         console.log(arg)

//         childWindow.show()
//     })
// })


// // Loads select text page
// ipcMain.on('newTextElement', (event, arg) => {
//     childWindow.loadFile('app/new_project/html/select_text.html')

//     childWindow.webContents.on('dom-ready', function () {
//         console.log('childWindow DOM-READY => send back html')
//         childWindow.send('loadTextUrl', arg)
//         console.log(arg)

//         childWindow.show()
//     })
// })


// // Loads select image Page
// ipcMain.on('newImgElement', (event, arg) => {
//     childWindow.loadFile('app/new_project/html/select_img.html')

//     childWindow.webContents.on('dom-ready', function () {
//         console.log('childWindow DOM-READY => send back html')
//         childWindow.send('loadImgUrl', arg)
//         console.log(arg)

//         childWindow.show()
//     })
// })


// // Displays Searchbar select error
// ipcMain.on('wrongSearchClick', (event, arg) => {
//     childWindow.webContents.send('wrong-search', arg);
// })


// // Logs a testing xpath in the main window
// ipcMain.on('beforeSearch', (event, arg) => {
//     mainWindow.webContents.send('printSearchXpath', arg)
// })

// // Sends searchbar Xpath to Mainwindow to be stored as a var
// ipcMain.on('searchXpath', (event, arg) => {
//     console.log(arg)
//     mainWindow.send("searchXPath", arg)
// })

// // Sends link Xpath to Mainwindow to be stored as a var
// ipcMain.on('linkXpathMain', (event, arg) => {
//     console.log(arg);
//     mainWindow.send('linkXpathRenderer', arg);
// })


// // Logs the Xpath of a selected text element to console (when recieved)
// ipcMain.on('textXpathMain', (event, arg) => {
//     mainWindow.send('textXpathRenderer', arg)
//     console.log(arg)
// })

// // Logs the Xpath of a selected image to console (when recieved)
// ipcMain.on('imgXpathMain', (event, arg) => {
//     mainWindow.send('imgXpathRenderer', arg)
//     console.log(arg)
// })


