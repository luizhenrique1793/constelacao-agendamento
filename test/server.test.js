const test = require('node:test');
const assert = require('node:assert/strict');
const { validAppointment } = require('../server');

function nextAllowedDate() {
  const date = new Date();
  for (let offset = 1; offset < 15; offset += 1) {
    const candidate = new Date(date.getTime() + offset * 86400000);
    if ([2, 4].includes(candidate.getUTCDay())) return candidate.toISOString().slice(0, 10);
  }
}

function appointment(overrides = {}) {
  const date = nextAllowedDate();
  return { acao: 'agendar', inicio: `${date}T14:30:00-03:00`, fim: `${date}T15:30:00-03:00`, nome: 'Maria Oliveira', telefone: '5544999999999', ...overrides };
}

test('aceita uma sessão futura válida em terça ou quinta', () => assert.equal(validAppointment(appointment()).valid, true));
test('rejeita horário fora da agenda', () => assert.equal(validAppointment(appointment({ inicio: `${nextAllowedDate()}T10:00:00-03:00` })).valid, false));
test('rejeita duração diferente de uma hora', () => assert.equal(validAppointment(appointment({ fim: `${nextAllowedDate()}T16:30:00-03:00` })).valid, false));
test('rejeita ausência de dados ao agendar', () => assert.equal(validAppointment(appointment({ nome: '', telefone: '' })).valid, false));
test('permite consulta sem nome e telefone', () => assert.equal(validAppointment(appointment({ acao: 'consultar', nome: '', telefone: '' })).valid, true));
