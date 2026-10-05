# Faixa de lance sugerida — medição (05/10/2026)

Pergunta: dá para mostrar, por item de licitação aberta, a faixa em que o vencedor
costuma fechar? Medido no banco da VM Oracle (`DATABASE_URL` do `.env.local`), só leitura.
Consultas em `docs/medicoes/faixa-lance/`: `REPO=<raiz do repo> node q.mjs 2.sql`. Elas criam
só TEMP TABLE, e a transação termina sempre em ROLLBACK.

## Base
- 641.737 resultados homologados; 89,5% têm estimado e homologado.
- **Descartar homologado = estimado:** 113 mil linhas. É 64% da Dispensa, 83% do
  Credenciamento e da Inexigibilidade, e 9,5% do Pregão. Não há disputa nesses casos.
- Válidos (só Pregão, razão entre 0,05 e 1,5, sem razão = 1): ~448 mil, quase tudo de 2025-2026.
- Desconto mediano sobre o estimado: 32% (p25-p75 da razão: 0,48-0,88). Varia por
  categoria: ambulância 16%, medicamento 35%, odontologia 37%.

## Preço absoluto (R$)
- Mesmo PDM: p75/p25 = 3,0x. As unidades estão misturadas (não existe coluna de unidade). Não serve.
- Mesma descrição normalizada (n >= 5): p75/p25 mediano 1,66x. Fica apertado quando a
  descrição é específica (ATENOLOL 25 MG: 0,03-0,04) e é lixo quando é genérica
  (ADESIVO CIRÚRGICO: 117-2.594).
- **Cobertura no ponto de uso:** só 2.400 de 64.623 itens abertos (3,7%) têm >= 5
  históricos com a mesma descrição. Medicamento 9%, o resto 0-4%.

## Desconto relativo (homologado / estimado)
Largura p25-p75 da razão, mediana dos grupos com n >= 30:
categoria 0,40 · PDM 0,36 · PDM+UF 0,35 · órgão 0,29 · órgão+categoria 0,27 ·
fornecedor 0,30 · fornecedor+PDM (n>=10) 0,24.

Backtest (faixa de 2025 contra os resultados de 2026):

| faixa | itens testados | caiu dentro | largura |
|---|---|---|---|
| categoria | 78.608 | 48,5% | 0,39 |
| órgão + categoria | 38.580 | 44,1% | 0,30 |
| fornecedor + categoria | 41.737 | 46,0% | 0,34 |

Erro mediano da previsão pela mediana: categoria 20 pontos, órgão 16 pontos.

## Cobertura e estabilidade
- Itens abertos com PDM: **766 de 64.623 (1,2%)**. O casamento de PDM não roda na entrada.
- Itens abertos cujo órgão tem >= 30 resultados válidos: 39.613 (61%).
- Fornecedores com >= 10 resultados: 5.692, que somam 93% do volume.
- Desconto do mesmo fornecedor de 2025 para 2026: correlação 0,53, variação mediana de 7 pontos.

## Conclusão
Uma "faixa de lance por item" não se sustenta. Em R$, cobre 3,7% dos itens abertos.
Em desconto relativo, a faixa útil tem cerca de 30 pontos de largura e erra 16 pontos
na mediana. O estimado de cada órgão é ruidoso, e a razão mede a qualidade do estimado
tanto quanto a disputa.

O que tem cobertura e algum poder preditivo:
1. o perfil do órgão (61% dos itens abertos);
2. o perfil de desconto dos concorrentes que costumam ganhar ali (93% do volume, estável entre anos);
3. o preço em R$ só para descrição específica com dispersão baixa (fatia pequena, sobretudo medicamento).

## Raio-X da disputa — cobertura validada (05/10/2026, noite)
- O fallback "órgão inteiro, todas as categorias" **não prevê**. Nos 16.583 itens de 2026
  sem amostra de órgão+categoria, ele erra 20,6 pontos contra 20,2 da categoria nacional.
  A faixa p25-p75 dele só acerta 36% (deveria ser ~50%). **Descartado.**
- Só órgão+categoria é validado. Cobertura nas 4.168 licitações abertas em pregão:
  - desconto (>= 30 itens válidos em 24 meses): 1.678 (40%; 38% do valor)
  - concorrentes (>= 10 itens ganhos e >= 3 vencedores): 1.944 (47%; 42% do valor)
- Por categoria (desconto / concorrentes): medicamento 65/68%, material hospitalar 62/69%,
  OPME 47/57%, laboratório 41/45%, cirurgia 41/46%, outros 30/40%, odontologia 21/25%,
  equipamento médico 17/28%, serviços médicos 17/22%, manutenção 11/13%, imagem 5/6%,
  ambulância 2/7%, UTI 8/8%.
- Tempo da consulta sem índice em contratacoes(cnpj_orgao): 1,3-1,5 s num órgão típico,
  5,5 s no maior.

## Régua final do Raio-X (o que foi para o código, `src/lib/raio-x.ts`)
- Só **medicamento e material hospitalar**: são as categorias acima de 60% de cobertura.
  Nas outras a função não existe, para não aparecer vazia na maioria das licitações.
- Só pregão; recorte sempre órgão + categoria; histórico de 24 meses.
- Desconto: >= 30 itens válidos de >= 3 pregões. Backtest em medicamento + material:

  | histórico | faixa acerta | erro mediano |
  |---|---|---|
  | 1-2 pregões | 39,7% (mal calibrada) | 16,8 pontos |
  | 3 ou mais | 48,8% | 14,8 pontos (nacional: 20,2) |
  | 5 ou mais | 51,8% | 13,6 pontos |

- Concorrentes: >= 10 itens ganhos e >= 3 vencedores. O desconto próprio de cada um
  exige >= 5 itens de >= 2 pregões.
- Cobertura nas 1.549 licitações abertas em pregão dessas duas categorias: desconto 843
  (54%), concorrentes 1.058 (68%), algum bloco 1.058 (68%).

## Correção do review da #64: homologado = estimado conta como desconto 0%
Até aqui, toda razão 1 era excluída. Isso estava errado para pregão:
- Em medicamento + material, 91% dos itens com razão 1 (20.452 de 22.517) estão em pregões
  em que outros itens tiveram desconto. São desconto 0% de verdade.
- Só 9% estão em pregões em que TODOS os itens saíram pelo estimado. Aí o estimado foi
  preenchido com o homologado, e só esses ficam de fora.
- Backtest 2025→2026 contra o desfecho real (tudo, menos os pregões inteiros pelo estimado):

  | regra | faixa acerta | erro mediano | largura |
  |---|---|---|---|
  | excluir toda razão 1 (antiga) | 44,5% | 15,7 pontos | 0,31 |
  | incluir tudo | 49,8% | 15,2 pontos | 0,33 |
  | **excluir só o pregão inteiro pelo estimado (atual)** | **49,7%** | **15,2 pontos** | 0,33 |

- Efeito no maior órgão (medicamento): o desconto típico foi de 34% para 26%, e a faixa
  de 15-54% para 3-50%. A regra antiga inflava o desconto.
- Razão entre 1 e 1,5 (homologado acima do estimado) é desconto negativo. Em 26 de 431
  recortes o p75 chega a 1 ou passa. O texto diz "acima do estimado" em vez de mostrar sinal.

Os números das seções anteriores (cobertura, largura, backtests) foram medidos com a regra
antiga. A cobertura só cresce com a regra nova, porque entram mais itens.
