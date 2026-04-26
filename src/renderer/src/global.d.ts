import type { TidalAppApi } from '../../preload';

declare module '*.svg' {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    tidalApp: TidalAppApi;
  }
}

export {};
