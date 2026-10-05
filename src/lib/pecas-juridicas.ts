// src/lib/pecas-juridicas.ts — as peças além da impugnação: pedido de esclarecimento,
// recurso e contrarrazões (Lei 14.133/2021).
//
// O mesmo princípio de prazos-uteis.ts: o modelo escreve bem, mas erra conta de
// calendário e às vezes cita artigo que não existe. Então o servidor faz as duas
// coisas que não podem sair erradas:
//   - o PRAZO da peça (data-limite, dia da semana, se ainda está aberto);
//   - a LISTA de dispositivos que a peça pode citar.
// O prompt entrega os dois prontos e proíbe o modelo de recalcular ou inventar.
//
// Toda conta aqui é conservadora: na dúvida, a data-limite sai MAIS CEDO. Feriado
// local e dia sem expediente no órgão empurram o prazo para frente (art. 183, III),
// nunca para trás — protocolar até a data daqui nunca é intempestivo por causa deles.

import { diaDaSemana, diasUteisEntre, extrairDatas, paraBR, paraISO, somarDiasUteis } from './prazos-uteis'

export type TipoPeca = 'esclarecimento' | 'recurso' | 'contrarrazoes'

export const TIPOS_PECA: readonly TipoPeca[] = ['esclarecimento', 'recurso', 'contrarrazoes']

/** Contra o quê o recurso se volta — muda a tese e o pedido. */
export type AlvoRecurso =
  | 'minha-inabilitacao'        // fui inabilitado
  | 'minha-desclassificacao'    // minha proposta foi desclassificada
  | 'habilitacao-concorrente'   // o vencedor foi habilitado/aceito sem cumprir o edital
  | 'outro'

export const ALVOS_RECURSO: readonly AlvoRecurso[] = [
  'minha-inabilitacao', 'minha-desclassificacao', 'habilitacao-concorrente', 'outro',
]

export const NOME_PECA: Record<TipoPeca, string> = {
  esclarecimento: 'Pedido de esclarecimento',
  recurso: 'Recurso administrativo',
  contrarrazoes: 'Contrarrazões ao recurso',
}

/** Rótulo da data que a pessoa informa — é dela que o prazo é contado. */
export const ROTULO_DATA_BASE: Record<TipoPeca, string> = {
  esclarecimento: 'Data da abertura da sessão',
  recurso: 'Data da ata ou da intimação da decisão',
  contrarrazoes: 'Data em que o recurso foi divulgado',
}

export interface PrazoPeca {
  /** Data-limite para protocolar (ISO, AAAA-MM-DD). */
  limiteIso: string
  limiteBR: string
  diaSemana: string
  /** A data informada (abertura, ata ou divulgação do recurso). */
  dataBaseIso: string
  dataBaseBR: string
  situacao: 'aberto' | 'vence-hoje' | 'vencido'
  /** Dias úteis de hoje até o limite (0 = vence hoje; negativo = já venceu). */
  diasUteisRestantes: number
  /** De onde vem o prazo, em uma frase com o artigo. */
  fundamento: string
  /** O que a conta não sabe e pode mover a data. */
  ressalvas: string[]
}

const civilDeIso = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(a, mes - 1, d, 12, 0, 0))
  // Rejeita 31/02 e afins: o Date normaliza para o mês seguinte.
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() + 1 !== mes || dt.getUTCDate() !== d) return null
  return dt
}

const RESSALVA_FERIADO_LOCAL =
  'Feriados estaduais e municipais e dias sem expediente no órgão não foram descontados. '
  + 'Eles só adiam o prazo (art. 183, III): protocolar até esta data nunca fica fora do prazo por causa deles.'

/**
 * Prazo da peça a partir da data que a pessoa informou.
 *
 * - esclarecimento: até 3 dias úteis ANTES da abertura (art. 164).
 * - recurso: 3 dias úteis contados da intimação ou da lavratura da ata (art. 165, I).
 * - contrarrazões: o mesmo prazo do recurso, contado da intimação ou da divulgação
 *   da interposição (art. 165, § 4º).
 *
 * Contagem do art. 183: exclui o dia do começo e inclui o do vencimento. O § 1º, I
 * ("dia do começo" = dia útil seguinte à divulgação na internet) pode empurrar o fim
 * em um dia; não aplicamos, porque a data mais cedo é a que nunca perde o prazo.
 *
 * Retorna `{ erro }` para data inválida, ou data futura quando a peça corre DEPOIS
 * do fato (ninguém foi intimado amanhã).
 */
export function prazoDaPeca(tipo: TipoPeca, dataBaseIso: string, hojeIso: string): PrazoPeca | { erro: string } {
  const base = civilDeIso(dataBaseIso)
  const hoje = civilDeIso(hojeIso)
  if (!base || !hoje) return { erro: 'Data inválida. Use o formato dia/mês/ano.' }

  let limite: Date
  let fundamento: string
  const ressalvas: string[] = []

  if (tipo === 'esclarecimento') {
    limite = somarDiasUteis(base, -3)
    fundamento = 'Art. 164 da Lei 14.133/2021: o pedido de esclarecimento deve ser protocolado até 3 dias úteis antes da abertura do certame.'
    ressalvas.push('Se o edital fixar prazo próprio, menor, vale o do edital: confira o item de esclarecimentos.')
  } else {
    if (base > hoje) {
      return { erro: tipo === 'recurso'
        ? 'A data da ata ou da intimação não pode ser no futuro.'
        : 'A data em que o recurso foi divulgado não pode ser no futuro.' }
    }
    limite = somarDiasUteis(base, 3)
    if (tipo === 'recurso') {
      fundamento = 'Art. 165, I, da Lei 14.133/2021: 3 dias úteis para apresentar as razões, contados da intimação ou da lavratura da ata.'
      ressalvas.push(
        'Contra o julgamento das propostas ou a habilitação, a intenção de recorrer precisa ter sido manifestada na sessão, logo após a decisão, sob pena de preclusão (art. 165, § 1º, I).',
        'Se o portal mostrar outro prazo para as razões, siga o que vencer primeiro.',
      )
    } else {
      fundamento = 'Art. 165, § 4º, da Lei 14.133/2021: as contrarrazões têm o mesmo prazo do recurso (3 dias úteis), contado da intimação ou da divulgação da interposição.'
      ressalvas.push('Se o portal mostrar outro prazo para as contrarrazões, siga o que vencer primeiro.')
    }
  }
  ressalvas.push(RESSALVA_FERIADO_LOCAL)

  const restantes = diasUteisEntre(hoje, limite)
  const mesmoDia = paraISO(hoje) === paraISO(limite)
  return {
    limiteIso: paraISO(limite),
    limiteBR: paraBR(limite),
    diaSemana: diaDaSemana(limite),
    dataBaseIso: paraISO(base),
    dataBaseBR: paraBR(base),
    situacao: mesmoDia ? 'vence-hoje' : limite > hoje ? 'aberto' : 'vencido',
    diasUteisRestantes: mesmoDia ? 0 : restantes,
    fundamento,
    ressalvas,
  }
}

/**
 * Dispositivos que a peça pode citar. O modelo pequeno inventa artigo com
 * facilidade ("art. 72-B"); com a lista fechada, a citação errada vira exceção.
 * Outro dispositivo só entra se o próprio edital o citar.
 */
export const DISPOSITIVOS_LEI_14133 = `- Art. 5º — princípios, entre eles legalidade, impessoalidade, igualdade, publicidade, motivação, vinculação ao edital, julgamento objetivo, segurança jurídica, razoabilidade, proporcionalidade, competitividade e economicidade.
- Art. 9º, I — é vedado ao agente público admitir, prever ou tolerar cláusulas que comprometam, restrinjam ou frustrem o caráter competitivo do processo.
- Art. 12, III — o desatendimento de exigências meramente formais, que não comprometam a aferição da qualificação do licitante ou a compreensão da proposta, não importa seu afastamento da licitação.
- Art. 55, § 1º — modificação do edital exige nova divulgação e reabertura dos prazos, salvo se a alteração não comprometer a formulação das propostas.
- Art. 59 — hipóteses de desclassificação da proposta (vícios insanáveis, desconformidade com especificações técnicas, preço inexequível ou acima do orçamento, não demonstração de exequibilidade quando exigida); § 2º — a Administração pode fazer diligência para aferir a exequibilidade (só do PREÇO; diligência sobre documento de habilitação é o art. 64).
- Art. 64 — depois da entrega dos documentos de habilitação, só cabe documento novo em diligência, para complementar informação sobre documento já apresentado (fato existente à época da abertura) ou atualizar documento vencido; § 1º — erros ou falhas que não alterem a substância dos documentos podem ser sanados, por despacho fundamentado.
- Art. 67, §§ 1º e 2º — atestados de capacidade técnica restritos às parcelas de maior relevância ou valor significativo (≥ 4% do valor estimado); quantidade mínima exigida limitada a 50% das parcelas.
- Art. 164 — qualquer pessoa pode impugnar o edital ou pedir esclarecimento até 3 dias úteis antes da abertura; parágrafo único — a resposta é divulgada em sítio oficial em até 3 dias úteis, limitada ao último dia útil antes da abertura.
- Art. 165, I e §§ 1º, 2º, 4º e 5º — recurso em 3 dias úteis contra julgamento das propostas e habilitação/inabilitação; intenção manifestada imediatamente; dirigido à autoridade que decidiu, que pode reconsiderar em 3 dias úteis ou encaminhar à autoridade superior (decisão em até 10 dias úteis); contrarrazões no mesmo prazo; vista dos elementos indispensáveis à defesa.
- Art. 168 — o recurso e o pedido de reconsideração têm efeito suspensivo do ato ou da decisão recorrida até a decisão final.
- Art. 183 — contagem de prazos: exclui o dia do começo, inclui o do vencimento; prazo em dias úteis conta só dias de expediente no órgão.`

const ALVO_TEXTO: Record<AlvoRecurso, string> = {
  'minha-inabilitacao': 'A RECORRENTE é a empresa do usuário, que foi INABILITADA. O recurso pede a reforma da decisão e a sua habilitação.',
  'minha-desclassificacao': 'A RECORRENTE é a empresa do usuário, cuja PROPOSTA foi DESCLASSIFICADA. O recurso pede a reforma da decisão e o retorno da proposta ao certame.',
  'habilitacao-concorrente': 'A RECORRENTE é a empresa do usuário, que contesta a ACEITAÇÃO/HABILITAÇÃO de outra licitante. O recurso pede a desclassificação ou a inabilitação dessa licitante e o prosseguimento do certame com a próxima colocada.',
  'outro': 'A RECORRENTE é a empresa do usuário. Leia a decisão para entender o que ela contesta.',
}

const ESTRUTURA: Record<TipoPeca, string> = {
  esclarecimento: `PEDIDO DE ESCLARECIMENTO, nesta ordem:
1. Endereçamento ao(à) Agente de Contratação/Pregoeiro(a) do órgão, com o número do processo/edital como estiver no edital.
2. Qualificação da solicitante.
3. Tempestividade: o título da seção e, na linha de baixo, exatamente [[TEMPESTIVIDADE]].
4. Os esclarecimentos, numerados. Cada um: o item do edital (cite o trecho literal entre aspas), a dúvida objetiva e, quando couber, por que a resposta afeta a formulação da proposta.
5. Pedido: resposta divulgada no sítio oficial (art. 164, parágrafo único) e, se a resposta alterar o edital de forma que afete as propostas, nova divulgação com reabertura de prazo (art. 55, § 1º).
6. Fechamento com local, data e assinatura.
É um pedido de ESCLARECIMENTO, não uma impugnação: tom colaborativo, perguntas, sem pedir anulação.`,
  recurso: `RECURSO ADMINISTRATIVO, nesta ordem:
1. Endereçamento à autoridade que proferiu a decisão (Agente de Contratação/Pregoeiro(a)), com pedido de reconsideração ou, se mantida a decisão, encaminhamento à autoridade superior (art. 165, § 2º).
2. Qualificação da recorrente e identificação do processo.
3. Tempestividade: o título da seção e, na linha de baixo, exatamente [[TEMPESTIVIDADE]].
4. Síntese dos fatos: o que foi decidido, por quem e com que motivação, só com base na DECISÃO enviada.
5. Razões: um tópico por tese, cada um com o trecho do edital ou da decisão entre aspas, o dispositivo da lista e por que a decisão está errada.
6. Efeito suspensivo (art. 168).
7. Pedidos, em itens: reconsideração/reforma, o resultado concreto pretendido, e o encaminhamento à autoridade superior se não houver reconsideração.
8. Fechamento com local, data e assinatura.`,
  contrarrazoes: `CONTRARRAZÕES AO RECURSO, nesta ordem:
1. Endereçamento ao(à) Agente de Contratação/Pregoeiro(a) e à autoridade superior.
2. Qualificação da recorrida (a empresa do usuário) e identificação do processo e da recorrente.
3. Tempestividade: o título da seção e, na linha de baixo, exatamente [[TEMPESTIVIDADE]].
4. Síntese do recurso: o que a recorrente alega, só com base no RECURSO enviado.
5. Razões para negar o recurso: rebata cada alegação em um tópico próprio, com o trecho do edital entre aspas e o dispositivo da lista. Se a alegação for de falha formal sanável, use o formalismo moderado (art. 12, III; art. 64, § 1º).
6. Pedidos: conhecimento e não provimento do recurso, manutenção da decisão.
7. Fechamento com local, data e assinatura.`,
}

export interface EmpresaPeca {
  razaoSocial?: string
  cnpj?: string
}

export interface EntradaPeca {
  tipo: TipoPeca
  edital: string
  /** recurso: a decisão/ata; contrarrazões: o recurso do concorrente. */
  documento?: string
  /** Dúvidas (esclarecimento) ou argumentos/fatos que só o usuário conhece. */
  argumentos?: string
  alvo?: AlvoRecurso
  intencaoManifestada?: boolean
  empresa?: EmpresaPeca
}

export const MAX_EDITAL_PECA = 80_000
export const MAX_DOCUMENTO_PECA = 20_000
export const MAX_ARGUMENTOS_PECA = 6_000

/** Mínimo de texto para a decisão/recurso colados: abaixo disso não há o que rebater. */
export const MIN_DOCUMENTO_PECA = 80

const texto = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/**
 * Corpo do pedido → entrada tipada. O JSON vem do navegador: campo de tipo errado
 * vira ausente aqui, em vez de estourar um `.trim()` lá no prompt.
 */
export function sanearEntrada(b: Record<string, unknown>): Partial<EntradaPeca> {
  const emp = b.empresa && typeof b.empresa === 'object' ? b.empresa as Record<string, unknown> : {}
  return {
    tipo: texto(b.tipo) as TipoPeca | undefined,
    edital: texto(b.edital) ?? '',
    documento: texto(b.documento),
    argumentos: texto(b.argumentos),
    alvo: texto(b.alvo) as AlvoRecurso | undefined,
    intencaoManifestada: b.intencaoManifestada === true,
    empresa: { razaoSocial: texto(emp.razaoSocial), cnpj: texto(emp.cnpj) },
  }
}

export function validarEntrada(e: Partial<EntradaPeca>): string | null {
  if (!e.tipo || !TIPOS_PECA.includes(e.tipo)) return 'Escolha a peça.'
  if ((e.edital ?? '').trim().length < 200) return 'Envie o edital antes de gerar a peça.'
  if (e.tipo === 'recurso' && (e.documento ?? '').trim().length < MIN_DOCUMENTO_PECA) {
    return 'Cole a decisão do pregoeiro ou o trecho da ata com a motivação.'
  }
  if (e.tipo === 'contrarrazoes' && (e.documento ?? '').trim().length < MIN_DOCUMENTO_PECA) {
    return 'Cole o recurso do concorrente.'
  }
  if (e.tipo === 'recurso' && e.alvo && !ALVOS_RECURSO.includes(e.alvo)) return 'Escolha contra o quê é o recurso.'
  return null
}

export const MARCADOR_TEMPESTIVIDADE = '[[TEMPESTIVIDADE]]'

/**
 * O bloco PRAZO do prompt. O modelo NÃO escreve o prazo: ele deixa o marcador e o
 * servidor põe no lugar o parágrafo de `textoTempestividade` (revisão da #60: copiar
 * a data "do bloco" ainda deixava a data dentro da minuta sob controle da IA).
 */
export function blocoPrazo(prazo: PrazoPeca | null): string {
  return `PRAZO E TEMPESTIVIDADE: quem escreve é o servidor, com a data calculada pela lei. Na seção de tempestividade escreva só ${MARCADOR_TEMPESTIVIDADE}. Em nenhum outro ponto da peça escreva data-limite, prazo em dias ou que a peça está dentro do prazo.`
    + (prazo?.situacao === 'vencido' ? '\nAtenção: o prazo desta peça JÁ VENCEU. Não afirme tempestividade em lugar nenhum.' : '')
}

const ARTIGO_DO_PRAZO: Record<TipoPeca, string> = {
  esclarecimento: 'art. 164',
  recurso: 'art. 165, I',
  contrarrazoes: 'art. 165, § 4º',
}

/**
 * O parágrafo de tempestividade, montado aqui e não pela IA. Com o prazo vencido ele
 * NÃO diz que a peça é tempestiva: vira um aviso entre colchetes para quem vai
 * protocolar.
 */
export function textoTempestividade(tipo: TipoPeca, prazo: PrazoPeca | null, intencaoManifestada?: boolean): string {
  const art = ARTIGO_DO_PRAZO[tipo]
  let t: string
  if (!prazo) {
    t = `[conferir: protocolado dentro do prazo do ${art}, da Lei nº 14.133/2021]`
  } else if (prazo.situacao === 'vencido') {
    t = `[ATENÇÃO: pelo ${art}, da Lei nº 14.133/2021, o prazo terminou em ${prazo.limiteBR} (${prazo.diaSemana}). Protocolada depois disso, a peça pode não ser conhecida. Confira o prazo no portal antes de protocolar.]`
  } else if (tipo === 'esclarecimento') {
    t = `O presente pedido é tempestivo: o prazo do art. 164 da Lei nº 14.133/2021, de até 3 (três) dias úteis antes da abertura da sessão, marcada para ${prazo.dataBaseBR}, encerra-se em ${prazo.limiteBR} (${prazo.diaSemana}).`
  } else if (tipo === 'recurso') {
    t = `As presentes razões são tempestivas: o prazo de 3 (três) dias úteis do art. 165, I, da Lei nº 14.133/2021, contado de ${prazo.dataBaseBR}, encerra-se em ${prazo.limiteBR} (${prazo.diaSemana}).`
  } else {
    t = `As presentes contrarrazões são tempestivas: o prazo de 3 (três) dias úteis do art. 165, § 4º, da Lei nº 14.133/2021, contado da divulgação do recurso em ${prazo.dataBaseBR}, encerra-se em ${prazo.limiteBR} (${prazo.diaSemana}).`
  }
  if (tipo === 'recurso') {
    t += intencaoManifestada
      ? ' A intenção de recorrer foi manifestada na sessão, logo após a decisão, nos termos do art. 165, § 1º, I.'
      : ' [conferir: intenção de recorrer manifestada na sessão em __/__/____, nos termos do art. 165, § 1º, I]'
  }
  return t
}

const RE_TITULO_TEMPESTIVIDADE = /^(\s*(?:(?:\d+|[IVX]+)\s*[.)\-–]\s*)?(?:DA\s+)?TEMPESTIVIDADE\b\s*[:.\-–]?\s*)(.*)$/i
// Linha que abre outra seção ("2. SÍNTESE DOS FATOS", "II – DOS PEDIDOS", "PEDIDOS"):
// o parágrafo da tempestividade termina antes dela mesmo sem linha em branco.
const RE_TITULO_SECAO = /^\s*(?:(?:\d+(?:\.\d+)*|[IVX]+)\s*[.)\-–]\s+\S|[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{3,}:?\s*$)/

/**
 * Põe o parágrafo do servidor na seção de tempestividade. Caminho normal: o marcador.
 * Se a IA ignorou o marcador e escreveu a seção, o texto dela é TROCADO pelo do
 * servidor (título com texto na mesma linha, ou o parágrafo logo abaixo do título).
 * Sem marcador nem título, nada é trocado e quem chamou avisa.
 */
export function inserirTempestividade(minuta: string, paragrafo: string): { minuta: string; como: 'marcador' | 'secao' | 'nenhum' } {
  if (minuta.includes(MARCADOR_TEMPESTIVIDADE)) {
    // Só a primeira ocorrência recebe o parágrafo; marcador repetido some.
    const [antes, ...depois] = minuta.split(MARCADOR_TEMPESTIVIDADE)
    return { minuta: (antes + paragrafo + depois.join('')).replace(/\n{3,}/g, '\n\n'), como: 'marcador' }
  }
  const linhas = minuta.split('\n')
  const i = linhas.findIndex((l) => RE_TITULO_TEMPESTIVIDADE.test(l))
  if (i < 0) return { minuta, como: 'nenhum' }
  const titulo = RE_TITULO_TEMPESTIVIDADE.exec(linhas[i])!
  if (titulo[2].trim()) {
    linhas[i] = `${titulo[1]}${paragrafo}`
    return { minuta: linhas.join('\n'), como: 'secao' }
  }
  let j = i + 1
  while (j < linhas.length && !linhas[j].trim()) j++
  let k = j
  while (k < linhas.length && linhas[k].trim() && !RE_TITULO_SECAO.test(linhas[k])) k++
  linhas.splice(j, k - j, paragrafo)
  return { minuta: linhas.join('\n'), como: 'secao' }
}

const nomeOuMarcador = (s: string | undefined, marcador: string) => (s && s.trim() ? s.trim() : marcador)

export function promptDaPeca(e: EntradaPeca, prazo: PrazoPeca | null, hoje: { iso: string; extenso: string }): {
  system: string
  user: string
} {
  const razao = nomeOuMarcador(e.empresa?.razaoSocial, '[RAZÃO SOCIAL]')
  const cnpj = nomeOuMarcador(e.empresa?.cnpj, '[CNPJ]')
  const contexto = e.tipo === 'recurso'
    ? `${ALVO_TEXTO[e.alvo ?? 'outro']}\nIntenção de recorrer manifestada na sessão: ${e.intencaoManifestada ? 'SIM, o usuário confirmou.' : 'NÃO CONFIRMADA pelo usuário (o servidor avisa na tempestividade; não escreva sobre isso).'}`
    : e.tipo === 'contrarrazoes'
      ? 'A RECORRIDA é a empresa do usuário, que está defendendo a decisão que a favoreceu.'
      : 'A SOLICITANTE é a empresa do usuário, que quer participar e precisa de respostas para formular a proposta.'

  const system = `HOJE É ${hoje.extenso} (${hoje.iso}).

Você é um ADVOGADO especialista em licitações (Lei 14.133/2021) que redige peças para FORNECEDORES de saúde. Escreva a peça pedida, pronta para o usuário revisar e protocolar.

${blocoPrazo(prazo)}

DISPOSITIVOS que você pode citar (use SÓ estes; outro dispositivo só se o próprio edital ou a decisão o citarem, e então diga que é citado ali):
${DISPOSITIVOS_LEI_14133}

Regras inegociáveis:
- Fatos só do que foi enviado (edital, decisão/recurso, argumentos do usuário). Não invente número de processo, nome de pregoeiro, data, valor, item ou documento. Onde faltar, use um marcador entre colchetes, como [Nº DO PROCESSO], e liste em "pendencias".
- Não cite jurisprudência, acórdão nem súmula: o número costuma sair errado e derruba a peça.
- Não escreva prazo nem data-limite: a tempestividade é do servidor (bloco PRAZO E TEMPESTIVIDADE).
- A lista de DISPOSITIVOS é um RESUMO, não o texto da lei: nunca ponha esse resumo entre aspas como se fosse citação literal. Aspas só para trecho do edital, da decisão ou do recurso enviados.
  Errado: "erros ou falhas que não alterem a substância dos documentos podem ser sanados" (art. 64, § 1º).
  Certo: o art. 64, § 1º, permite sanar erros ou falhas que não alterem a substância dos documentos.
- Tratamento neutro: "Ao(À) Senhor(a)", "Agente de Contratação/Pregoeiro(a)". Não presuma o gênero de ninguém.
- Cite o edital com o trecho literal entre aspas e o número do item quando ele existir.
- Linguagem técnica, objetiva, sem adjetivo contra a comissão ou o concorrente.
- Partes: solicitante/recorrente/recorrida = ${razao}, CNPJ ${cnpj}.

${contexto}

Estrutura obrigatória:
${ESTRUTURA[e.tipo]}

Responda SOMENTE com um objeto JSON válido, sem markdown:
{
  "minuta": "a peça completa, com \\n para quebras de linha",
  "teses": [{"tese": "argumento central em uma frase", "fundamento": "dispositivo da lista"}],
  "pendencias": ["o que o usuário precisa preencher ou conferir antes de protocolar"]
}
Em português brasileiro.`

  const partes = [`EDITAL:\n"""\n${e.edital.slice(0, MAX_EDITAL_PECA)}\n"""`]
  if (e.documento?.trim()) {
    partes.push(`${e.tipo === 'recurso' ? 'DECISÃO RECORRIDA (ata/motivação)' : 'RECURSO DO CONCORRENTE'}:\n"""\n${e.documento.trim().slice(0, MAX_DOCUMENTO_PECA)}\n"""`)
  }
  if (e.argumentos?.trim()) {
    partes.push(`${e.tipo === 'esclarecimento' ? 'DÚVIDAS DO USUÁRIO' : 'FATOS E ARGUMENTOS DO USUÁRIO'} (só ele sabe; trate como verdade):\n"""\n${e.argumentos.trim().slice(0, MAX_ARGUMENTOS_PECA)}\n"""`)
  } else if (e.tipo === 'esclarecimento') {
    partes.push('O usuário não listou dúvidas: identifique no edital os pontos ambíguos, omissos ou contraditórios que afetam a proposta de um fornecedor de saúde e pergunte sobre eles (no máximo 8).')
  }
  return { system, user: partes.join('\n\n') }
}

export interface PecaGerada {
  tipo: TipoPeca
  minuta: string
  teses: { tese: string; fundamento: string }[]
  pendencias: string[]
  /** O que o servidor conferiu e NÃO bate: artigo fora da lista, jurisprudência, data
   *  inventada, tempestividade que não pôde ser posta. A tela mostra em destaque. */
  alertas: string[]
  prazo: PrazoPeca | null
}

// ── Conferência das referências legais (revisão da #60) ───────────────────────
// O prompt pede a lista fechada, mas pedido não é garantia: tudo o que a minuta e as
// teses citam é extraído e comparado aqui.

/** Os artigos da lista DISPOSITIVOS_LEI_14133. */
export const ARTIGOS_CONFERIDOS: ReadonlySet<string> = new Set(['5', '9', '12', '55', '59', '64', '67', '164', '165', '168', '183'])

// "art. 64", "arts. 64 e 67", "artigo 5º", "art. 72-B", "arts. 62 a 70".
const RE_ARTIGO = /\b(?:arts?|artigos?)\.?\s*(\d+(?:-[A-Z])?)[º°o]?((?:\s*(?:,|e|a|até)\s*\d+(?:-[A-Z])?[º°o]?\b)*)/gi
// Normas: "Lei nº 14.133/2021", "Lei Complementar 123", "LC 123/2006", "Decreto 10.024".
const RE_NORMA = /\b(Lei\s+Complementar|Decreto-Lei|Decreto|Lei|LC)\s*(?:federal\s*)?(?:n[º°o.]*\s*)?(\d{1,3}(?:\.\d{3})+|\d{1,5})\b/gi
// Jurisprudência e afins: o prompt proíbe porque o número sai errado.
// O fim da palavra importa: sem ele, "resposta" virava "REsp" (visto numa minuta real).
const RE_JURIS = /\b(ac[óo]rd[ãa]os?|s[úu]mulas?|jurisprud[êe]ncia|precedentes?|REsp|AgRg|ADI|ADPF|RE\s*n?[º°]?\s*\d+|MS\s*n?[º°]?\s*\d+|entendimento\s+(?:consolidado\s+|pacífico\s+)?d[oa]s?\s+(?:TCU|STF|STJ|Tribuna(?:l|is)|Corte))(?![\p{L}\d])/giu

function artigosDe(texto: string): Set<string> {
  const achados = new Set<string>()
  for (const m of texto.matchAll(RE_ARTIGO)) {
    achados.add(m[1].toUpperCase())
    for (const n of (m[2] ?? '').matchAll(/(\d+(?:-[A-Z])?)/gi)) achados.add(n[1].toUpperCase())
  }
  return achados
}

function normasDe(texto: string): Map<string, string> {
  const achadas = new Map<string, string>()
  for (const m of texto.matchAll(RE_NORMA)) {
    const tipo = /^(lei\s+complementar|lc)$/i.test(m[1]) ? 'LC' : /^decreto/i.test(m[1]) ? 'Decreto' : 'Lei'
    const numero = m[2].replace(/\D/g, '')
    achadas.set(`${tipo}:${numero}`, `${tipo === 'LC' ? 'Lei Complementar' : tipo} ${m[2]}`)
  }
  return achadas
}

export interface ConferenciaReferencias {
  artigosForaDaLista: string[]
  normasNaoConferidas: string[]
  jurisprudencia: string[]
}

/**
 * Referências do `texto` (minuta + teses) que não estão na lista conferida NEM nas
 * `fontes` (edital, decisão, recurso, argumentos do usuário). O prompt deixa a IA citar
 * o que a própria fonte cita, então isso também vale aqui.
 */
export function conferirReferencias(texto: string, fontes: string): ConferenciaReferencias {
  const artFontes = artigosDe(fontes)
  const artigosForaDaLista = [...artigosDe(texto)]
    .filter((a) => !ARTIGOS_CONFERIDOS.has(a) && !artFontes.has(a))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((a) => `art. ${a}`)
  const normasFontes = normasDe(fontes)
  const normasNaoConferidas = [...normasDe(texto)]
    .filter(([chave]) => chave !== 'Lei:14133' && !normasFontes.has(chave))
    .map(([, rotulo]) => rotulo)
  const jurisFontes = new Set([...fontes.matchAll(RE_JURIS)].map((m) => m[1].toLowerCase().slice(0, 5)))
  const jurisprudencia = [...new Set([...texto.matchAll(RE_JURIS)].map((m) => m[1].trim()))]
    .filter((j) => !jurisFontes.has(j.toLowerCase().slice(0, 5)))
  return { artigosForaDaLista, normasNaoConferidas, jurisprudencia }
}

/** Datas citadas no `texto` que não vêm das fontes, do prazo calculado nem de hoje. */
export function datasNaoConferidas(texto: string, fontes: string, permitidasIso: string[], hojeIso: string): string[] {
  const [a, m, d] = hojeIso.split('-').map(Number)
  const hoje = new Date(Date.UTC(a, m - 1, d, 12))
  const ok = new Set([...permitidasIso, hojeIso, ...extrairDatas(fontes, hoje).map(paraISO)])
  return extrairDatas(texto, hoje).filter((dt) => !ok.has(paraISO(dt))).map(paraBR)
}

export interface ContextoConferencia {
  prazo: PrazoPeca | null
  intencaoManifestada?: boolean
  /** Tudo o que foi enviado à IA como fato: edital (no recorte enviado), decisão/recurso, argumentos. */
  fontes: string
  hojeIso: string
}

/** O que foi enviado como fato, no MESMO recorte que foi para o prompt. */
export function fontesDaEntrada(e: EntradaPeca): string {
  return [
    e.edital.slice(0, MAX_EDITAL_PECA),
    (e.documento ?? '').slice(0, MAX_DOCUMENTO_PECA),
    (e.argumentos ?? '').slice(0, MAX_ARGUMENTOS_PECA),
  ].join('\n')
}

const lista = (xs: string[]) => xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`

// Trecho entre aspas colado a uma referência de artigo, nas duas ordens:
//   "…" (art. 64, § 1º)      ·      o art. 64, § 1º, da Lei 14.133/2021, "…"
// Sem ponto nem quebra de linha no meio: depois do ponto já é outra frase, e
// `"… em 30 dias". Nos termos do art. 165` não é citação do art. 165.
const RE_ASPAS_ANTES = /["“”][^"“”\n]{15,600}["“”][ \t]*[,–-]?[ \t]*\(?[ \t]*(art(?:igo)?\.?\s*\d+)/gi
const RE_ASPAS_DEPOIS = /(art(?:igo)?\.?\s*\d+)([^"“”\n.]{0,80}?)["“”]/gi
// O ponto de "14.133" cortaria a frase no meio; e a aspa que vem depois de "item",
// "edital" ou "decisão" é citação desses, não da lei.
const RE_NOME_DA_LEI = /Lei\s*(?:n[º°o.]\s*)?14\.133(?:\/2021)?/gi
const RE_OUTRA_FONTE = /\b(?:item|itens|subitem|edital|cl[áa]usula|ata|decis[ãa]o|recurso)\b/i

/**
 * Artigos que a minuta "cita entre aspas". A lista do prompt é resumo, e o modelo
 * pequeno insiste em pôr o resumo entre aspas como se fosse a lei — a peça
 * protocolada com citação literal errada perde credibilidade. Não dá para corrigir
 * o texto daqui; dá para avisar quem vai protocolar.
 */
export function citacoesLiteraisDeLei(minuta: string): string[] {
  const t = minuta.replace(RE_NOME_DA_LEI, 'Lei 14133')
  const achados = new Set<string>()
  const num = (ref: string) => `art. ${ref.replace(/\D+/g, '')}`
  for (const m of t.matchAll(RE_ASPAS_ANTES)) achados.add(num(m[1]))
  for (const m of t.matchAll(RE_ASPAS_DEPOIS)) if (!RE_OUTRA_FONTE.test(m[2])) achados.add(num(m[1]))
  return [...achados].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
}

/**
 * Normaliza o JSON do modelo e confere a minuta. Campo faltando vira lista vazia,
 * nunca quebra a tela. A tempestividade é posta pelo servidor; artigo, norma,
 * jurisprudência e data que não batem com a lista ou com as fontes viram `alertas`.
 */
export function normalizarPeca(tipo: TipoPeca, bruto: unknown, ctx: ContextoConferencia): PecaGerada | null {
  const { prazo } = ctx
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>
  const minutaDaIA = typeof o.minuta === 'string' ? o.minuta.trim() : ''
  if (minutaDaIA.length < 200) return null
  const teses = Array.isArray(o.teses)
    ? o.teses
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => ({ tese: String(t.tese ?? '').trim(), fundamento: String(t.fundamento ?? '').trim() }))
      .filter((t) => t.tese)
    : []
  const pendencias = Array.isArray(o.pendencias)
    ? o.pendencias.map((p) => String(p ?? '').trim()).filter(Boolean)
    : []
  const alertas: string[] = []

  // 1. Tempestividade: o parágrafo é do servidor.
  const paragrafo = textoTempestividade(tipo, prazo, ctx.intencaoManifestada)
  const posta = inserirTempestividade(minutaDaIA, paragrafo)
  const minuta = posta.minuta
  if (posta.como === 'nenhum') {
    alertas.push(`A IA não deixou a seção de tempestividade, então o prazo dentro da minuta não foi conferido. Ponha nela este texto: "${paragrafo}"`)
  }
  // O que sobrou é só texto da IA: é nele que se procura data e "tempestivo".
  const textoDaIA = posta.como === 'nenhum' ? minuta : minuta.replace(paragrafo, '')
  // tempestivo/tempestiva, não o título "TEMPESTIVIDADE" nem "intempestivo".
  if (prazo?.situacao === 'vencido' && /(?<!in)tempestiv[oa]s?\b/i.test(textoDaIA)) {
    alertas.push(`O prazo terminou em ${prazo.limiteBR}, mas a minuta diz em outro ponto que a peça é tempestiva. Corrija antes de protocolar.`)
  }

  // 2. Referências legais fora da lista conferida.
  const citado = [minuta, ...teses.flatMap((t) => [t.tese, t.fundamento])].join('\n')
  const ref = conferirReferencias(citado, ctx.fontes)
  if (ref.artigosForaDaLista.length) {
    alertas.push(`A minuta cita ${lista(ref.artigosForaDaLista)}, fora da lista de artigos conferidos e sem aparecer no edital ou no que você colou. Confira na lei se o artigo existe e diz isso, ou tire antes de protocolar.`)
  }
  if (ref.normasNaoConferidas.length) {
    alertas.push(`A minuta cita ${lista(ref.normasNaoConferidas)}, que não é a Lei 14.133/2021 nem aparece no edital. Confira se a norma existe e vale para este caso.`)
  }
  if (ref.jurisprudencia.length) {
    alertas.push(`A minuta menciona jurisprudência (${lista(ref.jurisprudencia.map((j) => `"${j}"`))}). A IA não cita isso com segurança: confira número e teor, ou tire antes de protocolar.`)
  }

  // 3. Datas que não vieram de lugar nenhum.
  const permitidas = prazo ? [prazo.limiteIso, prazo.dataBaseIso] : []
  const datas = datasNaoConferidas(textoDaIA, ctx.fontes, permitidas, ctx.hojeIso)
  if (datas.length) {
    alertas.push(`A minuta cita ${lista(datas)}, que não aparece${datas.length > 1 ? 'm' : ''} no edital, no que você colou nem no prazo calculado. Confira antes de protocolar.`)
  }

  const literais = citacoesLiteraisDeLei(minuta)
  if (literais.length) {
    pendencias.push(`A minuta põe entre aspas trechos atribuídos ao ${literais.join(', ')} da Lei 14.133/2021. A IA resume a lei: confira a redação literal ou tire as aspas antes de protocolar.`)
  }
  if (tipo === 'recurso' && !ctx.intencaoManifestada) {
    pendencias.push('Confirme que a intenção de recorrer foi manifestada na sessão e ponha a data na tempestividade. Sem ela, o recurso pode não ser conhecido (art. 165, § 1º, I).')
  }
  return { tipo, minuta, teses, pendencias, alertas, prazo }
}
