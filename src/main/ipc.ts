import { ipcMain, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS } from '../shared/constants';
import { eventBus, store } from './state/store';
import { getApiServerInfo } from './api/server';
import { navigateToLogin, logout } from './auth/webviewToken';
import { getPlayerView } from './player/controller';
import { getCorsOrigins, addCorsOrigin, removeCorsOrigin, getCorsAllowAll, setCorsAllowAll, getCorsAllowFileOrigin, setCorsAllowFileOrigin, getApiHost, setApiHost, getApiPort, setApiPort } from './settings';
import { startApiServer, stopApiServer } from './api/server';

let corsPanelWindow: BrowserWindow | null = null;

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.getApiInfo, () => getApiServerInfo());
  ipcMain.handle(IPC_CHANNELS.getAuthStatus, () => store.auth);
  ipcMain.handle(IPC_CHANNELS.getNowPlaying, () => store.nowPlaying);

  ipcMain.handle(IPC_CHANNELS.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string') return;
    // Restreint aux schemas sûrs : http(s) uniquement, pas de javascript:, file:, etc.
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle(IPC_CHANNELS.authStart, async () => {
    const view = getPlayerView();
    if (view) await navigateToLogin(view);
    return { authorizationUrl: 'embedded://listen.tidal.com/login' };
  });

  ipcMain.handle(IPC_CHANNELS.authLogout, async () => {
    await logout(getPlayerView());
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.getCorsOrigins, () => getCorsOrigins());

  ipcMain.handle(IPC_CHANNELS.addCorsOrigin, (_e, origin: unknown) => {
    if (typeof origin !== 'string') return getCorsOrigins();
    let parsed: URL;
    try { parsed = new URL(origin); } catch { return getCorsOrigins(); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return getCorsOrigins();
    // Normalise en origin (scheme + host + port), sans slash final
    const normalized = parsed.origin;
    return addCorsOrigin(normalized);
  });

  ipcMain.handle(IPC_CHANNELS.removeCorsOrigin, (_e, origin: unknown) => {
    if (typeof origin !== 'string') return getCorsOrigins();
    return removeCorsOrigin(origin);
  });

  ipcMain.handle(IPC_CHANNELS.getApiHost, () => ({ host: getApiHost(), port: getApiPort() }));

  ipcMain.handle(IPC_CHANNELS.setApiHost, (_e, host: unknown) => {
    if (host !== '127.0.0.1' && host !== '0.0.0.0') return;
    setApiHost(host as string);
  });

  ipcMain.handle(IPC_CHANNELS.setApiPort, (_e, port: unknown) => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) return;
    setApiPort(p);
  });

  ipcMain.handle(IPC_CHANNELS.restartApiServer, async () => {
    await stopApiServer();
    const info = await startApiServer();
    // Notify main window of updated API info
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.appEvent, { type: 'api-restarted', payload: info });
    }
    return info;
  });

  ipcMain.handle(IPC_CHANNELS.getCorsAllowAll, () => getCorsAllowAll());

  ipcMain.handle(IPC_CHANNELS.setCorsAllowAll, (_e, value: unknown) => {
    if (typeof value !== 'boolean') return;
    setCorsAllowAll(value);
  });

  ipcMain.handle(IPC_CHANNELS.getCorsAllowFileOrigin, () => getCorsAllowFileOrigin());

  ipcMain.handle(IPC_CHANNELS.setCorsAllowFileOrigin, (_e, value: unknown) => {
    if (typeof value !== 'boolean') return;
    setCorsAllowFileOrigin(value);
  });

  ipcMain.handle(IPC_CHANNELS.openCorsPanel, () => {
    if (corsPanelWindow && !corsPanelWindow.isDestroyed()) {
      corsPanelWindow.focus();
      return;
    }
    const mainWin = getMainWindow();
    if (!mainWin) return;

    const { x, y, width } = mainWin.getBounds();
    const panelWidth = 400;
    const panelHeight = 520;

    corsPanelWindow = new BrowserWindow({
      width: panelWidth,
      height: panelHeight,
      x: Math.round(x + width - panelWidth - 164),
      y: Math.round(y + 96),
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      parent: mainWin,
      show: false,
      backgroundColor: '#141414',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    const baseUrl = process.env.ELECTRON_RENDERER_URL
      ?? pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;

    void corsPanelWindow.loadURL(`${baseUrl}#cors-panel`);
    corsPanelWindow.once('ready-to-show', () => corsPanelWindow?.show());
    corsPanelWindow.on('blur', () => { corsPanelWindow?.close(); });
    corsPanelWindow.on('closed', () => { corsPanelWindow = null; });
  });

  ipcMain.handle(IPC_CHANNELS.closeCorsPanel, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // Push des événements vers le renderer
  eventBus.onEvent(event => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.appEvent, event);
    }
  });
}
