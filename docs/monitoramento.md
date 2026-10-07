# Monitoramento: erros e disponibilidade

Origem: TS-540. São duas peças que se complementam:

| Pergunta | Quem responde | Onde |
|---|---|---|
| O site está no ar e o banco responde? | Monitor externo (UptimeRobot) consultando `/api/health` | painel do UptimeRobot, alerta por e-mail |
| O que quebrou, onde e desde qual deploy? | SigNoz, com traces e erros do app, do worker e do navegador | `https://observability.tecsupply.techealth.com.br` |

O monitor de disponibilidade fica **fora** da VPS de propósito. O SigNoz roda no
mesmo k3s do GovHealth: se a VPS cair, ele cai junto e ninguém é avisado.

## `/api/health`

Faz `select 1` no Postgres por um pool só dele, de uma conexão, com teto de 1,5 s
em cada etapa (esperar vaga e conectar; a consulta). Com o banco travado, a
resposta é um 503 em ~1,5 s, e nenhuma consulta fica presa: pedidos repetidos
nunca ocupam as conexões do app. Ver `pingBanco` em `src/lib/db.ts`.

- `200 {"status":"ok","banco":"ok","ms":12}`: o app está de pé e o banco responde.
- `503 {"status":"erro","banco":"fora"}`: o app está de pé, mas o banco não responde.
  O motivo vai para o SigNoz como o erro `health: banco fora`.
- Qualquer outra resposta, ou nenhuma: o app (ou a VPS, o nginx, o Traefik) está fora.

A rota é pública e não devolve versão nem mensagem de erro. Ela **não** é a probe
do k8s, que continua sendo a `/inicio`: com o banco fora, tirar o app do Service
só troca a tela de erro por um 502.

### Configurar o UptimeRobot (uma vez, no painel)

1. **New monitor** → tipo **HTTP(s)**.
2. URL: `https://govhealth.techealth.com.br/api/health`.
3. Intervalo: 5 min (o mínimo do plano gratuito).
4. Alert contacts: o e-mail da equipe.

O 503 do banco fora já conta como fora do ar, porque o monitor HTTP trata
qualquer 4xx ou 5xx assim.

## O que vai para o SigNoz

O código liga o SDK só com `OTEL_EXPORTER_OTLP_ENDPOINT` no env, que o chart põe
(`otel.endpoint` no `values.yaml`). Em dev e na Vercel, nada é enviado.

| Serviço | O que chega |
|---|---|
| `govhealth-app` | Um trace por requisição (o Next gera), cada query do Postgres, e os erros: `erro no servidor` (Server Component, Server Action, route handler, pelo `onRequestError` de `src/instrumentation.ts`) e `erro no navegador` (telas de erro e erros soltos na janela, via `/api/erro-cliente`) |
| `govhealth-worker` | Um span `job <nome>` por rodada do pg-boss, com as queries e o fetch de saída pendurados nele. Job que falha vira span com erro |

`service.version` é o SHA da imagem. É por ele que se compara antes e depois de um deploy.

O `digest` que a tela de erro mostra ao usuário (`código 2262999834`) é o atributo
`erro.digest` no SigNoz. Com o código que o cliente mandou pelo "Reporte um
problema", filtre por ele em **Exceptions** para achar o erro do servidor.

### Redação

Todo span passa por `src/lib/redigir.mjs` antes de sair do processo, inclusive os
nativos do Next e os do fetch, que trazem a URL completa. Some do nome, dos
atributos e das exceções:

- query string e fragmento de qualquer URL ou caminho (`url.query` sai inteiro);
- e-mail, CPF, celular, `Bearer`, JWT, `token=`/`senha=`… e chaves longas.

É uma rede, não uma licença: o código continua sem pôr dado pessoal em span.
`npm run observabilidade:teste` sobe um coletor falso e falha se algo depois de
`?` (ou um e-mail) chegar até ele.

O `/api/erro-cliente` é público, então vai menos ainda:

- **Sem sessão:** só a mensagem normalizada (números viram `#`, texto entre aspas
  vira `…`), sem stack. Ninguém de fora consegue gravar texto livre no SigNoz.
- **Com sessão:** mensagem e stack, redigidas.
- **Nos dois casos:** `erro.fingerprint`, que agrupa o mesmo erro com números
  diferentes, e `erro.sessao`.

### O que não vai, por decisão

- **Parâmetros das queries.** O `pg` registra a query com `$1`, `$2`, sem os
  valores.
- **Logs (`console.*`).** Só traces e erros. Os logs seguem no `kubectl logs`.
- **As minerações.** As CronJobs ainda não carregam o SDK.
- **Stack legível do navegador.** Ela chega minificada, porque os source maps de
  produção não são publicados. Use a mensagem, a rota e o `digest`.

Consumo de CPU, memória e restarts dos pods já vinha antes desta mudança, pelo
`k8s-infra` do SigNoz: **Infrastructure Monitoring → Kubernetes**, filtrando
`k8s.namespace.name = govhealth`.

## Alertas a criar no SigNoz

Alertas moram no banco do SigNoz, não em arquivo, então são criados na UI
(**Alerts → New alert**). O canal é o e-mail que o SigNoz já usa, pela Resend.

| Alerta | Consulta | Dispara quando |
|---|---|---|
| Erro no servidor | traces, `service.name = govhealth-app`, `name = erro no servidor`, count | > 5 em 15 min |
| Taxa de erro do app | traces, `service.name = govhealth-app`, `has_error = true` / total | > 5 % em 10 min |
| Job do worker falhou | traces, `service.name = govhealth-worker`, `name like job %`, `has_error = true`, count | > 0 em 1 h |
| Pod reiniciando | métrica `k8s.container.restarts`, `k8s.namespace.name = govhealth`, aumento | > 2 em 30 min |

Os limiares são um ponto de partida. Ajuste depois de uma ou duas semanas vendo
o ruído real.

## Conferir depois do deploy

Na VPS, um ou dois minutos depois de navegar no site:

```bash
CHPASS=$(kubectl -n observability get secret signoz-secrets -o jsonpath='{.data.clickhouse-password}' | base64 -d)
kubectl -n observability exec chi-signoz-clickhouse-cluster-0-0-0 -c clickhouse -- \
  clickhouse-client --user admin --password "$CHPASS" -q \
  "select serviceName, count() from signoz_traces.distributed_signoz_index_v3 where timestamp > now() - interval 10 minute group by serviceName"
```

Esperado: linhas para `govhealth-app` e `govhealth-worker`. Se não aparecerem,
confira se a NetworkPolicy `otlp-from-tenants` do repositório `infra`
(`signoz/networkpolicy.yaml`) libera o namespace `govhealth`. Sem ela, o envio é
descartado sem erro nenhum do lado do app.
