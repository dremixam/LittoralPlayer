import type { TidalAppApi } from '../../preload';

declare global {
  interface Window {
    tidalApp: TidalAppApi;
  }
}

export {};
