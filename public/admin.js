const loginSection = document.querySelector('#admin-login');
const panelSection = document.querySelector('#admin-panel');
const loginForm = document.querySelector('#login-form');
const passwordInput = document.querySelector('#admin-password');
const loginError = document.querySelector('#login-error');
const datesElement = document.querySelector('#admin-dates');
const slotsElement = document.querySelector('#admin-slots');
const dateLabel = document.querySelector('#admin-date-label');
const statusElement = document.querySelector('#admin-status');
let selectedDate = null;
let loading = false;
const times = ['14:30', '15:30'];
const formatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' });

function saoPauloToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const data = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${data.year}-${data.month}-${data.day}`;
}
function dateObject(date) { return new Date(`${date}T12:00:00-03:00`); }
function humanDate(date) { const value = formatter.format(dateObject(date)); return value.charAt(0).toUpperCase() + value.slice(1); }
function interval(date, time) { return { inicio: `${date}T${time}:00-03:00`, fim: `${date}T${time === '14:30' ? '15:30' : '16:30'}:00-03:00` }; }
function nextDates() {
  const output = []; const start = saoPauloToday(); const cursor = new Date(`${start}T12:00:00-03:00`);
  for (let offset = 1; output.length < 12 && offset < 80; offset += 1) {
    const candidate = new Date(cursor.getTime() + offset * 86400000); const weekday = candidate.getUTCDay();
    if ([2, 4].includes(weekday)) output.push(candidate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  }
  return output;
}
async function api(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.mensagem || 'Não foi possível concluir a ação.'); error.status = response.status; throw error; }
  return data;
}
function showStatus(message) { statusElement.hidden = !message; statusElement.textContent = message || ''; }
function renderDates() {
  datesElement.replaceChildren();
  nextDates().forEach((date) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `admin-date${date === selectedDate ? ' is-selected' : ''}`;
    const day = dateObject(date);
    button.innerHTML = `<strong>${String(day.getUTCDate()).padStart(2, '0')}</strong><span>${day.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', '')}</span>`;
    button.setAttribute('aria-label', humanDate(date)); button.addEventListener('click', () => { selectedDate = date; renderDates(); loadSlots(); }); datesElement.append(button);
  });
}
function renderSlots(states = {}) {
  slotsElement.replaceChildren();
  times.forEach((time) => {
    const state = states[time] || 'loading';
    const card = document.createElement('article'); card.className = `admin-slot admin-slot--${state}`;
    const label = { loading: 'Consultando...', disponivel: 'Disponível', bloqueado: 'Bloqueado por você', ocupado: 'Agendado por cliente' }[state] || 'Indisponível';
    card.innerHTML = `<div><strong>${time}</strong><span>${label}</span></div>`;
    if (state === 'disponivel' || state === 'bloqueado') {
      const button = document.createElement('button'); button.type = 'button'; button.className = state === 'disponivel' ? 'admin-block' : 'admin-release';
      button.textContent = state === 'disponivel' ? 'Bloquear horário' : 'Liberar horário';
      button.disabled = loading; button.addEventListener('click', () => changeSlot(time, state === 'disponivel' ? 'admin_bloquear' : 'admin_liberar'));
      card.append(button);
    }
    slotsElement.append(card);
  });
}
async function loadSlots() {
  if (!selectedDate || loading) return; loading = true; showStatus('Consultando a agenda...'); dateLabel.textContent = humanDate(selectedDate); renderSlots();
  try {
    const answers = await Promise.all(times.map(async (time) => [time, await api('/api/admin/agenda', { acao: 'admin_consultar', ...interval(selectedDate, time) })]));
    const states = Object.fromEntries(answers.map(([time, answer]) => [time, answer.status])); renderSlots(states); showStatus('');
  } catch (error) {
    if (error.status === 401) return logout(true);
    showStatus(error.message); renderSlots({ '14:30': 'erro', '15:30': 'erro' });
  } finally { loading = false; }
}
async function changeSlot(time, action) {
  if (loading) return; loading = true; showStatus(action === 'admin_bloquear' ? 'Bloqueando horário...' : 'Liberando horário...'); renderSlots();
  try { await api('/api/admin/agenda', { acao: action, ...interval(selectedDate, time) }); await loadSlotsAfterAction(); }
  catch (error) {
    if (error.status === 401) return logout(true);
    const message = error.message;
    loading = false;
    await loadSlots();
    showStatus(message);
  }
}
async function loadSlotsAfterAction() { loading = false; await loadSlots(); }
function openPanel() { loginSection.hidden = true; panelSection.hidden = false; selectedDate = nextDates()[0]; renderDates(); loadSlots(); }
function logout(expired = false) { panelSection.hidden = true; loginSection.hidden = false; passwordInput.value = ''; loginError.textContent = expired ? 'Sua sessão expirou. Entre novamente.' : ''; if (!expired) api('/api/admin/logout').catch(() => {}); }
loginForm.addEventListener('submit', async (event) => { event.preventDefault(); loginError.textContent = ''; try { await api('/api/admin/login', { senha: passwordInput.value }); openPanel(); } catch (error) { loginError.textContent = error.message; } });
document.querySelector('#logout').addEventListener('click', () => logout());
document.querySelector('#refresh-slots').addEventListener('click', loadSlots);
