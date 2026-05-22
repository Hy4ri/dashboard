const { speedtestRunning } = require('../state');
const { runSpeedtest } = require('../collectors/speedtest');

function createSpeedtestRoute() {
  return function handleSpeedtestRun(req, res) {
    if (speedtestRunning) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Speedtest already running' }));
    }
    runSpeedtest();
    res.writeHead(202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, message: 'Speedtest started' }));
  };
}

module.exports = { createSpeedtestRoute };
