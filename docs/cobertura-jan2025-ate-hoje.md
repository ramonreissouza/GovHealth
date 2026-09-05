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

- Sempre **duas UFs ou mais**. SP/pregão foi o pior caso em 2025 (36%) enquanto MG ficava
  em 11-13% e BA em 0%. Extrapolar SP para a base inteira superestima.
- A sonda **se recusa a rodar** com a pista ocupada, e está certa: sondar junto de uma
  coleta dá 429. Espere, não passe `--sem-lock`.
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

**Página abandonada some em silêncio.** Quando o ETL desiste de uma página após 5
tentativas, o checkpoint avança por cima dela — nenhum re-run a revisita. Para recuperar,
recue o checkpoint à mão:
```sql
UPDATE etl_checkpoint SET ultima_pagina = <n-1> WHERE chave = 'uf:XX:mod:N:r<ini>_<fim>';
```
e re-rode só aquela UF/modalidade. **Este defeito não está consertado.**

**Neste shell, heredoc com aspas quebra.** Use a ferramenta Write para criar scripts.

**`pg` só resolve dentro do repositório.** Script de consulta tem que morar na raiz do
repo (crie, rode, apague) — não funciona no diretório temporário.

**Não use `Get-Content`/`Set-Content` do PowerShell 5.1 para editar texto acentuado em
massa** — corrompe acentos. Use Python/.NET com UTF-8 sem BOM.

---

## 5. Testes que protegem tudo isto

```bash
npm run pncp:lock:teste        # 12 casos: um dono só na pista
npm run pncp:fila:teste        # 17 casos: prioridade e passagem
npm run pncp:fila:teste:e2e    #  9 casos: DOIS processos de verdade
```

O terceiro é o que importa. O modo de falha da fila é invisível: se a passagem quebrar,
ninguém recebe erro — o `sync-cobertura` só volta a desistir todo dia, com o log
parecendo normal. Rode os três depois de qualquer mexida em `pncp-lock.mjs` ou
`pncp-prioridade.mjs`.

---

## 6. Pendências conhecidas

- **Defeito do checkpoint** (seção 4): página abandonada nunca é revisitada.
- **`contratacoes` não tem índice em `data_publicacao`** (345k linhas). Consulta por dia
  com subconsulta correlacionada trava; agregue com um `GROUP BY` só e junte em JS.
- **2024 e anteriores não foram medidos.** Fora de escopo por decisão de 05/09/2026.
- **Backfill de itens**: 36.814 contratações sem itens, estimativa própria de ~492h e
  crescendo. Hoje é prioridade 60 e cede para todo mundo — anda quando sobra pista.
