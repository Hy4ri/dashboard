const fs = require('fs');
const { execFile } = require('child_process');

const readFile = filePath => new Promise(resolve =>
  fs.readFile(filePath, 'utf8', (e, d) => resolve(e ? null : d)));

const readDir = dirPath => new Promise(resolve =>
  fs.readdir(dirPath, (e, d) => resolve(e ? [] : d)));

const runCmd = (cmd, args = [], tmo = 3000) => new Promise(resolve =>
  execFile(cmd, args, { timeout: tmo }, (e, o) => resolve(e ? '' : o.trim())));

module.exports = { readFile, readDir, runCmd };
