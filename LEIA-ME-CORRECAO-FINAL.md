# CORREÇÃO FINAL — Calibrada com os dados reais do /api/debug

## O que o debug confirmou (e o que foi corrigido)

| Descoberta no debug | Correção aplicada |
|---|---|
| PNCP responde, ~12% dos itens são saúde | Varre 5 páginas × 4 modalidades para acumular volume |
| Emendas: função exata é **"Saúde"** (acento, maiúsculo) | Filtro mudou de `.includes('sa')` para igualdade exata |
| Convênios exigem filtro UF (sem ele = 400) | Agora exige UF; varre UFs prioritárias para cobertura nacional |
| Convênios trazem objeto em `dimConvenio.objeto` | Normalização corrigida para a estrutura real da API |

## Arquivos neste pacote (substituem os existentes)

```
src/lib/pncp.ts                       ← varredura multi-página
src/lib/emendas.ts                    ← filtro "Saúde" exato
src/lib/transferegov.ts               ← UF obrigatório + dimConvenio
src/app/api/opportunities/route.ts    ← liga tudo, fonte PNCP em tempo real
```

## Como aplicar

1. Copie a pasta `src/` deste pacote por cima do projeto (substitui os 4 arquivos)
2. Salve — o Next recompila sozinho
3. Acesse `http://localhost:3000/api/opportunities`
   → agora deve retornar dezenas de oportunidades reais de saúde
4. Volte ao dashboard `http://localhost:3000`
   → os KPIs e a lista de oportunidades devem popular

## Sobre o ANTHROPIC_API_KEY (apareceu "NAO encontrada" no debug)

O Copiloto IA não vai funcionar até você adicionar a chave. No `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-sua-chave-aqui
```

Obtenha em console.anthropic.com → API Keys. Sem isso, todo o resto
(dashboard, oportunidades, emendas, mapa) funciona normalmente — só o
chat do Copiloto fica indisponível.

## Verificação rápida pós-aplicação

| URL | Resultado esperado |
|---|---|
| `/api/opportunities` | lista de oportunidades de saúde com valores reais |
| `/api/emendas?ano=2025` | emendas de saúde (função "Saúde") |
| `/api/opportunities?uf=CE&minScore=70` | oportunidades filtradas do Ceará |

## Próximo passo (quando quiser)

Com os dados ao vivo funcionando, rode o snapshot (pacote anterior) para
ter a "foto" persistente + atualização semanal automática:
```
node scripts/snapshot.mjs
```
