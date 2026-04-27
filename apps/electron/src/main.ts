import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const isDev = !app.isPackaged;

function resolveWebIndex(): string {
  const built = join(__dirname, '..', '..', 'web', 'dist', 'index.html');
  if (existsSync(built)) return built;
  throw new Error(
    'apps/web/dist/index.html not found. Run `pnpm --filter @brtlb/web build` first.',
  );
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.BRTLB_DEV_URL) {
    await win.loadURL(process.env.BRTLB_DEV_URL);
  } else {
    await win.loadFile(resolveWebIndex());
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
