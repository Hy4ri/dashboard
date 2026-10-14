const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'monit-tests-'));
const dist = path.join(workspace, 'dist');
const browserOnly = process.argv.includes('--browser');
let status = 0;
try {
  const commands = browserOnly ? [] : [['go', ['test', './...']], ['go', ['vet', './...']]];
  commands.push([path.join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.client.json', '--outDir', dist]]);
  const tests = browserOnly ? ['browser-smoke.cjs'] : ['frontend-transport.cjs', 'frontend-render.cjs', 'frontend-actions.cjs', 'service-worker.cjs'];
  for (const test of tests) commands.push([process.execPath, ['--experimental-vm-modules', path.join(__dirname, test)]]);
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, MONIT_TEST_DIST: dist },
    });
    if (result.error) console.error(result.error.message);
    if (result.error || result.status !== 0) { status = result.status || 1; break; }
  }
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
process.exit(status);
