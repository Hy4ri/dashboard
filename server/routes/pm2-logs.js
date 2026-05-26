const { execFile } = require('child_process');
const { runCmd } = require('../utils/helpers');

function runTail(filePath) {
  return new Promise((resolve) => {
    if (!filePath) return resolve('');
    execFile('tail', ['-n', '100', filePath], { timeout: 1000 }, (err, stdout, stderr) => {
      if (err) return resolve(`[Error reading log: ${err.message}]`);
      resolve(stdout || stderr || '');
    });
  });
}

function createPM2LogsRoute() {
  return async function handlePM2Logs(req, res, name) {
    if (!name || /[;|&$`()<>]/.test(name)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Invalid process name' }));
    }

    try {
      const out = await runCmd('pm2', ['jlist']);
      if (!out) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'PM2 is not running or responded empty' }));
      }

      const processes = JSON.parse(out);
      const proc = processes.find(p => p.name === name);

      if (!proc) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: `Process '${name}' not found` }));
      }

      const outLogPath = proc.pm2_env ? proc.pm2_env.pm_out_log_path : null;
      const errLogPath = proc.pm2_env ? proc.pm2_env.pm_err_log_path : null;

      const [outLogs, errLogs] = await Promise.all([
        runTail(outLogPath),
        runTail(errLogPath)
      ]);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: true,
        name,
        out: outLogs,
        err: errLogs
      }));

    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  };
}

module.exports = { createPM2LogsRoute };
