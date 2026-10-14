const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.MONIT_BUILD_DIR || root);
fs.mkdirSync(output, { recursive: true });
for (const [command, args] of [
  ['go', ['build', '-o', path.join(output, 'monit-server'), '.']],
  [path.join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.client.json', '--outDir', path.join(output, 'dist')]],
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log('Built dashboard at ' + output);
process.exit(0);
