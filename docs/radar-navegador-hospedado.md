# Radar — navegador hospedado (login do gov.br dentro da tela)

Como o fornecedor conecta a conta gov.br sem que ninguém digite senha para ele, e o que
foi preciso consertar antes de isso poder existir.

## 1. Por que existe

O Radar monitora o chat dos pregões, e para isso precisa de uma **sessão autenticada**
do gov.br do fornecedor. Não guardamos a senha: o fornecedor faz o login na página
oficial e nós capturamos só a sessão, cifrada.

O login precisa acontecer num navegador **que nós controlamos** — é de lá que a sessão é
extraída. Vercel não roda navegador, então existe um serviço fora dela.

## 2. As peças

```
navegador do fornecedor
   │  (iframe, https)
   ▼
browser-service  ──►  steel-browser  ──►  gov.br
   ▲   (público pelo túnel)   (localhost, NUNCA publicado)
   │
   │  (server-to-server, token interno)
app na Vercel  ◄── /api/radar/conexao (proxy)
```

| peça | onde | porta |
|---|---|---|
| steel-browser | container na instância | 3100 (API), 9223 (CDP) — **só localhost** |
| browser-service | Node na instância | 3200 — **único exposto pelo túnel** |
| app | Vercel | — |

## 3. Três defeitos consertados antes de subir (10/09/2026)

Todos achados lendo o código do steel, não em produção. Valem estar escritos porque
nenhum deles dá erro: os três falham em silêncio.

**O iframe mostraria a página errada.** O `steel.mjs` escolhia `sessionViewerUrl`
("URL to view session details") antes de `debugUrl` ("URL for a viewing the live browser
instance"). O fornecedor veria metadados da sessão no lugar da tela de login. A rota de
reserva também estava errada: é `/v1/sessions/debug`, **sem id**; a variante com id não
existe, e o `/v1/sessions/{id}/player` da documentação responde 404 no self-hosted (é da
nuvem paga — [issue #72](https://github.com/steel-dev/steel-browser/issues/72)).

**O steel roda UMA sessão por vez.** Em `session.service.ts` o estado é
`public activeSession: Session` — um campo, não um mapa — e um novo `POST /v1/sessions`
**encerra a ativa**. Sem serializar, o segundo fornecedor a conectar mata o login do
primeiro; e como a captura lê `contexts()[0]` do navegador único, dava para gravar a
sessão gov.br de um cliente como credencial de outro. Por isso existe a
`pista-navegador.mjs`: um por vez, e **quem não tem a pista não captura**. A captura
confere duas coisas — a pista e o id da sessão viva no steel. Uma só não basta.

**O live view é público por desenho.** A documentação do steel diz que as debug URLs são
"intentionally unauthenticated for fast embeds", e a rota é fixa, sem id — não há nem
segredo por obscuridade. Publicar o steel no túnel seria pôr na internet uma URL que
dirige um navegador logado no gov.br de um cliente. Por isso o steel fica em localhost e
quem vai ao túnel é o `browser-service`, que serve o live view em `/live/<token>` com
token de 32 bytes por sessão, morto no cancelar, no capturar e no prazo.

`npm run radar:pista:teste` — 30 casos, e o último bloco encena o vazamento com a regra
antiga e exige que a nova recuse.

## 3b. Mais dois, achados com o container rodando (11/09/2026)

Os de cima saíram de ler o código do steel. Estes só apareceram com ele de pé — e é a
razão de subir o container antes de ir para a nuvem.

**As URLs que o steel devolve não são alcançáveis.** Medido:

```
websocketUrl      ws://0.0.0.0:3000/
debugUrl          http://0.0.0.0:3000/v1/sessions/debug
sessionViewerUrl  http://0.0.0.0:3000/            ← a HOME do steel
```

`0.0.0.0` é o endereço de escuta dentro do container e 3000 é a porta interna; de fora
o caminho é `localhost:3100`. Usar o que ele devolve dá `ECONNREFUSED` no Playwright.
O `steel.mjs` agora mantém o CAMINHO informado e rebaseia a ORIGEM para a configurada.
De quebra, isto confirmou o defeito do item anterior por observação e não por leitura:
`sessionViewerUrl` é mesmo a home. Com a URL certa, o live view responde
`HTTP 200 · <title>Steel Session Player</title>`, com canvas de stream.

**URL não prova login — de novo.** Numa sessão em que ninguém logou, a página parou em
`/comprasnet-web/seguro/acompanhamento`, que **não casa** com nenhum padrão de tela de
login. Só pela URL, o `capturar()` declararia sucesso, cifraria um cofre **vazio** e
marcaria a saúde como `ok`: o fornecedor veria "Conectado ao gov.br" e o monitoramento
nunca traria uma mensagem. É o mesmo falso "conectado" que o Radar já teve uma vez.
A captura agora também recusa quando **não há nenhum cookie** — sessão autenticada tem
cookie, e cofre vazio nunca é sucesso.

**Memória medida:** container ocioso **457MB**, com uma sessão aberta e uma página
carregada **565MB**. Bem abaixo da estimativa de 700MB–1GB — cabe com folga em 2GB, o
que amplia as opções de hospedagem.

Também confirmado: `browser.close()` numa conexão CDP **não** mata a sessão do steel
(o `sessaoAtivaId()` segue devolvendo a mesma), e o binding em `127.0.0.1` funciona —
de um endereço não-loopback, 3100 e 9223 não respondem.

## 4. Onde NÃO subir

**Não na VM que roda o Postgres de produção** (163.176.103.191). Medido em 10/09/2026:

```
MemTotal        954 MB
MemAvailable    324 MB
Committed_AS   1132 MB   ← já promete mais do que tem
```

Um Chromium quer 700MB–1GB. Em falta de memória o kernel mata o maior RSS, que ali é o
**Postgres de produção**. Trocaríamos "um cliente não conecta" por "o banco cai".

Use uma instância separada. O Always Free da Oracle dá `VM.Standard.A1.Flex` com até
4 OCPU e 24GB — e o steel publica imagem **arm64**, então roda nativo.

### Criar a instância (e o problema de capacidade)

**Peça 1 OCPU / 6GB, não o máximo.** Um Chromium quer ~1GB; 6GB sobra. Pedir
4 OCPU/24GB é a razão número um de `Out of host capacity` — é o que todo mundo pede.

Console → Compute → Instances → Create instance:

| campo | valor |
|---|---|
| Name | `govhealth-radar` |
| Shape | Change shape → **Ampere** → `VM.Standard.A1.Flex` → **1 OCPU, 6 GB** |
| Image | Canonical Ubuntu 24.04 (ARM) |
| Networking | VCN padrão, **Assign a public IPv4 address** marcado |
| SSH keys | colar `~/.ssh/id_ed25519.pub` |
| Boot volume | 50GB (o Always Free dá 200GB no total) |

**Se der `Out of host capacity`** — e costuma dar, porque o Always Free tem a última
prioridade na fila de alocação do A1:

- **O que de fato destrava: mudar a conta para Pay As You Go** (Billing → Upgrade to
  Paid). Os recursos Always Free continuam gratuitos — 1 OCPU/6GB de A1 está dentro do
  limite; o que muda é a prioridade de alocação. Exige cartão; ponha um budget alert de
  US$ 1 para não criar algo pago sem perceber.
- Sem cartão: a capacidade abre em janelas curtas e imprevisíveis, então tente por
  script (OCI CLI, a cada ~2min, alternando os Availability Domains) em vez de clicar.
- Availability Domains são tentativas independentes: se a região tiver AD-2 e AD-3,
  valem como novas chances.
- A home region importa — recursos Always Free só existem nela, e `sa-saopaulo-1` e
  `sa-vinhedo-1` são conhecidas por viver lotadas.

**Se não vier de jeito nenhum:** VPS pequeno pago com 2GB resolve (faixa de uns US$ 4–6
por mês). Vale mais que esperar sorteio quando há cliente parado.

## 5. Subir

Na instância nova (Ubuntu):

```bash
# docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# o repo e as dependências do serviço
git clone <repo> govhealth && cd govhealth
npm ci && npx playwright install chromium && npx playwright install-deps

# steel (só localhost — o 127.0.0.1 no mapeamento é o que o mantém privado)
docker compose -f docker-compose.radar.yml up -d
```

> No `docker-compose.radar.yml`, publique como `127.0.0.1:3100:3000` e
> `127.0.0.1:9223:9223`. Sem o `127.0.0.1:` o Docker abre a porta em todas as
> interfaces e **fura o firewall da Oracle**, expondo o steel direto.

`.env.local` da instância:

```
DATABASE_URL=...            # o mesmo banco de produção
RADAR_CRED_KEY=...          # a MESMA chave da Vercel, senão a sessão cifrada não abre
RADAR_CONNECT_TOKEN=...     # ver C:\Users\souza\govhealth-radar-hospedado.txt
RADAR_CONNECT_PORT=3200
RADAR_STEEL_URL=http://localhost:3100
RADAR_STEEL_CDP=http://localhost:9223
RADAR_PUBLIC_URL=https://<hostname-do-tunel>
```

Túnel (dá HTTPS sem domínio próprio):

```bash
cloudflared tunnel --url http://localhost:3200
```

Para valer, crie um túnel nomeado e rode como serviço — o comando acima sorteia um
hostname novo a cada execução, e o hostname entra na CSP da app.

Serviço:

```bash
sudo tee /etc/systemd/system/radar-browser.service >/dev/null <<'EOF'
[Unit]
After=docker.service
[Service]
WorkingDirectory=/home/ubuntu/govhealth
ExecStart=/usr/bin/npm run radar:browser-service
Restart=always
User=ubuntu
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now radar-browser
```

Na Vercel (Production):

```
RADAR_CONNECT_URL   = https://<hostname-do-tunel>
RADAR_CONNECT_TOKEN = <o mesmo do arquivo>
RADAR_EMBED_ORIGIN  = https://<hostname-do-tunel>
```

> `RADAR_EMBED_ORIGIN` é lido em **tempo de build** (entra na CSP em `next.config.js`).
> Salvar a variável não basta: **exige redeploy**. Sem ela a CSP cai em
> `default-src 'self'` e o iframe é bloqueado — tela branca, sem erro na app.

## 6. Conferir

```bash
# na instância: o steel responde, e só de dentro
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/v1/sessions   # 200
# de fora, a porta do steel NÃO pode responder
curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://<ip>:3100/v1/sessions   # falha/timeout

# o porteiro recusa link inválido
curl -s -o /dev/null -w "%{http_code}\n" https://<tunel>/live/nadaaver       # 403
```

Na app: abrir "Conectar portal", pôr CNPJ e CPF, e a tela deve mostrar **a página de
login do gov.br dentro do iframe** — não uma tela de "Abrindo o gov.br…" girando (isso é
o caminho de reserva local, que só funciona na máquina do desenvolvedor) e não uma
página de detalhes de sessão (isso era o defeito do `sessionViewerUrl`).

## 7. Limites que ficam

- **Um fornecedor conectando por vez.** É limitação do steel open-source, não escolha
  nossa. O segundo recebe 409 com o tempo de espera. Login é evento raro (uma vez por
  credencial), então com a carteira atual isso não aperta — mas aperta com escala, e aí
  a saída é Steel Cloud (isolamento por sessão) ou um container por sessão.
- **A pista expira em 10min** (`RADAR_PISTA_TTL_MIN`). É o prazo para alguém que fechou
  a aba no meio do login não trancar a fila para sempre.
- O `capturar()` reconecta pelo CDP global. Funciona porque há um navegador só — se um
  dia houver mais de uma sessão, isto precisa passar a usar o `websocketUrl` da sessão.
