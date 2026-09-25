// scripts/radar/limite-credencial.mjs — limite de chamadas POR CREDENCIAL, no
// browser-service, e não por IP no nginx.
//
// O DEFEITO (revisão da #35): o nginx limitava /session, /capture e /cancel numa zona só,
// chaveada por `$binary_remote_addr`. Só que quem chama essas rotas é o servidor do Next,
// não o navegador do fornecedor — então TODOS os tenants chegavam com o mesmo IP, o de
// saída da Vercel, e dividiam um balde de 6/min. Um usuário repetindo "conectar" esgotava
// o balde e impedia outro cliente de capturar a sessão que acabou de logar, ou de
// cancelar uma aberta. E o nginx respondia 503 em HTML, que o proxy do Next lê como "a
// ponte com a nossa máquina está fora do ar" — o limite aparecia como pane.
//
// Aqui a chave é o `credencialId`, que o proxy só repassa depois de conferir que a
// credencial é do tenant autenticado (src/app/api/radar/conexao/route.ts). E cada ROTA
// tem o seu balde: abrir sessão sobe um navegador de verdade e é caro; capturar e
// cancelar são baratos, e cancelar nunca pode ficar preso atrás de quem abriu demais.
//
// Balde de fichas (token bucket): `rajada` fichas, repostas a `porMinuto` por minuto.

export const LIMITES = {
  // Um fornecedor conecta uma vez; 6/min com rajada de 3 é folga, não teto real.
  session: { porMinuto: 6, rajada: 3 },
  // "Já concluí" é clicado de novo enquanto o 2FA não termina.
  capture: { porMinuto: 30, rajada: 10 },
  // Liberar a sessão é o que DEVOLVE recurso: o mais largo de todos.
  cancel: { porMinuto: 60, rajada: 20 },
}

/**
 * @param {{ limites?: typeof LIMITES, agora?: () => number, maxChaves?: number }} [opts]
 */
export function criarLimitador({ limites = LIMITES, agora = Date.now, maxChaves = 10_000 } = {}) {
  const baldes = new Map()

  /** Esquece baldes já cheios de novo — sem isto o mapa só cresce. */
  function podar(t) {
    for (const [k, b] of baldes) {
      const cfg = limites[b.rota]
      if (!cfg) { baldes.delete(k); continue }
      const cheio = b.fichas + ((t - b.em) / 60_000) * cfg.porMinuto >= cfg.rajada
      if (cheio) baldes.delete(k)
    }
  }

  /**
   * @param {string} rota        'session' | 'capture' | 'cancel'
   * @param {string} credencialId
   * @returns {{ ok: true } | { ok: false, retryAfter: number }}
   */
  function permitir(rota, credencialId) {
    const cfg = limites[rota]
    if (!cfg) return { ok: true }
    const t = agora()
    if (baldes.size >= maxChaves) podar(t)
    const k = `${rota}\u0000${credencialId}`
    const b = baldes.get(k) ?? { rota, fichas: cfg.rajada, em: t }
    b.fichas = Math.min(cfg.rajada, b.fichas + ((t - b.em) / 60_000) * cfg.porMinuto)
    b.em = t
    if (b.fichas >= 1) {
      b.fichas -= 1
      baldes.set(k, b)
      return { ok: true }
    }
    baldes.set(k, b)
    const faltam = (1 - b.fichas) / cfg.porMinuto * 60 // segundos até a próxima ficha
    return { ok: false, retryAfter: Math.max(1, Math.ceil(faltam)) }
  }

  return { permitir, _baldes: baldes }
}

/**
 * Corpo do 429: JSON. A FRASE vai em `erro`, `error` e `detalhe` porque a tela lê um ou
 * outro conforme o passo (src/app/radar/page.tsx) — um código ali apareceria cru para o
 * fornecedor. O código máquina fica em `codigo`.
 */
export function respostaLimite(rota, retryAfter) {
  const acao = rota === 'session' ? 'abrir o navegador do portal' : rota === 'capture' ? 'confirmar a conexão' : 'cancelar'
  const frase = `Muitas tentativas de ${acao} para esta conexão. Aguarde ${retryAfter} s e tente de novo.`
  return { erro: frase, error: frase, detalhe: frase, codigo: 'limite_por_conexao', retryAfter }
}
