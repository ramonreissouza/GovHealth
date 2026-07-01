# PRD — Módulo de Inteligência de Resultados (4 telas estilo Hospmult)

> Documento de especificação para implementação via Claude Code.
> Plataforma: GovHealth AI (Next.js 14 + TypeScript). Objetivo: replicar e superar
> as telas de análise de vencedores/concorrentes da Hospmult (slides 7-12).

---

## 0. CONTEXTO E DECISÃO DE ARQUITETURA (ler primeiro)

### O problema central
As telas da Hospmult mostram **resultados homologados** (quem ganhou, quanto, qual item),
não editais publicados. A plataforma atual lê apenas editais (fase de divulgação).
São fontes/fases diferentes do mesmo processo de compra.

### Limitação real da API do PNCP (verificado)
Não existe endpoint que liste "todos os vencedores de saúde do Brasil" de uma vez.
O caminho oficial para obter um resultado é granular, item a item:

```
GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados/{sequencialResultado}
```

Situação do item no retorno:
- código 2 = **Homologado** (tem vencedor — é o que interessa)
- código 4 = Deserto | código 5 = Fracassado (sem resultado)

Campos do resultado homologado (do manual oficial):
`quantidadeHomologada`, `valorUnitarioHomologado`, `valorTotalHomologado`,
`niFornecedor` (CNPJ do vencedor), `nomeRazaoSocialFornecedor`, `porteFornecedorId`,
`dataResultado`, `ordemClassificacaoSrp`.

### Consequência arquitetural (a decisão mais importante)
Para montar o equivalente aos R$466M da Hospmult, é necessário um **pipeline ETL em
background** que:
1. Lista as contratações de saúde (já temos isso, via /contratacoes/publicacao)
2. Para cada contratação, busca os itens
3. Para cada item, busca os resultados homologados
4. Persiste tudo num banco (não dá para fazer em request de página)

Isso é centenas de milhares de chamadas. **NÃO pode rodar em API route síncrona.**
Tem que ser job/worker com persistência em banco. Ver seção 5.

### Endpoints de consulta pública (base, sem auth)
- Base consulta: `https://pncp.gov.br/api/consulta/v1`
- Itens de uma compra: `GET /orgaos/{cnpj}/compras/{ano}/{sequencial}/itens` (confirmar no Swagger)
- Resultados de um item: caminho granular acima
- Swagger oficial: https://pncp.gov.br/api/consulta/swagger-ui/index.html
  **AÇÃO PARA O CLAUDE CODE: abrir o Swagger e confirmar os nomes/caminhos exatos
  dos endpoints de itens e resultados ANTES de implementar. Os caminhos podem ter
  pequenas diferenças entre o manual de integração e a API de consulta pública.**

---

## 1. PRÉ-REQUISITO TÉCNICO — Banco de dados

Antes das 4 telas, é preciso uma camada de persistência. Opções (escolher 1):
- **Supabase** (Postgres gerenciado, free tier generoso) — recomendado
- **Neon** (Postgres serverless, integra bem com Vercel)
- **Vercel Postgres**

### Schema mínimo

```sql
-- Contratações de saúde (cabeçalho)
CREATE TABLE contratacoes (
  numero_controle_pncp TEXT PRIMARY KEY,
  cnpj_orgao           TEXT NOT NULL,
  razao_social_orgao   TEXT,
  municipio            TEXT,
  uf                   TEXT,
  modalidade_nome      TEXT,
  objeto_compra        TEXT,
  ano_compra           INT,
  sequencial_compra    INT,
  valor_total_estimado NUMERIC,
  data_publicacao      DATE,
  situacao_id          INT,
  categoria_saude      TEXT,           -- imagem, uti, laboratorio, etc.
  coletado_em          TIMESTAMPTZ DEFAULT now()
);

-- Itens de cada contratação
CREATE TABLE itens (
  id                       BIGSERIAL PRIMARY KEY,
  numero_controle_pncp     TEXT REFERENCES contratacoes,
  numero_item              INT,
  descricao                TEXT,
  codigo_catmat            TEXT,        -- ex: "000253" (Arco Cirúrgico)
  nome_catmat              TEXT,        -- ex: "Arco Cirúrgico"
  quantidade               NUMERIC,
  valor_unitario_estimado  NUMERIC,
  situacao_item_id         INT,         -- 2 = homologado
  UNIQUE (numero_controle_pncp, numero_item)
);

-- Resultados homologados (vencedores) — o coração das 4 telas
CREATE TABLE resultados (
  id                        BIGSERIAL PRIMARY KEY,
  numero_controle_pncp      TEXT,
  numero_item               INT,
  ni_fornecedor             TEXT,       -- CNPJ vencedor
  nome_fornecedor           TEXT,
  quantidade_homologada     NUMERIC,
  valor_unitario_homologado NUMERIC,
  valor_total_homologado    NUMERIC,
  data_resultado            DATE,
  ordem_classificacao_srp   INT,
  uf                        TEXT,       -- desnormalizado p/ performance
  codigo_catmat             TEXT,       -- desnormalizado
  nome_catmat               TEXT,       -- desnormalizado
  ano                       INT,        -- desnormalizado p/ filtro por ano
  FOREIGN KEY (numero_controle_pncp, numero_item)
    REFERENCES itens (numero_controle_pncp, numero_item)
);

-- Índices essenciais para as agregações das telas
CREATE INDEX idx_res_uf        ON resultados (uf);
CREATE INDEX idx_res_fornec    ON resultados (ni_fornecedor);
CREATE INDEX idx_res_catmat    ON resultados (codigo_catmat);
CREATE INDEX idx_res_ano       ON resultados (ano);
CREATE INDEX idx_res_valor     ON resultados (valor_total_homologado DESC);
```

---

## 2. AS 4 TELAS

### TELA 1 — Análise de Vencedores (slide 7)

**Objetivo:** mostrar quem venceu cada licitação de saúde, com KPIs no topo.

**KPIs (cards superiores):**
- Valor total homologado (soma de `valor_total_homologado` com filtros aplicados)
- Ticket médio (valor total ÷ nº de licitações distintas)
- Itens únicos (count distinct `codigo_catmat`)
- Convênios (count distinct contratação)
- Consumidores/órgãos (count distinct `cnpj_orgao`)

**Filtros:**
- Situação do processo (Homologado / Em andamento / Deserto / Fracassado)
- Estado (UF) — multiseleção, igual ao slide (BA, CE, DF...)
- Cidade (deriva da UF selecionada)
- Nome da instituição (busca текст)
- Nome da empresa/vencedor (busca)
- Range de datas (slider de período, ex: 2023→hoje)

**Tabela principal (colunas):**
| Coluna | Campo |
|---|---|
| Nome do proponente | `razao_social_orgao` |
| Convênio | `numero_controle_pncp` ou número do convênio |
| Status | situação do item |
| Vencedor | `nome_fornecedor` |
| Item | `codigo_catmat` + `nome_catmat` |
| Qtd | `quantidade_homologada` |
| Valor vencedor | `valor_total_homologado` |

**Endpoint a criar:** `GET /api/vencedores?uf=&situacao=&empresa=&dataIni=&dataFim=`
Retorna: `{ kpis: {...}, vencedores: [...] }`

---

### TELA 2 — Breakdown Item × Empresa × Estado (slides 8 e 9)

**Objetivo:** revelar onde está o dinheiro — qual equipamento move mais valor,
quem vende, em qual estado.

**Layout:** 3 colunas conectadas (estilo Sankey/breakdown da Hospmult):
1. **Coluna ITEM** — ranking de equipamentos por valor homologado, decrescente.
   Ex: "011425-Ventilador Pulmonar — R$58.543.316,91". Barra de proporção.
2. **Coluna VENCEDOR** — para o item selecionado, ranking de empresas vencedoras.
   Ex: "HOSPCOM EQUIPAMENTOS — R$10.787.030,00".
3. **Coluna ESTADO** — para o item+empresa, distribuição por UF.

**KPI central:** Valor Total Homologado (grande, à esquerda — ex: R$465.565.484,18).

**Filtros:**
- Range de ano (2023, 2024, 2025) — slider
- Equipamento (dropdown por `nome_catmat`)
- Situação do aceite
- Empresa

**Lista lateral:** "Nome do Proponente" (órgãos beneficiados).

**Endpoint a criar:** `GET /api/breakdown?ano=&item=&empresa=&uf=`
Retorna estrutura hierárquica: `{ valorTotal, porItem: [...], porVencedor: [...], porEstado: [...] }`

**Componente sugerido:** treemap ou barras horizontais agrupadas (Recharts).

---

### TELA 3 — Posicionamento de Empresas por Ano (slides 10 e 11)

**Objetivo:** market share competitivo por empresa ao longo do tempo.

**KPIs:**
- Valor total (ex: R$466.119.742,29)
- Ticket médio
- Itens únicos (ex: 4.143)
- Convênios (ex: 1.130)
- Consumidores (ex: 600)

**Visualização principal:** TREEMAP por ano (2024 | 2025 | sem data).
Cada bloco = uma empresa, tamanho = valor ganho naquele ano.
Ex: HOSPCOM, SIEMENS, VMI TECNOLOGIA, BARRFAB, GE HEALTHCARE...

**Gráfico secundário:** distribuição por modalidade da compra
(Cotação Eletrônica, Cotação Prévia, Licitação, Dispensa, Pesquisa de Mercado).

**Lista lateral:** "Total Ganho por Empresa" — ranking com valores,
com busca. Ex: "1000MEDIC DISTRIBUIDORA — R$43.321,16".

**Filtros:** equipamento + ano (multiseleção).

**Endpoint a criar:** `GET /api/posicionamento?ano=&equipamento=`
Retorna: `{ kpis, treemapPorAno: {...}, porModalidade: [...], rankingEmpresas: [...] }`

---

### TELA 4 — Concorrentes por Estado e Equipamento (slide 12)

**Objetivo:** quem domina o quê em cada região.

**Topo:** Ranking Top 3 maiores concorrentes (vencedor, valor, item).
Ex: "SAFE SUPORTE A VIDA — R$7.660.806,00 — 000162-Aparelho de Anestesia".

**Seletor de estado:** barra com todas as UFs (AC, AL, AP... TO) — clicável.

**Coluna esquerda:** filtro por item (lista de equipamentos com checkbox).

**Centro:** donut "Porcentagem de itens adquiridos" — distribuição por categoria.
Ex: Monitor Multiparâmetros 10.96%, Ventilador 8.77%, etc.

**Coluna direita:** "Entidades Beneficiadas" (proponentes/órgãos da UF selecionada).

**Filtros:** ano (2023/2024), proponente (busca), situação do aceite.

**Endpoint a criar:** `GET /api/concorrentes-estado?uf=&item=&ano=`
Retorna: `{ top3: [...], distribuicaoItens: [...], entidades: [...] }`

---

## 3. FONTE DE DADOS POR TELA (resumo)

Todas as 4 telas consomem a tabela `resultados` (vencedores homologados),
agregada de formas diferentes. Nenhuma chama a API do PNCP em tempo real —
todas leem o banco populado pelo ETL. Isso garante performance (as agregações
de R$466M são pesadas demais para fazer ao vivo).

---

## 4. PIPELINE ETL (o trabalho pesado — fazer ANTES das telas)

**Onde rodar:** NÃO na Vercel (timeout). Opções:
- GitHub Actions agendado (como já fizemos no snapshot)
- Worker dedicado (Railway, Render, ou máquina local com cron)
- Supabase Edge Functions agendadas

**Fluxo do worker:**
```
1. Buscar contratações de saúde (todas modalidades, 2023→hoje)
   → /contratacoes/publicacao  [JÁ IMPLEMENTADO no pncp.ts corrigido]
   → salvar em tabela `contratacoes`

2. Para cada contratação nova:
   a. GET itens da compra → salvar em `itens`
   b. Para cada item com situacao_item_id = 2 (homologado):
      GET resultado do item → salvar em `resultados`
   c. Enriquecer: copiar uf, ano, catmat para `resultados` (desnormalização)

3. Rate limit: ~300-500ms entre chamadas (o PNCP limita)
4. Idempotência: usar UPSERT (ON CONFLICT) para reprocessar sem duplicar
5. Checkpoint: salvar última contratação processada para retomar
```

**Estimativa de volume:** milhares de contratações × vários itens cada =
dezenas a centenas de milhares de chamadas. O primeiro run completo (2023→hoje)
pode levar horas. Runs incrementais (semanais) são rápidos.

**AÇÃO CLAUDE CODE:** verificar se as rotas em `_backup/` (vencedores, comprasgov,
contratos) já têm parte dessa lógica antes de escrever do zero.

---

## 5. ORDEM DE IMPLEMENTAÇÃO SUGERIDA

1. **Confirmar endpoints no Swagger** do PNCP (itens + resultados)
2. **Provisionar banco** (Supabase recomendado) + criar schema da seção 1
3. **ETL incremental** — começar com 1 estado (ex: CE) e período curto (3 meses)
   para validar o fluxo item→resultado antes de rodar tudo
4. **Tela 1** (Vencedores) — a mais simples, valida o banco
5. **Tela 4** (Concorrentes por estado) — donut + top 3
6. **Tela 2** (Breakdown) — visual mais complexo
7. **Tela 3** (Posicionamento/treemap) — depende de mais volume histórico
8. **Rodar ETL completo** 2023→hoje em background
9. **Cron semanal** para manter atualizado

---

## 6. RISCOS E PONTOS DE ATENÇÃO

- **Volume de chamadas:** o ETL é pesado. Comece pequeno, valide, depois escale.
- **Rate limiting do PNCP:** respeitar intervalos; se bloquear, aumentar o delay.
- **Mudança de schema da API:** confirmar campos no Swagger, não confiar só neste doc.
- **Custo do banco:** dezenas de milhares de linhas cabem no free tier do Supabase,
  mas monitorar conforme cresce.
- **CATMAT:** o código do item (ex: 000253) vem do catálogo. Confirmar se vem
  direto no retorno dos itens ou se precisa cruzar com a tabela CATMAT separada.
- **Não inventar dados:** se um item não tem resultado homologado, ele simplesmente
  não entra em `resultados`. Telas devem lidar com "sem dados ainda" graciosamente.

---

## 7. O QUE NÃO ESTÁ NESTE PRD (decisões futuras)

- Portais estaduais (cada estado tem sistema próprio, muitos sem API) — fase posterior
- Comprasnet/SIASG legado — avaliar se agrega além do PNCP
- Preços de referência (BPS/CMED) — já tratados em pacote anterior, integrar depois
- Cruzamento com convênios do TransfereGov — enriquecimento futuro

---

*Fim do PRD. Entregar este arquivo ao Claude Code junto com acesso ao repositório.
Pedir que ele confirme os endpoints no Swagger antes de implementar e que verifique
o conteúdo das rotas em _backup/ para reaproveitar o que já existe.*
