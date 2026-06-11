function parseMemInfo(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon);
    // Only extract the fields we need
    if (!/^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree)$/.test(key)) continue;
    const valStr = line.slice(colon + 1).trim();
    const val = parseInt(valStr, 10) * 1024; // kB → bytes
    if (!isNaN(val)) result[key] = val;
  }
  return result;
}

module.exports = { parseMemInfo };
