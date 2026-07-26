---
description: Ranqueia os bugs/relatos abertos (Jira) por prioridade x custo p/ você escolher o que implementar
---

# Check semanal de bugs — ranking prioridade × custo

Você é o revisor de backlog. O objetivo é: **listar os relatos abertos, ranqueá-los
por (prioridade de negócio) × (custo de implementação), e deixar o usuário escolher**
quais seguem para implementação. **NÃO implemente nada sem a escolha explícita do usuário.**
Este comando é MANUAL (o usuário roda quando quer) — não crie cron/agendamento.

## Passo 1 — Buscar os issues abertos (barato, só leitura)

Rode:

```
node scripts/jira/list-issues.mjs
```

- A fonte é o **Jira** se as credenciais estiverem configuradas; senão cai para a
  tabela local `feedback_issues` (o campo `source` no JSON diz qual foi).
- Se vier `{"erro": ...}` ou `jiraConfigurado: false` e o usuário quiser usar Jira,
  aponte o passo a passo de conexão (README de suporte / envs `JIRA_*`) e pare aqui.
- Se não houver issues abertos, informe e encerre.

## Passo 2 — Avaliar cada issue (mantenha o custo de token baixo)

Para cada issue, faça uma avaliação **cirúrgica** (leia só o necessário do repo —
use a rota em `rota`/contexto e a descrição para achar os arquivos prováveis; prefira
Grep/Glob e leituras pontuais, ou o agente Explore para os casos ambíguos):

- **Prioridade (impacto)** — Alta / Média / Baixa. Considere: `severidade`
  (critica > alta > media > baixa), `tipo` (bug quebrando fluxo > melhoria > dúvida),
  abrangência (afeta muitos usuários / caminho crítico como login, pagamento, dados)
  e recorrência.
- **Custo de implementação (esforço)** — Baixo / Médio / Alto. Estime pelo tamanho da
  mudança: nº de arquivos, se mexe em schema/DB, risco de regressão, se precisa de
  migração/deploy especial. "Baixo" = 1-2 arquivos, sem migração; "Alto" = várias
  áreas, schema, ou incerteza grande.
- Anote os **arquivos prováveis** e um **veredito de 1 linha**.

## Passo 3 — Apresentar o ranking

Ordene priorizando **quick wins** (Prioridade Alta + Custo Baixo primeiro) usando uma
lógica valor/esforço. Mostre uma tabela:

| # | Jira | Título | Prioridade | Custo | Arquivos prováveis | Veredito |
|---|------|--------|-----------|-------|--------------------|----------|

Abaixo da tabela, destaque em 1 parágrafo os **quick wins** recomendados.

## Passo 4 — Deixar o usuário escolher

Use `AskUserQuestion` (multiSelect) listando os issues ranqueados para o usuário marcar
**quais devem ser implementados agora pelo Claude Code**. Não decida por ele.

## Passo 5 — Implementar só os escolhidos

Para cada issue selecionado, uma de cada vez:
- Crie uma branch, implemente a correção, verifique (type-check/rodar o afetado).
- Siga o fluxo padrão do projeto (commit; deploy via `vercel --prod` só se o usuário pedir).
- Ao concluir, se houver `jira_key`, ofereça atualizar o status do issue (o app tem
  `PATCH /api/feedback` para mover status; o Jira reflete via `comentarStatus`).

Se nenhum for escolhido, apenas registre o ranking e encerre — sem gastar mais tokens.
