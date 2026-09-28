// scripts/prospeccao-fornecedores.mjs — quem ja vende equipamento/servico para a saude
// publica e, portanto, e cliente potencial da GovHealth AI.
//
// Fonte: PNCP publico. Nao toca no nosso banco (de proposito: a lista precisa ser
// defensavel para quem nao tem acesso a ele).
//
// Como funciona: busca contratos por termos de saude, pega o detalhe de cada um para
// saber QUEM ganhou (a busca nao traz o fornecedor), agrupa por CNPJ e ordena por valor.
//
// UA: o PNCP derruba a conexao para "(compatible; Nome/versao)" — ver src/lib/contratos.ts.
import fs from 'node:fs'
import { raizEmpresa } from './lib/raiz-empresa.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 GovHealthAI/1.0'
const H = { Accept: 'application/json', 'User-Agent': UA }
// "raio-x" sozinho traz scanner de bagagem de aeroporto (Nuctech, VMI Seguranca) —
// trocado por termos que so existem em saude.
const TERMOS = ['equipamento hospitalar','monitor multiparametrico','ultrassom','tomografo','respirador pulmonar','equipamento medico hospitalar','raio-x medico','desfibrilador','eletrocardiografo','mamografo','equipamento odontologico','autoclave hospitalar']

// Quem NAO e cliente: comprador (hospital/clinica/prefeitura), ou fornecedor de outra
// coisa que caiu na busca por causa do objeto do contrato.
const FORA = /limpeza|residuo|higieniza|vigilancia|seguranca|informatica|telecom|construtora|engenharia civil|locacao de veiculo|alimenta|transporte|prefeitura|municipio|estado d|secretaria|hospital |santa casa|beneficencia|fundacao|instituto|clinica |centro de imagen|diagnostico por imagem|radiologia|laboratorio de analises|medicina e diagnostico/i
// Farmaceutica/medicamento e ICP vizinho, nao o mesmo: marcamos em vez de excluir.
const VIZINHO = /pharma|farmac|medicamento|droga/i
const ANO_MIN = 2025

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function get(url, n = 4) {
  for (let i = 0; i < n; i++) {
    try { const r = await fetch(url, { headers: H }); if (r.ok) return await r.json() } catch { /* rede */ }
    await sleep(800 * 2 ** i)
  }
  return null
}

const itens = new Map()
for (const termo of TERMOS) {
  for (let p = 1; p <= 3; p++) {
    const u = `https://pncp.gov.br/api/search/?q=${encodeURIComponent(termo)}&tipos_documento=contrato&ordenacao=-data&pagina=${p}&tam_pagina=50`
    const j = await get(u); if (!j) break
    for (const it of (j.items ?? [])) if (Number(it.ano) >= ANO_MIN && it.orgao_cnpj && it.numero_sequencial) itens.set(it.numero_controle_pncp ?? `${it.orgao_cnpj}-${it.ano}-${it.numero_sequencial}`, it)
    if ((j.items ?? []).length < 50) break
  }
  console.error(`[busca] "${termo}" — acumulado ${itens.size}`)
}

const porCnpj = new Map()
let i = 0
for (const it of itens.values()) {
  i++
  const d = await get(`https://pncp.gov.br/api/pncp/v1/orgaos/${it.orgao_cnpj}/contratos/${it.ano}/${Number(it.numero_sequencial)}`, 2)
  if (i % 40 === 0) console.error(`[detalhe] ${i}/${itens.size}`)
  const cnpj = d?.niFornecedor?.replace(/\D/g, ''); const nome = d?.nomeRazaoSocialFornecedor
  if (!cnpj || cnpj.length !== 14 || !nome) continue
  const v = Number(d.valorGlobal) || 0
  const cur = porCnpj.get(cnpj) ?? { nome, cnpj, contratos: 0, valor: 0, orgaos: new Set(), ufs: new Set(), ultimo: '' }
  if (!cur.raiz) cur.raiz = raizEmpresa(nome)
  cur.contratos++; cur.valor += v
  if (it.orgao_nome) cur.orgaos.add(it.orgao_nome)
  if (it.uf) cur.ufs.add(it.uf)
  const ass = (d.dataAssinatura ?? '').slice(0, 10); if (ass > cur.ultimo) cur.ultimo = ass
  porCnpj.set(cnpj, cur)
  await sleep(120)
}

// Funde filiais do mesmo grupo (Philips/GE aparecem com CNPJs diferentes).
const porGrupo = new Map()
for (const f of porCnpj.values()) {
  const g = porGrupo.get(f.raiz) ?? { nome: f.nome, raiz: f.raiz, cnpjs: new Set(), contratos: 0, valor: 0, orgaos: new Set(), ufs: new Set(), ultimo: '' }
  g.cnpjs.add(f.cnpj); g.contratos += f.contratos; g.valor += f.valor
  for (const o of f.orgaos) g.orgaos.add(o)
  for (const u of f.ufs) g.ufs.add(u)
  if (f.ultimo > g.ultimo) g.ultimo = f.ultimo
  porGrupo.set(f.raiz, g)
}

// Ordena por SINAL DE PROSPECCAO, nao por valor: quem ganha em varias UFs e de varios
// orgaos tem operacao comercial de verdade, e e quem sente a dor que a plataforma cura.
// Um unico contrato grande e sorte; recorrencia e processo.
const pontos = (g) => g.contratos * 2 + g.ufs.size * 3 + g.orgaos.size
const todos = [...porGrupo.values()]
  .filter((g) => !FORA.test(g.nome))
  .sort((a, b) => pontos(b) - pontos(a) || b.valor - a.valor)
  .map((g, n) => ({ pos: n + 1, nome: g.nome, cnpjs: [...g.cnpjs], contratos: g.contratos, ufs: [...g.ufs].sort().join('/'), nUfs: g.ufs.size, orgaos: g.orgaos.size, valor: Math.round(g.valor), ultimoContrato: g.ultimo, icp: VIZINHO.test(g.nome) ? 'vizinho (medicamento)' : 'nucleo (equipamento/servico)' }))
const lista = todos.slice(0, 50)
fs.writeFileSync('prospeccao-50.json', JSON.stringify(lista, null, 1))
fs.writeFileSync('prospeccao-todos.json', JSON.stringify(todos, null, 1))
console.log(`descartados por nao serem ICP: ${porGrupo.size - todos.length} de ${porGrupo.size} grupos`)
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
console.log(`universo: ${itens.size} contratos · ${porCnpj.size} fornecedores distintos\n`)
for (const f of lista) console.log(String(f.pos).padStart(2), '|', String(f.contratos).padStart(3), 'ct |', String(f.nUfs).padStart(2), 'UF |', String(f.orgaos).padStart(3), 'org |', brl(f.valor).padStart(15), '|', f.nome.slice(0, 46))
