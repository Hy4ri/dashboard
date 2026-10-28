import { $ } from '../utils/dom.js';
import { DashboardState } from '../../shared/types.js';
import { THRESHOLDS } from '../config.js';

let notificationGranted = false;
let previousAlerts = new Set<string>();
// Alerts the user closed. An alert returns only after its condition clears and comes back.
const dismissedKeys = new Set<string>();

// Banners use inline icons so the UI carries no emoji glyphs.
const ALERT_ICONS: Record<AlertItem['type'], string> = {
  danger: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

export interface AlertItem {
  key: string;
  type: 'danger' | 'warning' | 'info';
  message: string;
}

// notificationsGranted reports whether the browser will deliver desktop
// alerts. It is also the reason to keep the socket open while the tab hides.
export function notificationsGranted(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

// Request notification permission. Call this once at startup: the button owns
// its click handler, so repeated calls would stack listeners.
export function initNotifications(): void {
  if (notificationsGranted()) {
    notificationGranted = true;
    updateNotificationButton(true);
  } else if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
    updateNotificationButton(false);
  }
}

function updateNotificationButton(enabled: boolean): void {
  let btn = $('enable-notifications-btn');
  if (!btn) {
    // Create button in the header status-bar
    const statusBar = document.querySelector('.status-bar');
    if (!statusBar) return;
    btn = document.createElement('button');
    btn.id = 'enable-notifications-btn';
    btn.className = 'notification-toggle-btn';
    btn.addEventListener('click', requestPermission);
    statusBar.insertBefore(btn, statusBar.firstChild);
  }

  if (enabled) {
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      <span>Alerts On</span>
    `;
    btn.classList.add('enabled');
  } else {
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M13.73 21a2 2 0 01-3.46 0M18.02 8c0-1.55-.63-2.96-1.64-4M6.02 8c0-1.55.63-2.96 1.64-4M3 17h18M12 4v1" />
      </svg>
      <span>Enable Alerts</span>
    `;
    btn.classList.remove('enabled');
  }
}

function requestPermission(): void {
  if (typeof Notification !== 'undefined') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        notificationGranted = true;
        updateNotificationButton(true);
        new Notification('Server Dashboard', { body: 'Desktop notifications enabled!' });
      }
    });
  }
}

function triggerBrowserNotification(title: string, body: string): void {
  if (notificationGranted && document.hidden) {
    try {
      new Notification(title, {
        body: body,
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ff3333"%3E%3Cpath d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/%3E%3C/svg%3E',
      });
    } catch (err) {
      console.warn('Notification failed:', err);
    }
  }
}

export function checkAlerts(data?: DashboardState | null): void {
  if (!data) return;

  const currentAlerts: AlertItem[] = [];
  const currentKeys = new Set<string>();

  // 1. Check CPU Temperature (Thermal)
  if (data.thermal) {
    data.thermal.forEach((sensor) => {
      if (sensor.temp >= THRESHOLDS.temp.crit) {
        currentAlerts.push({
          key: `temp_${sensor.name}`,
          type: 'danger',
          message: `High temperature: ${sensor.name} is ${sensor.temp}°C`,
        });
        currentKeys.add(`temp_${sensor.name}`);
      }
    });
  }

  // 2. Check RAM usage
  if (data.memory && (data.memory.used_pct || 0) >= THRESHOLDS.mem.crit) {
    currentAlerts.push({
      key: 'ram_high',
      type: 'warning',
      message: `High RAM usage: ${(data.memory.used_pct || 0).toFixed(1)}%`,
    });
    currentKeys.add('ram_high');
  }

  // 3. Check Disk usage
  if (data.disk && (data.disk.used_pct || 0) >= THRESHOLDS.disk.crit) {
    currentAlerts.push({
      key: 'disk_high',
      type: 'warning',
      message: `High Disk usage: ${(data.disk.used_pct || 0).toFixed(1)}%`,
    });
    currentKeys.add('disk_high');
  }

  // 4. Check PM2 status
  if (data.pm2) {
    data.pm2.forEach(p => {
      if (p.status === 'errored') {
        currentAlerts.push({
          key: `pm2_error_${p.name}`,
          type: 'danger',
          message: `PM2 process errored: '${p.name}'`,
        });
        currentKeys.add(`pm2_error_${p.name}`);
      } else if (p.status === 'stopped') {
        currentAlerts.push({
          key: `pm2_stopped_${p.name}`,
          type: 'warning',
          message: `PM2 process stopped: '${p.name}'`,
        });
        currentKeys.add(`pm2_stopped_${p.name}`);
      }
    });
  }

  // 5. Check Internet connection
  if (data.internet && !data.internet.ok) {
    currentAlerts.push({
      key: 'internet_offline',
      type: 'danger',
      message: 'Server internet is Offline!',
    });
    currentKeys.add('internet_offline');
  }

  // Trigger web notifications for NEW alerts
  currentAlerts.forEach(alert => {
    if (!previousAlerts.has(alert.key)) {
      triggerBrowserNotification(
        'Server Alert',
        alert.message
      );
    }
  });

  previousAlerts = currentKeys;
  renderAlertsList(currentAlerts);
}

const ICON_CLOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function renderAlertsList(allAlerts: AlertItem[]): void {
  // Forget dismissals for alerts whose condition has cleared.
  const liveKeys = new Set(allAlerts.map(a => a.key));
  for (const key of Array.from(dismissedKeys)) {
    if (!liveKeys.has(key)) dismissedKeys.delete(key);
  }
  const alerts = allAlerts.filter(a => !dismissedKeys.has(a.key));
  let container = $('alerts-container');

  // No alerts active — remove container entirely
  if (alerts.length === 0) {
    if (container) container.remove();
    return;
  }

  // Create container if needed
  if (!container) {
    container = document.createElement('div');
    container.id = 'alerts-container';
    container.className = 'alerts-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-label', 'Alerts');
    document.body.appendChild(container);
  }

  // Collect keys of alerts that should be displayed
  const activeKeys = new Set(alerts.map(a => a.key));

  // Remove banners for alerts that no longer exist
  container.querySelectorAll<HTMLElement>('.alert-banner').forEach(banner => {
    if (!activeKeys.has(banner.dataset.alertKey || '')) {
      banner.remove();
    }
  });

  // Map of currently present banners in DOM
  const existingBanners = new Map<string, HTMLElement>();
  container.querySelectorAll<HTMLElement>('.alert-banner').forEach(b => {
    const key = b.dataset.alertKey;
    if (key) {
      existingBanners.set(key, b);
    }
  });

  alerts.forEach(a => {
    const existing = existingBanners.get(a.key);
    if (existing) {
      // Update existing banner safely with textContent
      existing.className = `alert-banner ${a.type}`;
      const msgEl = existing.querySelector('.alert-message');
      if (msgEl) {
        msgEl.textContent = a.message;
      }
      const iconEl = existing.querySelector('.alert-icon');
      if (iconEl) {
        iconEl.innerHTML = ALERT_ICONS[a.type];
      }
    } else {
      // Create new banner safely
      const banner = document.createElement('div');
      banner.className = `alert-banner ${a.type} entering`;
      banner.dataset.alertKey = a.key;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'alert-icon';
      iconSpan.innerHTML = ALERT_ICONS[a.type];

      const msgSpan = document.createElement('span');
      msgSpan.className = 'alert-message';
      msgSpan.textContent = a.message;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'alert-dismiss';
      closeBtn.setAttribute('aria-label', 'Dismiss alert');
      closeBtn.title = 'Dismiss';
      closeBtn.innerHTML = ICON_CLOSE;
      closeBtn.addEventListener('click', () => {
        dismissedKeys.add(a.key);
        banner.remove();
        const box = $('alerts-container');
        if (box && box.children.length === 0) box.remove();
      });

      banner.appendChild(iconSpan);
      banner.appendChild(msgSpan);
      banner.appendChild(closeBtn);
      container?.appendChild(banner);

      // Remove the 'entering' class after animation completes
      banner.addEventListener('animationend', () => {
        banner.classList.remove('entering');
      }, { once: true });
    }
  });
}
