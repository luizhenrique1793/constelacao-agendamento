const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_URL = process.env.N8N_KATIA_AGENDA_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const N8N_ADMIN_SECRET = process.env.N8N_ADMIN_SECRET;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 50 * 1024;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dayOfWeek(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function validAppointment(payload) {
  if (!payload || typeof payload !== 'object' || !['consultar', 'agendar'].includes(payload.acao)) {
    return { valid: false };
  }

  const match = typeof payload.inicio === 'string'
    ? payload.inicio.match(/^(\d{4}-\d{2}-\d{2})T(14:30|15:30):00-03:00$/)
    : null;
  const endMatch = typeof payload.fim === 'string'
    ? payload.fim.match(/^(\d{4}-\d{2}-\d{2})T(15:30|16:30):00-03:00$/)
    : null;
  if (!match || !endMatch || match[1] !== endMatch[1]) return { valid: false };

  const [date, start] = [match[1], match[2]];
  const expectedEnd = start === '14:30' ? '15:30' : '16:30';
  const parsedDate = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsedDate.valueOf()) || dayOfWeek(date) !== 2 && dayOfWeek(date) !== 4 || date <= saoPauloDate() || endMatch[2] !== expectedEnd) {
    return { valid: false };
  }

  const nome = typeof payload.nome === 'string' ? payload.nome.trim().replace(/\s+/g, ' ') : '';
  const telefone = typeof payload.telefone === 'string' ? payload.telefone.replace(/\D/g, '') : '';
  if (payload.acao === 'agendar' && (nome.length < 3 || telefone.length < 10 || telefone.length > 13)) {
    return { valid: false };
  }

  return {
    valid: true,
    payload: { acao: payload.acao, inicio: payload.inicio, fim: payload.fim, nome, telefone },
  };
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function adminIsConfigured() {
  return Boolean(ADMIN_PASSWORD && ADMIN_SESSION_SECRET && N8N_ADMIN_SECRET);
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie || '';
  const prefix = `${name}=`;
  const item = cookies.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

function sessionSignature(expiresAt) {
  return crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(`katia-admin:${expiresAt}`).digest('base64url');
}

function validAdminSession(request) {
  if (!adminIsConfigured()) return false;
  const [expiresAt, signature] = cookieValue(request, 'katia_admin').split('.');
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now() || !signature) return false;
  const expected = sessionSignature(expiresAt);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function setAdminCookie(response, expiresAt) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = `katia_admin=${encodeURIComponent(`${expiresAt}.${sessionSignature(expiresAt)}`)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
  response.setHeader('Set-Cookie', cookie);
}

function clearAdminCookie(response) {
  response.setHeader('Set-Cookie', 'katia_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) reject(new Error('body_too_large'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid_json')); }
    });
    request.on('error', reject);
  });
}

async function handleAppointment(request, response) {
  if (!WEBHOOK_URL) {
    console.error('N8N_KATIA_AGENDA_URL não foi configurada no servidor.');
    return json(response, 503, { sucesso: false, mensagem: 'O agendamento está temporariamente indisponível. Tente novamente mais tarde.' });
  }
  let body;
  try { body = await readJson(request); } catch { return json(response, 400, { sucesso: false, mensagem: 'Solicitação inválida.' }); }
  const checked = validAppointment(body);
  if (!checked.valid) return json(response, 400, { sucesso: false, mensagem: 'Dados de agendamento inválidos.' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const upstream = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(checked.payload),
      signal: controller.signal,
    });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.includes('application/json')) throw new Error('invalid_upstream_response');
    const result = await upstream.json();
    if (!result || typeof result !== 'object') throw new Error('invalid_upstream_response');
    return json(response, 200, result);
  } catch (error) {
    // Mantém detalhes fora da resposta pública, mas permite diagnosticar falhas de conexão no servidor.
    console.error('Falha ao comunicar com a agenda n8n:', {
      acao: checked.payload.acao,
      erro: error?.cause?.code || error?.name || 'erro_desconhecido',
      mensagem: error?.message,
    });
    return json(response, 502, {
      sucesso: false,
      mensagem: checked.payload.acao === 'consultar'
        ? 'Não foi possível consultar a agenda agora. Tente novamente em alguns instantes.'
        : 'Não foi possível concluir seu agendamento. Tente novamente.',
    });
  } finally {
    clearTimeout(timer);
  }
}

function validAdminPayload(payload) {
  if (!payload || !['admin_consultar', 'admin_bloquear', 'admin_liberar'].includes(payload.acao)) return null;
  const checked = validAppointment({ ...payload, acao: 'consultar', nome: '', telefone: '' });
  if (!checked.valid) return null;
  return { acao: payload.acao, inicio: checked.payload.inicio, fim: checked.payload.fim };
}

async function sendToN8n(payload, admin = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (admin) headers['X-Admin-Secret'] = N8N_ADMIN_SECRET;
    const upstream = await fetch(WEBHOOK_URL, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.includes('application/json')) throw new Error('invalid_upstream_response');
    const result = await upstream.json();
    if (!result || typeof result !== 'object') throw new Error('invalid_upstream_response');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function handleAdminLogin(request, response) {
  if (!adminIsConfigured()) return json(response, 503, { sucesso: false, mensagem: 'O painel administrativo não está configurado.' });
  let body;
  try { body = await readJson(request); } catch { return json(response, 400, { sucesso: false, mensagem: 'Solicitação inválida.' }); }
  const password = typeof body.senha === 'string' ? body.senha : '';
  const expected = Buffer.from(ADMIN_PASSWORD);
  const actual = Buffer.from(password);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return json(response, 401, { sucesso: false, mensagem: 'Senha incorreta.' });
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  setAdminCookie(response, expiresAt);
  return json(response, 200, { sucesso: true });
}

async function handleAdminAction(request, response) {
  if (!adminIsConfigured()) return json(response, 503, { sucesso: false, mensagem: 'O painel administrativo não está configurado.' });
  if (!validAdminSession(request)) return json(response, 401, { sucesso: false, mensagem: 'Sua sessão expirou. Entre novamente.' });
  if (!WEBHOOK_URL) return json(response, 503, { sucesso: false, mensagem: 'A agenda está temporariamente indisponível.' });
  let body;
  try { body = await readJson(request); } catch { return json(response, 400, { sucesso: false, mensagem: 'Solicitação inválida.' }); }
  const payload = validAdminPayload(body);
  if (!payload) return json(response, 400, { sucesso: false, mensagem: 'Dados do horário inválidos.' });
  try {
    return json(response, 200, await sendToN8n(payload, true));
  } catch (error) {
    console.error('Falha ao comunicar com a administração n8n:', { acao: payload.acao, erro: error?.cause?.code || error?.name, mensagem: error?.message });
    return json(response, 502, { sucesso: false, mensagem: 'Não foi possível atualizar a agenda agora. Tente novamente.' });
  }
}

function serveStatic(request, response) {
  const urlPath = request.url === '/' ? '/index.html' : request.url === '/admin' ? '/admin.html' : request.url;
  const safePath = path.normalize(urlPath).replace(/^([.]{2}[\\/])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { response.writeHead(403); return response.end(); }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
  fs.readFile(filePath, (error, file) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); return response.end(); }
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    response.end(file);
  });
}

function createServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'POST' && request.url === '/api/agendamento') return handleAppointment(request, response);
    if (request.method === 'POST' && pathname === '/api/admin/login') return handleAdminLogin(request, response);
    if (request.method === 'POST' && pathname === '/api/admin/agenda') return handleAdminAction(request, response);
    if (request.method === 'POST' && pathname === '/api/admin/logout') { clearAdminCookie(response); return json(response, 200, { sucesso: true }); }
    if (request.method === 'GET') return serveStatic(request, response);
    response.writeHead(405, { Allow: 'GET, POST' });
    response.end();
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`Agendamento disponível em http://localhost:${PORT}`));
}

module.exports = { createServer, validAppointment, saoPauloDate };
