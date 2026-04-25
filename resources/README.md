# resources/

Placez ici les icônes de l'application. Aucun fichier obligatoire ; si rien
n'est présent, Electron utilisera l'icône par défaut.

| Plateforme | Fichier        | Format / taille recommandés |
|------------|----------------|-----------------------------|
| Windows    | `icon.ico`     | multi-tailles (16/32/48/256) |
| macOS      | `icon.icns`    | jeu d'icônes Apple |
| Linux / dev| `icon.png`     | 512×512 PNG |

Le main process (`src/main/index.ts → resolveAppIcon()`) cherche
`icon.png` puis `icon.ico` dans ce dossier (et dans `process.resourcesPath`
en build packagé). `electron-builder` est configuré pour packager ce
dossier (`extraResources`).
