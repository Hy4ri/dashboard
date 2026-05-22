const { readFile, runCmd } = require('../utils/helpers');
let { staticSystem } = require('../state');

async function initStaticSystem() {
  const [osRel, host, ip, kern, lscpu] = await Promise.all([
    readFile('/etc/os-release'),
    runCmd('hostname'),
    runCmd('hostname', ['-I']),
    runCmd('uname', ['-r']),
    runCmd('lscpu'),
  ]);
  let os = null;
  if (osRel) {
    const m = osRel.match(/PRETTY_NAME="(.+)"/);
    if (m) os = m[1];
  }
  let arch = null;
  for (const line of (lscpu || '').split('\n')) {
    const s = line.split(':').map(x => x.trim());
    if (s[0] === 'Model name')    { arch = s[1]; break; }
    if (s[0] === 'Architecture' && !arch) arch = s[1];
  }
  staticSystem = { hostname: host, ip, kernel: kern, os, arch };
}

async function collectSystem() {
  // staticSystem was populated once at startup – just read uptime
  const upt = await readFile('/proc/uptime');
  return {
    uptime:   upt ? parseFloat(upt.split(' ')[0]) : null,
    hostname: staticSystem?.hostname || null,
    ip:       staticSystem?.ip       || null,
    kernel:   staticSystem?.kernel   || null,
    os:       staticSystem?.os       || null,
    arch:     staticSystem?.arch     || null,
  };
}

module.exports = { initStaticSystem, collectSystem };
