import http from 'http';
import { qbDelete } from '../collectors/qbittorrent';

export function createQBittorrentRoute() {
  return function handleQBDelete(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    hash: string
  ): void {
    (async () => {
      const result = await qbDelete(hash);
      const code = result.success ? 200 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    })();
  };
}
