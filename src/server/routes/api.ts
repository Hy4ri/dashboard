import http from 'http';
import { DashboardState } from '../../shared/types';

export interface HandleAPIOptions {
  state: DashboardState;
  ensureActivePolling: () => void;
  SECURITY_HEADERS: Record<string, string>;
}

export function createHandleAPI({ state, ensureActivePolling, SECURITY_HEADERS }: HandleAPIOptions) {
  return function handleAPI(req: http.IncomingMessage, res: http.ServerResponse): void {
    ensureActivePolling();
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
    res.end(JSON.stringify(state));
  };
}
