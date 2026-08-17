export interface PM2Process {
  id: number;
  name: string;
  status: 'online' | 'stopped' | 'errored' | string;
  cpu: number;
  memory: number;
  uptime: number | null;
  restarts: number;
  pid: number;
  _full?: any;
}

export interface ThermalSensor {
  name: string;
  temp: number;
}

export interface CpuFrequency {
  core: number;
  current?: number | null;
  min: number | null;
  max: number | null;
  governor: string | null;
}

export interface DiskUsage {
  total: number;
  used: number;
  available: number;
  used_pct?: number;
}

export interface DiskIOItem {
  reads: number;
  writes: number;
  sectorsRead: number;
  sectorsWritten: number;
  ioTime: number;
  readsPerSec?: number;
  writesPerSec?: number;
  sectorsReadPerSec?: number;
  sectorsWrittenPerSec?: number;
}

export interface DiskData extends Partial<DiskUsage> {
  io: Record<string, DiskIOItem>;
}

export interface MemoryData {
  MemTotal: number;
  MemFree: number;
  MemAvailable: number;
  Buffers: number;
  Cached: number;
  SwapTotal?: number;
  SwapFree?: number;
  used_pct?: number;
}

export interface SwapData {
  total: number;
  free: number;
}

export interface NetworkInterface {
  rx_bytes: number;
  tx_bytes: number;
  rx_rate?: number;
  tx_rate?: number;
}

export interface ConnectivityStatus {
  ok: boolean;
  latency?: number;
  error?: string;
}

export interface TechnitiumStats {
  configured: boolean;
  ok?: boolean;
  totalQueries?: number;
  blockedQueries?: number;
  blockedPercentage?: number;
  cachedQueries?: number;
  error?: string;
}

export interface BatteryData {
  capacity: number | null;
  status: string | null;
  voltage: number | null;
  current: number | null;
}

export interface SystemData {
  uptime: number | null;
  hostname: string | null;
  ip: string | null;
  kernel: string | null;
  os: string | null;
  arch: string | null;
}

export interface TorrentItem {
  hash: string;
  name: string;
  size: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  state: string;
  num_seeds: number;
  num_peers: number;
  ratio: number;
}

export interface DashboardState {
  timestamp?: number;
  pm2?: PM2Process[];
  cpu?: number | null;
  cpuCores?: (number | null)[];
  thermal?: ThermalSensor[];
  frequency?: CpuFrequency[];
  loadavg?: [number, number, number] | null;
  memory?: MemoryData | null;
  swap?: SwapData | null;
  disk?: DiskData;
  network?: Record<string, NetworkInterface>;
  internet?: ConnectivityStatus;
  dns?: ConnectivityStatus;
  battery?: BatteryData;
  system?: SystemData;
  torrents?: TorrentItem[];
  services?: Record<string, boolean>;
  dnsStats?: TechnitiumStats;
  authEnabled?: boolean;
}
