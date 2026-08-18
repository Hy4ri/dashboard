import net from 'net';

export interface ServiceDef {
  name: string;
  port: number;
}

export const SERVICES: ServiceDef[] = [
  { name: 'Jellyfin', port: 8096 },
  { name: 'Seerr', port: 5055 },
  { name: 'qBittorrent', port: 7777 },
  { name: 'Sonarr', port: 8989 },
  { name: 'Radarr', port: 7878 },
  { name: 'Prowlarr', port: 9696 },
  { name: 'Bazarr', port: 6767 },
  { name: 'Dufs', port: 5050 },
  { name: 'Technitium', port: 5380 },
  { name: 'Hermes', port: 9119 },
];

export function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: port,
      timeout: 500,
    });

    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function collectServices(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  const checks = SERVICES.map(async (s) => {
    const isUp = await checkPort(s.port);
    results[s.name] = isUp;
  });
  await Promise.all(checks);
  return results;
}
