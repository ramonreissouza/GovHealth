# Roteiro de Auditoria de Usuário — GovHealth AI
## 28 tarefas reais, tela por tela, com critério de aprovação

> Objetivo: simular um gerente comercial de fornecedora de equipamentos médicos
> usando a plataforma para extrair valor de verdade. Cada tarefa tem um critério
> objetivo de PASSA/FALHA e a evidência a capturar (screenshot + observação).
>
> Como executar: entregar este arquivo ao Claude Code com a instrução:
> "Escreva um script Playwright que faça login com [credenciais], execute cada
> tarefa abaixo, capture screenshot de cada passo e gere um relatório
> tarefa → resultado → evidência." Ou executar manualmente com Claude for Chrome.
>
> ⚠️ Antes de tudo: trocar a senha da conta demo (a antiga ficou exposta
> publicamente). Usar a nova credencial no script.

---

## BLOCO 0 — Entrada e primeira impressão (3 tarefas)

**T01. Login**
- Fazer login com as credenciais.
- PASSA se: login completa em <5s e cai direto numa tela com dados (não vazia).
- Observar: existe algum onboarding/tour para usuário novo? (Se não: anotar.)

**T02. Compreensão em 30 segundos**
- Ao cair no dashboard, sem clicar em nada, responder: "o que esta tela está me
  dizendo para fazer AGORA?"
- PASSA se: há uma ação óbvia (ex: "3 oportunidades urgentes — ver agora").
- FALHA se: só há números soltos sem hierarquia de ação.

**T03. Atualidade do dado**
- Localizar em QUALQUER lugar da tela: quando esses dados foram coletados.
- PASSA se: existe data/hora real da coleta (não "atualizado agora" genérico).
- Evidência: screenshot do indicador.

## BLOCO 1 — Dashboard (3 tarefas)

**T04. Do KPI ao detalhe**
- Clicar no KPI "Oportunidades quentes". 
- PASSA se: leva à lista filtrada correspondente (não é número morto).

**T05. Alertas acionáveis**
- Abrir um alerta da lista. 
- PASSA se: o alerta leva à oportunidade/emenda que o gerou, com contexto.
- FALHA se: alerta é texto sem link/ação.

**T06. Números batem**
- Somar mentalmente: o valor total do KPI confere com a soma da lista exibida?
- PASSA se: coerente. FALHA se: KPI diz X e a lista soma outra coisa.

## BLOCO 2 — Oportunidades (5 tarefas)

**T07. Busca real de usuário**
- Buscar "tomógrafo". Depois "tomografo" (sem acento). Depois "TOMOGRAFIA".
- PASSA se: os três retornam resultados equivalentes (busca tolerante).

**T08. Filtro composto**
- Aplicar: UF=CE + score≥70 + categoria imagem, simultaneamente.
- PASSA se: filtros combinam (E, não OU) e a URL reflete o filtro
  (dá para copiar o link filtrado e mandar para um colega?).

**T09. Entender POR QUE o score é aquele**
- Abrir uma oportunidade com score alto. Procurar a explicação do score
  (sub-scores, fatores).
- PASSA se: o usuário entende o porquê. FALHA se: número mágico sem justificativa.
- (Confiança no score = confiança na plataforma. Crítico.)

**T10. Da oportunidade à ação**
- Na oportunidade aberta: adicionar ao CRM/pipeline. Voltar à lista. A
  oportunidade indica que já está no pipeline?
- PASSA se: fluxo completo funciona e há indicação visual de "já adicionada".

**T11. Link para a fonte oficial**
- Na oportunidade: clicar no link para o edital/fonte original (PNCP).
- PASSA se: abre a página oficial do processo. FALHA se: não há link ou quebra.

## BLOCO 3 — CRM / Pipeline (3 tarefas)

**T12. Gestão do lead**
- No CRM: mover um card de estágio, adicionar uma nota, criar uma tarefa
  com prazo.
- PASSA se: as três ações existem e persistem após recarregar a página (F5).

**T13. Contexto preservado**
- Abrir o card no CRM: ele mantém o vínculo com os dados da oportunidade
  (score, valor, prazo do edital)?
- PASSA se: o card é rico. FALHA se: virou um post-it desconectado.

**T14. Prazo visível**
- Existe alguma visão de prazos/datas de encerramento de proposta
  (calendário, ordenação por urgência)?
- PASSA se: sim. FALHA se: prazos existem no dado mas não há visão temporal.

## BLOCO 4 — Vencedores / Concorrentes (4 tarefas)

**T15. Pergunta de guerra comercial #1**
- Responder usando a plataforma: "Quem mais vendeu ultrassom no Nordeste
  nos últimos 12 meses, e por qual preço médio?"
- PASSA se: respondível em <2 minutos de navegação.
- Anotar o caminho percorrido (nº de cliques).

**T16. Dado real vs mock**
- Nas telas de concorrentes: verificar se há aviso quando o dado exibido é
  exemplo/fallback (o Claude Code implementou aviso âmbar).
- PASSA se: impossível confundir dado real com exemplo.

**T17. Profundidade do histórico**
- Filtrar vencedores por ano: 2023 disponível? 2024? Quantos registros aparecem
  por ano? (Anotar números — mede a cobertura real do ETL.)

**T18. Drill-down do concorrente**
- Clicar num concorrente: existe página/painel dele (histórico de vitórias,
  regiões, preços)?
- PASSA se: sim. FALHA se: nome é texto morto.

## BLOCO 5 — Mapa (2 tarefas)

**T19. Mapa funcional**
- O mapa carrega tiles reais? Clicar num município: abre as oportunidades dele?
- PASSA se: ambos. FALHA se: placeholder ou clique inerte.

**T20. Do mapa à lista**
- A partir do mapa, chegar à lista filtrada de um estado em ≤2 cliques.

## BLOCO 6 — Radar de Verba / Emendas (2 tarefas — se a tela existir)

**T21. A pergunta de ouro**
- Responder: "Quais 10 municípios do CE têm mais verba de saúde empenhada e
  não gasta?"
- PASSA se: respondível em <30 segundos (é a métrica de sucesso do PRD).

**T22. Distinguir zero real de dado ausente**
- Numa emenda com valorPago=0: a tela diferencia "não executado" de
  "execução não informada"?

## BLOCO 7 — Transversais (6 tarefas)

**T23. Exportação**
- Em qualquer lista: exportar para Excel/CSV.
- PASSA se: existe e o arquivo abre correto. FALHA se: não existe (anotar —
  gap conhecido).

**T24. Filtros sobrevivem?**
- Aplicar filtros, navegar para outra tela, voltar. Os filtros persistem?

**T25. Mobile**
- Abrir no celular (ou DevTools mobile): dashboard e oportunidades são usáveis?
- PASSA se: legível e clicável sem zoom. (Vendedor vive no celular.)

**T26. Performance percebida**
- Cronometrar: login→dashboard; abrir oportunidades; aplicar filtro.
- Anotar os 3 tempos. Referência: >3s por ação já irrita usuário recorrente.

**T27. Erro gracioso**
- Forçar um estado sem dados (filtro impossível: UF=AC + score≥95).
- PASSA se: mensagem útil ("nada encontrado, tente X"). FALHA se: tela branca
  ou spinner eterno.

**T28. Sair e voltar**
- Logout → login novamente: o estado do usuário (CRM, favoritos) persistiu?

---

## Formato do relatório de saída

| # | Tarefa | Resultado | Tempo | Evidência | Observação |
|---|---|---|---|---|---|
| T01 | Login | PASSA/FALHA | Xs | screenshot | ... |

Com esse relatório preenchido (+ screenshots), produzo o Top 10 definitivo
baseado em uso real — sem nenhuma suposição.
