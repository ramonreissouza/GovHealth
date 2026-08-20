# Apresentação comercial (5 slides, .pptx editável)

```bash
npm run deck:numeros   # mede no banco e grava numeros.json  (opcional)
npm run deck           # gera scripts/deck/out/GovHealth AI - Apresentacao Comercial.pptx
```

O primeiro comando é opcional porque `numeros.json` está commitado com a última
medição. Rode-o quando a base tiver andado — a apresentação inteira se refaz com os
números novos, incluindo as legendas das pranchas.

Dependências fora do npm, uma vez por máquina:

```bash
pip install python-pptx pillow
```

## Por que assim

**Os números não são digitados.** `numeros.ts` importa `ABERTA`, `UNIVERSO` e
`ANO_CORRENTE` de [`src/lib/licitacoes/universo.ts`](../../src/lib/licitacoes/universo.ts),
que é a definição canônica de "licitação de saúde na base" e de "aberta". É por isso
que ele é TypeScript e não `.mjs` como o resto de `scripts/`: uma cópia da regra aqui
faria a apresentação divergir da plataforma, que é exatamente o problema que a
unificação de 20/08/2026 resolveu (a mesma pergunta dava 192.467 na landing, 231.650
na lista e 319.377 no mapa).

**As imagens não são versionadas.** Os recortes saem de `public/shots/*.png` na hora
da geração, e a logo transparente sai de `public/logo-govhealth.png`. Recapturou os
prints de produção? Rode `npm run deck` e eles entram atualizados, sem nenhum binário
novo no repo. Tudo cai em `scripts/deck/out/`, que é ignorado pelo git.

**As cores saem do arquivo da logo**, amostradas por pixel — navy do "Gov", azul do
símbolo, teal do "Health". Os dois últimos não passam contraste sobre fundo claro no
valor puro, então entram escurecidos; a tabela está no cabeçalho de `montar.py`.

**A fonte é Segoe UI, não Syne + DM Sans da landing.** Num `.pptx` a fonte tem de
existir na máquina de quem abre — as duas da landing não vêm no Windows, e o
PowerPoint substituiria por outra qualquer, quebrando o layout no notebook do
cliente. Para usar a tipografia exata da landing, instale as fontes em todas as
máquinas que vão abrir o arquivo e troque `LIGHT`/`REG`/`SEMI` em `montar.py`.

## Ressalva das telas

Os contadores **dentro** dos prints são da data da captura. Por isso nenhum número da
plataforma fica colado numa imagem: os números vivem no texto, e as legendas dizem
"tela de produção". Quando os prints forem recapturados logado
(`scripts/shots/capture.mjs`), o deck volta a bater em tudo.

## Mexeu no layout? Olhe o resultado

As posições estão em polegadas e foram conferidas exportando os slides em PNG pelo
PowerPoint. Três colisões foram encontradas assim, e nenhuma por leitura do código:
título de duas linhas caindo sobre a linha de apoio (slides 2 e 5) e a prancha de
preços passando por cima da grade de números (slide 4). Com o PowerPoint instalado:

```powershell
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open("<caminho>\out\GovHealth AI - Apresentacao Comercial.pptx", $true, $false, $false)
$i = 1; foreach ($sl in $pres.Slides) { $sl.Export("<caminho>\out\v$i.png", "PNG", 1400, 788); $i++ }
$pres.Close(); $pp.Quit()
```

Preços e features dos planos espelham [`src/lib/planos.ts`](../../src/lib/planos.ts) —
mexeu lá, mexa em `PLANOS` no `montar.py`.
