// Expo config plugin: installs the WireGuard tunnel native module on every `expo prebuild`.
const { withMainApplication, withAppBuildGradle, withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { kotlinSource, patchMainApplication, patchAppGradle } = require('./transforms');

function withWGTunnel(config) {
  const pkg = config.android && config.android.package;
  if (!pkg) throw new Error('with-wg-tunnel: set android.package in app.json');

  config = withDangerousMod(config, ['android', async (c) => {
    const src = fs.readFileSync(path.join(c.modRequest.projectRoot, 'native/android/WGTunnelModule.kt'), 'utf8');
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/java', ...pkg.split('.'), 'tunnel');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'WGTunnelModule.kt'), kotlinSource(src, pkg));
    return c;
  }]);

  config = withMainApplication(config, (c) => {
    if (c.modResults.language !== 'kt') throw new Error('with-wg-tunnel: expected a Kotlin MainApplication');
    c.modResults.contents = patchMainApplication(c.modResults.contents, pkg);
    return c;
  });

  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = patchAppGradle(c.modResults.contents);
    return c;
  });
  return config;
}
module.exports = createRunOncePlugin(withWGTunnel, 'with-wg-tunnel', '1.0.0');
