/**
 * @file electron/window.js
 * Creates and configures the primary application BrowserWindow.
 */
const url = require('url');
const path = require('path');
const { app, BrowserWindow } = require('electron');

/**
 * @returns {string} file: URL for app/index.html
 */
function getMainWindowLoadUrl() {
    return url.format({
        protocol: 'file',
        slashes: true,
        pathname: path.join(__dirname, '..', 'app', 'index.html'),
    });
}

/**
 * Opens the main window, loads the landing page, wires show/quit behavior.
 *
 * @returns {BrowserWindow}
 */
function createMainWindow() {
    const mainWindow = new BrowserWindow({
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
        },
    });

    // COMMENT OUT IN FINAL BUILD
    // Opening devtools for testing purposes
    mainWindow.webContents.openDevTools();

    mainWindow.loadURL(getMainWindowLoadUrl());

    mainWindow.webContents.on('dom-ready', function () {
        console.log('user-agent:', mainWindow.webContents.getUserAgent());
        mainWindow.setResizable(true);
        mainWindow.show();
    });

    mainWindow.on('closed', function () {
        app.quit();
    });

    return mainWindow;
}

module.exports = {
    createMainWindow,
    getMainWindowLoadUrl,
};
