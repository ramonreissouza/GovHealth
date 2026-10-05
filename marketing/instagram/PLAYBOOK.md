# Playbook do agente de posts: GovHealth no Instagram (@techealth_)

Instruções para o agente que prepara 1 post por execução (segunda e quarta, 8h).
O Ramon revisa e posta. **O agente nunca publica nada, não acessa o Instagram e não manda mensagem para ninguém.**

Contexto comercial completo: `marketing/PLANO_COMERCIAL.md`. Leia antes de começar.

## Pastas

```
marketing/
  PLANO_COMERCIAL.md   PRIVADO: estratégia, calendário, metas
  LGPD_PROSPECCAO.md   PRIVADO: governança de dados para prospecção
  instagram/
    PLAYBOOK.md        este arquivo (versionado)
    render.mjs         slides.html -> 01.png, 02.png... (versionado)
    template/          slides.css + fonts/ locais (versionado)
    exemplos/          exemplo canônico de cada componente (versionado, conteúdo neutro)
    HISTORICO.md       PRIVADO: uma linha por post gerado
    fila/              PRIVADO: posts aguardando aprovação do Ramon
    publicados/        PRIVADO: posts que o Ramon já postou (ele move a pasta para cá)
```

**O repositório é PÚBLICO.** Tudo marcado PRIVADO está no `.gitignore` e existe só no disco (pasta sincronizada no OneDrive). Campanha não publicada, calendário, metas, funil e PNGs **nunca** vão para o git: post com revelação programada perde o sentido se o conteúdo já estiver público, e PNG regenerado faz o repositório crescer para sempre. Se algum arquivo privado aparecer em `git status`, pare e avise o Ramon.

## Passo a passo de cada execução

1. **Ler o estado.** `HISTORICO.md`, a lista de `fila/` e de `publicados/`. Ler o `legenda.md` dos 3 últimos posts, inclusive anotações do Ramon (linhas começando com `> Ramon:`): são correção de tom e de conteúdo, siga-as.
2. **Fila cheia?** Se já houver 3 ou mais posts em `fila/` não aprovados, **não gere outro**. Apenas registre em HISTORICO.md "fila cheia, nada gerado em <data>" e termine. Post acumulado sem revisão vira trabalho jogado fora.
3. **Escolher o tema.**
   - Siga o calendário do PLANO_COMERCIAL.md (o que ainda não foi feito e ainda não está em `fila/`).
   - Depois, rode os pilares na ordem 1 → 2 → 3 → 4 → 5 → 1..., pulando o pilar do último post. A cada 5 posts, no máximo 1 é de venda direta.
   - Pilar 4 (novidade) só com recurso **no ar em produção**. Para descobrir: `git log origin/main --since="21 days ago" --oneline` e confira se a tela existe na produção (`https://govhealth.techealth.com.br`). Commit em branch que não é a main não conta. Na dúvida, escolha outro pilar e anote a ideia em HISTORICO.md como "pauta futura".
   - Não repetir tema dos últimos 8 posts.
4. **Conferir os números.** Busque `https://govhealth.techealth.com.br/inicio` (WebFetch) e use só o que está lá: licitações abertas no ano, portais de disputa, R$ mapeado, concorrentes rastreados, municípios com CAPAG e quantos têm nota C/D, municípios e estados cobertos, data de atualização. Fora isso, só fonte oficial pública com link (PNCP, Tesouro Nacional, Compras.gov, Lei 14.133). Anote no `legenda.md` de onde veio cada número e a data.
5. **Escrever.** Crie `fila/AAAA-MM-DD-<tema-curto>/` com a data sugerida de postagem (próxima terça ou quinta). Dentro:
   - `slides.html` (carrossel, ver "Visual")
   - `legenda.md` (ver "Legenda")
6. **Renderizar.** Da raiz do repo: `node marketing/instagram/render.mjs marketing/instagram/fila/<pasta>`. Depois **abra cada PNG** (Read) e confira: texto cortado, palavra sozinha numa linha, slide vazio, imagem quebrada, número diferente da legenda. Corrija e renderize de novo.
7. **Registrar.** Acrescente uma linha em `HISTORICO.md`.
8. **Avisar.** Termine com um resumo de 3 linhas: tema, pilar, pasta, e o gancho do slide 1.

Não faça commit, push nem deploy. Não edite nada fora de `marketing/`. Não altere `template/` nem `render.mjs` (são versionados e revisados por PR); se faltar um componente, descreva em "Sugestões" na legenda.md.

## Tom de voz

- Português do Brasil, direto, de fornecedor para fornecedor. "Você" e "a gente".
- Fala de dinheiro perdido e prazo, não de "tecnologia disruptiva". Proibido: "revolucionário", "solução completa", "inovador", "potencialize", "alavanque".
- Frases curtas. Um número forte vale mais que três adjetivos.
- Sem travessão longo em excesso; prefira ponto final.
- Emoji só como marcador na legenda (👉 ✅ 🎁), nunca nos slides.

## Formato: curto e em série (decisão do Ramon, 05/10/2026)

Post comprido "joga tudo de uma vez": o interesse morre ou a pessoa sai no meio. Por isso:

- **1 ideia por post.** Se cabe em duas ideias, são dois posts.
- **1 a 3 slides** (o padrão é 2). Imagem única também vale.
- **Instigar, não explicar.** O slide 1 abre uma pergunta ou dor. O último deixa um gancho para o próximo post (bloco `.cont`: `<span class="when">Continua quinta</span>` + `<p>` com uma frase que dá vontade de voltar). Não entregue a solução inteira no mesmo post da dor.
- **Pense em séries de 2 a 4 posts** com um fio condutor. O nome da série vai no `.mast`, e a parte ("Parte 2 de 3") em `<span class="no">` dentro do `.mast`, só no 1º slide do post.
- **Legenda curta:** 3 a 5 frases + 1 chamada para ação. Sem listas longas.
- Produto e preço aparecem no máximo em 1 de cada 4 posts. Nos outros, o produto fica implícito ou numa linha no fim.

## Visual: "dossiê de licitação" (decisão do Ramon, 05/10/2026)

A primeira versão ficou com cara de "gerada por IA". A linguagem atual imita o mundo do seguidor (edital, carimbo, checklist, sala de disputa) com acabamento editorial. Regras:

**Nunca use:** brilho/bolha desfocada no fundo, degradê dentro do texto, degradê azul→teal de fundo, pílula com bolinha, ícone genérico em quadrado com degradê, sombra suave difusa, tudo centralizado.

**Sempre:**
- Tipografia: título em **Fraunces** (serifa; o itálico `<em>` é o tempero, 1 por slide), texto em **Archivo**, dado/fonte/hora em **IBM Plex Mono**.
- Cor chapada da paleta: papel `--paper` (claro), `ink` (navy), `blue` (#1f6fd6) ou `teal` (#17b8a6). Vermelho `--red` só para o que deu errado (carimbo, "não saiu").
- Um detalhe "feito à mão" por slide, no máximo dois: `.mark` (marca-texto teal), `.pen` (sublinhado de caneta em SVG), `.stamp` (carimbo), check desenhado em `.checks`.
- Sombra, quando houver, é dura e deslocada (`box-shadow: 14px 14px 0 var(--ink)`), como papel recortado.
- Cada série tem cabeçalho de revista `.mast` (nome da série) e rodapé `.foot`. A parte da série ("Parte 2 de 4") vai **só no 1º slide** de cada post: repetida em todos, parecia contador de slides (o Ramon achou ambíguo). O gancho vai em `.cont` ("Continua quinta" + frase em itálico).

**Componentes** (em `template/slides.css`): `.slide` + `ink`/`blue`/`teal`; `.mast`, `.foot`, `.cont`; `.kicker`, `.display` (`.md`, `.sm`), `.body` (`.serif`), `.bleed` (número gigante vazando a margem); `.mark`, `.pen`, `.stamp`, `.toast` (notificação); `.ficha` (quadradinhos "marque o seu"), `.checks` (checklist grande), `.sala` (janela de sala de disputa, sem marca de portal real), `.grades` (escala A-D da CAPAG) + `.bar`, `.sticker` (logo colada como etiqueta), `.verbs`, `.recall`, `.coupon` (cupom destacável), `.shot` (print do produto recortado); `.spacer` para centralizar na vertical. **Use só esses.** Classe que não está nesta lista não tem estilo no CSS e sai crua no PNG.

**Composição:**
- 1 a 3 slides. Slide 1 = gancho, último = gancho do próximo post ou chamada para ação. Alterne fundos claro e escuro/cor dentro do post.
- No máximo ~30 palavras por slide. Título em até 3 linhas, sem palavra sozinha na última linha (use `<br>` ou diminua o corpo).
- Invente um objeto visual do assunto antes de escrever (checklist que não fecha, chat com carimbo, escala de nota, cupom). Se o slide é só título + parágrafo, ainda não está pronto.
- A logo da GovHealth entra como `.sticker`. O PLANO_COMERCIAL.md (privado) diz em quais posts ela pode aparecer.
- Parta de `exemplos/componentes/slides.html` (todos os componentes, com o HTML certo) ou de um post já aprovado em `publicados/`. Caminhos a partir de `fila/<pasta>/`: `../../template/slides.css` e `../../../../public/...`.
- Prints do produto em `public/shots/` (`dashboard.png`, `licitacoes.png`, `mapa.png`, `precos.png`) só recortados dentro de `.shot` (moldura com sombra dura), nunca de tela inteira. Não rode `scripts/shots/capture.mjs`.

## Legenda (legenda.md)

Cabeçalho com: formato, pilar, data sugerida, fonte e data dos números, status "aguardando aprovação". Depois:

- **Legenda pronta para colar**: gancho na 1ª linha (aparece antes do "mais"), 3 a 5 frases curtas, chamada para ação ("Teste grátis 3 dias, link na bio" ou "Comente GOVHEALTH"), 8 a 14 hashtags de nicho (#licitacao #pregaoeletronico #saudepublica #equipamentosmedicos #engenhariaclinica #fornecedoresdogoverno #govhealth #techealth ...).
- **Sugestão de story** do dia (1 a 3 telas, com enquete ou caixinha).
- **Sugestões** (opcional): print que faltou, ideia de pauta futura.

## Regras que não se quebram

- Número só da landing pública ou de fonte oficial citada. Nunca inventar, arredondar para cima ou extrapolar ("milhares de clientes").
- "Abertas em 2026", nunca só "abertas".
- Não dizer que a GovHealth é "integrada" aos portais nem que dá lance. Ela reúne as licitações, diz em qual portal está a sessão e avisa do chat.
- Nunca citar cliente, conta de apresentação, depoimento ou empresa concorrente pelo nome. Não há depoimento autorizado: não crie.
- Não citar órgão ou município específico em tom negativo ("a prefeitura X não paga"). Fale de nota CAPAG de forma agregada.
- Radar de Chat e equipe = plano Empresa. Preços: Essencial R$ 990, Pro R$ 1.990, Empresa sob consulta. Teste: 3 dias, sem cartão.
- Não prometer resultado ("ganhe mais licitações garantido").
- Conteúdo jurídico (prazo de impugnação, recurso) cita o artigo da Lei 14.133/2021 e não substitui advogado.
