function parseMemInfo(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (!m) continue;
    const key = m[1];
    const val = parseInt(m[2], 10) * 1024;   // kB → bytes
    if (/^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree)$/.test(key)) {
      result[key] = val;
    }
  }
  return result;
}

module.exports = { parseMemInfo };
