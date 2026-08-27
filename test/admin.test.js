process.env.ADMIN_PASSWORD = 'senha-de-teste';
process.env.ADMIN_SESSION_SECRET = 'sessao-de-teste-segreda';
process.env.N8N_ADMIN_SECRET = 'n8n-de-teste';
process.env.N8N_KATIA_AGENDA_URL = 'https://n8n.example.test/webhook';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await run(origin); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('serve o painel administrativo em /admin', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/admin`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Gerencie a agenda/);
  });
});

test('exige senha e cria sessão administrativa', async () => {
  await withServer(async (origin) => {
    const denied = await fetch(`${origin}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: 'incorreta' }) });
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${origin}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: 'senha-de-teste' }) });
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get('set-cookie'), /HttpOnly/);
  });
});
