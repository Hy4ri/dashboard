/* ── Dashboard Configuration ─────────────────────────────────────── */

export const POLL_MS = 3000;

export const THERMAL_MAP = {
  'cpu-1-6-step':    'CPU Hotspot',
  'battery':         'Battery',
  'gpuss-0-step':    'GPU',
  'ddr-usr':         'RAM',
  'modem-lte-sub6-pa1': '5G Modem',
  'pmr735a_tz':      'PMIC',
};

export const GOVERNOR_MAP = {
  schedutil:   'Scheduler-guided',
  performance: 'Max Performance',
  powersave:   'Power Saving',
  ondemand:    'On Demand',
  conservative:'Conservative',
  userspace:   'Userspace',
};

export const NET_IFACE_MAP = {
  'wlan0': 'WiFi',
  'wl': 'WiFi',
  'eth0': 'Ethernet',
  'enp': 'Ethernet',
  'tun0': 'VPN',
  'wg0': 'WireGuard',
  'lo': 'Loopback',
  'docker0': 'Docker',
  'br-': 'Bridge',
};

export const SERVICE_LINKS = [
  { name: 'Jellyfin',    port: 8096, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><polyline points="9 3 9 21"/></svg>' },
  { name: 'Seerr',       port: 5055, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' },
  { name: 'qBittorrent', port: 7777, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' },
  { name: 'Sonarr',      port: 8989, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
  { name: 'Radarr',      port: 7878, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>' },
  { name: 'Prowlarr',    port: 9696, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' },
  { name: 'Bazarr',      port: 6767, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' },
  { name: 'Dufs',        port: 5050, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' },
  { name: 'Technitium',  port: 5380, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>' },
  { name: 'SearXNG',     port: 8888, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' },
];
