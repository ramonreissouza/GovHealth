# AUDITORIA COMPLETA — GovHealth (execução via Claude Code + Playwright)

## Por que este arquivo existe
O consultor-IA do chat NÃO consegue fazer login em sites (sem navegador real).
Quem executa a auditoria logada é VOCÊ, Claude Code, rodando Playwright na
máquina local. Este arquivo te diz exatamente o que fazer, o que medir e como
reportar. Regra geral: EVIDÊNCIA antes de opinião. Não assuma nada que não
tenha verificado.

## PASSO 0 — Credenciais (segurança primeiro)
1. NUNCA escreva a senha em arquivo versionado. Peça ao usuário para criar
   `.env.audit` (adicionar ao .gitignore ANTES) com:
   AUDIT_EMAIL=...
   AUDIT_SENHA=...
2. O script Playwright lê essas variáveis do ambiente.
3. Ao final da auditoria, lembre o usuário: TROCAR a senha desta conta
   (ela circulou em chat) e apagar o .env.audit.

## PASSO 1 — Setup
- Instale Playwright se ausente (npm i -D playwright && npx playwright install chromium).
- Alvo: https://gov-health.vercel.app/
- Crie pasta `auditoria/` para screenshots e o relatório.

## PASSO 2 — Auditoria da PARTE PÚBLICA (sem login)
P1. Screenshot da landing (/ e /inicio). A página comunica o valor em 10s de
    scroll? Existe CTA único? Números exibidos são reais (confira contra o
    banco — qualquer número inventado é FALHA CRÍTICA)?
P2. Página /planos ou seção de planos: transcreva EXATAMENTE nomes, preços e
    features de cada plano. Este é o registro-verdade para o item B1 abaixo.
P3. Clique em "Testar Essencial", "Testar Pro" e "assinar direto": descreva o
    que acontece em cada um (fluxo completo, tela a tela, com screenshot).
    Se algum botão não leva a um fluxo funcional de cadastro/pagamento,
    registre como GAP CRÍTICO DE RECEITA.
P4. /metodologia existe? O rodapé tem links funcionais?

## PASSO 3 — Auditoria LOGADA (as 28 tarefas, formato PASSA/FALHA)
Login com as credenciais do ambiente. Para cada tarefa: screenshot +
PASSA/FALHA + tempo (quando aplicável) + observação de 1 linha.

BLOCO ENTRADA: T01 login <5s cai em tela com dados · T02 dashboard tem ação
óbvia em 30s · T03 existe data/hora REAL da coleta dos dados (não "atualizado
agora" genérico — verifique se o valor muda com F5; se contar do render, é
FALHA).
BLOCO DASHBOARD: T04 clicar num KPI leva à lista filtrada correspondente ·
T05 alerta abre a oportunidade que o gerou · T06 o valor do KPI bate com a
soma da lista exibida.
BLOCO OPORTUNIDADES: T07 buscar "tomógrafo", "tomografo" e "TOMOGRAFIA"
retornam equivalente · T08 filtro composto UF+score+categoria combina em E, e
a URL reflete o filtro (link compartilhável) · T09 o score exibe justificativa
(sub-fatores) e não número mágico · T10 adicionar ao CRM e a lista indica "já
adicionada" · T11 link para a fonte oficial (PNCP) abre o processo real.
BLOCO CRM: T12 mover card + nota + tarefa com prazo persistem após F5 ·
T13 card mantém score/valor/prazo da oportunidade · T14 existe visão de
prazos/calendário (dataEncerramentoProposta aproveitada).
BLOCO VENCEDORES/CONCORRENTES: T15 responder "quem mais vendeu ultrassom no
Nordeste em 12 meses e por qual preço médio" em <2min (registre o caminho e
nº de cliques) · T16 dado de exemplo/fallback é impossível de confundir com
real (aviso visível) · T17 registre cobertura por ano: quantos registros 2023,
2024, 2025, 2026 (mede o ETL real) · T18 clicar num concorrente abre painel
dele (histórico, regiões, preços) ou é texto morto?
BLOCO MAPA: T19 tiles carregam e clique em município abre as oportunidades
dele · T20 do mapa à lista filtrada de um estado em ≤2 cliques.
BLOCO RADAR DE VERBA: T21 responder "10 municípios do CE com mais verba de
saúde empenhada e não gasta" em <30s · T22 a tela diferencia "não executado"
de "execução não informada" quando valorPago=0.
BLOCO TRANSVERSAL: T23 exportar Excel/CSV/PDF de uma lista e abrir o arquivo ·
T24 filtros sobrevivem a navegar e voltar · T25 usável em viewport mobile ·
T26 cronometrar login→dashboard, abrir oportunidades, aplicar filtro (>3s por
ação = atrito) · T27 filtro impossível (AC + score≥95) mostra mensagem útil,
não tela branca · T28 logout→login preserva CRM e favoritos.

## PASSO 4 — Auditoria de NEGÓCIO (cruzamentos)
B1. PROMESSA vs ENTREGA: para CADA feature listada nos planos (registro do
    P2), diga onde ela está na plataforma e se funciona (PASSA/FALHA com
    evidência). Feature vendida e não-encontrada = item de relatório crítico.
B2. COBERTURA vs "cobertura nacional": com os números do T17 + uma query no
    banco por UF, a promessa do plano Essencial se sustenta? Tabela UF ×
    registros × período.
B3. PREÇO: com o que funciona hoje, o Essencial entrega R$490/mês de valor
    para um fornecedor de 1 estado? O Pro justifica 2x? Argumente com base no
    que VOCÊ verificou nas tarefas (não em opinião abstrata).
B4. SEGURANÇA RÁPIDA: /api/debug responde sem auth? /admin nega usuário
    comum? A conta demo@govhealth.ai/demo123 ainda loga? (teste factual;
    reporte apenas o status).

## PASSO 5 — RELATÓRIO (formato obrigatório)
Gere `auditoria/RELATORIO.md` com:
1. Tabela das 28 tarefas: # | resultado | tempo | evidência | observação
2. Tabela B1 (promessa vs entrega)
3. Tabela B2 (cobertura por UF)
4. Top 10 problemas encontrados, ranqueados por impacto comercial, cada um
   com: evidência (screenshot), correção proposta, esforço estimado (P/M/G)
5. Resposta objetiva ao B3 (o preço se sustenta?) e B4 (status de segurança)
NÃO inclua opinião sem evidência. NÃO corrija nada ainda — este passo é só
diagnóstico. As correções seguem o ROADMAP-consultoria.md, jogada a jogada.