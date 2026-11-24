// Pure text transforms used by withWGTunnel.js (kept separate so they can be tested without Expo).
const DEP = "implementation 'com.wireguard.android:tunnel:1.0.20230706'"; // CHECK for a newer version

exports.kotlinSource = (src, pkg) => src.replace(/^package .*$/m, `package ${pkg}.tunnel`);

exports.patchMainApplication = (s, pkg) => {
  const imp = `import ${pkg}.tunnel.WGTunnelPackage`;
  if (!s.includes(imp)) s = s.replace(/^(package .*)$/m, `$1\n\n${imp}`);
  if (!s.includes('WGTunnelPackage()')) {
    const re = /PackageList\(this\)\.packages\.apply \{/;
    if (!re.test(s)) throw new Error('with-wg-tunnel: could not find PackageList(this).packages.apply { in MainApplication.kt. Add add(WGTunnelPackage()) by hand.');
    s = s.replace(re, (m) => `${m}\n              add(WGTunnelPackage())`);
  }
  return s;
};

exports.patchAppGradle = (s) =>
  s.includes('com.wireguard.android:tunnel') ? s : s.replace(/dependencies \{/, `dependencies {\n    ${DEP}`);
