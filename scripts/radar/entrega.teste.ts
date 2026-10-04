// scripts/radar/entrega.teste.ts — o que sai por e-mail na hora e o que espera o resumo.
// Uso: npx tsx --test scripts/radar/entrega.teste.ts
// Os textos são do chat real (02/10/2026), com o nome da empresa trocado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entregaDe, mencionaEmpresa, nucleoNome, quemEscala } from '../../src/lib/radar/entrega'
import { tokenVi, lerTokenVi } from '../../src/lib/radar/vi-token'

const cliente = { cnpj: '12.345.678/0001-90', nomes: ['REMORA PRODUTOS PARA SAUDE EIRELI', 'Remora Saúde'] }
const msg = (texto: string, extra: Partial<{ evento: string; prioridade: string; origem: string; participando: boolean }> = {}) =>
  ({ evento: 'nova_mensagem', texto, prioridade: 'alta', origem: 'auto', ...extra })

test('convocação do PRÓPRIO cliente sai na hora, mesmo em pregão escolhido pelo perfil', () => {
  const t = 'O participante REMORA PRODUTOS PARA SAUDE LTDA foi convocado a apresentar seus documentos de habilitação até 02/10/2026'
  assert.equal(entregaDe(msg(t), cliente), 'agora')
})

test('convocação de OUTRA empresa espera o resumo — era quase tudo o que a fila tinha', () => {
  const t = 'Convoco a empresa D. GOMES DA SILVA para que apresente sua documentação de habilitação, no prazo de 2 (duas) horas'
  assert.equal(entregaDe(msg(t), cliente), 'resumo')
})

test('CNPJ citado no texto conta, com ou sem pontuação', () => {
  assert.equal(mencionaEmpresa('Empresa 12345678000190 convocada', cliente), true)
  assert.equal(mencionaEmpresa('Empresa 12.345.678/0001-90 convocada', cliente), true)
  assert.equal(mencionaEmpresa('Empresa 12.345.678/0001-91 convocada', cliente), false)
})

test('números soltos que, juntos, formariam o CNPJ não contam (revisão da #53)', () => {
  assert.equal(mencionaEmpresa('Processo 12345678, item 0001-90, lote 3', cliente), false)
  assert.equal(mencionaEmpresa('Protocolo 912345678000190', cliente), false)   // dígito colado antes
  assert.equal(mencionaEmpresa('Ref. 123456780001901', cliente), false)        // dígito colado depois
  assert.equal(mencionaEmpresa('CNPJ 12.345.678/0001-90.', cliente), true)     // pontuação depois é ok
})

test('aviso parado na fila há mais de 6 h vai para o resumo, mesmo citando o cliente', () => {
  const t = 'Convoco a REMORA PRODUTOS PARA SAUDE LTDA para envio da proposta em 2 horas'
  assert.equal(entregaDe({ ...msg(t), idadeHoras: 0.1 }, cliente), 'agora')
  assert.equal(entregaDe({ ...msg(t), idadeHoras: 6 }, cliente), 'agora')
  assert.equal(entregaDe({ ...msg(t), idadeHoras: 7 }, cliente), 'resumo')
  assert.equal(entregaDe({ ...msg(t), idadeHoras: 47 }, cliente), 'resumo')
})

test('acento, caixa e sufixo societário não atrapalham', () => {
  assert.equal(mencionaEmpresa('a remora saúde enviou a proposta', cliente), true)
  assert.equal(mencionaEmpresa('REMORA PRODUTOS PARA SAÚDE EIRELI - ME foi habilitada', cliente), true)
})

test('nome curto ou genérico NÃO vira gatilho: casaria com o chat de todo mundo', () => {
  assert.equal(nucleoNome('SIEMENS'), null)
  assert.equal(nucleoNome('COMERCIO DE PRODUTOS HOSPITALARES LTDA'), null)
  assert.equal(nucleoNome('ME'), null)
  assert.equal(nucleoNome(''), null)
  assert.equal(nucleoNome(null), null)
  assert.equal(nucleoNome('SIEMENS HEALTHCARE DIAGNOSTICOS LTDA'), ' SIEMENS HEALTHCARE DIAGNOSTICOS ')
  const generico = { cnpj: null, nomes: ['SIEMENS', 'Comércio de Produtos Hospitalares'] }
  assert.equal(mencionaEmpresa('Comércio de produtos hospitalares em geral; Siemens', generico), false)
})

test('a palavra tem que bater inteira: REMORA não casa dentro de REMORAS', () => {
  const um = { cnpj: null, nomes: ['REMORA SAUDE'] }
  assert.equal(mencionaEmpresa('REMORAS SAUDE LTDA', um), false)
  assert.equal(mencionaEmpresa('a REMORA SAUDE LTDA', um), true)
})

test('pregão que o cliente adicionou à mão: o urgente sai na hora, o resto espera', () => {
  const geral = 'Ficam os licitantes convocados a apresentar as propostas realinhadas, no prazo de 2 (duas) horas'
  assert.equal(entregaDe(msg(geral, { origem: 'manual' }), cliente), 'agora')
  assert.equal(entregaDe(msg(geral, { origem: 'manual', prioridade: 'normal' }), cliente), 'resumo')
  assert.equal(entregaDe(msg(geral, { origem: 'auto' }), cliente), 'resumo')
})

test('pregão marcado como "Estou participando" vale o mesmo que o adicionado à mão', () => {
  const geral = 'Ficam os licitantes convocados a apresentar as propostas realinhadas, no prazo de 2 (duas) horas'
  assert.equal(entregaDe(msg(geral, { participando: true }), cliente), 'agora')
  assert.equal(entregaDe(msg(geral, { participando: true, prioridade: 'baixa' }), cliente), 'resumo')
  assert.equal(entregaDe(msg(geral, { participando: false }), cliente), 'resumo')
})

test('licitação nova para o perfil sempre vai para o resumo', () => {
  assert.equal(entregaDe(msg('REMORA PRODUTOS PARA SAUDE', { evento: 'nova_licitacao' }), cliente), 'resumo')
})

test('conta sem empresa cadastrada: só a origem manual pode adiantar', () => {
  const vazio = { cnpj: '', nomes: [null, undefined, ''] }
  assert.equal(entregaDe(msg('Convocamos a empresa X LTDA'), vazio), 'resumo')
  assert.equal(entregaDe(msg('Convocamos a empresa X LTDA', { origem: 'manual' }), vazio), 'agora')
  assert.equal(entregaDe(msg(''), vazio), 'resumo')
})

// ── repasse sem "Vi" ─────────────────────────────────────────────────────────────
const titular = { id: 'dono@empresa.com', email: 'dono@empresa.com', titular: true }
const ana = { id: 'ana@empresa.com', email: 'ana@empresa.com', titular: false }
const bia = { id: 'bia@empresa.com', email: 'bia@empresa.com', titular: false }

test('repasse vai para o responsável pelo pregão, se for outra pessoa', () => {
  assert.equal(quemEscala({ destinatario: 'dono@empresa.com', responsavel: 'bia@empresa.com', equipe: [titular, ana, bia] })?.email, 'bia@empresa.com')
})

test('sem responsável: o titular; se foi o titular quem recebeu, o membro mais antigo', () => {
  assert.equal(quemEscala({ destinatario: 'ana@empresa.com', equipe: [titular, ana, bia] })?.email, 'dono@empresa.com')
  assert.equal(quemEscala({ destinatario: 'Dono@Empresa.com', equipe: [titular, ana, bia] })?.email, 'ana@empresa.com')
})

test('quem foi indicado à mão vem primeiro, por id ou e-mail, mas só se for da equipe', () => {
  assert.equal(quemEscala({ destinatario: 'dono@empresa.com', preferido: 'BIA@empresa.com', responsavel: 'ana@empresa.com', equipe: [titular, ana, bia] })?.email, 'bia@empresa.com')
  assert.equal(quemEscala({ destinatario: 'dono@empresa.com', preferido: 'estranho@fora.com', responsavel: 'ana@empresa.com', equipe: [titular, ana, bia] })?.email, 'ana@empresa.com')
})

test('nunca para quem já recebeu, e equipe de uma pessoa não tem repasse', () => {
  assert.equal(quemEscala({ destinatario: 'dono@empresa.com', responsavel: 'dono@empresa.com', equipe: [titular, ana] })?.email, 'ana@empresa.com')
  assert.equal(quemEscala({ destinatario: 'dono@empresa.com', equipe: [titular] }), null)
  assert.equal(quemEscala({ destinatario: 'dono@empresa.com', equipe: [] }), null)
})

test('link "Vi": volta o id; adulterado, de outra chave ou vencido não vale', () => {
  process.env.NEXTAUTH_SECRET = 'segredo-de-teste'
  const t = tokenVi('nm:42:email')
  assert.equal(lerTokenVi(t), 'nm:42:email')
  const [id, exp, sig] = t.split('.')
  assert.equal(lerTokenVi(`${Buffer.from('nm:43:email').toString('base64url')}.${exp}.${sig}`), null, 'outro id')
  assert.equal(lerTokenVi(`${id}.${(parseInt(exp, 36) + 999).toString(36)}.${sig}`), null, 'validade esticada')
  assert.equal(lerTokenVi(`${id}.${exp}.${sig.slice(0, -2)}xx`), null, 'assinatura trocada')
  assert.equal(lerTokenVi(t, Date.now() + 8 * 86400_000), null, 'passou de 7 dias')
  assert.equal(lerTokenVi(''), null)
  assert.equal(lerTokenVi('a.b'), null)
  process.env.NEXTAUTH_SECRET = 'outro-segredo'
  assert.equal(lerTokenVi(t), null, 'assinado com outra chave')
})
