const { runCmd } = require('../utils/helpers');

function createPM2Route({ collect }) {
  return function handlePM2Control(req, res, action, name) {
    if (!name || /[;|&$`()<>]/.test(name)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Invalid request' }));
    }
    (async () => {
      try {
        const out = await runCmd('pm2', [action, name]);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: `Process ${name} ${action}ed` }));
        setTimeout(() => collect(), 300);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
  };
}

module.exports = { createPM2Route };
