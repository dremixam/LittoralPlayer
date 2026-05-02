import { ipcMain, BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { eventBus, store } from './state/store';
import { getApiServerInfo } from './api/server';
import { navigateToLogin, logout } from './auth/webviewToken';
import { getPlayerView } from './player/controller';

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

  // Push des événements vers le renderer
  eventBus.onEvent(event => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.appEvent, event);
    }
  });
}
