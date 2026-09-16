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

---

# Onda 2 — medida antes de escrita (15/09/2026)

## A primeira medição da Onda 2 estava ERRADA — e o erro foi meu, não do backlog

> **Correção registrada em 15/09/2026.** A versão anterior desta seção afirmava que
> Betha, IPM, GovernançaBrasil, Megasoft, GOVTEC e Elotech tinham **0 licitações** na base
> e concluía que a Onda 2 era "categoria errada". **As duas coisas eram falsas.** Fica
> escrito porque o erro é instrutivo e pode se repetir.

O que aconteceu: a busca foi feita por `link_externo`. Essas casas **não publicam link
nenhum** — então voltaram zeradas, e o zero foi lido como ausência em vez de como
ausência de URL. Procurando pelo campo certo (`usuario_nome`, que o PNCP preenche), elas
são das maiores da base:

| casa de software | licitações (180d) | abertas hoje | % com `link_externo` |
|---|---:|---:|---:|
| Betha Sistemas | 3.890 | 136 | **0%** |
| IPM Sistemas | 3.880 | 358 | **0%** |
| GovernançaBrasil | 3.714 | 157 | **0%** |
| Megasoft Informática | 3.589 | 98 | **0%** |
| GOVTEC | 2.499 | — | **0%** |
| Elotech | 2.022 | 96 | **0%** |
| E & L Produções | 1.519 | 61 | **0%** |
| SMARAPD | 1.407 | 56 | **0%** |

Confirmado na fonte, não inferido: o endpoint de consulta do PNCP
(`/api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`) **tem** o campo
`linkSistemaOrigem`, e para essas casas ele vem `""`, `" "` ou `null`. O PNCP oferece o
lugar; quem publica é que deixa vazio.

**Regra que fica:** antes de concluir que um portal não existe na base, medir por
`usuario_nome`, não por `link_externo`. O primeiro diz *quem* publicou; o segundo, só
*onde* — e "onde" é exatamente o que falta nos casos difíceis.

### Por que, ainda assim, elas continuam fora

O motivo real não é volume, é **endereço**. Para ler a página de um processo é preciso
saber onde ela está, e para essas casas não há de onde tirar isso:

- o PNCP não publica (acima);
- não há portal central: `farroupilha.atende.net` (IPM) responde, mas é **um subdomínio
  por município** — seriam 129 domínios só para o IPM, descobertos um a um;
- e o que responde é SPA: a página de licitações do Atende.Net não renderiza nada sem
  navegador.

A descoberta seria O(municípios), não O(portais) — outra ordem de grandeza do resolvedor
do PCP, que tem uma API de busca única para um portal só. Elas ficam fora **por custo de
descoberta**, com o motivo certo desta vez.

## O que realmente sobrou sem cobertura

Hosts com pregão ABERTO hoje que nenhum conector atende — aberto é o que importa, porque
chat de processo encerrado não muda decisão nenhuma:

| host | total | abertas | veredito |
|---|---:|---:|---|
| `app2.licitardigital.com.br` | 5.889 | 399 | **bloqueado** — `Cf-Mitigated: challenge`, ressondado em 15/09/2026 e segue fechado |
| `licitacoes-e2.bb.com.br` | 5.552 | 181 | sem chat público (Onda 1) |
| `sai.io.org.br` | 2.504 | 62 | **só repositório de arquivos** |
| **`comprasbr.com.br`** | 329 | 54 | **ligado** — a página é inútil, a API não (ver abaixo) |
| `www.transparencia.pr.gov.br` | 6.107 | 53 | portal de transparência, não de disputa |
| `www1.compras.mg.gov.br` | 2.186 | 47 | estadual — candidato de Onda 3 |
| `www.compras.rj.gov.br` | 2.516 | 42 | estadual — candidato de Onda 3 |
| **`pregaobanrisul.com.br`** | 1.231 | 39 | **ligado** |
| `www.peintegrado.pe.gov.br` | 3.497 | 38 | estadual — candidato de Onda 3 |
| **`www.compras.rs.gov.br`** | 1.741 | 28 | **ligado** |

Cobertura de pregões abertos antes da Onda 2: **3.990 de 7.467 (53,4%)** — contando o
Compras.gov.br, que é conector de LOGIN e enxerga pela área do próprio cliente, sem
precisar de link.

Outros 2.286 (31%) não têm `link_externo` nenhum. **Atenção ao que isso significa e ao que
não significa**: 2.284 desses 2.286 *têm* `usuario_nome`, então sabemos perfeitamente de
quem são — são as casas de software da seção anterior. Não é anonimato, é falta de
endereço. O teto não é "não sabemos de quem é"; é "não há para onde ir".

### Onde medir a cobertura muda a resposta

O ranking nacional engana. Restringindo às UFs em que há cliente ativo (RN, SP, GO, PB,
PE, MT, BA, CE, AL, SE), o quadro se inverte:

| | abertas | cobertas |
|---|---:|---:|
| Brasil | 7.467 | 3.990 (53,4%) |
| **Só UFs de cliente** | 3.130 | **1.838 (58,7%)** |

O maior gap do país — Licitar Digital, 393 abertas — **nem aparece no top 12 das UFs de
cliente**: é plataforma do Sul/Sudeste, como IPM, Betha e GovernançaBrasil. O mesmo vale,
com desconforto, para o eGov RS que ligamos: **0 abertas** nas UFs de cliente.

Os gaps que de fato pesam para quem paga hoje são outros: Licitações-e BB (105), BBMNET
(101), Fiorilli (85), Megasoft (84), BR Conectado (75), Bahia (46), Pernambuco (43) e
ASJB/Sergipe (37).

### BR Conectado: por que parecia o melhor e não era

Ele encabeçou a lista de "vale a pena" por um motivo que não sobreviveu à conferência:
100% das suas licitações têm `link_externo`. Só que **os 3.461 links são domínio puro, sem
caminho** — `http://www.portaldecomprascodo.com.br`, sem id de processo — espalhados por
**257 domínios**. O link existe e não leva a lugar nenhum. É o mesmo problema de descoberta
das casas de software, disfarçado de link.

Fica a regra: `pct_com_link` não basta; é preciso conferir se o link tem **caminho**.
Aplicado aos candidatos, isso reduz a lista a dois — Compras BR (1 domínio, 329 com
caminho) e ASJB/Sergipe (3 domínios, 1.767 com caminho, servidor fora do ar na sondagem de
15/09).

O `sai.io.org.br` merece nota porque parecia promissor e não era: ele **redireciona para o
domínio da própria prefeitura** mantendo a rota
(`lafaietecoutinho.ba.gov.br/site/licitacao/…`), o padrão "um app, muitos domínios" que já
rendeu BLL/BNC. Mas a seção "Fases externas" é uma lista de anexos (processo
administrativo, edital) — não há comunicação de certame.

## eGov RS (Compras RS + Pregão Banrisul) — ligado

Mesma aplicação em dois domínios, terceiro caso do padrão depois de BLL/BNC e AMM/Licitar
Digital. A rota do edital é idêntica nos dois — `/editais/<numero>_<ano>/<idOffer>` — e a
página do Banrisul aponta, nela mesma, para `compras.rs.gov.br/egov2/…`. Dois ids no
catálogo (`egovrs`, `banrisul`), um conector só (`connector-egovrs.mjs`).

### O que se lê

A **ata de esclarecimentos e impugnações**, em
`egov2/offer/offerPetition/electronicRecord.ctlx?idOfferFiltered=<idOffer>`. Não é aviso de
que houve pergunta: é a pergunta inteira, a resposta inteira, quem respondeu, quando, e no
caso de impugnação o **julgamento**. Capturado sem login em 15/09/2026 (edital 0038/2026,
Veranópolis/RS):

```
Esclarecimento nº 34335 — "os serviços de Enfermeiro e Técnico de Enfermagem foram
   desmembrados do objeto (…) e passaram a compor procedimento licitatório próprio
   (Pregão Eletrônico nº 039/2026)"  — LILIA RECHE CENCI, 10/07/2026 13:34
Impugnação nº 34428 — Julgamento: Negado — 21/07/2026 15:53
```

É o conteúdo mais decisivo dos portais públicos ligados até aqui: muda proposta, não só
avisa que algo aconteceu.

### O que este conector se recusa a ler

A mesma página oferece a **Ata Eletrônica** (`acessarAtaEletronica.ctlx`), que traria a
sessão de lances inteira. Ela está atrás de uma validação que o próprio portal explica:
*"Esta validação ajuda o Portal de Compras a evitar consultas por programas automáticos
(robôs)"*. É desafio anti-robô, e o Radar não contorna desafio anti-robô (requisito 4.2 +
ToS) — o mesmo motivo de o Licitar Digital estar fora. Só a ata de esclarecimentos entra, e
ela é aberta: **37 de 37** processos sondados responderam 200 sem cookie, sem `siteContext`
e sem validação nenhuma.

### Não usa navegador — e é isso que muda o teto

A página é HTML servido pronto (JSP antigo, tabelas com `bgcolor`). Um `fetch` basta. Os
outros conectores públicos custam ~12 s por processo esperando o Vue montar; aqui é ~0,5 s.
Por isso `TETO_PROCESSOS = 400` e não 60: o gargalo deixou de ser o navegador e passou a
ser a educação com o portal (350 ms entre chamadas).

### A armadilha do parser, e por que ela não é teórica

O texto plano **não** serve para achar as fronteiras dos registros. Os anexos se chamam
`"Resposta"` e `"PEDIDO DE IMPUGNAÇÃO"` — os mesmos nomes dos marcadores. Um parser que
procure esses textos abre um registro fantasma dentro do anterior, e o cliente recebe uma
impugnação que nunca existiu.

As fronteiras vêm da **estrutura**, que é explícita e estável: `<tr bgcolor="#dddddd">`
abre um pedido, `<tr bgcolor="#efefef">` marca protocolo e resposta, os campos são
`<b>Rótulo:</b> valor</td>`, e anexo é sempre `<a>`, nunca `<b>`. O teste
(`npm run radar:egovrs:teste`, 28 asserções) trava exatamente isso: o fixture inclui os
anexos com nome de marcador e exige **3** registros, não 5.

### Pergunta e resposta são mensagens separadas

O dedup é `sha256(conector, licitação, autor, texto, horário)`. Numa mensagem só, o pedido
ainda sem resposta entraria com um texto e, ao ser respondido, o texto MUDARIA — hash novo,
e o cliente receberia a pergunta de novo junto com a resposta. Separadas, a pergunta entra
uma vez e depois chega só a resposta, que é a novidade.

Pelo mesmo motivo `Situação:` fica fora do texto: ela vai de "Aguardando" para "Respondido"
e ressuscitaria a mensagem inteira. Na resposta entra o `Julgamento`, que é o que decide se
o edital mudou — e ele vem antes do texto, de propósito.

### Estado honesto: ligado e ocioso

Atribuição conferida contra a base inteira: 1.741 (`egovrs`) + 1.232 (`banrisul`) = 2.973
licitações, **zero disputadas** com os portais já existentes.

Mas **nenhum cliente hoje monitora o RS** — os processos ativos estão em GO, CE, BA e PE. O
conector está ligado, testado contra páginas reais e ocioso: não produzirá mensagem nenhuma
até existir cliente gaúcho no Setup. Isso não é defeito, e não deve ser lido como falha na
tela de saúde — mas também não pode ser confundido com "rodando em produção".

### Verificando

```bash
npm run radar:egovrs:teste
```

```bash
node scripts/radar/run.mjs --dry --publico-only --limit 5
```

## Compras BR — o primeiro que se lê por API, e não por página

`connector-comprasbr.mjs`, id `comprasbr`. É o portal da **AZ Tecnologia em Gestão**, e o
único ligado até aqui em que **a página do processo não é lida**.

### Como foi achado, porque o caminho é o aprendizado

O link que o PNCP publica — `comprasbr.com.br/pregao-eletronico-detalhe/?idlicitacao=<id>`
— **redireciona para a home**. Aberto no navegador, o conteúdo real vem de um `<iframe>`
apontando para `app.comprasbr.com.br/licitacao-pub/`, e dentro dele um Angular consome uma
API REST. Lendo a aba de rede, a API apareceu inteira:

```
GET app.comprasbr.com.br/licitacao-readonly/api/public/v1/licitacoes/<id>/esclarecimentosImpugnacoes
GET app.comprasbr.com.br/licitacao-readonly/api/licitacao/public/portal/paginaInterna/idLicitacao=<id>
```

Pública, sem token, sem cookie: **25 de 25** processos responderam 200. E o `idlicitacao`
do link do PNCP é o **mesmo id** da API — nada a resolver.

Então o conector pula a página e fala com a API. Sem navegador, ~1 s por processo contra
os ~12 s dos conectores com Playwright; daí o teto de 300 por passada.

### O melhor aproveitamento medido — e o que falta nele

**36%** dos processos têm esclarecimento ou impugnação registrada, contra 16% do eGov RS.
O que entra é o `assunto`, escrito pelo próprio fornecedor, e ele costuma ser específico:

```
[Esclarecimento nº 18198] — CATETERES INFANTIS — Situação: respondido
[Impugnação nº 18303] — Impugnação de edital — Situação: respondido
[Esclarecimento nº 18526] — Quantas casas decimais devemos considerar? O sistema está recusando.
```

O que o portal **não** dá é o corpo da pergunta nem o da resposta: os dois vivem em PDF.
Isso está dito no `detalhe` de toda passada ("o teor fica no documento anexado"), para
ninguém ler o alerta achando que leu o mérito.

Metade dos fornecedores escreve a pergunta inteira no `assunto`, com quebra de linha — o
conector colapsa o espaço em branco, senão a quebra crua estraga o e-mail e a caixa.

### A situação ENTRA no texto aqui — ao contrário do eGov RS

No eGov RS a `Situação` fica fora, porque lá existe o texto da resposta: a resposta
chegando já prova que foi respondida.

Aqui é o oposto, pelo mesmo raciocínio. Sem corpo de resposta, **a mudança de situação é o
único sinal** de que o órgão respondeu. Com ela no texto, o hash muda de `AGUARDANDO` para
`RESPONDIDO` e o fornecedor recebe exatamente um aviso: *o que perguntaram foi respondido,
vá ler o anexo*. Sem ela, esse fato nunca chegaria.

### Status do processo: lista de inclusão, não de exclusão

O segundo endpoint traz `status` e `fase`. Só **ruptura** vira mensagem — `SUSPENSO`,
`REVOGADO`, `CANCELADO`, `ANULADO`, `FRACASSADO`, `DESERTO`, `REABERTO`. Rotina
(`ABERTO`, `AGUARDANDO_ABERTURA`, `ENCERRADO` — 40 de 40 numa amostra) fica calada: emiti-la
daria uma mensagem por processo já na primeira visita, afogando o que importa. Status novo
que o portal invente fica de fora até alguém decidir que é notícia — aqui o erro seguro é o
silêncio sobre rotina, não o alarme sobre tudo.

O portal não data a mudança de status, e o conector **não inventa horário**: `null`. Datar
faria a mensagem passar pela janela de 48 h do e-mail como se fosse novidade de hoje.

### O que este conector se recusa a gravar

Cada pedido vem com o objeto `fornecedor` **completo** de quem o protocolou — CNPJ, razão
social, endereço, telefone, e-mail — mais o e-mail em `usuarioCadastro`. É dado de um
terceiro (um concorrente do nosso cliente), e nada disso é necessário para avisar que o
edital foi questionado. Os dois campos são descartados na leitura e **nunca chegam ao
`raw`** gravado no banco. Quatro asserções do teste existem só para isso.

### Quanto isso move o ponteiro

| | abertas no Brasil | nas UFs de cliente |
|---|---:|---:|
| Compras BR | 55 | **18** |
| eGov RS + Banrisul | 67 | **0** |

Cobertura de pregões abertos depois dos dois: **54,2% no Brasil**, **58,7% nas UFs onde há
cliente** (era 53,4% / 58,1%). É ganho pequeno — dito de frente. O Compras BR entrou por
ser o mais barato e o de melhor aproveitamento, não por volume.

### Verificando

```bash
npm run radar:comprasbr:teste
```
