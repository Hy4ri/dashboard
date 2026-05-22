const { qbDelete } = require('../collectors/qbittorrent');

function createQBittorrentRoute() {
  return function handleQBDelete(req, res, hash) {
    (async () => {
      const result = await qbDelete(hash);
      const code = result.success ? 200 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    })();
  };
}

module.exports = { createQBittorrentRoute };
