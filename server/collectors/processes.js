const { execFile } = require('child_process');

function getCleanName(comm, args, pid) {
  let name = (comm || '').replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
  
  if (name.includes('/')) {
    name = name.substring(name.lastIndexOf('/') + 1);
  }

  const interpreters = ['node', 'python', 'python3', 'python2', 'ruby', 'perl', 'bash', 'sh', 'sudo', 'npx'];
  if (!name || interpreters.includes(name.toLowerCase())) {
    let cleanArgs = (args || '').replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
    if (cleanArgs) {
      const argsParts = cleanArgs.split(/\s+/);
      const execPath = argsParts[0];
      let execName = execPath.substring(execPath.lastIndexOf('/') + 1);
      
      if (argsParts.length > 1 && interpreters.includes(execName.toLowerCase())) {
        const scriptPath = argsParts[1];
        const scriptName = scriptPath.substring(scriptPath.lastIndexOf('/') + 1);
        name = `${execName} ${scriptName}`;
      } else {
        name = execName || name || cleanArgs;
      }
    }
  }

  return name || `[Process ${pid}]`;
}

function execPsWithDelimiter(sortArg) {
  return new Promise((resolve, reject) => {
    execFile('ps', ['--delimiter', ',', '-eo', 'pid,%cpu,%mem,comm,args', '--sort=' + sortArg], { timeout: 1000 }, (err, stdout) => {
      if (err) return reject(err);
      
      const lines = stdout.trim().split(/\r?\n/);
      if (lines.length <= 1) return resolve([]);

      const processes = [];
      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length >= 4) {
          const pid = parseInt(parts[0].trim(), 10);
          const cpu = parseFloat(parts[1].trim());
          const mem = parseFloat(parts[2].trim());
          const comm = parts[3].trim();
          const args = parts.slice(4).join(',').trim();
          const name = getCleanName(comm, args, pid);
          processes.push({ pid, cpu, mem, name });
        }
      }
      resolve(processes);
    });
  });
}

function execPsFallback(sortArg) {
  return new Promise((resolve) => {
    execFile('ps', ['-eo', 'pid,%cpu,%mem,comm,args', '--sort=' + sortArg], { timeout: 1000 }, (err, stdout) => {
      if (err) {
        console.warn(`ps command fallback with args failed:`, err.message);
        execFile('ps', ['-eo', 'pid,%cpu,%mem,comm', '--sort=' + sortArg], { timeout: 1000 }, (err2, stdout2) => {
          if (err2) {
            console.warn(`ps command last resort fallback failed:`, err2.message);
            return resolve([]);
          }
          const lines = stdout2.trim().split(/\r?\n/);
          const processes = [];
          for (let i = 1; i < Math.min(lines.length, 6); i++) {
            const line = lines[i].trim();
            const parts = line.split(/\s+/);
            if (parts.length >= 4) {
              const pid = parseInt(parts[0], 10);
              const cpu = parseFloat(parts[1]);
              const mem = parseFloat(parts[2]);
              const comm = parts.slice(3).join(' ');
              const name = getCleanName(comm, '', pid);
              processes.push({ pid, cpu, mem, name });
            }
          }
          resolve(processes);
        });
        return;
      }

      const lines = stdout.trim().split(/\r?\n/);
      if (lines.length <= 1) return resolve([]);

      const processes = [];
      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        const line = lines[i].trim();
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          const pid = parseInt(parts[0], 10);
          const cpu = parseFloat(parts[1]);
          const mem = parseFloat(parts[2]);
          const comm = parts[3];
          const args = parts.slice(4).join(' ');
          const name = getCleanName(comm, args, pid);
          processes.push({ pid, cpu, mem, name });
        }
      }
      resolve(processes);
    });
  });
}

async function execPs(sortBy) {
  const sortArg = sortBy === 'cpu' ? '-%cpu' : '-%mem';
  try {
    return await execPsWithDelimiter(sortArg);
  } catch (e) {
    return await execPsFallback(sortArg);
  }
}

async function collectProcesses() {
  const [topCpu, topMem] = await Promise.all([
    execPs('cpu'),
    execPs('mem')
  ]);
  return { topCpu, topMem };
}

module.exports = { collectProcesses };

