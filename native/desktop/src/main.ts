import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let virtualCamProcess: ChildProcess | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    title: 'My Web Cam',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('virtual-cam:start', (_event, opts: { wsUrl: string; password?: string }) => {
  if (virtualCamProcess) {
    virtualCamProcess.kill();
    virtualCamProcess = null;
  }

  const scriptPath = path.join(__dirname, '../virtual-cam/bridge.py');
  const args = [scriptPath, '--url', opts.wsUrl];
  if (opts.password) {
    args.push('--password', opts.password);
  }

  virtualCamProcess = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  virtualCamProcess.stdout?.on('data', (chunk) => {
    mainWindow?.webContents.send('virtual-cam:log', chunk.toString());
  });
  virtualCamProcess.stderr?.on('data', (chunk) => {
    mainWindow?.webContents.send('virtual-cam:error', chunk.toString());
  });
  virtualCamProcess.on('exit', (code) => {
    virtualCamProcess = null;
    mainWindow?.webContents.send('virtual-cam:stopped', code ?? 0);
  });

  return { started: true };
});

ipcMain.handle('virtual-cam:stop', () => {
  if (virtualCamProcess) {
    virtualCamProcess.kill();
    virtualCamProcess = null;
  }
  return { stopped: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (virtualCamProcess) {
    virtualCamProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
