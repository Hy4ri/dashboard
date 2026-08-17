import { readFile, runCmd } from '../utils/helpers';
import stateModule from '../state';
import { SystemData } from '../../shared/types';

export async function initStaticSystem(): Promise<void> {
  const [osRel, host, ip, kern, lscpu] = await Promise.all([
    readFile('/etc/os-release'),
    runCmd('hostname'),
    runCmd('hostname', ['-I']),
    runCmd('uname', ['-r']),
    runCmd('lscpu'),
  ]);
  let os: string | null = null;
  if (osRel) {
    const m = osRel.match(/PRETTY_NAME="(.+)"/);
    if (m) os = m[1];
  }
  let arch: string | null = null;
  for (const line of (lscpu || '').split('\n')) {
    const s = line.split(':').map(x => x.trim());
    if (s[0] === 'Model name') { arch = s[1]; break; }
    if (s[0] === 'Architecture' && !arch) arch = s[1];
  }
  stateModule.staticSystem = { hostname: host || null, ip: ip || null, kernel: kern || null, os, arch };
}

export async function collectSystem(): Promise<SystemData> {
  // staticSystem was populated once at startup – just read uptime
  const upt = await readFile('/proc/uptime');
  return {
    uptime: upt ? parseFloat(upt.split(' ')[0]) : null,
    hostname: stateModule.staticSystem?.hostname || null,
    ip: stateModule.staticSystem?.ip || null,
    kernel: stateModule.staticSystem?.kernel || null,
    os: stateModule.staticSystem?.os || null,
    arch: stateModule.staticSystem?.arch || null,
  };
}
