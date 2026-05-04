/**
 * @file main.js
 * Electron **main** process: window lifecycle, native menus, IPC routing, and Mongo helpers.
 *
 * IPC patterns used here:
 * - `ipcMain.on` + `event.sender.send` — fire-and-forget (e.g. context menu → preload).
 * - `ipcMain.handle` + `ipcRenderer.invoke` — request/response (e.g. save/load scrape plans).
 */
const url = require('url')
const path = require('path')
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

let mainWindow = null

// --- Mongo (startup smoke test client; per-operation clients use `withMongo`) ---
// console.log(process.env.MONGO_URI);
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const SCRAPE_DB_NAME = process.env.MONGO_DB_NAME || 'electron_webscraping';

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

// --- Window bootstrap ---
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

    mainWindow.webContents.on('dom-ready', function () {
        console.log('user-agent:', mainWindow.webContents.getUserAgent());
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

// --- IPC: navigation between host HTML pages ---
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

// --- IPC: guest `<webview>` context menu (main builds `Menu`, preload reacts) ---
/**
 * IPC: shows a native context menu for a webContents (typically a `webview`).
 * Preload (`preload.js`) sends `show-ctxmenu` on right-click; menu callbacks route to
 * `ctxmenu-select-*` so the guest applies search/link/text/img validation rules.
 *
 * @listens ipcMain#show-ctxmenu
 * @param {Electron.IpcMainEvent} _e
 */
ipcMain.on('show-ctxmenu', (_e) => {
    const sender = _e.sender;
    const menu = Menu.buildFromTemplate([
        {
            label: 'Select search bar (INPUT)',
            click: () => sender.send('ctxmenu-select-search')
        },
        {
            label: 'Select product link',
            click: () => sender.send('ctxmenu-select-link')
        },
        {
            label: 'Select text to scrape',
            click: () => sender.send('ctxmenu-select-text')
        },
        {
            label: 'Select image (IMG or link)',
            click: () => sender.send('ctxmenu-select-img')
        }
    ]);
    menu.popup({
        window: BrowserWindow.fromWebContents(sender)
    });
});

// Startup: optional Mongo connectivity smoke test (see `run()`).
run().catch(console.dir);

// --- Mongo helpers: short-lived client per `invoke` (keeps Atlas happy vs long-lived handle) ---
/**
 * Runs a database operation against the configured MongoDB database.
 *
 * @template T
 * @param {(db: import("mongodb").Db) => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function withMongo(operation) {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is not set.');
    }

    const opClient = new MongoClient(process.env.MONGO_URI, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });

    try {
        await opClient.connect();
        const db = opClient.db(SCRAPE_DB_NAME);
        return await operation(db);
    } finally {
        await opClient.close();
    }
}

/**
 * IPC: saves a scrape plan document to MongoDB.
 *
 * @listens ipcMain#saveScrapePlan
 */
ipcMain.handle('saveScrapePlan', async (_event, planDoc) => {
    return withMongo(async (db) => {
        const now = new Date().toISOString();
        const payload = {
            ...planDoc,
            createdAt: planDoc?.createdAt || now,
            updatedAt: now,
        };

        const result = await db.collection('scrapePlans').insertOne(payload);
        return { insertedId: String(result.insertedId) };
    });
});

/**
 * IPC: returns saved scrape plans.
 *
 * @listens ipcMain#loadScrapePlans
 */
ipcMain.handle('loadScrapePlans', async () => {
    return withMongo(async (db) => {
        const docs = await db.collection('scrapePlans')
            .find({}, { sort: { updatedAt: -1 } })
            .toArray();
        return docs.map((doc) => ({
            ...doc,
            _id: String(doc._id),
        }));
    });
});

/**
 * IPC: saves one scraping run (plan snapshot + extracted rows).
 *
 * @listens ipcMain#saveScrapeRun
 */
ipcMain.handle('saveScrapeRun', async (_event, runDoc) => {
    return withMongo(async (db) => {
        const payload = {
            ...runDoc,
            createdAt: new Date().toISOString(),
        };
        const result = await db.collection('scrapeRuns').insertOne(payload);
        return { insertedId: String(result.insertedId) };
    });
});


/**
 * IPC: forwards invalid guest selections to the host window (`wrong-search`).
 *
 * @listens ipcMain#wrongSearchClick
 */
ipcMain.on('wrongSearchClick', (_event, arg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wrong-search', arg);
    }
})

/**
 * IPC: search bar XPath from guest (INPUT-only validation done in preload).
 *
 * @listens ipcMain#searchXpath
 */
ipcMain.on('searchXpath', (_event, arg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('searchXPath', arg);
    }
})

/**
 * IPC: product link XPath from guest.
 *
 * @listens ipcMain#linkXpathMain
 */
ipcMain.on('linkXpathMain', (_event, arg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('linkXpathRenderer', arg);
    }
})

/**
 * IPC: text field XPath from guest.
 *
 * @listens ipcMain#textXpathMain
 */
ipcMain.on('textXpathMain', (_event, arg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('textXpathRenderer', arg);
    }
})

/**
 * IPC: image XPath from guest.
 *
 * @listens ipcMain#imgXpathMain
 */
ipcMain.on('imgXpathMain', (_event, arg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('imgXpathRenderer', arg);
    }
})


