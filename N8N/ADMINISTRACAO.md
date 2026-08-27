# Extensão segura do workflow existente

Esta extensão adiciona administração ao workflow `Katia Melo | Agenda Google Calendar` sem alterar os caminhos existentes de `consultar` e `agendar`.

## Antes de editar

1. Duplique o workflow atual dentro do n8n como backup.
2. No serviço do **n8n** no Easypanel, abra **Variáveis de Ambiente** e crie `KATIA_ADMIN_SECRET` com um valor longo e aleatório. Salve e faça redeploy do serviço n8n.
3. No serviço do site de agendamento, configure o mesmo valor em `N8N_ADMIN_SECRET`.

O segredo é enviado pelo site apenas no cabeçalho `X-Admin-Secret`. Não o coloque no JavaScript, no corpo da requisição ou em nós públicos.

## Novas ações esperadas

Todas recebem `inicio` e `fim` no mesmo formato já usado no workflow atual.

| Ação | Resposta esperada |
| --- | --- |
| `admin_consultar` | `{ "sucesso": true, "status": "disponivel" \| "bloqueado" \| "ocupado" }` |
| `admin_bloquear` | `{ "sucesso": true, "status": "bloqueado" }` |
| `admin_liberar` | `{ "sucesso": true, "status": "disponivel" }` |

## Roteamento e autorização

No nó **Qual ação?**, preserve as duas primeiras saídas atuais e acrescente as ações administrativas. A expressão deve enviar `consultar` para a saída 0, `agendar` para a saída 1, `admin_consultar` para 2, `admin_bloquear` para 3, `admin_liberar` para 4 e qualquer outra ação para a última saída de erro.

Conecte as três saídas administrativas a um nó **If** chamado `Autorizar administração`:

- valor da esquerda: `={{ $json.headers['x-admin-secret'] || '' }}`
- operador: `equals`
- valor da direita: `={{ $env.KATIA_ADMIN_SECRET }}`

A saída falsa deve responder HTTP 401. Somente a saída verdadeira segue para os nós administrativos.

## Como identificar bloqueios

Todo bloqueio criado pelo painel deve usar exatamente:

```text
Summary: BLOQUEIO ADMIN | Constelação
Description: Bloqueio criado pelo painel administrativo da Katia Melo.
Show me as: Opaque
```

Esse marcador é essencial: o fluxo só pode excluir eventos cujo resumo começa com `BLOQUEIO ADMIN |`. Nunca remova eventos de clientes, que usam o resumo `Constelação | ...`.

## Implementação de cada ação

### admin_consultar

Busque eventos do calendário no intervalo `inicio`/`fim` recebido. Use um nó Google Calendar de leitura de eventos, não o modo `availability`.

- sem evento: responda `disponivel`;
- com ao menos um evento cujo resumo começa com `BLOQUEIO ADMIN |`: responda `bloqueado`;
- qualquer outro evento: responda `ocupado`.

### admin_bloquear

Primeiro reutilize a mesma lógica de disponibilidade que já existe para `agendar`. Se estiver ocupado, responda HTTP 409 e não crie nada. Se estiver livre, crie o evento com o marcador acima, utilizando `inicio` e `fim` do webhook, e responda `bloqueado`.

### admin_liberar

Busque eventos no intervalo recebido, filtre exclusivamente os eventos com resumo iniciado em `BLOQUEIO ADMIN |` e exclua-os pelo ID. Se não encontrar um bloqueio, responda HTTP 409. Depois da exclusão, responda `disponivel`.

## Teste seguro

1. Acesse `https://seu-dominio/admin` e entre com `ADMIN_PASSWORD`.
2. Escolha um horário livre e bloqueie-o.
3. Na página pública, atualize a data: o horário deve aparecer indisponível.
4. Volte ao painel e libere-o. Ele deve voltar a ficar disponível.
5. Nunca use o botão de liberar em um horário marcado como `Ocupado`; o painel já bloqueia essa ação.
