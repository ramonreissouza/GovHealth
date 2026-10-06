// src/instrumentation.ts — o Next chama `register()` uma vez, no boot, antes de
// carregar qualquer rota. É o lugar onde o SDK do OpenTelemetry precisa subir para
// enxergar o `pg` (TS-540; o que ele liga está em src/lib/otel.mjs).
//
// O `NEXT_RUNTIME` é trocado em tempo de build: no bundle do edge (o middleware) o
// ramo do Node some, e os pacotes do SDK, que só rodam em Node, não entram lá.

import type { Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { iniciarOtel } = await import('./lib/otel.mjs')
    iniciarOtel()
  }
}

// Erros que o próprio Next captura no servidor: Server Component, Server Action,
// route handler. Ele os transforma na tela de erro (ou num 500) e, sem este gancho,
// eles só deixam rastro no stdout do pod. O `digest` é o mesmo código que a tela de
// erro mostra ao usuário (src/app/error.tsx), e é por ele que se acha o caso no SigNoz.
export const onRequestError: Instrumentation.onRequestError = async (erro, request, contexto) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { registrarErro } = await import('./lib/rastreio')
  const digest = (erro as { digest?: unknown }).digest
  registrarErro('erro no servidor', erro, {
    'http.request.method': request.method,
    // Sem a query string: busca e filtros podem levar texto que o usuário digitou.
    'url.path': request.path.split('?')[0],
    'next.route': contexto.routePath,
    'next.route_type': contexto.routeType,
    'next.router': contexto.routerKind,
    ...(typeof digest === 'string' ? { 'erro.digest': digest } : {}),
  })
}
