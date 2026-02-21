const alertForm = document.getElementById('alertForm');
const alertsEl = document.getElementById('alerts');
const notificationsEl = document.getElementById('notifications');
const checkNowBtn = document.getElementById('checkNow');

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro inesperado' }));
    throw new Error(error.error || 'Erro inesperado');
  }

  if (response.status === 204) return null;
  return response.json();
}

function fmtMoney(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function loadAlerts() {
  const alerts = await api('/api/alerts');
  alertsEl.innerHTML = alerts.length
    ? alerts
        .map(
          (a) => `
      <div class="item">
        <div>
          <strong>${a.symbol}</strong> <span class="badge">alvo ${fmtMoney(a.targetPrice)}</span>
          <div class="small">Último preço: ${a.lastPrice ? fmtMoney(a.lastPrice) : '—'} | Última checagem: ${a.lastCheckedAt ? new Date(a.lastCheckedAt).toLocaleString('pt-BR') : '—'}</div>
          <div class="small">Status: ${a.triggered ? '✅ Disparado' : '⏳ Aguardando'}</div>
        </div>
        <div>
          ${a.triggered ? `<button onclick="rearm(${a.id})">Rearmar</button>` : ''}
          <button class="danger" onclick="removeAlert(${a.id})">Excluir</button>
        </div>
      </div>`
        )
        .join('')
    : '<div class="small">Nenhum alerta cadastrado.</div>';
}

async function loadNotifications() {
  const notifications = await api('/api/notifications');
  notificationsEl.innerHTML = notifications.length
    ? notifications
        .map(
          (n) => `<div class="item"><div>${n.message}<div class="small">${new Date(n.createdAt).toLocaleString('pt-BR')}</div></div></div>`
        )
        .join('')
    : '<div class="small">Sem notificações por enquanto.</div>';

  if (document.visibilityState === 'visible' && Notification.permission === 'granted' && notifications[0]) {
    const latest = notifications[0];
    if (!window.lastNotificationId || latest.id > window.lastNotificationId) {
      window.lastNotificationId = latest.id;
      new Notification('Alerta B3', { body: latest.message });
    }
  }
}

alertForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    symbol: document.getElementById('symbol').value.trim(),
    targetPrice: Number(document.getElementById('targetPrice').value),
    email: document.getElementById('email').value.trim(),
  };

  try {
    await api('/api/alerts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    alertForm.reset();
    await Promise.all([loadAlerts(), loadNotifications()]);
  } catch (error) {
    alert(error.message);
  }
});

checkNowBtn.addEventListener('click', async () => {
  await api('/api/check-now', { method: 'POST' });
  await Promise.all([loadAlerts(), loadNotifications()]);
});

async function removeAlert(id) {
  await api(`/api/alerts/${id}`, { method: 'DELETE' });
  await loadAlerts();
}

async function rearm(id) {
  await api(`/api/alerts/${id}/rearm`, { method: 'POST' });
  await loadAlerts();
}

window.removeAlert = removeAlert;
window.rearm = rearm;

async function init() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  await Promise.all([loadAlerts(), loadNotifications()]);
  setInterval(() => {
    loadAlerts();
    loadNotifications();
  }, 15000);
}

init();
