// src/lib/erro-cliente.ts — manda um erro do navegador para /api/erro-cliente
// (TS-540). Best-effort: nunca lança, e nunca deixa um erro em loop virar uma
// enxurrada de POSTs (mesma mensagem uma vez só, no máximo 10 por carga de página).

export type TipoErroCliente = 'render' | 'global' | 'janela' | 'promessa'

const MAXIMO_POR_PAGINA = 10
const enviados = new Set<string>()

export function reportarErroCliente(erro: unknown, tipo: TipoErroCliente): void {
  try {
    const e = erro instanceof Error ? erro : new Error(typeof erro === 'string' ? erro : 'erro sem mensagem')
    const chave = `${tipo}:${e.message}`
    if (enviados.has(chave) || enviados.size >= MAXIMO_POR_PAGINA) return
    enviados.add(chave)

    fetch('/api/erro-cliente', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tipo,
        nome: e.name,
        mensagem: e.message,
        stack: e.stack,
        digest: (e as { digest?: string }).digest,
        rota: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* reportar erro não pode virar outro erro */ }
}
