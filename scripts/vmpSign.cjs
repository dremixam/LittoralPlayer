/**
 * Signe le binaire packagé avec EVS (Castlabs VMP).
 *
 * Doit être exécuté APRÈS `electron-builder --dir`, pour que la signature
 * porte sur le `.exe` final (electron-builder embarque les hashes asar
 * integrity dans le binaire pendant son propre processus, ce qui invaliderait
 * une signature appliquée trop tôt via `afterPack`).
 */

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const targets = [
  path.resolve(__dirname, '..', 'release', 'win-unpacked'),
  path.resolve(__dirname, '..', 'release', 'mac'),
  path.resolve(__dirname, '..', 'release', 'mac-arm64'),
  path.resolve(__dirname, '..', 'release', 'linux-unpacked'),
];

const existing = targets.filter((t) => fs.existsSync(t));
if (existing.length === 0) {
  console.error('[vmp:sign] Aucun dossier packagé trouvé sous release/.');
  process.exit(1);
}

for (const dir of existing) {
  console.log(`[vmp:sign] Signing: ${dir}`);
  const cmds = [
    `py -3 -m castlabs_evs.vmp sign-pkg "${dir}"`,
    `python -m castlabs_evs.vmp sign-pkg "${dir}"`,
  ];
  let signed = false;
  for (const cmd of cmds) {
    try {
      execSync(cmd, { stdio: 'inherit' });
      signed = true;
      break;
    } catch {
      // try next
    }
  }
  if (!signed) {
    console.error(`[vmp:sign] ÉCHEC pour ${dir}`);
    process.exit(1);
  }

  // Vérification
  for (const cmd of [
    `py -3 -m castlabs_evs.vmp verify-pkg "${dir}"`,
    `python -m castlabs_evs.vmp verify-pkg "${dir}"`,
  ]) {
    try {
      execSync(cmd, { stdio: 'inherit' });
      break;
    } catch {
      // try next
    }
  }
}

console.log('[vmp:sign] OK');
