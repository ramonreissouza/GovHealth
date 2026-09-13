# Radar — portais públicos (sem login)

Como um portal entra no Radar **sem pedir credencial ao cliente**, e o que foi medido
no BLL e no BNC em 13/09/2026.

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

## Histórico não é notícia

Na primeira vez que o Radar vê um processo, o portal entrega o log **inteiro** de uma vez.
Todas essas linhas são novas para o banco. O enfileiramento mandava um e-mail por linha:
**246 mensagens de dez processos de teste**, quase todas sobre eventos de semanas atrás.

Por isso `run.mjs` só enfileira e-mail para mensagem com horário de origem dentro de
`JANELA_EMAIL_H` (48 h). O resto fica gravado e aparece na caixa do Radar — é contexto do
processo —, mas não toca o telefone de ninguém. Mensagem **sem** horário notifica: não dá
para afirmar que é velha.

## Verificando

```bash
node scripts/radar/run.mjs --publico-only --limit 5
```

O que esperar de uma passada saudável — e como ler cada estado:

| `detalhe` | Significa |
|---|---|
| `N mensagem(ns) em X/Y processo(s)` | leu de verdade; `Y-X` processos ainda não têm mensagem |
| `k página(s) não lida(s)` | falha parcial, contada e dita |
| `nenhuma das N página(s) pôde ser lida` (status `falha`) | o portal mudou — **nunca** vira "sem novidades" |
| `k compra(s) direta(s) sem quadro de mensagens` | não é falha: aquela tela não tem chat |
