import http from 'http';
import { runCmd } from '../utils/helpers';

export interface PM2RouteOptions {
  collect: () => Promise<void>;
}

export function createPM2Route({ collect }: PM2RouteOptions) {
  return function handlePM2Control(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    action: string,
    name: string
  ): void {
    if (!name || /[;|&$`()<>]/.test(name)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
      return;
    }
    (async () => {
      try {
        await runCmd('pm2', [action, name]);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: `Process ${name} ${action}ed` }));
        setTimeout(() => collect(), 300);
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
  };
}
