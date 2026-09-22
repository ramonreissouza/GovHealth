# Radar do Compras.gov.br — plano de execução

**Escrito em 22/09/2026.** Destinado a ser executado por um modelo de menor custo, passo a
passo, sem tomar decisões de arquitetura. Toda decisão já foi tomada aqui. Onde houver
dúvida, **pare e pergunte** — não infira.

---

## O que aconteceu, em cinco linhas

Desde 13-14/09/2026 o login do fornecedor no gov.br, feito dentro do nosso navegador
hospedado, é recusado com `ERL0000900` mesmo com o captcha resolvido corretamente por um
humano. O Compras.gov.br é o único portal do Radar que exige sessão; os outros quatro são
lidos pela página pública. Resultado: o conector `comprasgov` está em `sessao_expirada`
desde 13/09, e três credenciais de cliente estão sem leitura.

---

## Medições já feitas — não refazer

Estas são medições, não hipóteses. Foram executadas e conferidas.

| # | Medição | Resultado | Data |
|---|---|---|---|
| M1 | Métodos de login do gov.br | Os cinco (CPF, banco, QR, certificado, certificado em nuvem) postam o **mesmo** formulário, que carrega `h-captcha-response`. Nenhum escapa. | 21/09 |
| M2 | Por que o QR falhou | O celular aprova sem captcha; a página então dispara o hCaptcha para finalizar. Chega o e-mail "login validado" e a tela não sai do lugar. | 21/09 |
| M3 | Custódia de `.pfx` de cliente | Colide com o art. 6º, § único da MP 2.200-2 ("exclusivo controle, uso e conhecimento" do titular). **Descartado por razão jurídica.** | 21/09 |
| M4 | `chaveCompra` derivável do que guardamos? | **Não.** Dos 8.820 processos `comprasgov`, **zero** têm link do comprasnet; todos apontam para `pncp.gov.br`. `contratacoes` não tem UASG. | 22/09 |
| M5 | A UASG está disponível? | **Sim, e é descartada.** `src/lib/types.ts:375` declara `unidadeOrgao.codigoUnidade`. Os três ingestores leem só `municipioNome` e `ufSigla`: `src/lib/pncp-ingest.ts:122-123`, `scripts/etl-pncp.mjs:198`, `scripts/etl-fornecedor.mjs:90`. | 22/09 |
| M6 | Colisão de modalidade PNCP×SIASG | **Não nos atinge**, porque nunca guardamos o código numérico do PNCP — só `modalidade_nome` (texto). Mapear por nome é inequívoco. | 22/09 |
| M7 | API pública do Compras.gov.br tem chat? | **NÃO.** `/compras/{chave}` e `/itens` existem; `/mensagens`, `/chat` e `/diligencias` devolvem **404** (rota inexistente). | 22/09 |
| M8 | A API pública funciona sem captcha? | **Não.** Sem o parâmetro `captcha=P1_<JWT>`, todo endpoint devolve **204 sem conteúdo** — vazio silencioso, não erro. | 22/09 |

**M7 e M8 juntos encerram a hipótese "existe uma porta grátis".** Ela não serve para chat.

### Formato da `chaveCompra` (confirmado observando a SPA)

```
02000105001022023  =  UASG(6) + modalidadeSIASG(2) + numero(5) + ano(4)  = 17 dígitos
                      020001      05                  00102      2023
```

O `filtro` da busca pública é um JSON url-encoded:
`{"abertasParaParticipacao":true,"emDisputa":true,...,"modalidade":"","unidadeCompradora":"","numeroAnoCompra":""}`

---

## A decisão

Duas frentes, **nesta ordem**. A primeira é barata e pode tornar a segunda menos urgente;
a segunda é a resposta durável e acontece de qualquer jeito.

### Frente A — testar a hipótese do ambiente (1 dia, pode ressuscitar o que já existe)

A issue **#53** do repositório oficial do gov.br (`servicosgovbr/manual-script-chatbot-login-unico`,
aberta em 06/09/2026) relata: captcha resolvido por humano, e-CNPJ A1 válido, e ainda assim
recusa quando o navegador roda em **servidor Linux de datacenter**. O **mesmo** certificado,
do **mesmo** datacenter, em **servidor Windows**, passa. De **conexão residencial**, passa.

Nosso ambiente de login é exatamente o perfil recusado: Chromium **Linux** em **container
Docker** (steel-browser), dirigido por **CDP**, exposto por **túnel**. O Chrome comum do
operador — que passa — é o perfil aceito.

**Nunca isolamos as variáveis.** Registramos no `MEMORY.md` "hCaptcha recusa navegador
automatizado" quando o que medimos foi "recusa Chromium Linux em container saindo por túnel
de datacenter". São hipóteses diferentes, e a evidência oficial sustenta a segunda.

Se a causa for o perfil de ambiente e não o CDP, a tela integrada que já existe volta a
funcionar mudando **onde** o navegador roda — sem contrato, sem API, sem obra.

### Frente B — a resposta durável

1. **Tela "estou participando deste"** — obrigatória em qualquer cenário, porque nenhuma
   API oferece "minhas compras por CNPJ" e participação não é pública antes da sessão.
2. **Integra Compras (SERPRO)** — a API oficial paga, com `GET /chat/{chaveCompra}` e
   `/chat/{chaveCompra}/diligencias`. É o único caminho medido que entrega chat sem sessão.

**O que o mercado faz, e por que não copiamos:** a Effecti custodia senha do gov.br e
**exige que o cliente desligue o 2FA** — passivo de LGPD nosso, e a arquitetura que acabou
de falhar. Licitante Prime, WaveCode e SIGA Pregão usam agente local (Electron, certificado
do store do Windows), que satisfaz o F5 por construção mas transforma o produto em
"monitorado enquanto o PC está ligado". ConLicitação e LicitaIA não pedem credencial nenhuma.
Nenhuma plataforma brasileira adotou o Integra Compras ainda.

---

# FASE 0 — Frente A: isolar a variável de ambiente

**Objetivo:** descobrir se a recusa é do CDP ou do perfil Linux/datacenter/túnel.
**Nada de código nesta fase.** É teste manual, com humano no teclado.

## 0.1 — Os três testes, nesta ordem

Em todos: o humano resolve o captcha; **ninguém automatiza o desafio**.

| Teste | Onde o navegador roda | Como | O que prova |
|---|---|---|---|
| T1 | Windows do operador, Chrome comum, **sem CDP** | login manual no gov.br pelo Compras.gov.br | linha de base (já sabemos: passa) |
| T2 | Windows do operador, **Chrome com CDP** (`--remote-debugging-port`, perfil dedicado via `--user-data-dir`) | Playwright `connectOverCDP`, humano digita | **isola o CDP.** Passou → o CDP não é a causa |
| T3 | steel-browser atual (Linux/Docker/túnel) | fluxo que já existe | confirma a falha conhecida |

> Chrome ≥136 só abre a porta de depuração com `--user-data-dir` apontando para um perfil
> dedicado. Sem isso o T2 não sobe e você vai achar que falhou por outro motivo.

## 0.2 — Critério de decisão

- **T2 passa e T3 falha** → a causa é o ambiente, não a automação. **Pare aqui e avise o
  humano.** A correção é mover o navegador para um host Windows ou saída residencial, e a
  tela integrada volta. As fases 1-4 continuam valendo, mas deixam de ser urgentes.
- **T2 falha igual ao T3** → a causa é o CDP. Siga para a Fase 1.
- **T1 falha** → algo mudou desde 20/09; pare e reavalie tudo.

## 0.3 — Registrar

Escreva o resultado em `docs/radar-navegador-hospedado.md`, com data, e **corrija a linha do
`MEMORY.md`** que hoje afirma "hCaptcha recusa navegador automatizado" para dizer apenas o
que foi medido.

---

# FASE 1 — Medir o teto de cobertura

**Objetivo:** saber quantos processos teriam `chaveCompra` montável. Esse número é o teto do
produto. **Nenhuma linha de código de produção antes disto.**

## 1.1 — Script

Crie `scripts/radar/medir-chave-compra.mjs`. Ele **só lê**, não escreve nada. Deve imprimir:

1. Total de `radar_processos` com `conector_id='comprasgov'`.
2. Quantos têm linha correspondente em `contratacoes` (via `licitacao_id` →
   `numero_controle_pncp`).
3. Desses, a distribuição de `modalidade_nome` (para dimensionar o de/para).
4. Quantos são de órgão **federal** — só esses existem no SIASG.

Use `novoPool` de `scripts/lib/pg-ssl.mjs` com handler de `'error'`, como em
`scripts/radar/run.mjs`. Não use `pg.Client` direto: ele derruba o processo quando o
PgBouncer fecha conexão ociosa.

## 1.2 — Critério de decisão

- **≥ 60% federais com modalidade mapeável** → siga para a Fase 2.
- **20-60%** → siga, mas avise o humano que isso é complemento, não substituto.
- **< 20%** → **pare e avise**. Não vale contratar API para essa fatia.

---

# FASE 2 — Guardar a UASG (independente de tudo)

**Objetivo:** parar de jogar fora o `codigoUnidade` que o PNCP já nos manda.
Esta fase é útil sozinha, mesmo que o resto seja cancelado.

## 2.1 — Arquivos

| Arquivo | Mudança |
|---|---|
| `db/` (nova migração) | `ALTER TABLE contratacoes ADD COLUMN uasg text` |
| `src/lib/pncp-ingest.ts:122` | ler também `c.unidadeOrgao?.codigoUnidade` |
| `scripts/etl-pncp.mjs:198` | idem |
| `scripts/etl-fornecedor.mjs:90` | idem |

> **Os três são arquivos-irmãos com o mesmo defeito.** Neste repositório já aconteceu três
> vezes de um conserto ser aplicado a um dos dois ou três arquivos que tinham o problema.
> Ao terminar, rode `grep -rn "unidadeOrgao" src scripts` e confirme que **todos** os pontos
> que leem `municipioNome` também leem `codigoUnidade`.

## 2.2 — Proibição explícita

**NÃO adicione uma coluna com o código numérico de modalidade do PNCP.** O `modalidadeId`
do PNCP colide com o do SIASG (PNCP 6 = Pregão Eletrônico; SIASG 6 = Dispensa). Guardar o
número convida alguém a usá-lo direto na chave, o que produz uma chave **bem formada e
errada** — ela não dá erro, devolve o chat de outra compra. Use sempre `modalidade_nome`.

## 2.3 — Como testar

`npm run radar:cobertura` antes e depois; e um `SELECT count(*) FROM contratacoes WHERE uasg
IS NOT NULL` após uma passada de ETL, que deve ser > 0.

---

# FASE 3 — Módulo puro `chave-compra` + de/para

**Objetivo:** uma função que monta a `chaveCompra` ou **se recusa** a montar.

## 3.1 — `scripts/radar/chave-compra.mjs`

Exporte:

```js
export const MODALIDADE_SIASG = {
  'Pregão - Eletrônico': '05',
  'Concorrência - Eletrônica': '03',
  'Dispensa': '06',
  'Concurso': '20',
  // completar a partir da distribuição medida na Fase 1
}

export function montarChaveCompra({ uasg, modalidadeNome, numero, ano }) {
  // devolve { chave } OU { erro: 'motivo legível' } — NUNCA adivinha.
}
```

Regras não negociáveis:

- Se `uasg` faltar, for vazia ou não tiver 6 dígitos → `{ erro }`. **Não completar com zeros
  à esquerda por conta própria** a menos que a Fase 1 prove que a UASG vem sempre com 6.
- Se `modalidadeNome` não estiver no de/para → `{ erro }`, nunca um padrão.
- A função **não faz requisição HTTP**. É pura. É o que a torna testável sem rede.

## 3.2 — `scripts/radar/chave-compra.teste.mjs`

Siga o padrão de `scripts/radar/connector-bll.teste.mjs`: sem rede, sem dormir, asserções
contadas, saída legível. **Casos obrigatórios:**

1. caso feliz → chave de 17 dígitos.
2. `uasg` ausente → erro, e a mensagem diz qual campo faltou.
3. modalidade desconhecida → erro.
4. **O teste que morde:** passar `modalidadeId: 6` (o número do PNCP) **deve falhar**. Este
   caso existe para que, se alguém um dia aceitar o código numérico, o teste quebre.
5. ano com 2 dígitos → erro (não expandir para 4).

Registre em `package.json`: `"radar:chave:teste": "node scripts/radar/chave-compra.teste.mjs"`.

## 3.3 — Critério de pronto

`npm run radar:chave:teste` verde, e a bateria completa (177 asserções) continua verde.

---

# FASE 4 — Tela "estou participando deste"

**Objetivo:** o fornecedor marca, com um toque, os pregões em que realmente entrou.
**Esta fase é independente das outras três e entrega valor sozinha.**

Ela resolve o furo que nenhuma API resolve: não existe "minhas compras por CNPJ", e a
participação é sigilosa até a sessão. Também corta a conta da API em ~95%, porque o cliente
entra em 5-20 pregões por mês, não em 519.

## 4.1 — Banco

Coluna nova em `radar_processos`: `participando boolean not null default false`, mais
`participando_em timestamptz`. Migração no padrão do repositório.

## 4.2 — UI

Em `src/app/radar/page.tsx`, na lista de processos: um controle de um toque por linha
("Estou participando"). Sem modal, sem formulário, sem confirmação. Rotular pelo que o
fornecedor reconhece — ele "entra num pregão", não "habilita monitoramento".

## 4.3 — API

`src/app/api/radar/processos/route.ts` — endpoint para alternar o campo. Respeite o
isolamento por `titular_id` que já existe em todas as rotas do Radar; copie o padrão de uma
rota vizinha, não invente.

## 4.4 — Critério de pronto

Marcar e desmarcar persiste, sobrevive a reload, e um titular não vê nem altera processo de
outro. Teste esse último ponto explicitamente.

---

# FASE 5 — Conector do Integra Compras

**Só comece se a Fase 1 autorizou e o contrato estiver assinado.**

Contratação: Loja Serpro, exige e-CNPJ da GovHealth, acesso em até 10 min, cancelável a
qualquer momento. O e-CNPJ é usado **só para contratar**; as chamadas usam `Bearer`, então
nenhum `.pfx` de cliente fica sob nossa guarda.

## 5.1 — Antes de escrever o conector: validar em homologação

Servidor de homologação: `gateway.apiserpro.serpro.gov.br/integra-compras-hom/v1`.

Duas perguntas que **só o ambiente responde**, e que mudam o desenho:

1. **O `sequencial_compra` do PNCP é o mesmo `numero` do SIASG?** São sistemas de numeração
   diferentes. Monte 10 chaves a partir de processos reais e confira se voltam as compras
   certas. **Se não baterem, pare** — o de/para de numeração é outro problema.
2. **O chat é o do certame do nosso cliente, ou só o público?** Se for só o público, isto
   complementa o conector, não o substitui.

## 5.2 — Economia: o que o desenho tem de evitar

- O FAQ oficial diz: *"Todas as solicitações com o código de retorno HTTP 200, 206, 404 são
  cobradas"*. O poll ocioso devolve **404** — e é ~95% das chamadas de um radar.
  **Só chamar para processos com `participando = true`.**
- A página é fixa em 20 itens; `size=100` é ignorado. Orçar `ceil(n/20)` chamadas.
- Há indisponibilidade programada de fim de semana. O conector deve tratar isso como
  `portal_indisponivel`, não como falha.

## 5.3 — Minimização de dados

A resposta traz o chat inteiro da compra, incluindo CPF do pregoeiro e mensagens dirigidas a
concorrentes. **Filtre por `identificadorDestinatario` no momento da ingestão e não persista
o que não é do nosso cliente.** Não grave primeiro para filtrar depois.

## 5.4 — Onde encaixa

Crie `scripts/radar/connector-comprasgov-api.mjs` **ao lado** do existente, sem apagá-lo.
A coluna `radar_credenciais.metodo` hoje é escrita em 5 lugares e **nunca lida**: passa a ser
lida aqui, para escolher o conector. Siga a forma de `connector-comprasbr.mjs`, que já é um
conector de API pura (sem navegador).

## 5.5 — Sombra obrigatória

**Não apague nenhum `storage_state` por duas semanas.** Rode os dois conectores em paralelo e
compare o que cada um traz. Só depois de duas semanas de comparação é que se decide desligar
o caminho antigo.

---

# FASE 6 — Estreitar o que guardamos (independente, e urgente)

Achado que não é sobre nenhuma das propostas: o que o cofre guarda hoje **não é a sessão do
Compras.gov.br**. São 4 cookies do `sso.acesso.gov.br` — a sessão do **Login Único da pessoa
física**, que abre e-CAC, Meu INSS, FGTS, Conecte SUS (dado de saúde, art. 11 da LGPD).

`scripts/radar/capture.mjs` faz `JSON.stringify(await context.storageState())` **sem recorte
nenhum**, e `sessaoTemCredencial()` só exige que exista algum cookie.

**Tarefa:** filtrar o `storageState` no momento da captura, mantendo apenas os cookies dos
domínios estritamente necessários para ler o Compras.gov.br. Descartar o resto antes de
cifrar. Teste: capturar uma sessão e verificar que nenhum cookie de domínio fora da lista
sobreviveu.

Isto vale independentemente de qual frente vencer, e reduz um passivo real.

---

# Regras da casa (valem em todas as fases)

1. **Medir antes de codar.** Toda fase começa por um número.
2. **Arquivos-irmãos.** Ao consertar algo, procure o gêmeo. Já aconteceu três vezes neste
   repositório de um conserto pegar só um dos arquivos com o mesmo defeito.
3. **Renomear é atômico.** Se renomear uma variável, renomeie parâmetro e chamadas **no mesmo
   passo**. `node --check` **não** pega `ReferenceError`; já passou despercebido aqui.
4. **CRLF.** O repositório usa CRLF. Regex de manipulação de texto usa `\r?\n`.
5. **Nunca `pg.Client` solto.** Use `novoPool` com handler de `'error'`, senão o processo
   morre quando o PgBouncer fecha conexão ociosa.
6. **Falha honesta.** Nunca reportar "sem novidades" quando a leitura não aconteceu. O 204
   silencioso da API pública (M8) é exatamente o modo de falha a evitar.
7. **Nada de burlar captcha ou 2FA** (requisito 4.2 + ToS). Nada de solver, de stealth
   plugin, de falsificar fingerprint. Mudar **onde** o navegador roda é legítimo; mudar
   **o que ele declara ser** não é.
8. **Na dúvida, pare e pergunte.** Este plano prefere uma pergunta a uma suposição.
