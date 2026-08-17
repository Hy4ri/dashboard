import { prev } from '../state';

export interface ProcStatCpu {
  total: number;
  idle: number;
}

export interface ParsedProcStat {
  overall: ProcStatCpu | null;
  cores: Record<string, ProcStatCpu>;
}

export interface CpuMetricsResult {
  cpuOverall: number | null;
  cpuCores: (number | null)[];
}

export function parseProcStat(text: string): ParsedProcStat {
  const result: ParsedProcStat = { overall: null, cores: {} };
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const parts = line.trim().split(/\s+/);
    const name = parts[0];
    const nums = parts.slice(1).map(Number);
    if (nums.length < 4) continue;
    const total = nums.reduce((a, b) => a + b, 0);
    const idle = nums[3] + (nums[4] ?? 0); // idle + iowait
    if (name === 'cpu') result.overall = { total, idle };
    else result.cores[name] = { total, idle };
  }
  return result;
}

export function computePct(prevStat: ProcStatCpu | null | undefined, currStat: ProcStatCpu | null | undefined): number | null {
  if (!prevStat || !currStat) return null;
  const dT = currStat.total - prevStat.total;
  const dI = currStat.idle - prevStat.idle;
  return dT === 0 ? 0 : Math.round(((dT - dI) / dT) * 1000) / 10;
}

export function collectCPU(cpuText: string | null, _interval?: number): CpuMetricsResult {
  const cpuData = cpuText ? parseProcStat(cpuText) : null;
  let cpuOverall: number | null = null;
  const cpuCores: (number | null)[] = [];
  if (cpuData && prev.cpu) {
    cpuOverall = computePct(prev.cpu.overall, cpuData.overall);
    for (const [name, cd] of Object.entries(cpuData.cores)) {
      const p = prev.cpu.cores[name];
      cpuCores.push(p ? computePct(p, cd) : null);
    }
  }
  prev.cpu = cpuData;
  return { cpuOverall, cpuCores };
}
