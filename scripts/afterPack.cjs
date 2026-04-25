/**
 * Hook electron-builder `afterPack` — re-signe le binaire Electron packagé
 * avec le certificat VMP Castlabs EVS (obligatoire pour que Widevine/Tidal
 * accepte la DRM request).
 *
 * Prérequis sur la machine de build :
 *   py -3 -m pip install --upgrade castlabs-evs
 *   py -3 -m castlabs_evs.account reauth
 */

const { execSync } = require('node:child_process');
const path = require('node:path');

/** @param {{ appOutDir: string }} context */
exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  console.log(`[afterPack] Signing VMP in: ${appOutDir}`);

  const cmds = [
    `py -3 -m castlabs_evs.vmp sign-pkg "${appOutDir}"`,
    `python -m castlabs_evs.vmp sign-pkg "${appOutDir}"`,
  ];

  for (const cmd of cmds) {
    try {
      execSync(cmd, { stdio: 'inherit' });
      console.log('[afterPack] VMP signing succeeded.');
      return;
    } catch {
      // essaie la commande suivante
    }
  }

  console.warn(
    '[afterPack] WARNING: VMP signing failed. ' +
    'The packaged app may not be able to play DRM content (S6001). ' +
    'Make sure castlabs-evs is installed and `evs.account reauth` has been run.',
  );
};
