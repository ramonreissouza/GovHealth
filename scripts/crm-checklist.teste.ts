// Testes do checklist por etapa do CRM (src/lib/crm.ts). Roda com `npm run crm:teste`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHECKLIST_ETAPA, ID_TAREFA_HABILITACAO, STAGES, adicionarTarefa, alternarTarefa, checklistDoDeal,
  checklistPadrao, pendentesAnteriores, progressoEtapa, removerTarefa, tarefasDaEtapa,
  type PipelineStage, type TarefaEtapa,
} from '../src/lib/crm'

const deal = (stage: PipelineStage, checklist?: TarefaEtapa[]) => ({ stage, checklist })

test('modelo: toda etapa tem tarefa e os ids não se repetem', () => {
  for (const s of STAGES) assert.ok(CHECKLIST_ETAPA[s.id].length > 0, s.id)
  const ids = checklistPadrao().map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes(ID_TAREFA_HABILITACAO))
})

test('deal antigo, sem o campo, recebe o modelo padrão com ids estáveis', () => {
  const a = checklistDoDeal({})
  const b = checklistDoDeal({})
  assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id))
  assert.ok(a.every((t) => !t.feito))
})

test('checklist salvo é usado como está, não é misturado ao modelo', () => {
  const c: TarefaEtapa[] = [{ id: 'x', stage: 'contato', label: 'só esta', feito: true }]
  assert.deepEqual(checklistDoDeal({ checklist: c }), c)
  assert.deepEqual(progressoEtapa({ checklist: c }, 'contato'), { feitos: 1, total: 1 })
  assert.deepEqual(progressoEtapa({ checklist: c }, 'proposta'), { feitos: 0, total: 0 })
})

test('alternar marca e desmarca só a tarefa pedida, sem mutar o original', () => {
  const c = checklistPadrao()
  const id = CHECKLIST_ETAPA.prospeccao[0].id
  const marcado = alternarTarefa(c, id)
  assert.equal(marcado.find((t) => t.id === id)!.feito, true)
  assert.equal(c.find((t) => t.id === id)!.feito, false)
  assert.equal(marcado.filter((t) => t.feito).length, 1)
  assert.equal(alternarTarefa(marcado, id).find((t) => t.id === id)!.feito, false)
})

test('pendentes anteriores: só etapas ANTES da atual, não a atual nem as seguintes', () => {
  const c = checklistPadrao()
  const p = pendentesAnteriores(deal('proposta', c))
  const etapas = new Set(p.map((t) => t.stage))
  assert.deepEqual([...etapas].sort(), ['contato', 'prospeccao'])
  assert.equal(p.length, CHECKLIST_ETAPA.prospeccao.length + CHECKLIST_ETAPA.contato.length)
  assert.equal(pendentesAnteriores(deal('prospeccao', c)).length, 0)
})

test('pendentes anteriores: tarefa feita deixa de contar', () => {
  let c = checklistPadrao()
  for (const t of tarefasDaEtapa({ checklist: c }, 'prospeccao')) c = alternarTarefa(c, t.id)
  const p = pendentesAnteriores(deal('proposta', c))
  assert.ok(p.every((t) => t.stage === 'contato'))
})

test('perdido não cobra nada, e ganho não cobra as tarefas de perdido', () => {
  const c = checklistPadrao()
  assert.equal(pendentesAnteriores(deal('perdido', c)).length, 0)
  assert.ok(pendentesAnteriores(deal('ganho', c)).every((t) => t.stage !== 'perdido'))
})

test('adicionar: tarefa personalizada na etapa; texto vazio não cria nada', () => {
  const c = checklistPadrao()
  assert.equal(adicionarTarefa(c, 'proposta', '   '), c)
  const n = adicionarTarefa(c, 'proposta', '  Garantia da proposta  ')
  const nova = n[n.length - 1]
  assert.equal(nova.label, 'Garantia da proposta')
  assert.equal(nova.stage, 'proposta')
  assert.equal(nova.personalizada, true)
  assert.ok(!c.some((t) => t.id === nova.id))
})

test('remover tira só a tarefa pedida', () => {
  const c = checklistPadrao()
  const r = removerTarefa(c, ID_TAREFA_HABILITACAO)
  assert.equal(r.length, c.length - 1)
  assert.ok(!r.some((t) => t.id === ID_TAREFA_HABILITACAO))
})
