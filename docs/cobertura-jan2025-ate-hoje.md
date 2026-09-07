# Cobertura de jan/2025 até hoje — como manter, como medir, como consertar

Objetivo declarado pelo Ramon em 05/09/2026: **o mais próximo de 100% de cobertura de
jan/2025 até hoje**, e **garantia de que o que saiu nos últimos dias sempre chega**.

Este documento é executável: passo a passo, comandos exatos, critério de pronto e o que
fazer quando falhar. Não precisa de contexto de conversa nenhuma.

---

## 1. O que já está garantido (não mexer sem motivo)

| tarefa agendada | cadência | janela | prioridade na pista | papel |
|---|---|---|---|---|
| GovHealth Sync Cobertura | 01:00 e 12:00 | dias magros dos últimos 10 | **10** | guarda da recência: pergunta ao banco quais dias estão abaixo da mediana e recolhe |
| GovHealth Refresh 2 Dias | a cada 2 dias, 05:00 | **5 dias** | **15** | garante que o que saiu nesta semana chega; criada em 05/09/2026 |
| GovHealth ETL Refresh | a cada 3 dias, 03:00 | 21 dias | **20** | rede profunda: pega o que o PNCP publica com atraso |
| cron `sync-pncp` da Vercel | diário | dia corrente | (fora da pista) | ~15% do volume diário |

A janela de 5 dias com cadência de 2 dias é redundância deliberada: **uma execução pode
falhar inteira e a seguinte ainda cobre o período**.

Prioridade importa porque só um processo pode falar com o PNCP por vez (concorrência dá
429 — medido: 18× 429 e 14× 503 com duas frentes, contra 4 quedas em 485 páginas com uma
só). Quem tem a pista **cede** para quem é mais urgente; ceder é pausa, não desistência.

---

## 2. Como medir a cobertura (a única medida que vale)

O `sync-cobertura` compara o banco com ele mesmo — um período coletado pela metade
inteiro passa invisível. Foi o caso de jan–jun/2025: faltavam 30-59% das linhas e não
havia **um único** dia útil vazio em 608 dias.

Para medir contra a FONTE:

```bash
npm run pncp:sonda -- --mensal=2025 --ufs=SP,MG --mods=6,8
```

- Sempre **duas UFs ou mais, e nunca só as grandes**. SP, RJ, MG, RS, PR e BA são as
  PRIMEIRAS a serem coletadas em toda passada (ver o cabeçalho do `etl-refresh-loop.mjs`),
  então medem o melhor caso. Quando a passada estoura o orçamento, quem fica de fora é
  sempre o fim da fila.

  Medido em 05/09/2026, e a diferença não é sutil:

  | amostra | faltando |
  |---|---|
  | SP+MG, 14 datas de jan/2025 a ago/2026 | **1%** |
  | PE, 5 datas de jul a dez/2025 | **28-68%** |

  A mesma base, no mesmo dia. Amostrar só SP e MG teria fechado o assunto com "1%,
  cobertura boa" e deixado PE pela metade. **Inclua sempre uma UF do meio da fila.**

  (Em jan–jun/2025 valia o contrário — SP/pregão era o pior caso, com 36% — porque ali o
  problema era teto de paginação, que castiga justamente quem tem mais páginas. A regra
  não é "UF X é pior": é que **cada modo de falha tem sua própria vítima preferida**.)
- A sonda **entra na fila** (prioridade 35) e toma a pista enquanto mede — não rode com
  `--sem-lock`: sondar junto de uma coleta dá 429, e 429 vira consulta PARCIAL, que a
  sonda reporta como "faltando". Medição envenenada manda mutirão onde não falta nada.
- Ela **cede entre datas**, então uma sonda longa não segura o `sync-cobertura` das 18:00.
- Veredito automático: ≥10% faltando = buraco relevante.

**Critério de pronto:** o total da amostra fica abaixo de 5%.

---

## 3. Se a sonda apontar buraco num período

```bash
# 1. Confirme em outra UF antes de varrer (uma varredura custa horas de pista)
npm run pncp:sonda -- --datas=<as datas suspeitas> --ufs=BA,PE --mods=6,8

# 2. Ensaio: mostra o plano de fatias, não toca em nada
node scripts/backfill-2025h1.mjs --ensaio --de=<YYYY-MM-DD> --ate=<YYYY-MM-DD>

# 3. Varra (à NOITE — ver armadilha 4)
node scripts/backfill-2025h1.mjs --de=<YYYY-MM-DD> --ate=<YYYY-MM-DD>

# 4. OBRIGATÓRIO ao terminar
npm run ruido:limpar -- --so-valor --aplicar
```

O passo 4 não é opcional: toda coleta ressuscita linhas de valor impossível já
neutralizadas. Em 03/09/2026 eram **43 linhas somando R$ 53,8 tri contra R$ 1,08 tri de
base legítima** — 98% do valor exibido era ruído de 43 registros.

---

## 4. Armadilhas que custam horas se você não souber

**O erro do ETL vai para o stderr, não para o stdout.** O stdout parece limpo (com
`skip 0` em toda linha, que conta registros já processados, não páginas perdidas)
enquanto o stderr acumula 429 e quedas. Página realmente perdida aparece como `[skip]`
no stderr. Sempre olhe os dois arquivos.

**Um job morto é indistinguível de um job quieto.** Confira o processo, não o log:
```bash
tasklist //FI "PID eq <PID>" //NH | grep "^node" && echo vivo || echo MORTO
```

**A máquina dormindo mata a varredura.** Em 01/09/2026 o Modern Standby matou um mutirão
às 04:44 e custou 2 dias porque ninguém percebeu. Na tomada o standby é 0 (nunca); na
bateria são 3 minutos. **Manter plugado durante varredura longa.**

**O PNCP é ~2,5× mais lento em horário comercial.** Medido em 9 fatias seguidas: 5,3
s/página às 21h contra 14,2 s/página às 17h. Varredura pesada começa à noite.

**Página abandonada — CONSERTADO em 06/09/2026.** Quando o ETL desiste de uma página
após 5 tentativas, o checkpoint continua avançando por cima dela (é ele que mantém o
progresso durável), mas agora a página fica **anotada** em `etl_checkpoint.paginas_puladas`
e a próxima passada por aquela UF/modalidade a revisita **antes** de seguir em frente.

Não avançar o checkpoint teria sido a correção óbvia e é a errada: uma página
permanentemente quebrada travaria toda execução futura naquele ponto. Era essa a escolha
original — entre travar e perder, perder pareceu menos ruim. Com a lista não é preciso
escolher.

O resumo final agora imprime no **stdout** quantas páginas foram abandonadas, recuperadas
e seguem pendentes, então a perda deixou de depender de alguém ler o stderr. Para ver o
que está pendente a qualquer momento:
```sql
SELECT chave, ultima_pagina, paginas_puladas FROM etl_checkpoint
 WHERE cardinality(paginas_puladas) > 0 ORDER BY chave;
```
Limite: a lista pertence à **chave** do checkpoint. Em varredura por `--dias` a chave
carrega a data (`:d20260901`), então a janela do dia seguinte é uma chave nova e a
pendência da anterior fica órfã — o dado em si volta pela janela nova, que revarre as
mesmas datas do zero.

**Dois donos na pista — CONSERTADO em 06/09/2026.** O `pegar()` do `pncp-lock` escrevia
o arquivo de lock existisse ou não, e o `soltar()` apagava o de quem fosse. Quem chegasse
por último virava "o dono" no papel enquanto o anterior **seguia varrendo sem saber**.
Flagrado às 11h24 de 06/09: `etl-refresh-2dias` com o lock e `etl-refresh-loop` varrendo
RS/mod6 ao mesmo tempo, por seis horas, sem uma linha de erro em nenhum dos dois.

O gatilho foi o `ceder()`: ele esperava a pista até `tetoMin` (120min) e, estourado o
teto, retomava por cima. O mutirão de MG cedeu às 03:01, esperou os 120 minutos e às
05:01 despejou o refresh longo — o log dele diz "pista retomada", que era mentira.

Agora `pegar()` cria o lock com `wx` (O_CREAT|O_EXCL) e **devolve `false`** se alguém
vivo já está nele; `soltar()` só apaga o lock se ele for meu; e `ceder()` devolve `false`
em vez de despejar. Todo chamador de `ceder()` para quando a pista não volta — o
checkpoint guarda o progresso e a próxima execução retoma dali. O sintoma a procurar, se
voltar: 429/503 em rajada num lado e `[skip]` no outro. E agora também a linha
`[pista] PERDI a pista para "X"`, que a batida imprime ao detectar despejo.

**As duas APIs do PNCP caem SEPARADO — CONSERTADO em 07/09/2026.** A coleta fala
com duas: `/api/consulta/v1` traz a LISTA de contratações e `/api/pncp/v1` traz
ITENS e RESULTADOS de cada uma. Em 07/09 às 06:12 a lista respondia HTTP 200 em
3,1s enquanto a de itens devolvia HTTP 503 em 245ms, três vezes seguidas.
Rejeição em 245ms é serviço fora, não sobrecarga nossa — fosse nossa viria 429, e
vieram **zero** 429 em 417 erros.

O estrago não é perder item. É que cada chamada morta esgota as 5 tentativas do
`fetchJson` com espera de 2+4+6+8+10 = **30 segundos**, e há uma dessas por
REGISTRO, 50 registros por página. A rodada das 05:00 de 07/09 gastou 70 minutos
para fazer 14 páginas de UMA UF das 27 e não gravou uma linha nova: o orçamento
evaporou dormindo.

O circuit breaker que já existia conta falhas de PÁGINA DA LISTA — e a lista
estava saudável, então ele nunca disparou. O `scripts/pncp-breaker.mjs` é o do
outro lado: depois de 5 falhas seguidas desliga o enriquecimento por 10 minutos e
deixa a coleta seguir só com a lista. A contratação entra no banco do mesmo jeito
(o upsert do cabeçalho é ANTERIOR ao enriquecimento — era o que o log já dizia em
`183c/0i/0r`) e o item fica para o `backfill-itens`. Cumprida a espera, UMA
chamada sonda se o serviço voltou; se voltou, religa. Ajuste por
`PNCP_ENRIQ_LIMITE` e `PNCP_ENRIQ_ESPERA_MIN`.

O resumo final imprime no **stdout** quantas vezes desligou, quantas chamadas
pulou e se terminou desligado — enriquecimento fora é perda silenciosa por
natureza, porque a rodada termina "com sucesso", cheia de contratações e sem um
item.

O sintoma a procurar, se voltar: rajada de 503 **sem nenhum 429**, com a listagem
respondendo normalmente. Uma requisição em cada API resolve a dúvida em segundos:
```bash
curl -s -o /dev/null -w "lista: %{http_code} %{time_total}s\n" \
  "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20260901&dataFinal=20260906&codigoModalidadeContratacao=6&uf=SP&pagina=1&tamanhoPagina=50"
```

**Fim de semana não é buraco.** Medido em 120 dias, por `extract(isodow …)`:

| seg | ter | qua | qui | sex | sáb | dom |
|----:|----:|----:|----:|----:|----:|----:|
| 832 | 888 | 978 | 871 | 826 | **14** | **9** |

Todo dia com menos de 100 linhas nos últimos 120 caiu em sábado ou domingo, sem exceção.
Antes de chamar um dia magro de buraco, veja em que dia da semana ele caiu.

**`toISOString()` em coluna `date` mente um dia.** `contratacoes.data_publicacao` é `date`,
e o node-postgres devolve `date` como **meia-noite local**. Nesta máquina (UTC+2),
`r.d.toISOString().slice(0,10)` imprime o dia ANTERIOR. Em 06/09/2026 isso me fez
reportar "último dado em 03/09" quando era 04/09, e quase virou um mutirão atrás de um
dia útil que não estava faltando. Formate a data no próprio SQL:
```sql
SELECT to_char(data_publicacao, 'YYYY-MM-DD') dia, extract(isodow FROM data_publicacao) dow
```
O rótulo do dia da semana vindo do Postgres continua correto mesmo quando a data impressa
está deslocada — foi essa incoerência que denunciou o erro.

**Neste shell, heredoc com aspas quebra.** Use a ferramenta Write para criar scripts.

**`pg` só resolve dentro do repositório.** Script de consulta tem que morar na raiz do
repo (crie, rode, apague) — não funciona no diretório temporário.

**Não use `Get-Content`/`Set-Content` do PowerShell 5.1 para editar texto acentuado em
massa** — corrompe acentos. Use Python/.NET com UTF-8 sem BOM.

---

## 5. Testes que protegem tudo isto

```bash
npm run pncp:lock:teste          # 18 casos: um dono só na pista
npm run pncp:fila:teste          # 20 casos: prioridade, passagem e não-despejo
npm run pncp:fila:teste:e2e      #  9 casos: DOIS processos de verdade
npm run pncp:fila:teste:filho    #  8 casos: quem varre é um FILHO por fatia
npm run checkpoint:teste         # 12 casos: a lista de páginas abandonadas
npm run pncp:breaker:teste       # 20 casos: o disjuntor do enriquecimento
```

Os de processo de verdade são os que importam. O modo de falha desta área é invisível:
quando ela erra, ninguém recebe erro — duas frentes passam a bater no PNCP ao mesmo
tempo, ou uma página some, e o log das duas pontas parece normal. Rode os seis depois
de qualquer mexida em `pncp-lock.mjs`, `pncp-prioridade.mjs`, `pncp-breaker.mjs` ou
`etl-pncp.mjs`.

**Um teste que passa no código antigo não prova nada.** Dois destes conjuntos existem
justamente porque a versão anterior os reprovava: o `:filho` roda o cenário COM e SEM o
carimbo de `PNCP_TRABALHANDO_DESDE` e exige que o SEM falhe; os três casos novos de
`pncp:lock:teste` (recusa de despejo, não-sobrescrita, não-soltar-alheio) foram rodados
contra o `pncp-lock.mjs` de HEAD antes de entrar, e reprovaram os três; e o
`pncp:breaker:teste` fecha medindo o CUSTO do mesmo cenário com e sem disjuntor —
500 registros com a API de itens fora dão **500 chamadas / 250min** sem ele contra
**5 chamadas / 3min** com ele, e a asserção exige que o número antigo estoure o
orçamento de 120min. Ao consertar um defeito invisível aqui, faça a mesma
conferência.

---

## 6. Pendências conhecidas

- **Página pendente órfã por troca de janela.** Aconteceu de verdade em 07/09: a
  pendência de MG estava sob a chave `uf:MG:mod:6:d20260901` e a janela do dia
  virou `d20260902`, então nada a revisita. As datas 02–06/09 voltam pela janela
  nova, mas o que foi publicado em 01/09 naquela página específica não volta.
  Conserto de verdade seria a lista pendente viver por UF/modalidade/DATA em vez
  de por chave de janela.
- **`contratacoes` não tem índice em `data_publicacao`** (345k linhas). Consulta por dia
  com subconsulta correlacionada trava; agregue com um `GROUP BY` só e junte em JS.
- **2024 e anteriores não foram medidos.** Fora de escopo por decisão de 05/09/2026.
- **Backfill de itens**: 36.814 contratações sem itens, estimativa própria de ~492h e
  crescendo. Hoje é prioridade 60 e cede para todo mundo — anda quando sobra pista.
