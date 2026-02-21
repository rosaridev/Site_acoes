const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5 * 60 * 1000);
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(ALERTS_FILE); } catch { await fs.writeFile(ALERTS_FILE, '[]'); }
  try { await fs.access(NOTIFICATIONS_FILE); } catch { await fs.writeFile(NOTIFICATIONS_FILE, '[]'); }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

async function fetchCurrentPrice(symbol) {
  const normalized = symbol.toUpperCase().endsWith('.SA') ? symbol.toUpperCase() : `${symbol.toUpperCase()}.SA`;
  const apiUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(normalized)}`;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error('Erro ao consultar provedor de preços.');
  }

  const data = await response.json();
  const quote = data?.quoteResponse?.result?.[0];

  if (!quote || typeof quote.regularMarketPrice !== 'number') {
    throw new Error(`Não foi possível obter cotação para ${symbol}.`);
  }

  return {
    symbol: quote.symbol,
    name: quote.longName || quote.shortName || symbol.toUpperCase(),
    price: quote.regularMarketPrice,
    marketTime: quote.regularMarketTime,
  };
}

async function pushNotification(message, type = 'info') {
  const notifications = await readJson(NOTIFICATIONS_FILE);
  const item = { id: Date.now(), type, message, createdAt: new Date().toISOString() };
  notifications.unshift(item);
  await writeJson(NOTIFICATIONS_FILE, notifications.slice(0, 100));

  if (WEBHOOK_URL) {
    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
    } catch {
      // ignora erro de webhook
    }
  }
}

async function checkAlerts() {
  const alerts = await readJson(ALERTS_FILE);
  let changed = false;

  for (const alert of alerts) {
    try {
      const quote = await fetchCurrentPrice(alert.symbol);
      alert.lastPrice = quote.price;
      alert.lastCheckedAt = new Date().toISOString();

      if (!alert.triggered && Number(quote.price) <= Number(alert.targetPrice)) {
        alert.triggered = true;
        alert.triggeredAt = new Date().toISOString();
        await pushNotification(
          `🔔 ${alert.symbol}: preço ${quote.price.toFixed(2)} ficou <= alvo ${Number(alert.targetPrice).toFixed(2)}.`,
          'alert'
        );
      }

      changed = true;
    } catch (error) {
      await pushNotification(`Erro ao consultar ${alert.symbol}: ${error.message}`, 'error');
    }
  }

  if (changed) await writeJson(ALERTS_FILE, alerts);
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, file));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Acesso negado' });
    return;
  }

  try {
    const data = await fs.readFile(fullPath);
    res.writeHead(200, { 'Content-Type': contentType(fullPath) });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Arquivo não encontrado' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();

  try {
    if (req.method === 'GET' && pathname.startsWith('/api/quote/')) {
      const symbol = pathname.split('/').pop();
      const quote = await fetchCurrentPrice(symbol);
      return sendJson(res, 200, quote);
    }

    if (req.method === 'GET' && pathname === '/api/alerts') {
      return sendJson(res, 200, await readJson(ALERTS_FILE));
    }

    if (req.method === 'POST' && pathname === '/api/alerts') {
      const { symbol, targetPrice, email } = await parseBody(req);
      if (!symbol || !targetPrice) return sendJson(res, 400, { error: 'symbol e targetPrice são obrigatórios.' });

      const alerts = await readJson(ALERTS_FILE);
      const newAlert = {
        id: Date.now(),
        symbol: String(symbol).toUpperCase().replace('.SA', ''),
        targetPrice: Number(targetPrice),
        email: email || '',
        triggered: false,
        createdAt: new Date().toISOString(),
        lastPrice: null,
        lastCheckedAt: null,
      };
      alerts.unshift(newAlert);
      await writeJson(ALERTS_FILE, alerts);
      await pushNotification(`Novo alerta: ${newAlert.symbol} abaixo de R$ ${newAlert.targetPrice.toFixed(2)}.`, 'info');
      return sendJson(res, 201, newAlert);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/alerts/')) {
      const id = Number(pathname.split('/').pop());
      const alerts = await readJson(ALERTS_FILE);
      const filtered = alerts.filter((a) => a.id !== id);
      if (filtered.length === alerts.length) return sendJson(res, 404, { error: 'Alerta não encontrado.' });
      await writeJson(ALERTS_FILE, filtered);
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'POST' && pathname.startsWith('/api/alerts/') && pathname.endsWith('/rearm')) {
      const parts = pathname.split('/');
      const id = Number(parts[3]);
      const alerts = await readJson(ALERTS_FILE);
      const alert = alerts.find((a) => a.id === id);
      if (!alert) return sendJson(res, 404, { error: 'Alerta não encontrado.' });
      alert.triggered = false;
      alert.triggeredAt = null;
      await writeJson(ALERTS_FILE, alerts);
      return sendJson(res, 200, alert);
    }

    if (req.method === 'GET' && pathname === '/api/notifications') {
      return sendJson(res, 200, await readJson(NOTIFICATIONS_FILE));
    }

    if (req.method === 'POST' && pathname === '/api/check-now') {
      await checkAlerts();
      return sendJson(res, 200, { ok: true });
    }

    if (!pathname.startsWith('/api/')) {
      return serveStatic(req, res, pathname);
    }

    return sendJson(res, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
});

ensureDataFiles().then(async () => {
  await checkAlerts();
  setInterval(checkAlerts, POLL_INTERVAL_MS);
  server.listen(PORT, () => {
    console.log(`Servidor em http://localhost:${PORT}`);
  });
});
