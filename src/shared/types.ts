export interface PM2Process {
  id: number;
  name: string;
  status: 'online' | 'stopped' | 'errored' | string;
  cpu: number;
  memory: number;
  restarts: number;
}

export interface ServiceStatus {
  name: string;
  port: number;
  up: boolean;
}

export interface ThermalSensor {
  name: string;
  temp: number;
}

export interface DiskUsage {
  total: number;
  used: number;
  available: number;
  used_pct?: number;
}

export type DiskData = Partial<DiskUsage>;

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
}

export interface SystemData {
  hostname: string | null;
}

export interface ActionResult {
  success: boolean;
  error?: string;
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

export interface AntigravityQuotaBucket {
  bucketId: string;
  displayName: string;
  window: string;
  resetTime?: string;
  remainingFraction: number;
  remainingPct: number;
}

export interface AntigravityQuotaGroup {
  displayName: string;
  buckets: AntigravityQuotaBucket[];
}

export interface AntigravityAccountQuota {
  email: string;
  project?: string;
  groups: AntigravityQuotaGroup[];
}

export interface ClaudeUsageWindow {
  utilization: number;
  resetsAt?: string;
}

export interface ClaudeUsageData {
  email?: string;
  planType?: string;
  fiveHour?: ClaudeUsageWindow;
  sevenDay?: ClaudeUsageWindow;
  breakdown?: Record<string, number>;
}

export interface CodexUsageWindow {
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt: number;
}

export interface CodexUsageData {
  email?: string;
  planType?: string;
  primaryWindow?: CodexUsageWindow;
  secondaryWindow?: CodexUsageWindow;
}

export interface DashboardState {
  timestamp?: number;
  pm2?: PM2Process[] | null;
  cpu?: number | null;
  cpuCores?: (number | null)[];
  thermal?: ThermalSensor[];
  loadavg?: [number, number, number] | null;
  memory?: MemoryData | null;
  swap?: SwapData | null;
  disk?: DiskData;
  network?: Record<string, NetworkInterface>;
  internet?: ConnectivityStatus;
  dns?: ConnectivityStatus;
  battery?: BatteryData;
  system?: SystemData;
  torrents?: TorrentItem[] | null;
  services?: ServiceStatus[];
  dnsStats?: TechnitiumStats;
  antigravity?: AntigravityAccountQuota[];
  claudeUsage?: ClaudeUsageData;
  codexUsage?: CodexUsageData;
  authEnabled?: boolean;
}
