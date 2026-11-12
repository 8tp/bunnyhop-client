const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  FuseV1Options,
  FuseVersion,
  flipFuses,
} = require('@electron/fuses');

module.exports = async function afterPack(context) {
  const product = context.packager.appInfo.productFilename;
  let executable;
  if (context.electronPlatformName === 'darwin') {
    executable = path.join(context.appOutDir, `${product}.app`, 'Contents', 'MacOS', product);
  } else if (context.electronPlatformName === 'linux') {
    executable = path.join(context.appOutDir, context.packager.executableName);
  } else {
    executable = path.join(context.appOutDir, `${product}.exe`);
  }

  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });

  /* Flipping a Mach-O fuse changes the executable after Electron's download
     signature was applied. Give unsigned developer bundles a valid ad hoc
     seal. Electron Builder replaces it with Developer ID signing later in a
     real release. */
  if (context.electronPlatformName === 'darwin') {
    const app = path.join(context.appOutDir, `${product}.app`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    // The outer seal again, with the microphone entitlement (voice chat).
    execFileSync('codesign', ['--force', '--sign', '-', '--entitlements', path.join(__dirname, 'entitlements.mac.plist'), app], { stdio: 'inherit' });
  }
};
