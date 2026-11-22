// RCB Weather desktop app: shows the live site full screen (so updates arrive without a new
// download), or the copy of www/ inside the app when offline. F11 toggles full screen, Esc leaves it.
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

const LIVE = 'https://rananjaya.github.io/RCB_Weather/';
const LOCAL = path.join(__dirname, '..', 'www', 'index.html');

let win;
let quitting = false;

function create() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true,
    backgroundColor: '#100d1c',
    title: 'RCB Weather',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'www', 'icons', 'app-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.removeMenu();
  win.loadURL(LIVE).catch(() => win.loadFile(LOCAL));
  win.webContents.on('did-fail-load', (_e, _code, _desc, url, isMain) => {
    if (isMain && url.startsWith('http')) win.loadFile(LOCAL);
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false);
  });
  // Mac: closing the window keeps RCB Weather running in the Dock, so weather alerts keep coming.
  // Cmd+Q quits. Clicking the Dock icon brings the window back.
  win.on('close', e => {
    if (process.platform === 'darwin' && !quitting) {
      e.preventDefault();
      if (win.isFullScreen()) { win.once('leave-full-screen', () => win.hide()); win.setFullScreen(false); } else win.hide();
    }
  });
  // Links (e.g. provider sites) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// Windows: notifications need an app ID. The zip version is not installed (no Start-menu
// shortcut), so the .exe path is used as the ID, which Windows accepts without a shortcut.
if (process.platform === 'win32') app.setAppUserModelId(process.execPath);

app.whenReady().then(() => {
  // Allow "My location" (the only permission the dashboard asks for).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'geolocation' || permission === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'geolocation' || permission === 'notifications');
  create();
});
app.on('before-quit', () => { quitting = true; });
app.on('activate', () => { if (win) { win.show(); win.focus(); } else create(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
