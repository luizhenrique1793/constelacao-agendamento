# Constelação — agendamento

Página pública, responsiva e acessível para agendar sessões de Constelação com Katia Melo. A aplicação consulta e cria horários pelo workflow n8n já existente, sempre a partir de uma rota interna do servidor.

## Executar localmente

Requer Node.js 18 ou superior.

```powershell
$env:N8N_KATIA_AGENDA_URL = 'https://n8n.automaleads.cloud/webhook/katia_agenda'
npm start
```

Abra `http://localhost:3000`. A URL do webhook é lida somente no servidor pela variável `N8N_KATIA_AGENDA_URL`; use `.env.example` como referência para a configuração no ambiente de deploy. Não há credenciais ou URL do n8n no JavaScript entregue ao navegador.

## Arquitetura

- `public/`: página e experiência de agendamento sem dependências externas.
- `POST /api/agendamento`: valida ação, data, dia da semana, horário, duração, nome e telefone; então encaminha a solicitação ao n8n com timeout de 12 segundos.
- O browser nunca chama o n8n diretamente. As verificações dos dois horários são paralelas, e o fluxo de criação é revalidado pelo workflow antes de confirmar.

Os únicos horários aceitos são terça ou quinta-feira futura, `14:30–15:30` e `15:30–16:30`, sempre em `America/Sao_Paulo` (`-03:00`).

## Testes e validações

```powershell
npm test
npm run lint
npm run typecheck
```

## Teste manual

1. Inicie o servidor e escolha uma terça ou quinta futura no calendário. A página fará duas chamadas de `consultar` para `/api/agendamento` e mostrará o resultado de cada horário.
2. Escolha um horário disponível, preencha nome e WhatsApp e confirme. A página fará a chamada `agendar` e exibirá a confirmação apenas quando o n8n retornar `status: "agendado"`.
3. Para testar conflito, mantenha a página aberta após a consulta e ocupe o mesmo horário por outra sessão/cliente. Ao confirmar, uma resposta `status: "horario_ocupado"` mostra o aviso e consulta a data novamente, permitindo escolher o outro horário se estiver livre.

## Deploy no Easypanel

O projeto inclui um `Dockerfile` e pode ser publicado diretamente a partir do repositório GitHub.

1. Crie um serviço **App** no Easypanel e conecte o repositório e a branch desejada.
2. Selecione **Dockerfile** como método de build. A porta interna é `3000`.
3. Em **Environment variables**, adicione `N8N_KATIA_AGENDA_URL` com a URL de produção do webhook n8n. Essa variável é privada e não deve receber prefixo público.
4. Configure o domínio, habilite HTTPS e publique.

O health check do container verifica `GET /`. Após o deploy, faça um teste completo de consulta e um agendamento real no domínio público.
