const slots = ['14:30', '15:30'];
const slotButtons = [...document.querySelectorAll('.slot')];
const calendarDays = document.querySelector('#calendar-days');
const monthLabel = document.querySelector('#month-label');
const previousMonth = document.querySelector('#previous-month');
const nextMonth = document.querySelector('#next-month');
const timeStep = document.querySelector('#time-step');
const detailsStep = document.querySelector('#details-step');
const timeDescription = document.querySelector('#time-description');
const availabilityMessage = document.querySelector('#availability-message');
const retry = document.querySelector('#retry');
const form = document.querySelector('#booking-form');
const nameInput = document.querySelector('#name');
const phoneInput = document.querySelector('#phone');
const summary = document.querySelector('#summary');
const submitButton = document.querySelector('#submit');
const success = document.querySelector('#success');

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' });
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', month: 'long', year: 'numeric' });
let selectedDate = null;
let selectedTime = null;
let checking = false;
let submitting = false;
let availabilityRequest = 0;

function saoPauloToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const today = saoPauloToday();
const [initialYear, initialMonth] = today.split('-').map(Number);
let displayYear = initialYear;
let displayMonth = initialMonth - 1;

function dateString(year, month, day) { return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function dateObject(value) { return new Date(`${value}T12:00:00-03:00`); }
function isAllowedDate(value) { const weekday = dateObject(value).getUTCDay(); return value > today && (weekday === 2 || weekday === 4); }
function readableDate(value) { const text = dateFormatter.format(dateObject(value)); return text.charAt(0).toUpperCase() + text.slice(1); }
function intervalFor(time) { return { inicio: `${selectedDate}T${time}:00-03:00`, fim: `${selectedDate}T${time === '14:30' ? '15:30' : '16:30'}:00-03:00` }; }

function renderCalendar() {
  // Meio-dia UTC evita que o fuso de São Paulo transforme o primeiro dia no mês anterior.
  monthLabel.textContent = monthFormatter.format(new Date(Date.UTC(displayYear, displayMonth, 1, 12)));
  previousMonth.disabled = displayYear === initialYear && displayMonth === initialMonth - 1;
  calendarDays.replaceChildren();
  const firstDay = new Date(Date.UTC(displayYear, displayMonth, 1)).getUTCDay();
  const monthLength = new Date(Date.UTC(displayYear, displayMonth + 1, 0)).getUTCDate();
  for (let index = 0; index < firstDay; index += 1) calendarDays.append(document.createElement('span'));
  for (let day = 1; day <= monthLength; day += 1) {
    const value = dateString(displayYear, displayMonth, day);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'day'; button.textContent = String(day);
    button.disabled = !isAllowedDate(value);
    button.setAttribute('aria-label', readableDate(value));
    button.setAttribute('aria-pressed', String(value === selectedDate));
    if (value === selectedDate) button.classList.add('is-selected');
    button.addEventListener('click', () => chooseDate(value));
    calendarDays.append(button);
  }
}

function setSlots(state) {
  slotButtons.forEach((button) => {
    const value = button.dataset.time;
    const status = state[value] || 'disabled';
    button.className = `slot${status === 'busy' ? ' is-busy' : ''}${status === 'error' ? ' is-error' : ''}${selectedTime === value ? ' is-selected' : ''}`;
    button.disabled = status !== 'available';
    button.querySelector('small').textContent = ({ loading: 'Verificando...', available: 'Disponível', busy: 'Indisponível', error: 'Erro ao consultar', disabled: 'Escolha uma data' })[status];
  });
}

async function postBooking(payload) {
  const response = await fetch('/api/agendamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let result;
  try { result = await response.json(); } catch { throw new Error('invalid_response'); }
  if (!response.ok) throw new Error('request_failed');
  return result;
}

async function checkAvailability() {
  if (!selectedDate || checking) return;
  const requestId = ++availabilityRequest;
  checking = true; selectedTime = null; setSlots({ '14:30': 'loading', '15:30': 'loading' });
  timeStep.classList.remove('is-muted'); detailsStep.classList.add('is-muted');
  timeDescription.textContent = `Verificando horários para ${readableDate(selectedDate)}...`;
  availabilityMessage.hidden = false; availabilityMessage.textContent = 'Verificando horários disponíveis...'; retry.hidden = true;
  disableDetails();
  const results = await Promise.all(slots.map(async (time) => {
    try {
      const result = await postBooking({ acao: 'consultar', ...intervalFor(time), nome: '', telefone: '' });
      return [time, result.sucesso === true && result.disponivel === true ? 'available' : 'busy'];
    } catch { return [time, 'error']; }
  }));
  if (requestId !== availabilityRequest) return;
  const states = Object.fromEntries(results); setSlots(states); checking = false;
  const errors = Object.values(states).filter((state) => state === 'error').length;
  const available = Object.values(states).filter((state) => state === 'available').length;
  if (errors) { availabilityMessage.textContent = 'Não foi possível consultar a agenda agora. Tente novamente em alguns instantes.'; retry.hidden = false; }
  else if (!available) availabilityMessage.textContent = 'Não temos mais horários disponíveis nesta data. Escolha outra terça ou quinta para continuar.';
  else { availabilityMessage.hidden = true; }
  timeDescription.textContent = `Horários para ${readableDate(selectedDate)}.`;
}

function chooseDate(value) { selectedDate = value; selectedTime = null; renderCalendar(); checkAvailability(); }
function chooseTime(time) { selectedTime = time; setSlots(Object.fromEntries(slotButtons.map((button) => [button.dataset.time, button.disabled ? 'busy' : 'available']))); detailsStep.classList.remove('is-muted'); nameInput.disabled = false; phoneInput.disabled = false; submitButton.disabled = false; updateSummary(); nameInput.focus(); }
function disableDetails() { nameInput.disabled = true; phoneInput.disabled = true; submitButton.disabled = true; summary.hidden = true; }
function updateSummary() { if (!selectedDate || !selectedTime) return; summary.innerHTML = `<strong>Constelação com Katia Melo</strong><span>${readableDate(selectedDate)}</span><span>${selectedTime} às ${selectedTime === '14:30' ? '15:30' : '16:30'}</span>`; summary.hidden = false; }
function phoneDigits() { return phoneInput.value.replace(/\D/g, '').slice(0, 11); }
function formatPhone(value) { const digits = value.replace(/\D/g, '').slice(0, 11); if (digits.length <= 2) return digits ? `(${digits}` : ''; if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`; return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length <= 10 ? 6 : 7)}-${digits.slice(digits.length <= 10 ? 6 : 7)}`; }
function showFieldError(input, id, message) { input.setAttribute('aria-invalid', String(Boolean(message))); document.querySelector(id).textContent = message || ''; }

slotButtons.forEach((button) => button.addEventListener('click', () => chooseTime(button.dataset.time)));
previousMonth.addEventListener('click', () => { displayMonth -= 1; if (displayMonth < 0) { displayMonth = 11; displayYear -= 1; } renderCalendar(); });
nextMonth.addEventListener('click', () => { displayMonth += 1; if (displayMonth > 11) { displayMonth = 0; displayYear += 1; } renderCalendar(); });
retry.addEventListener('click', checkAvailability);
phoneInput.addEventListener('input', () => { phoneInput.value = formatPhone(phoneInput.value); });

form.addEventListener('submit', async (event) => {
  event.preventDefault(); if (submitting || !selectedDate || !selectedTime) return;
  const name = nameInput.value.trim().replace(/\s+/g, ' '); const phone = phoneDigits();
  const nameError = name.length < 3 ? 'Informe seu nome completo.' : '';
  const phoneError = !/^\d{10,11}$/.test(phone) ? 'Informe um WhatsApp válido com DDD.' : '';
  showFieldError(nameInput, '#name-error', nameError); showFieldError(phoneInput, '#phone-error', phoneError);
  if (nameError || phoneError) return;
  submitting = true; submitButton.disabled = true; submitButton.textContent = 'Confirmando...'; document.querySelector('#form-error').hidden = true;
  try {
    const result = await postBooking({ acao: 'agendar', ...intervalFor(selectedTime), nome: name, telefone: `55${phone}` });
    if (result.sucesso === true && result.status === 'agendado') {
      document.querySelector('.booking-card').hidden = true;
      success.hidden = false; success.innerHTML = `<div class="success-mark">✓</div><h2>Agendamento confirmado!</h2><p>Sua Constelação com Katia Melo foi agendada para ${readableDate(selectedDate)}, às ${selectedTime}.</p>`;
      const whatsappMessage = encodeURIComponent(`Oi, Katia! Acabei de confirmar meu agendamento de Constelação para ${readableDate(selectedDate)}, às ${selectedTime}.`);
      success.innerHTML += `<a class="whatsapp-button" href="https://wa.me/5544988122353?text=${whatsappMessage}" target="_blank" rel="noopener noreferrer">Confirmar pelo WhatsApp</a>`;
      success.focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
    }
    if (result.status === 'horario_ocupado') {
      document.querySelector('#form-error').textContent = 'Este horário acabou de ficar indisponível. Escolha outro horário para continuar.';
      document.querySelector('#form-error').hidden = false; await checkAvailability(); return;
    }
    throw new Error('booking_failed');
  } catch {
    document.querySelector('#form-error').textContent = 'Não foi possível concluir seu agendamento. Tente novamente.';
    document.querySelector('#form-error').hidden = false;
  } finally { submitting = false; submitButton.disabled = !selectedTime; submitButton.textContent = 'Confirmar agendamento'; }
});

renderCalendar();
