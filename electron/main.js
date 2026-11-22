// RCB Weather desktop app: shows www/ full screen. F11 toggles full screen, Esc leaves it.
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

function create() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true,
    backgroundColor: '#100d1c',
    title: 'RCB Weather',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'www', 'icons', 'app-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false);
  });
  // Links (e.g. provider sites) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  // Allow "My location" (the only permission the dashboard asks for).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'geolocation'));
  create();
});
app.on('window-all-closed', () => app.quit());
