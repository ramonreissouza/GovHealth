// A RÉGUA da cobertura: dado o retrato de cada dia, decide quais precisam ser
// recolhidos. Só decisão — nada de banco, PNCP ou pista aqui, para poder ser testada
// sem nada ligado (é o mesmo motivo pelo qual pncp-lock e pncp-breaker moram sozinhos).
//
// Estava dentro do sync-cobertura.mjs até 10/09/2026 e saiu por causa do conserto
// abaixo: uma régua que decide gastar pista precisa de teste, e teste de função que
// mora no meio de um script com `await` no topo não existe.
//
// ── AS TRÊS CLASSES DE DIA ───────────────────────────────────────────────────
// Dia útil, fim de semana e FERIADO. As duas primeiras já existiam; a terceira é o
// conserto de 10/09/2026. Ver `feriados.mjs` para o porquê e para o que entra na lista.
// Feriado é comparado com a régua de BAIXO VOLUME, junto com o fim de semana: os dois
// são dias em que o país não publica, e é isso que a mediana precisa saber. Publicação
// em 07/09/2026 (Independência, numa segunda): 51 no país inteiro, contra mediana de
// dia útil de 767.
//
// ── POR QUE EXISTE A MARCA DE CONFIRMADO ─────────────────────────────────────
// (medido em 10/09/2026, não estimado)
//
// Um dia pode estar COMPLETO e ainda assim ficar eternamente abaixo da régua. 05 e
// 06/09/2026 (sábado e domingo) têm ZERO contratações no país; a mediana de fim de
// semana é 7, e abaixo do piso a regra é "só o zero absoluto conta como buraco" — então
// os dois eram buraco para sempre. O `sync-cobertura` os recolhia, ganhava nada, dizia
// "rodou inteiro e ainda ficou curto", e recomeçava na execução seguinte. Três vezes por
// dia, indefinidamente, gastando pista para reconfirmar o que já sabia.
//
// A INFORMAÇÃO QUE FALTAVA JÁ ESTAVA NA MÃO e era jogada fora: no fim da coleta o
// script sabe que a varredura rodou INTEIRA e que o ganho foi ZERO. Isso não é um dia
// suspeito, é um dia RESPONDIDO — uma varredura nacional completa afirmou que não há
// mais nada lá. Então agora ele anota, e a régua respeita a anotação.
//
// POR QUE NÃO "ACEITAR ZERO" DIRETO, que era o conserto óbvio: porque cegaria a
// ferramenta. Se zero deixasse de ser buraco nos dias de baixo volume, um sábado que
// REALMENTE não foi coletado ficaria invisível — e é justamente para achar esses que
// este script existe. A marca não relaxa a régua: ela registra que a pergunta já foi
// feita à fonte e respondida.
//
// A MARCA VENCE SOZINHA. Ela vale para uma contagem específica: se o dia mudar de
// número (alguém trouxe linha nova por outro caminho), a confirmação é descartada e o
// dia volta a ser julgado pela régua. Confirmação não é anistia permanente, é a
// resposta a uma pergunta que continua valendo enquanto o mundo não muda.

import { ehFeriado, nomeFeriado } from './feriados.mjs'

export const UTIL = 'útil'
export const FDS = 'fim de semana'
export const FERIADO = 'feriado'

export const mediana = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/** Classifica pelo dia da semana E pelo calendário. `dow` no padrão do Postgres
 *  (`extract(dow)`): 0 = domingo, 6 = sábado. */
export function classificar(iso, dow) {
  if (dow === 0 || dow === 6) return FDS
  return ehFeriado(iso) ? FERIADO : UTIL
}

/** Fim de semana e feriado dividem a régua: os dois são dias de baixo volume, e num
 *  horizonte de 45 dias há feriado suficiente para uma mediana própria quase nunca —
 *  uma mediana de um ou dois pontos é pior que nenhuma. */
export const baixoVolume = (classe) => classe === FDS || classe === FERIADO

/** As duas medianas, calculadas sobre a janela de referência (maior que a do conserto,
 *  ver o cabeçalho do sync-cobertura). O dia de HOJE fica fora: ele ainda está sendo
 *  publicado e entraria como um zero permanente, puxando a mediana para baixo. */
export function reguas(referencia) {
  const base = referencia.filter((d) => d.idade > 0)
  return {
    refUtil: mediana(base.filter((d) => !baixoVolume(d.classe)).map((d) => d.n)),
    refBaixo: mediana(base.filter((d) => baixoVolume(d.classe)).map((d) => d.n)),
  }
}

/** Decide, para cada dia da janela do conserto, se ele precisa ser recolhido.
 *
 *  `inacabados`: Map iso -> quantas contratações o dia tinha quando a tentativa começou.
 *  `confirmados`: Map iso -> contagem que uma varredura COMPLETA declarou definitiva.
 *
 *  Muta os dias (é o que o chamador já esperava) e devolve as duas réguas. */
export function avaliar(dias, referencia, { inacabados = new Map(), confirmados = new Map(),
  limiar = 0.5, pisoRef = 20 } = {}) {
  const { refUtil, refBaixo } = reguas(referencia)
  for (const d of dias) {
    d.ref = baixoVolume(d.classe) ? refBaixo : refUtil
    d.feriado = d.classe === FERIADO ? nomeFeriado(d.iso) : null

    // Percentual em cima de número pequeno não quer dizer nada: um sábado com 3 contra
    // referência 8 dispara "buraco de 62%" para uma diferença de 5 registros, e pagaria
    // uma varredura nacional de 20min por eles. Abaixo do piso só o zero conta.
    const faltando = d.ref < pisoRef ? d.n === 0 : d.n < limiar * d.ref

    // A marca de inacabado vence o limiar. Um dia que sabidamente ficou pela metade não
    // precisa convencer a régua: quem o interrompeu já sabe, e a régua nunca vai saber.
    d.inacabado = inacabados.has(d.iso)

    // A confirmação vale para uma contagem. Se o dia mudou de número, o mundo mudou e a
    // resposta antiga não vale mais — o chamador apaga a marca e a régua volta a valer.
    const confirmada = confirmados.get(d.iso)
    d.confirmado = confirmada !== undefined && confirmada === d.n
    d.confirmacaoVencida = confirmada !== undefined && confirmada !== d.n

    // Os dois mais novos entram sempre: são os que a tela mostra primeiro e o dia de
    // hoje, por definição, ainda está sendo publicado — nunca vai parecer completo.
    d.recolher = d.idade <= 1 || d.inacabado || (faltando && !d.confirmado)
    d.motivo = d.idade <= 1 ? 'recente'
      : d.inacabado ? `inacabado (parou em ${inacabados.get(d.iso) ?? '?'})`
      : faltando && !d.confirmado ? `${d.n} vs ref ${d.ref}`
      : null
    // Só para o relatório: por que um dia abaixo da régua NÃO está sendo recolhido.
    d.dispensa = faltando && d.confirmado && d.idade > 1
      ? `varredura completa confirmou ${confirmada}`
      : null
  }
  return { refUtil, refBaixo }
}

/** Um dia merece a marca de confirmado quando a varredura rodou INTEIRA e não trouxe
 *  nada. Não é "achou pouco": é "a fonte foi perguntada por completo e não tinha mais".
 *  Dia recente fica fora — ele ainda está sendo publicado, e confirmar hoje seria
 *  congelar um retrato que vai mudar em horas. */
export function mereceConfirmacao({ inteiro, idade, ganho }) {
  return inteiro === true && idade > 1 && ganho === 0
}
