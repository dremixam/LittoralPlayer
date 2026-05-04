import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { ApiServerInfo, AppEvent, AuthStatus, NowPlaying } from '../shared/models';

const api = {
  getApiInfo: (): Promise<ApiServerInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.getApiInfo),
  getAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke(IPC_CHANNELS.getAuthStatus),
  getNowPlaying: (): Promise<NowPlaying> => ipcRenderer.invoke(IPC_CHANNELS.getNowPlaying),
  startLogin: (): Promise<{ authorizationUrl: string }> => ipcRenderer.invoke(IPC_CHANNELS.authStart),
  logout: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.authLogout),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  getCorsOrigins: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.getCorsOrigins),
  addCorsOrigin: (origin: string): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.addCorsOrigin, origin),
  removeCorsOrigin: (origin: string): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.removeCorsOrigin, origin),
  getCorsAllowAll: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.getCorsAllowAll),
  setCorsAllowAll: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.setCorsAllowAll, value),
  getCorsAllowFileOrigin: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.getCorsAllowFileOrigin),
  setCorsAllowFileOrigin: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.setCorsAllowFileOrigin, value),
  openCorsPanel: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.openCorsPanel),
  closeCorsPanel: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.closeCorsPanel),
  onEvent: (cb: (event: AppEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AppEvent) => cb(event);
    ipcRenderer.on(IPC_CHANNELS.appEvent, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.appEvent, listener);
  },
};

contextBridge.exposeInMainWorld('tidalApp', api);

export type TidalAppApi = typeof api;
