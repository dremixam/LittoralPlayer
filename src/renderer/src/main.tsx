import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CorsPanel } from './CorsManager';

const root = createRoot(document.getElementById('root')!);

if (window.location.hash === '#cors-panel') {
  root.render(<CorsPanel />);
} else {
  root.render(<App />);
}
