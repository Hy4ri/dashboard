const net = require('net');

const SERVICES = [
  { name: 'Jellyfin', port: 8096 },
  { name: 'Seerr', port: 5055 },
  { name: 'qBittorrent', port: 7777 },
  { name: 'Sonarr', port: 8989 },
  { name: 'Radarr', port: 7878 },
  { name: 'Prowlarr', port: 9696 },
  { name: 'Bazarr', port: 6767 },
  { name: 'Dufs', port: 5050 },
  { name: 'Technitium', port: 5380 },
  { name: 'SearXNG', port: 8888 }
];

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: port,
      timeout: 500
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

async function collectServices() {
  const results = {};
  const checks = SERVICES.map(async (s) => {
    const isUp = await checkPort(s.port);
    results[s.name] = isUp;
  });
  await Promise.all(checks);
  return results;
}

module.exports = { collectServices, SERVICES };
