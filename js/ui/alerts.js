import { $ } from '../utils/dom.js';

let notificationGranted = false;
let previousAlerts = new Set();

// Request notification permission
export function initNotifications() {
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      notificationGranted = true;
      updateNotificationButton(true);
    } else if (Notification.permission !== 'denied') {
      updateNotificationButton(false);
    }
  }
}

function updateNotificationButton(enabled) {
  let btn = $('enable-notifications-btn');
  if (!btn) {
    // Create button in the header status-bar
    const statusBar = document.querySelector('.status-bar');
    if (statusBar) {
      btn = document.createElement('button');
      btn.id = 'enable-notifications-btn';
      btn.className = 'notification-toggle-btn';
      statusBar.insertBefore(btn, statusBar.firstChild);
    }
  }

  if (btn) {
    if (enabled) {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        <span>Alerts On</span>
      `;
      btn.classList.add('enabled');
    } else {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13.73 21a2 2 0 01-3.46 0M18.02 8c0-1.55-.63-2.96-1.64-4M6.02 8c0-1.55.63-2.96 1.64-4M3 17h18M12 4v1" />
        </svg>
        <span>Enable Alerts</span>
      `;
      btn.classList.remove('enabled');
      btn.addEventListener('click', requestPermission);
    }
  }
}

function requestPermission() {
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        notificationGranted = true;
        updateNotificationButton(true);
        new Notification('Server Dashboard', { body: 'Desktop notifications enabled!' });
      }
    });
  }
}

function triggerBrowserNotification(title, body) {
  if (notificationGranted && document.hidden) {
    try {
      new Notification(title, {
        body: body,
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ff3333"%3E%3Cpath d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/%3E%3C/svg%3E'
      });
    } catch (err) {
      console.warn('Notification failed:', err);
    }
  }
}

export function checkAlerts(data) {
  if (!data) return;

  const currentAlerts = [];
  const currentKeys = new Set();

  // 1. Check CPU Temperature (Thermal)
  if (data.thermal) {
    Object.entries(data.thermal).forEach(([zone, temp]) => {
      if (temp > 80) {
        currentAlerts.push({
          key: `temp_${zone}`,
          type: 'danger',
          message: `High temperature: ${zone} is ${temp}°C`
        });
        currentKeys.add(`temp_${zone}`);
      }
    });
  }

  // 2. Check RAM usage
  if (data.memory && data.memory.used_pct > 95) {
    currentAlerts.push({
      key: 'ram_high',
      type: 'warning',
      message: `High RAM usage: ${data.memory.used_pct.toFixed(1)}%`
    });
    currentKeys.add('ram_high');
  }

  // 3. Check Disk usage
  if (data.disk && data.disk.used_pct > 95) {
    currentAlerts.push({
      key: 'disk_high',
      type: 'warning',
      message: `High Disk usage: ${data.disk.used_pct.toFixed(1)}%`
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
          message: `PM2 process errored: '${p.name}'`
        });
        currentKeys.add(`pm2_error_${p.name}`);
      } else if (p.status === 'stopped') {
        currentAlerts.push({
          key: `pm2_stopped_${p.name}`,
          type: 'warning',
          message: `PM2 process stopped: '${p.name}'`
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
      message: 'Server internet is Offline!'
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

function renderAlertsList(alerts) {
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
    document.body.appendChild(container);
  }

  // Collect keys of alerts that should be displayed
  const activeKeys = new Set(alerts.map(a => a.key));

  // Remove banners for alerts that no longer exist
  container.querySelectorAll('.alert-banner').forEach(banner => {
    if (!activeKeys.has(banner.dataset.alertKey)) {
      banner.remove();
    }
  });

  // Add banners for new alerts (ones not already in the DOM)
  const existingKeys = new Set(
    Array.from(container.querySelectorAll('.alert-banner')).map(b => b.dataset.alertKey)
  );

  alerts.forEach(a => {
    if (!existingKeys.has(a.key)) {
      const banner = document.createElement('div');
      banner.className = `alert-banner ${a.type} entering`;
      banner.dataset.alertKey = a.key;
      banner.innerHTML = `
        <span class="alert-icon">
          ${a.type === 'danger' ? '⚠️' : '🔔'}
        </span>
        <span class="alert-message">${a.message}</span>
      `;
      container.appendChild(banner);

      // Remove the 'entering' class after animation completes
      banner.addEventListener('animationend', () => {
        banner.classList.remove('entering');
      }, { once: true });
    }
  });
}
