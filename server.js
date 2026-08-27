const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_URL = process.env.N8N_KATIA_AGENDA_URL;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 50 * 1024;

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

function serveStatic(request, response) {
  const urlPath = request.url === '/' ? '/index.html' : request.url;
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
    if (request.method === 'POST' && request.url === '/api/agendamento') return handleAppointment(request, response);
    if (request.method === 'GET') return serveStatic(request, response);
    response.writeHead(405, { Allow: 'GET, POST' });
    response.end();
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`Agendamento disponível em http://localhost:${PORT}`));
}

module.exports = { createServer, validAppointment, saoPauloDate };
