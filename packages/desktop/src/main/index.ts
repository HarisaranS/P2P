import { app, BrowserWindow, session, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// Disable Hardware Acceleration to prevent Linux VSync/GPU crashes
app.disableHardwareAcceleration();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Isolate userData for local P2P testing with multiple instances
const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
if (rendererUrl) {
  try {
    const port = new URL(rendererUrl).port;
    const customDataPath = path.join(app.getPath('userData'), `dev-profile-${port}`);
    app.setPath('userData', customDataPath);
  } catch (e) {
    console.warn('Failed to isolate userData path:', e);
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../preload/index.cjs'),
    },
    backgroundColor: '#0A0A0A',
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Security Hardening: Content Protection
  mainWindow.setContentProtection(true);
  
  // Open DevTools automatically for debugging IPC
  mainWindow.webContents.openDevTools();
  
  return mainWindow;
}

app.whenReady().then(async () => {
  // Security Hardening: CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDev = !!process.env['ELECTRON_RENDERER_URL'];
    const connectSrc = isDev ? "connect-src 'self' ws://localhost:* http://localhost:*;" : "connect-src 'none';";
    const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval';" : "script-src 'self';";
    
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self';" +
          scriptSrc +
          "style-src 'self' 'unsafe-inline';" +
          "img-src 'self' data:;" +
          connectSrc +
          "font-src 'self';" +
          "media-src 'none';" +
          "object-src 'none';" +
          "frame-src 'none';" +
          "base-uri 'self';" +
          "form-action 'none';"
        ],
      },
    });
  });

  const mainWindow = createWindow();

  // Setup IPCs
  const { setupCryptoIPC } = await import('./ipc/crypto.js');
  const { setupStorageIPC } = await import('./ipc/storage.js');
  const { setupP2PIPC } = await import('./ipc/p2p.js');
  
  setupCryptoIPC();
  setupStorageIPC();
  setupP2PIPC();

  // Start Tor Daemon
  let currentTorStatus: any = { status: 'CONNECTING' };
  ipcMain.handle('tor:getStatus', () => currentTorStatus);

  try {
    const { TorDaemon } = await import('./tor-daemon.js');
    const tor = new TorDaemon();
    const ports = await tor.start();
    currentTorStatus = { status: 'CONNECTED', ports };
    console.log(`Tor connected on SOCKS:${ports.socksPort} CONTROL:${ports.controlPort}`);
    mainWindow.webContents.send('tor:status', currentTorStatus);
  } catch (err) {
    currentTorStatus = { status: 'ERROR', error: String(err) };
    console.error('Failed to start Tor:', err);
    mainWindow.webContents.send('tor:status', currentTorStatus);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
