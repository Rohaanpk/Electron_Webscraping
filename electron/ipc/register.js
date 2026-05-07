/**
 * @file electron/ipc/register.js
 * Registers all main-process IPC handlers (navigation, guest menu, Mongo invoke, guest→host relay).
 */
const { BrowserWindow, ipcMain, Menu } = require('electron');
const { withMongo } = require('../mongo');

/**
 * @param {{ getMainWindow: () => import('electron').BrowserWindow | null }} opts
 * @returns {void}
 */
function registerIpc({ getMainWindow }) {
    ipcMain.on('mainPage', () => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
            w.loadFile('app/index.html');
        }
    });

    ipcMain.on('newProject', () => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
            w.loadFile('app/new_project/html/new_project.html');
        }
    });

    /**
     * Guest `<webview>` context menu — preload sends `show-ctxmenu` on right-click.
     * @listens ipcMain#show-ctxmenu
     */
    ipcMain.on('show-ctxmenu', (_e) => {
        const sender = _e.sender;
        const menu = Menu.buildFromTemplate([
            {
                label: 'Select search bar (INPUT)',
                click: () => sender.send('ctxmenu-select-search'),
            },
            {
                label: 'Select product link',
                click: () => sender.send('ctxmenu-select-link'),
            },
            {
                label: 'Select text to scrape',
                click: () => sender.send('ctxmenu-select-text'),
            },
            {
                label: 'Select image (IMG or link)',
                click: () => sender.send('ctxmenu-select-img'),
            },
        ]);
        menu.popup({
            window: BrowserWindow.fromWebContents(sender),
        });
    });

    /**
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
     * @listens ipcMain#wrongSearchClick
     */
    ipcMain.on('wrongSearchClick', (_event, arg) => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
            w.webContents.send('wrong-search', arg);
        }
    });

    /**
     * @listens ipcMain#searchXpath
     */
    ipcMain.on('searchXpath', (_event, arg) => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
            w.webContents.send('searchXPath', arg);
        }
    });

    /**
     * @listens ipcMain#linkXpathMain
     */
    ipcMain.on('linkXpathMain', (_event, arg) => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
            w.webContents.send('linkXpathRenderer', arg);
        }
    });

    /**
     * @listens ipcMain#textXpathMain
     */
    ipcMain.on('textXpathMain', (_event, arg) => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
            w.webContents.send('textXpathRenderer', arg);
        }
    });

    /**
     * @listens ipcMain#imgXpathMain
     */
    ipcMain.on('imgXpathMain', (_event, arg) => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
            w.webContents.send('imgXpathRenderer', arg);
        }
    });
}

module.exports = { registerIpc };
