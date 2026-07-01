# PRD — Tela "Radar de Verba" (Emendas Quentes não executadas)

> Documento de especificação para implementação via Claude Code.
> Plataforma: GovHealth AI (Next.js 14 + TypeScript).
> Complementa o PRD de Vencedores. Enquanto aquele olha o PASSADO (quem já ganhou),
> este olha o FUTURO (onde a verba existe mas ainda não virou compra).

---

## 0. A TESE COMERCIAL (validada com dados oficiais)

O valor está em chegar ANTES do edital. A emenda parlamentar é o sinal mais precoce:
a verba foi destinada a um município/hospital, mas ainda não foi gasta.

**Dados que provam que a janela existe e é grande:**
- O TCU constatou que **mais de 70% dos valores empenhados** em emendas ficaram como
  "restos a pagar não processados" (empenhados, não liquidados) ao longo de 4 anos.
  → A maioria das emendas NÃO é executada rápido. A janela é a regra, não a exceção.
- Muitas emendas são liberadas só no 2º semestre, transbordando para o ano seguinte.
  → Meses de janela para o fornecedor trabalhar o lead.

**O ciclo da despesa (o que cada estágio significa):**
```
EMPENHADO  →  LIQUIDADO  →  PAGO
(reservado)   (entregue)    (dinheiro saiu)
   ▲
   └─ AQUI está a oportunidade: empenhado alto, pago baixo/zero
```

---

## 1. RESSALVA IMPORTANTE (não vender ilusão)

Nem toda emenda de saúde vira a compra que VOCÊ fornece. Por lei:
- Parte vai para **equipamentos/material permanente** (alvo do fornecedor de equipamentos)
- Parte vai para **custeio** (folha, serviços — não é venda de equipamento)
- As **"emendas PIX" (transferência especial)** caem na conta do município SEM
  vinculação a projeto — não dá para saber no que será gasto. São as mais difíceis
  de qualificar.

**Implicação para a tela:** a emenda é um LEAD A QUALIFICAR, não venda garantida.
A tela deve classificar por tipo e sinalizar o nível de "rastreabilidade" do destino.
O fornecedor ainda precisa ligar, entender e trabalhar — mas recebe o lead cedo.

---

## 2. FONTE DE DADOS

**API:** Portal da Transparência — `/api-de-dados/emendas` (já usada na plataforma).
A chave do usuário (Gov.br Ouro) já funciona — confirmado no /api/debug.

**Campos relevantes do retorno (confirmar nomes exatos no Swagger):**
- `codigoEmenda`, `numeroEmenda`, `ano`
- `autor` (parlamentar)
- `tipoEmenda` (individual, bancada, comissão, relator — IMPORTANTE para classificar)
- `localidadeDoGasto` (município/UF destino)
- `funcao` (filtrar = "Saúde", confirmado no debug)
- `subfuncao` (refina: atenção básica, média/alta complexidade, vigilância...)
- `valorEmpenhado`, `valorLiquidado`, `valorPago`
- `valorRestoInscrito`, `valorRestoPago` (restos a pagar — sinal de verba antiga não gasta)

**Novidade da API (nov/2024):** filtros por número da emenda, código, e se possui
ou não convênio vinculado. O Portal integrou emendas + convênios — permite navegar
do empenho até a execução no TransfereGov. EXPLORAR esses campos de vínculo.

**Valores monetários** vêm como string "1.234.567,89" — fazer parse BR (já temos `parseValorBR`).

---

## 3. A TELA — "Radar de Verba"

### 3.1 KPIs (cards superiores)
- **Verba disponível** = Σ(empenhado − pago) das emendas de saúde com filtros
  → o "dinheiro em cima da mesa"
- **Nº de emendas quentes** (empenhado > limiar E pago/empenhado < 50%)
- **Municípios com verba** = count distinct localidade
- **Ticket médio disponível** = verba disponível ÷ nº emendas

### 3.2 Score de "temperatura" da emenda (lógica de priorização)
Calcular para cada emenda um score 0-100 que combina:
- **% não executado** (empenhado − pago) / empenhado → quanto maior, mais quente
- **Valor absoluto disponível** → verbas maiores pontuam mais
- **Tipo de emenda** → individual/bancada com destino claro pontuam mais que PIX
- **Tem convênio vinculado?** → se já tem convênio no TransfereGov, está mais maduro
  (mais perto de virar edital) → pontua urgência
- **Idade do empenho** → empenho antigo não pago = pode estar prestes a executar OU
  prestes a virar resto a pagar (sinalizar ambos)
- **Subfunção** → "média/alta complexidade" e "atenção especializada" tendem a
  envolver equipamento; "atenção básica" e "custeio" menos → pontuar afinidade
  com venda de equipamento

> NÃO inventar pesos com falsa precisão. Começar com regras simples e transparentes,
> documentar cada peso, e refinar com dados reais. O score é um AUXÍLIO de priorização,
> não uma previsão garantida.

### 3.3 Filtros
- Estado (UF) e município
- Ano da emenda (2023, 2024, 2025, 2026)
- Tipo de emenda (individual / bancada / comissão / relator / PIX)
- Subfunção de saúde (dropdown)
- Faixa de valor disponível (slider)
- "Só com convênio vinculado" (toggle) — leads mais maduros
- "Só quentes" (toggle — empenhado alto, pago baixo)

### 3.4 Tabela / lista principal (colunas)
| Coluna | Campo | Observação |
|---|---|---|
| Temperatura | score 0-100 | badge colorido (quente/morno/frio) |
| Município/UF | `localidadeDoGasto` | |
| Autor | `autor` | parlamentar — útil para contexto político |
| Tipo | `tipoEmenda` | PIX sinalizado com aviso de baixa rastreabilidade |
| Subfunção | `subfuncao` | indica afinidade com equipamento |
| Empenhado | `valorEmpenhado` | |
| Pago | `valorPago` | |
| **Disponível** | empenhado − pago | **a coluna mais importante** |
| % executado | pago/empenhado | barra de progresso |
| Convênio? | tem vínculo | link para o convênio se existir |

### 3.5 Ação por linha
- Botão "Adicionar ao pipeline" → joga a emenda no CRM como lead a qualificar
- Botão "Ver no Portal" → link direto para a emenda no Portal da Transparência
- Se tem convênio vinculado: "Ver convênio" → detalhe do TransfereGov

---

## 4. ENDPOINT A CRIAR

```
GET /api/radar-verba?uf=&municipio=&ano=&tipo=&subfuncao=&valorMin=&comConvenio=&soQuentes=
```

Retorna:
```json
{
  "kpis": {
    "verbaDisponivel": 0,
    "emendasQuentes": 0,
    "municipiosComVerba": 0,
    "ticketMedioDisponivel": 0
  },
  "emendas": [
    {
      "codigoEmenda": "...",
      "score": 0,
      "municipio": "...", "uf": "...",
      "autor": "...", "tipo": "...", "subfuncao": "...",
      "empenhado": 0, "pago": 0, "disponivel": 0, "percentualExecutado": 0,
      "temConvenio": false, "convenioId": null,
      "alertaTipo": null
    }
  ],
  "atualizadoEm": "..."
}
```

> Reaproveitar `src/lib/emendas.ts` (já tem buscarEmendasSaudeAno, parseValorBR,
> emendasQuentes). Estender com cálculo de score e join com convênios.

---

## 5. RELAÇÃO COM AS OUTRAS PARTES DA PLATAFORMA

```
RADAR DE VERBA          →  TIMELINE              →  VENCEDORES
(emenda não executada)     (convênio → edital)      (quem ganhou)
"trabalhar o lead cedo"    "acompanhar maturação"   "estudar concorrência"
   [este PRD]                [já existe]              [PRD anterior]
```

A emenda quente, quando ganha convênio vinculado, "desce" para a Timeline.
Quando vira edital e homologa, alimenta a base de Vencedores.
São as 3 fases do mesmo funil, da mais precoce à mais tardia.

---

## 6. ORDEM DE IMPLEMENTAÇÃO

1. Estender `emendas.ts`: adicionar tipoEmenda, subfuncao, restos a pagar ao parse
2. Confirmar no Swagger do Portal os campos de vínculo emenda↔convênio
3. Implementar cálculo de score (regras simples, documentadas)
4. Criar `/api/radar-verba`
5. Criar a tela `/radar-verba` (KPIs + filtros + tabela)
6. Integrar ações: adicionar ao pipeline (CRM), ver no Portal, ver convênio
7. Validar com 1 estado antes de liberar nacional

---

## 7. CUIDADOS

- **Não prometer venda.** Linguagem da UI: "verba disponível para trabalhar",
  "lead a qualificar" — nunca "venda garantida".
- **Emendas PIX:** marcar com aviso visual de baixa rastreabilidade do destino.
- **Parse de valores:** strings BR ("1.234,56"). Testar com valores reais.
- **Rate limit do Portal:** a API limita req/min. Manter delays (já temos 700ms).
- **Restos a pagar:** verba de anos anteriores ainda não paga é sinal duplo —
  pode estar prestes a executar (oportunidade) ou prestes a ser cancelada (risco).
  Mostrar a idade do empenho para o usuário interpretar.
- **Confirmar campos no Swagger** antes de implementar — não confiar só neste doc.

---

*Fim do PRD. Entregar ao Claude Code junto com o PRD de Vencedores — são complementares.*
