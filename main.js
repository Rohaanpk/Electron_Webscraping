/**
 * @file main.js
 * Electron **main** process bootstrap: env, window, IPC registration, optional Mongo ping.
 *
 * IPC patterns (see `electron/ipc/register.js`):
 * - `ipcMain.on` + `event.sender.send` — fire-and-forget (e.g. context menu → preload).
 * - `ipcMain.handle` + `ipcRenderer.invoke` — request/response (e.g. save/load scrape plans).
 */
const { app } = require('electron')
require('dotenv').config();
const { pingOnce } = require('./electron/mongo');
const { createMainWindow } = require('./electron/window');
const { registerIpc } = require('./electron/ipc/register');

let mainWindow = null

registerIpc({
    getMainWindow: () => mainWindow,
})

app.on('ready', function () {
    mainWindow = createMainWindow()
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') { app.exit() }
})

// Startup: optional Mongo connectivity smoke test (see `electron/mongo.js` `pingOnce`).
pingOnce().catch(console.dir)
