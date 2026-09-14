# Radar — portais públicos (sem login)

Como um portal entra no Radar **sem pedir credencial ao cliente**, e o que foi medido
nos portais da Onda 1 em 13-14/09/2026.

## Por que o modo público importa

O caminho autenticado tem um teto que não é de implementação. No Compras.gov.br, a área
do fornecedor lista **só os pregões em que a empresa já participa** — sondado em
13/09/2026 com sessão real: `Acompanhar.asp` responde "não existem licitações para
acompanhar" quando não há participação. Ou seja: pelo login, um pregão que o cliente
ainda está avaliando é invisível.

A página pública não tem esse teto. Ela é a mesma para todo mundo, e por isso cobre
exatamente o que o cliente ainda não disputa.

A rota pública do **Compras.gov.br** foi sondada e está fechada: as três rotas com
conteúdo (`acompanhamento-compra`, `item/:numeroitem`, `quadro-informativo`) passam por
um *resolver* de CAPTCHA que injeta o token no `obterCompra(...)`. Sem token, a API nem
é chamada. Não se burla CAPTCHA (requisito 4.2 + ToS).

## O que é preciso para ligar um portal público

Quatro peças. Nenhuma delas envolve senha do cliente.

| Peça | Arquivo | O que responde |
|---|---|---|
| Catálogo da UI | `src/lib/radar/conectores.ts` | nome, `modoPublico: true`, `dominio` |
| Registro do worker | `scripts/radar/portais.mjs` | `publico: true`, `dominio`, entra em `PORTAIS_PUBLICOS` |
| Conector | `scripts/radar/connector-<id>.mjs` | como abrir a página e extrair as mensagens |
| Seed | `db/schema-radar.sql` | `radar_conectores` (o `conector_id` tem FK) |

O orquestrador (`scripts/radar/run.mjs`) **não** precisa ser tocado: a passada pública
percorre `PORTAIS_PUBLICOS`. Antes ela tinha `'pcp'` escrito na mão em cinco lugares, e
foi por isso que BLL e BNC ficaram parados mesmo com a página aberta a qualquer um.

### De onde vem a URL da página do processo

Duas famílias, e confundi-las custa trabalho à toa:

- **O PNCP publica o endereço** (BLL, BNC): `contratacoes.link_externo` já traz a URL do
  processo. `sincronizarSelecao` grava esse link em `radar_processos.link_portal`
  (via `linkDoProcesso`, que usa `licitacaoDoPortal` para não colar link de um portal em
  processo de outro). O worker lê dali. **Nada a resolver.**
- **O PNCP não publica** (PCP): 19.023 licitações trazem só a marca `[Portal de Compras
  Públicas]` no objeto, contra 530 com link. Daí o resolvedor
  (`scripts/radar/pcp-resolver.mjs`), que procura o processo e cacheia o achado.

## BLL e BNC — o que foi medido

**São a mesma aplicação em dois domínios.** Mesma rota (`/Process/ProcessView?param1=[gkz]…`),
mesmas abas, mesmo DOM. Um conector atende os dois (`connector-bll.mjs`); os ids ficam
separados só para o cliente ver o nome certo do portal.

Caminho da leitura, seguido do próprio portal (não adivinhado):

1. a página do processo abre **sem cookie nenhum**;
2. a aba "Mensagens" é um `<button>`; ele dispara `GET /BatchList/GetProcessMessageView`;
3. o modal faz `POST /BatchList/GetProcessMessageList` e injeta as linhas em `tbody#MsgProcess`;
4. cada linha é `<td class="datetimesecwidth">DD/MM/YYYY HH:MM:SS</td><td>texto</td>`.

O `param1` do passo 2 **não** é o da URL do processo — é outro token, gerado pela página.
Por isso o conector clica na aba em vez de montar a URL do endpoint: chamar direto exigiria
forjar o token, e quebraria no primeiro deploy deles.

Exemplos reais capturados sem login:

```
11/09/2026 15:58:18  O condutor alterou o intervalo mínimo entre lances para 1%.
11/09/2026 11:39:57  O arquivo 8. Chamamento publico VACINA.pdf foi removido pelo condutor.
11/09/2026 14:17:38  O pregoeiro original (…) foi substituído pela autoridade (…).
```

### Dois limites, ditos de frente

- **Compra direta não tem quadro de mensagens.** `/DirectBuy/` (2.090 links da base) é
  outra tela, e ela simplesmente não tem a aba — medido em três páginas nos dois portais.
  O conector separa esse caso (`ehCompraDireta`) em vez de acumular falha permanente.
- **A sala de disputa ao vivo continua exigindo a sessão do fornecedor.** O que o modo
  público entrega é o *log* do processo. Isso está escrito no `detalhe` de toda passada.

### Teto por passada

`TETO_PROCESSOS = 60` no conector. Cada processo custa ~12 s de navegador, e BLL+BNC
respondem por ~6,3 mil contratações de saúde em 180 dias. O worker manda os processos
**ordenados por proximidade da sessão**, então o teto corta a cauda fria, não o que
importa — e o truncamento aparece no `detalhe`.

## Licitanet — o painel mais rico dos que ligamos

`/sessao/<id>`, sob o título "Sessão Pública — Visualize o andamento do processo
licitatório". O painel "Mensagens · Comunicação da sessão" abre sem conta e sem cookie.
São 3.115 contratações de saúde em 180 dias (a rota antiga `/acesso-visitante`, com 7.103
no total, tem só 1 recente — está morta).

Aqui não é log de arquivo: é a comunicação do certame, com o **prazo escrito dentro do
texto**. Capturado sem login em 13/09/2026:

```
o Processo nº 040/2026 foi SUSPENSO. A REABERTURA será no dia 24/09/2026 09:00
A manifestação de Intenção de Recurso de (…) foi recebida (…) razões até 17/09/2026
   e os outros interessados contrarrazões até 22/09/2026
o Processo nº 021/2026 foi REVOGADO pelo seguinte motivo: Em anexo.
```

Três detalhes que decidem a implementação:

- **O painel só renderiza quando entra em tela.** A página é Vue e monta o bloco sob
  demanda: sem rolar até "Comunicação da sessão", o DOM não tem mensagem nenhuma — e o
  conector leria zero achando que leu. É por isso que `lerSessao` rola antes de extrair.
- **A âncora é `<time datetime="…">`**, não classe CSS. Vem em ISO com fuso, direto do
  portal: não depende das utilitárias do Tailwind (que mudam a cada build) e dispensa
  reparsear data em português.
- **O lote entra no texto** (`[ITEM-02] …`). Duas mensagens idênticas no mesmo segundo,
  uma por item, são o caso normal — foi o que o portal devolveu em Cruz das Almas/BA. Sem
  o lote, o dedup por hash colapsaria as duas e o fornecedor perderia que o fato
  aconteceu nos dois itens.

## AMM Licita — o quadro mais decisivo, e o gêmeo que ficou de fora

`/pesquisa/<id>`, aberto sem conta. 864 contratações de saúde em 180 dias.

**É a mesma aplicação do Licitar Digital** — mesma rota, ids na mesma faixa numérica,
provavelmente a mesma instalação com dois domínios. A diferença está no portão:
`app2.licitardigital.com.br` responde com o desafio de robô da Cloudflare (HTTP 403,
`__cf_chl_rt_tk` na URL) e `app2.ammlicita.org.br` não. O Radar não contorna proteção de
robô, então só o domínio aberto entra. O conector já serve aos dois: se um dia abrir,
basta acrescentar o id ao catálogo.

Dois quadros são lidos, e os dois valem:

- **Solicitações** — impugnação, esclarecimento e recurso, com o pedido, a resposta, os
  anexos e **o desfecho no título**: `Impugnação - VALE COMÉRCIO DE MOTOS LTDA INDEFERIDA`,
  `Esclarecimento - LF MOTOS PECAS E SERVICOS LTDA RESPONDIDA`, `Recurso - A4CLTDA PENDENTE`.
  É o quadro mais decisivo de todos os portais ligados: impugnação deferida muda o edital,
  e quem descobre depois perde a licitação.
- **Avisos** — atos do condutor sobre os lotes, assinados e datados:
  `Lote 1 foi declarado como fracassado. Motivo do fracasso: Outros. Deserto —
  AILTON PEREIRA GOULART - 11/09/2026 11:00`.

Três detalhes de implementação:

- **A âncora é `header > h1`** ("Solicitações", "Avisos"), nunca classe. A página é
  Material-UI com styled-components e as classes são hashes (`sc-cmaqmh rwTQm`) que trocam
  a cada build — ancorar nelas é garantir quebra silenciosa.
- **Dois formatos de data no mesmo processo**: as solicitações escrevem "7 de setembro de
  2026 às 22:35" e os avisos "11/09/2026 11:00". `horarioPorExtensoParaISO` cobre o
  primeiro e `horarioBrParaISO` o segundo; os dois viram ISO -03:00.
- **O desafio de robô tem estado próprio.** Se a Cloudflare aparecer aqui, o conector
  devolve `portal_indisponivel` dizendo exatamente isso — não é falha nossa, não é
  problema do cliente, e principalmente não é "sem novidades". O detector foi exercitado
  contra os dois domínios: `true` no licitardigital, `false` no ammlicita.

## O resto da Onda 1, medido

Sondado em 13-14/09/2026, com navegador limpo e User-Agent de navegador comum:

| Portal | 180 dias | Veredito |
|---|---:|---|
| BLL + BNC | 6.236 | **ligado** — log público do processo |
| Licitanet | 3.115 | **ligado** — comunicação da sessão |
| Licitar Digital (`app2.licitardigital`) | 1.673 | **bloqueado** — desafio de bot da Cloudflare (HTTP 403). Não se contorna |
| AMM Licita (`app2.ammlicita`) | 864 | **ligado** — Solicitações (impugnação/esclarecimento/recurso) + Avisos do condutor |
| Licitações-e (BB) | 1.993 | **sem chat público** — a rota `visualizar-processo-publico` traz dados e anexos, nada de mensagem, nem com a disputa encerrada |
| Licita+Brasil | 407 | **exige login** — a página de edital redireciona para autenticação |
| Compras BR | 178 | volume marginal |

Duas observações que valem mais que o número:

- **Licitar Digital e AMM Licita são o mesmo sistema** (mesma rota `/pesquisa/<id>`, ids
  na mesma faixa). O conector foi escrito e cobre os dois — mas só a AMM entrou, porque
  metade está atrás da Cloudflare e o Radar não burla proteção de bot (requisito 4.2 +
  ToS). São 0,8% da base hoje; se o outro domínio abrir, é uma linha no catálogo.
- **O Licitações-e não é caso de calibração, é caso de ausência.** O chat do BB fica atrás
  do login do fornecedor. O caminho que sobra é a Ata, ainda não verificado.

## Histórico não é notícia

Na primeira vez que o Radar vê um processo, o portal entrega o log **inteiro** de uma vez.
Todas essas linhas são novas para o banco. O enfileiramento mandava um e-mail por linha:
**246 mensagens de dez processos de teste**, quase todas sobre eventos de semanas atrás.

Por isso `run.mjs` só enfileira e-mail para mensagem com horário de origem dentro de
`JANELA_EMAIL_H` (48 h). O resto fica gravado e aparece na caixa do Radar — é contexto do
processo —, mas não toca o telefone de ninguém. Mensagem **sem** horário notifica: não dá
para afirmar que é velha.

### E um pregão vivo também não é uma caixa de entrada

A janela de 48 h resolve o histórico, não a enxurrada. Num pregão de 213 itens do
Licitanet o portal narra **cada item** ("o ITEM 212 está na fase competitiva", "o ITEM 213
foi encerrado") — centenas de mensagens legítimas e recentes numa tarde só.

`TETO_EMAIL_PROCESSO` (5) limita quantas viram e-mail por processo a cada passada, **as de
prioridade alta primeiro** e, entre iguais, as mais recentes. O resto continua gravado,
classificado e visível na caixa. O teto corta o toque no telefone, não a informação — e a
passada informa quantas conteve.

## Verificando

```bash
node scripts/radar/run.mjs --publico-only --limit 5
```

`--publico-only` roda só os portais públicos (o nome antigo `--pcp-only` continua valendo).

O que esperar de uma passada saudável — e como ler cada estado:

| `detalhe` | Significa |
|---|---|
| `N mensagem(ns) em X/Y processo(s)` | leu de verdade; `Y-X` processos ainda não têm mensagem |
| `k página(s) não lida(s)` | falha parcial, contada e dita |
| `nenhuma das N página(s) pôde ser lida` (status `falha`) | o portal mudou — **nunca** vira "sem novidades" |
| `k compra(s) direta(s) sem quadro de mensagens` | não é falha: aquela tela não tem chat |
