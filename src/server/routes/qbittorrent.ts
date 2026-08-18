import http from 'http';
import { qbDelete, qbPause, qbResume } from '../collectors/qbittorrent';
import { ActionResult } from '../../shared/types';

export function createQBittorrentRoute() {
  return function handleQBAction(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    action: string,
    hash: string
  ): void {
    (async () => {
      let result: ActionResult = { success: false, error: 'Unknown action' };
      if (action === 'delete') {
        result = await qbDelete(hash);
      } else if (action === 'pause') {
        result = await qbPause(hash);
      } else if (action === 'resume') {
        result = await qbResume(hash);
      }
      const code = result.success ? 200 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    })();
  };
}
