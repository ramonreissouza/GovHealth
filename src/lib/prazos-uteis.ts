// src/lib/prazos-uteis.ts — calendário de prazos calculado NO SERVIDOR.
//
// POR QUE ISTO EXISTE
// O modelo cita o edital com fidelidade, mas erra aritmética de calendário. Medido em
// produção: para uma sessão em 28/08/2026 (uma sexta), respondeu "como a sessão é
// segunda-feira, o prazo final para impugnar é 27/08 (quinta)" — dia da semana errado
// e contagem errada (três dias úteis antes de sexta caem na terça, 25/08). Num edital
// real isso é a diferença entre impugnar a tempo e perder o prazo.
//
// A saída daqui entra no prompt como fato pronto, e o prompt proíbe o modelo de
// recalcular. Ele volta a fazer o que faz bem: ler o documento e citar.
//
// Datas são tratadas como "civis" (ano/mês/dia), em Date de meio-dia UTC. Meio-dia, e
// não meia-noite, porque qualquer conversão de fuso em 00:00 escorrega para o dia
// anterior — o erro clássico deste tipo de código.

/** Meio-dia UTC do dia civil informado. */
function civil(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0))
}

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const diaDaSemana = (d: Date): string => DIAS[d.getUTCDay()]
export const paraISO = (d: Date): string => d.toISOString().slice(0, 10)
export const paraBR = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`

const somarDias = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000)

/** Domingo de Páscoa (algoritmo gregoriano anônimo). Base dos feriados móveis. */
function pascoa(ano: number): Date {
  const a = ano % 19
  const b = Math.floor(ano / 100), c = ano % 100
  const d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const bruto = h + l - 7 * m + 114
  return civil(ano, Math.floor(bruto / 31), (bruto % 31) + 1)
}

/**
 * Feriados NACIONAIS (Lei 662/1949, 6.802/1980, 9.093/1995 e 14.759/2023).
 * Só o que é feriado por lei — ponto facultativo entra na lista de baixo, separado,
 * porque não suspende prazo automaticamente e o órgão pode ou não parar.
 */
export function feriadosNacionais(ano: number): Map<string, string> {
  const p = pascoa(ano)
  const m = new Map<string, string>([
    [paraISO(civil(ano, 1, 1)), 'Confraternização Universal'],
    [paraISO(somarDias(p, -2)), 'Sexta-feira Santa'],
    [paraISO(civil(ano, 4, 21)), 'Tiradentes'],
    [paraISO(civil(ano, 5, 1)), 'Dia do Trabalho'],
    [paraISO(civil(ano, 9, 7)), 'Independência'],
    [paraISO(civil(ano, 10, 12)), 'Nossa Senhora Aparecida'],
    [paraISO(civil(ano, 11, 2)), 'Finados'],
    [paraISO(civil(ano, 11, 15)), 'Proclamação da República'],
    [paraISO(civil(ano, 12, 25)), 'Natal'],
  ])
  // Consciência Negra virou feriado nacional pela Lei 14.759/2023 — vale de 2024 em diante.
  if (ano >= 2024) m.set(paraISO(civil(ano, 11, 20)), 'Consciência Negra')
  return m
}

/** Ponto facultativo federal: NÃO descontamos, mas avisamos quando cai no intervalo. */
export function pontosFacultativos(ano: number): Map<string, string> {
  const p = pascoa(ano)
  return new Map<string, string>([
    [paraISO(somarDias(p, -48)), 'Carnaval (segunda)'],
    [paraISO(somarDias(p, -47)), 'Carnaval (terça)'],
    [paraISO(somarDias(p, -46)), 'Quarta-feira de Cinzas'],
    [paraISO(somarDias(p, 60)), 'Corpus Christi'],
  ])
}

/** Feriados dos anos que o intervalo toca — evita recalcular por data. */
function feriadosDe(anos: number[]): Map<string, string> {
  const todos = new Map<string, string>()
  for (const a of new Set(anos)) for (const [k, v] of feriadosNacionais(a)) todos.set(k, v)
  return todos
}

export function ehDiaUtil(d: Date, feriados: Map<string, string>): boolean {
  const dow = d.getUTCDay()
  return dow !== 0 && dow !== 6 && !feriados.has(paraISO(d))
}

/** Anda `n` dias úteis a partir de `base` (n negativo anda para trás). Não conta o dia base. */
export function somarDiasUteis(base: Date, n: number): Date {
  const passo = n < 0 ? -1 : 1
  const anos = [base.getUTCFullYear() - 1, base.getUTCFullYear(), base.getUTCFullYear() + 1]
  const feriados = feriadosDe(anos)
  let restam = Math.abs(n)
  let d = base
  while (restam > 0) {
    d = somarDias(d, passo)
    if (ehDiaUtil(d, feriados)) restam--
  }
  return d
}

export const diasCorridosEntre = (de: Date, ate: Date): number =>
  Math.round((ate.getTime() - de.getTime()) / 86_400_000)

/** Dias úteis entre duas datas, sem contar a de partida e contando a de chegada. */
export function diasUteisEntre(de: Date, ate: Date): number {
  const feriados = feriadosDe([de.getUTCFullYear(), ate.getUTCFullYear()])
  const passo = ate >= de ? 1 : -1
  let n = 0
  for (let d = somarDias(de, passo); passo > 0 ? d <= ate : d >= ate; d = somarDias(d, passo)) {
    if (ehDiaUtil(d, feriados)) n += passo
  }
  return n
}

// ── Extração das datas do edital ─────────────────────────────────────────────

const RE_NUMERICA = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g
const RE_EXTENSO = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MESES.join('|')})\\s+de\\s+(\\d{4})\\b`, 'gi')

function valida(a: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = civil(a, m, d)
  // Rejeita 31/02 e afins: o Date normaliza para março e a data deixa de ser a lida.
  if (dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null
  return dt
}

/**
 * Datas plausíveis citadas no edital. A janela (2 anos atrás → 3 à frente) corta
 * número de lei, CNPJ fatiado e versão de norma, que passam nas regex mas não são
 * data de certame.
 */
export function extrairDatas(texto: string, hoje: Date): Date[] {
  const achadas = new Map<string, Date>()
  const dentro = (d: Date) => {
    const anos = diasCorridosEntre(hoje, d) / 365
    return anos >= -2 && anos <= 3
  }
  for (const m of texto.matchAll(RE_NUMERICA)) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const dt = valida(ano, Number(m[2]), Number(m[1]))
    if (dt && dentro(dt)) achadas.set(paraISO(dt), dt)
  }
  for (const m of texto.matchAll(RE_EXTENSO)) {
    const mes = MESES.indexOf(m[2].toLowerCase()) + 1
    const dt = valida(Number(m[3]), mes, Number(m[1]))
    if (dt && dentro(dt)) achadas.set(paraISO(dt), dt)
  }
  return [...achadas.values()].sort((a, b) => a.getTime() - b.getTime())
}

/** Quantas datas entram no bloco. Edital longo cita dezenas; o que importa é o que ainda vai acontecer. */
const MAX_DATAS = 8

/**
 * Bloco de calendário pronto para o prompt. Vazio quando não há data reconhecível —
 * aí o prompt não promete um cálculo que não existe.
 */
export function calendarioParaPrompt(texto: string, hojeIso: string): string {
  const [ha, hm, hd] = hojeIso.split('-').map(Number)
  const hoje = civil(ha, hm, hd)
  const todas = extrairDatas(texto, hoje)
  if (!todas.length) return ''

  // Futuro primeiro (é sobre ele que se pergunta "ainda dá tempo?"); o passado recente
  // entra depois, só para o modelo poder dizer "esse prazo já venceu".
  const futuras = todas.filter((d) => d >= hoje)
  const passadas = todas.filter((d) => d < hoje).reverse()
  const usar = [...futuras, ...passadas].slice(0, MAX_DATAS).sort((a, b) => a.getTime() - b.getTime())

  const linhas = usar.map((d) => {
    const corridos = diasCorridosEntre(hoje, d)
    const uteis = diasUteisEntre(hoje, d)
    const quando = corridos === 0 ? 'É HOJE'
      : corridos > 0 ? `em ${corridos} dia(s) corrido(s) / ${uteis} dia(s) útil(eis)`
      : `há ${-corridos} dia(s) — JÁ PASSOU`
    const antes3 = somarDiasUteis(d, -3)
    const depois3 = somarDiasUteis(d, 3)
    return `- ${paraBR(d)} é ${diaDaSemana(d)} · ${quando}\n`
      + `    3 dias úteis ANTES = ${paraBR(antes3)} (${diaDaSemana(antes3)})`
      + ` · 3 dias úteis DEPOIS = ${paraBR(depois3)} (${diaDaSemana(depois3)})`
  })

  // Ponto facultativo que caia no intervalo coberto: pode mover a conta em um dia e o
  // modelo precisa avisar em vez de afirmar com falsa precisão.
  const inicio = usar[0] < hoje ? usar[0] : hoje
  const fim = usar[usar.length - 1]
  const facultativos: string[] = []
  for (let a = inicio.getUTCFullYear(); a <= fim.getUTCFullYear(); a++) {
    for (const [iso, nome] of pontosFacultativos(a)) {
      const d = civil(...(iso.split('-').map(Number) as [number, number, number]))
      if (d >= somarDias(inicio, -10) && d <= somarDias(fim, 10)) facultativos.push(`${paraBR(d)} (${nome})`)
    }
  }

  return `CALENDÁRIO — calculado pelo servidor a partir das datas citadas no edital.
hoje = ${diaDaSemana(hoje)}, ${paraBR(hoje)}
${linhas.join('\n')}
Contagem de dias úteis: sábados, domingos e feriados NACIONAIS descontados.`
    + (facultativos.length ? `\nAtenção: ${facultativos.join(', ')} é ponto facultativo e NÃO foi descontado.` : '')
    + `\nFeriados municipais e estaduais não são conhecidos aqui — ao dar uma data de prazo, diga que ela pode andar um dia se houver feriado local.`
}
