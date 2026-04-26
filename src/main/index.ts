import { app, BrowserWindow, Menu, components, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { startApiServer, stopApiServer } from './api/server';
import { createPlayerView, attachConsoleBridge } from './player/controller';
import { bootstrapAuth } from './auth/webviewToken';
import { registerIpc } from './ipc';

// Castlabs ECS : on autorise explicitement le component updater à fonctionner
// (certaines installations Windows bloquent l'auto-install via le sandbox).
app.commandLine.appendSwitch('enable-features', 'WidevineL3');

// Le sandbox des utility processes empêche le helper CDM Castlabs d'extraire
// le CRX (« Sandbox cannot access executable ») sur Windows, ce qui bloque
// le passage du CDM de status='new' à 'installed'. On le désactive en dev
// ET en prod : la signature VMP seule ne suffit pas à débloquer ce cas.
app.commandLine.appendSwitch('no-sandbox');

// Nom d'app stable -> dossier userData stable (%APPDATA%/Littoral)
app.setName('Littoral');

// Supprime complètement le menu File/Edit/View natif.
Menu.setApplicationMenu(null);

/**
 * Résout l'icône d'app si présente dans `resources/`.
 * Optionnelle : si rien n'est trouvé, Electron utilise l'icône par défaut.
 */
function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(process.cwd(), 'resources', 'icon.png'),
    path.join(process.cwd(), 'resources', 'icon.ico'),
    path.join(__dirname, '../../resources/icon.png'),
    path.join(__dirname, '../../resources/icon.ico'),
    path.join(process.resourcesPath ?? '', 'resources', 'icon.png'),
    path.join(process.resourcesPath ?? '', 'resources', 'icon.ico'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return undefined;
}

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  const iconPath = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    title: 'Littoral',
    icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
    // Title bar intégrée à l'UI : on garde les boutons natifs (overlay)
    // mais l'app peut peindre derrière et exposer une zone draggable via -webkit-app-region.
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#0a0a0a', symbolColor: '#eeeeee', height: 40 }
      : true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Charge l'UI React (renderer Vite)
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Crée la BrowserView contenant listen.tidal.com
  createPlayerView(mainWindow);
  attachConsoleBridge();

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  console.log('[app] userData:', app.getPath('userData'));
  console.log('[app] name:', app.getName());

  // Castlabs Electron : télécharge / charge le CDM Widevine avant tout autre chose.
  // Sans ça, le lecteur Tidal échoue avec l'erreur S6001 (DRM).
  //
  // ECS récent (~v33+) expose deux composants :
  //   - "Widevine Content Decryption Module" (oimompecagnajdejgnnjijobebaeigek) : ancien, deprecated, n'est plus distribué (status reste "not-installed" → c'est ce qui fait planter components.whenReady()).
  //   - "Google Widevine Windows CDM" (neifaoindggfcjicffkgpmnlppeffabd) : nouveau, c'est CELUI qui sert à décrypter.
  //
  // On considère donc que tout va bien tant que le NOUVEAU CDM est en état
  // 'installed' ou 'new' (téléchargé, sera chargé après prochain restart).
  const acceptable = new Set(['installed', 'new']);
  const NEW_CDM_ID = 'neifaoindggfcjicffkgpmnlppeffabd';
  let widevineOk = false;

  try {
    await components.whenReady();
    widevineOk = true;
    console.log('[widevine] components.whenReady() OK:', components.status());
  } catch (err) {
    const status = components.status() as Record<string, { status: string; title: string; version: string | null }>;
    const newCdm = status[NEW_CDM_ID];
    if (newCdm && acceptable.has(newCdm.status)) {
      widevineOk = true;
      console.log(`[widevine] new Windows CDM disponible (status=${newCdm.status}, version=${newCdm.version}). Ancien composant ignoré.`);
      if (newCdm.status === 'new') {
        console.log('[widevine] ⚠️  CDM téléchargé mais pas encore actif — restart automatique pour le charger.');
      }
    } else {
      const e = err as { message?: string; errors?: Array<{ message?: string; detail?: unknown }> };
      console.warn('[widevine] components.whenReady() a échoué :', e.message);
      if (e.errors) for (const sub of e.errors) {
        console.warn('[widevine]   sub-error:', sub.message, '— detail:', JSON.stringify(sub.detail));
      }
      console.warn('[widevine] status complet:', status);
    }
  }

  // Si le CDM vient d'être téléchargé (status 'new'), il ne sera réellement
  // chargé qu'au prochain démarrage. Pour éviter à l'utilisateur de devoir
  // fermer et relancer manuellement (ce qui produit S6001 au premier play),
  // on relance automatiquement l'app — une seule fois, via un flag CLI.
  const oldCdmStatus = (components.status() as Record<string, { status: string }>)[
    'oimompecagnajdejgnnjijobebaeigek'
  ]?.status;
  const newCdmStatus = (components.status() as Record<string, { status: string }>)[NEW_CDM_ID]?.status;
  const cdmJustDownloaded = oldCdmStatus === 'new' || newCdmStatus === 'new';
  const alreadyRestarted = process.argv.includes('--cdm-restart');
  // En mode dev, electron-vite gère le process Electron : un app.relaunch() tuerait
  // le serveur Vite et la fenêtre relancée n'aurait plus de renderer (écran noir).
  // On laisse donc le CDM s'activer au prochain démarrage manuel en dev.
  if (cdmJustDownloaded && !alreadyRestarted && app.isPackaged) {
    console.log('[widevine] Restart automatique pour activer le CDM fraîchement téléchargé...');
    app.relaunch({ args: [...process.argv.slice(1), '--cdm-restart'] });
    app.exit(0);
    return;
  }
  if (cdmJustDownloaded && !app.isPackaged) {
    console.log('[widevine] CDM téléchargé (status=new) — sera actif au prochain démarrage. Pas de restart en mode dev.');
  }

  if (!widevineOk) {
    console.warn('[widevine] CDM indisponible — Tidal renverra probablement S6001 au play.');
  }

  bootstrapAuth();
  await startApiServer();
  registerIpc(() => mainWindow);
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', async () => {
  await stopApiServer();
  if (process.platform !== 'darwin') app.quit();
});
