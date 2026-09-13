// FERIADO NACIONAL — a terceira classe de dia que a régua da cobertura não conhecia.
//
// POR QUE ISSO EXISTE (medido em 10/09/2026, não estimado).
//
// O `sync-cobertura` separa dia útil de fim de semana porque sábado publica uma fração
// de uma terça, e comparar os dois transforma todo fim de semana em falso buraco. Mas a
// separação era por DIA DA SEMANA, e feriado cai em dia útil.
//
// 07/09/2026 (Independência) caiu numa segunda e publicou 51 contratações no país
// inteiro. A régua comparou com a mediana de dia útil — 767 — e declarou buraco. O dia
// estava completo: a varredura das 27 UFs de 07/09 já havia passado por ele. Ainda
// assim ele voltava à lista de "ainda em falta" em TODA execução, três vezes por dia,
// gastando pista para reconfirmar o que já estava confirmado.
//
// O QUE ENTRA NESTA LISTA: os dias em que o poder público não publica. Isso NÃO é a
// lista legal de feriados nacionais — é a lista dos dias que suprimem publicação, que é
// o que a régua precisa saber. Por isso Carnaval (segunda e terça) e Corpus Christi
// entram, apesar de serem ponto facultativo e não feriado: para o volume de publicação
// eles se comportam como feriado, e é o volume que a régua está medindo.
//
// O QUE NÃO ENTRA: feriado estadual e municipal. A cobertura é NACIONAL — o dia só
// afunda de verdade quando o país inteiro para. Um feriado só de São Paulo tira SP da
// conta e deixa as outras 26 UFs publicando; tratar isso como dia de baixo volume
// esconderia buraco de verdade nas demais.
//
// 20/11 (Consciência Negra) é feriado nacional desde a Lei 14.759/2023 — antes disso era
// municipal em parte do país. Está na lista porque o horizonte da régua são 45 dias, e
// 2024 já passou.

const FIXOS = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalhador
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25', // Natal
])

/** Domingo de Páscoa pelo algoritmo gregoriano (Meeus/Jones/Butcher). Devolve
 *  [mes, dia] em base 1. Toda a aritmética é inteira, sem `Date` — porque `Date` em
 *  cima de string sem fuso é justamente a armadilha que já custou um dia de contagem
 *  errada neste projeto (ver o comentário de fuso em sync-cobertura.mjs). */
export function pascoa(ano) {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return [Math.floor(n / 31), (n % 31) + 1]
}

const pad = (x) => String(x).padStart(2, '0')

/** Soma dias a uma data, em UTC de propósito: a conta é de calendário, não de relógio,
 *  e UTC não tem horário de verão para pular uma hora e virar o dia. */
function somarDias(ano, mes, dia, delta) {
  const t = new Date(Date.UTC(ano, mes - 1, dia + delta))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Os móveis de um ano, como datas ISO completas. */
export function moveis(ano) {
  const [m, d] = pascoa(ano)
  return {
    'carnaval-segunda': somarDias(ano, m, d, -48),
    'carnaval-terca': somarDias(ano, m, d, -47),
    'sexta-feira-santa': somarDias(ano, m, d, -2),
    pascoa: somarDias(ano, m, d, 0),
    'corpus-christi': somarDias(ano, m, d, 60),
  }
}

// A Páscoa em si é domingo — já é fim de semana pela régua, e listá-la aqui só
// duplicaria a classificação. Fica em `moveis()` porque é a âncora das outras.
const SUPRIMEM = ['carnaval-segunda', 'carnaval-terca', 'sexta-feira-santa', 'corpus-christi']

const cache = new Map()

function doAno(ano) {
  if (cache.has(ano)) return cache.get(ano)
  const mv = moveis(ano)
  const s = new Set(SUPRIMEM.map((k) => mv[k]))
  for (const md of FIXOS) s.add(`${ano}-${md}`)
  cache.set(ano, s)
  return s
}

/** `iso` no formato YYYY-MM-DD, já ancorado no fuso de quem chamou. Devolve false para
 *  qualquer coisa que não seja data ISO — a régua não pode morrer por causa de lixo. */
export function ehFeriado(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const ano = Number(iso.slice(0, 4))
  if (!Number.isInteger(ano) || ano < 1583) return false
  return doAno(ano).has(iso)
}

const NOMES_FIXOS = {
  '01-01': 'Confraternização',
  '04-21': 'Tiradentes',
  '05-01': 'Dia do Trabalhador',
  '09-07': 'Independência',
  '10-12': 'Aparecida',
  '11-02': 'Finados',
  '11-15': 'Proclamação da República',
  '11-20': 'Consciência Negra',
  '12-25': 'Natal',
}

/** Nome do feriado, para o relatório dizer POR QUE o dia é de baixo volume em vez de
 *  só afirmar que é. Devolve null se não for feriado. */
export function nomeFeriado(iso) {
  if (!ehFeriado(iso)) return null
  const md = iso.slice(5)
  if (NOMES_FIXOS[md]) return NOMES_FIXOS[md]
  const mv = moveis(Number(iso.slice(0, 4)))
  for (const k of SUPRIMEM) if (mv[k] === iso) return k.replace(/-/g, ' ')
  return 'feriado'
}
