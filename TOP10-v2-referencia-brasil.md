# TOP 10 v2 — Caminho para a GovHealth AI virar referência única no Brasil

> Análise de especialista em vendas para saúde pública. Restrição respeitada:
> **nenhuma ferramenta paga de IA nesta fase** — sugestões de IA aparecem só no
> item 10, marcadas como fase futura.
>
> **Método e limites (honestidade primeiro):**
> - ✅ VERIFICADO AO VIVO: o site foi acessado agora; abre direto em /login,
>   credenciais demo removidas (correção anterior confirmada em produção).
>   NÃO consegui navegar nas áreas logadas — não tenho como autenticar.
> - 📐 INFERIDO DA ARQUITETURA: pontos baseados no código/backlog que construímos
>   juntos nesta jornada + retorno do Claude Code.
> - 🔍 PESQUISADO: benchmarks vêm dos sites oficiais dos players (Effecti,
>   GovWin IQ, Civic IQ) — material de marketing deles, portanto com viés de
>   autopromoção; e da apresentação da Hospmult que você forneceu.

---

## O mapa competitivo em uma frase

| Player | Força central | Fraqueza explorável |
|---|---|---|
| **Hospmult** (BR, nicho saúde) | Profundidade histórica de vencedores (R$466M consolidados) | UX datada, sem predição, sem workflow |
| **Effecti** (BR, geral) | Operação da disputa: robô de lances, chat do pregoeiro, alertas em smartwatch/app, IA de leitura de edital, 1.400+ portais | Não é especializada em saúde; não faz inteligência pré-edital (emendas/convênios) |
| **GovWin IQ / Civic IQ** (EUA) | Sinal precoce (leads anos antes do RFP) + pipeline integrado | Não operam no Brasil |
| **GovHealth AI (você)** | Pré-edital em saúde (emendas→convênio→edital) + score | Volume de dados ainda parcial; sem workflow operacional; invisível publicamente |

**A tese:** ninguém no Brasil combina (a) especialização em saúde, (b) inteligência
pré-edital e (c) workflow operacional. A Hospmult tem (a) e meio (b); a Effecti tem
(c). Quem juntar os três vira a referência. Esse é o critério de priorização abaixo.

---

## TOP 10

### 1. Criar a face pública da plataforma (hoje ela é invisível) — ✅ verificado ao vivo
**Problema:** o site abre direto no login. Não existe landing page, proposta de
valor, casos de uso, conteúdo — nada indexável. Para "virar referência", o mercado
precisa saber que você existe. A Effecti e a Hospmult têm sites de marketing
completos; a Effecti produz conteúdo constante sobre licitações (blog ativo em 2026).
**Ação (custo zero):** landing page pública com proposta de valor + 3-5 artigos
fundadores ("Como antecipar licitações de saúde", "O que são emendas não executadas").
Next.js já serve páginas estáticas de graça na Vercel.
**Por que é #1:** todos os outros itens melhoram o produto; este cria o mercado.
Referência não é só qualidade — é ser conhecido.

### 2. Volume e profundidade de dados: completar o ETL (27 UFs, 2023→hoje) — 📐
**Problema:** o piloto rodou com amostra (8 UFs, janelas limitadas). A Hospmult
exibe R$466M consolidados e 4.143 itens — esse volume É o produto na cabeça do
cliente. Com pouco dado, qualquer análise parece incompleta.
**Ação (custo zero, só tempo de máquina):** rodar o ETL incremental com checkpoint
até cobertura nacional completa desde 2023, e cron semanal para manter. A
infraestrutura já existe; falta executar o volume.
**Meta objetiva:** quando o valor consolidado da sua base superar o da Hospmult,
isso vira argumento de venda direto e verificável.

### 3. Lançar o Radar de Verba (emendas não executadas) — 📐
**Problema:** o PRD existe e não foi implementado. Atenção: a Hospmult JÁ monitora
emendas (a apresentação dela mostra "Painel de Indicação de Emendas" e "Monitor de
Novas Emendas Federais") — então isso não é diferencial inédito, é PARIDADE
obrigatória. O diferencial vem do refinamento: score quente/morna/fria por
percentual de execução, ranking por verba disponível, restos a pagar.
**Ação (custo zero):** implementar o PRD-radar-verba.md já entregue. A API de
emendas funciona com sua chave (verificado no debug).

### 4. Agenda operacional de prazos e disputas — 🔍 (gap vs Effecti)
**Problema:** a Effecti ganha o dia a dia do licitante com operação: alertas de
convocação, monitoramento de chat do pregoeiro, prazos centralizados. A GovHealth
encontra a oportunidade mas abandona o vendedor no momento seguinte. O campo
`dataEncerramentoProposta` JÁ vem do PNCP — hoje é subutilizado.
**Ação (custo zero):** visão de calendário com prazos de proposta das oportunidades
salvas no CRM + exportação .ics (Google Calendar/Outlook). Não é preciso replicar
robô de lances (fora do escopo de inteligência) — mas prazo perdido é venda perdida,
e isso é resolvível com o dado que você já tem.

### 5. Alertas que chegam onde o vendedor está — 🔍 parcialmente incerto
**Problema:** alertas só dentro da plataforma não mudam comportamento. A Effecti
notifica em smartwatch, app e web.
**Ação em camadas:**
- **Agora (custo zero):** notificações web push do navegador (API nativa, sem custo)
  + resumo diário por e-mail. ⚠️ Incerteza sinalizada: provedores de e-mail
  transacional (Resend, Brevo) têm camadas gratuitas, mas os limites mudam com
  frequência — verificar os valores atuais antes de prometer volume.
- **Futuro (pago):** WhatsApp Business API — no Brasil, vendedor vive no WhatsApp;
  é o canal de maior impacto, mas a API da Meta é paga. Deixar para a fase de receita.

### 6. Exportação Excel/PDF de qualquer tela — 📐
**Problema:** o comprador da sua plataforma (gerente comercial) presta contas a
uma diretoria que vive de Excel e PowerPoint. Sem exportar, sua inteligência não
circula dentro do cliente — e quem decide renovação é a diretoria que nunca logou.
**Ação (custo zero):** botão "Exportar" nas telas de oportunidades, vencedores e
radar de verba (xlsx no frontend; bibliotecas gratuitas já disponíveis no stack).

### 7. Selo de proveniência real + página pública de metodologia — 📐 (gap confirmado pelo Claude Code)
**Problema:** o "Atualizado há X" do topbar é decorativo (conta desde o render da
página, não desde a coleta do dado). Numa ferramenta que embasa propostas de
milhões, isso é risco de credibilidade — e credibilidade É o produto.
**Ação (custo zero):** (a) trocar pelo timestamp real da coleta (o `_meta.json`
do snapshot já guarda isso); (b) criar página pública "Nossas fontes e metodologia"
listando PNCP, Portal da Transparência, frequência de atualização e limitações
conhecidas. Nenhum concorrente brasileiro expõe metodologia — transparência aqui
é diferencial de confiança barato.

### 8. Mapa 100% gratuito + território do vendedor — 📐 (já encaminhado)
**Problema:** já resolvido o "como" (MapLibre + OpenFreeMap, sem chave, sem risco
de fatura — instrução já entregue ao Claude Code). O que falta é o "para quê":
mapa como ferramenta de território, não decoração.
**Ação (custo zero):** vendedor salva sua região de atuação (ex: "Nordeste +
norte de MG") e a plataforma filtra tudo — oportunidades, verba, concorrentes —
por esse território. É como rep de saúde pensa: por território, não por lista.

### 9. Personalização: filtros salvos, favoritos e perfil de interesse — 🔍 (padrão Effecti)
**Problema:** a Effecti deixa favoritar órgãos e salvar filtros por perfil da
empresa; hoje a GovHealth trata todo usuário igual, e cada sessão recomeça do zero.
**Ação (custo zero):** salvar buscas ("tomografia + CE + score>70"), favoritar
órgãos/municípios, e usar esse perfil para ordenar o dashboard. É também a
fundação dos alertas do item 5 (alerta = busca salva + gatilho).

### 10. IA aplicada — FASE FUTURA (respeitando a restrição de custo)
**O que fica para depois, em ordem de valor quando reativar:**
1. **Leitura de edital** (equivalente à "Aimê" da Effecti): extrair exigências,
   documentos e prazos do PDF. Quando ativar: modelo econômico (Haiku) sob demanda.
2. **Copiloto com fontes citadas** (cada resposta linka o registro de origem).
3. **Kit de proposta** (checklist automático de conformidade do edital).

**O que dá para fazer SEM IA paga, já:** extração básica de campos de edital por
regras/regex (datas, valores, modalidade aparecem em padrões previsíveis nos PDFs)
— cobre talvez a metade do valor com custo zero. ⚠️ Sinalizo: a taxa real de
acerto de regex em editais heterogêneos é incerta; tratar como "melhor esforço"
com fallback manual, nunca como leitura garantida.

---

## Ordem de execução sugerida (impacto ÷ esforço, tudo custo zero)

| Ordem | Item | Esforço | Por quê primeiro |
|---|---|---|---|
| 1º | #7 selo + metodologia | Baixo | Credibilidade; corrige gap apontado pelo Claude Code |
| 2º | #6 exportação Excel | Baixo | Valor imediato percebido pelo cliente |
| 3º | #2 ETL completo | Baixo (roda sozinho) | Volume = argumento de venda; só precisa de tempo de máquina |
| 4º | #1 landing pública | Médio | Cria o mercado enquanto o ETL roda |
| 5º | #9 filtros salvos | Médio | Fundação para alertas |
| 6º | #4 agenda de prazos | Médio | Dado já existe (dataEncerramentoProposta) |
| 7º | #5 alertas push/email | Médio | Depende de #9 |
| 8º | #3 Radar de Verba | Médio-Alto | PRD pronto; paridade + superação vs Hospmult |
| 9º | #8 território no mapa | Médio | Depende do MapLibre já encaminhado |
| 10º | #10 IA | — | Só quando a fase de custo permitir |

---

## Incertezas declaradas (conforme suas premissas)

1. Não naveguei nas áreas logadas — tudo sobre telas internas vem do código/backlog
   que construímos, não de inspeção visual ao vivo.
2. As capacidades da Effecti vêm do site de marketing dela — funcionam como
   posicionamento declarado, não como auditoria independente.
3. Limites de camadas gratuitas (e-mail transacional, etc.) mudam com frequência —
   verificar valores vigentes antes de assumir compromissos de volume.
4. Não afirmo números de mercado (tamanho, share) porque não tenho fonte
   verificada — os únicos números citados são os da apresentação da Hospmult
   que você forneceu e os publicados pelos próprios players.
