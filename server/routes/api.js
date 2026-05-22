function createHandleAPI({ state, ensureActivePolling, SECURITY_HEADERS }) {
  return function handleAPI(req, res) {
    ensureActivePolling();
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
    res.end(JSON.stringify(state));
  };
}

module.exports = { createHandleAPI };
