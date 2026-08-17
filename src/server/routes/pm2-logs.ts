import http from 'http';
import { execFile } from 'child_process';
import { getPM2Process } from '../collectors/pm2';

function runTail(filePath: string | null | undefined): Promise<string> {
  return new Promise((resolve) => {
    if (!filePath) return resolve('');
    execFile('tail', ['-n', '100', filePath], { timeout: 1000 }, (err, stdout, stderr) => {
      if (err) return resolve(`[Error reading log: ${err.message}]`);
      const output = stdout || stderr || '';
      // Prepend single ISO timestamp header instead of per-line
      const now = new Date();
      const ts = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');
      resolve(`[${ts}] (last 100 lines)\n${output}`);
    });
  });
}

export function createPM2LogsRoute() {
  return async function handlePM2Logs(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string
  ): Promise<void> {
    if (!name || /[;|&$`()<>]/.test(name)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid process name' }));
      return;
    }

    try {
      const proc = await getPM2Process(name);

      if (!proc) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: `Process '${name}' not found` }));
        return;
      }

      const outLogPath = proc._full && proc._full.pm2_env ? proc._full.pm2_env.pm_out_log_path : null;
      const errLogPath = proc._full && proc._full.pm2_env ? proc._full.pm2_env.pm_err_log_path : null;

      const [outLogs, errLogs] = await Promise.all([
        runTail(outLogPath),
        runTail(errLogPath),
      ]);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: true,
        name,
        out: outLogs,
        err: errLogs,
      }));

    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  };
}
