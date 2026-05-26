const { execFile } = require('child_process');

function execPs(sortBy) {
  return new Promise((resolve) => {
    const sortArg = sortBy === 'cpu' ? '-%cpu' : '-%mem';
    execFile('ps', ['-eo', 'pid,%cpu,%mem,comm', '--sort=' + sortArg], { timeout: 1000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn(`ps command failed for sorting by ${sortBy}:`, err.message);
        return resolve([]);
      }

      const lines = stdout.trim().split(/\r?\n/);
      if (lines.length <= 1) return resolve([]);

      const processes = [];
      // Skip index 0 (header: PID %CPU %MEM COMMAND) and fetch top 5
      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        const line = lines[i].trim();
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          const pid = parseInt(parts[0], 10);
          const cpu = parseFloat(parts[1]);
          const mem = parseFloat(parts[2]);
          // Re-join COMMAND name in case it contains spaces
          const name = parts.slice(3).join(' ');
          processes.push({ pid, cpu, mem, name });
        }
      }
      resolve(processes);
    });
  });
}

async function collectProcesses() {
  const [topCpu, topMem] = await Promise.all([
    execPs('cpu'),
    execPs('mem')
  ]);
  return { topCpu, topMem };
}

module.exports = { collectProcesses };
