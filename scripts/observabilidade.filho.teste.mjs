// Processo filho de scripts/observabilidade.teste.ts. Roda com
// `node --import ./src/worker/otel.mjs`, o mesmo bootstrap do worker em produção,
// e gera spans cheios de dado sensível: um fetch com query string (instrumentação
// automática) e um span com os atributos que o Next usa. O teste confere, no
// coletor falso, que nada disso saiu do processo.
import http from 'node:http'
import { trace } from '@opentelemetry/api'
import { encerrarOtel } from '../src/lib/otel.mjs'

const alvo = http.createServer((_, res) => res.end('ok'))
await new Promise((pronto) => alvo.listen(0, '127.0.0.1', pronto))
const { port } = /** @type {import('node:net').AddressInfo} */ (alvo.address())

await fetch(`http://127.0.0.1:${port}/busca?cnpj=12345678000190&q=segredo-fetch`)

trace.getTracer('teste').startActiveSpan('GET /oportunidades?q=segredo-nome', {
  attributes: {
    'http.target': '/oportunidades?q=segredo-target',
    'url.full': 'https://govhealth.techealth.com.br/oportunidades?sessao=segredo-url',
    'url.query': 'q=segredo-query',
    'next.span_name': 'GET /oportunidades?q=segredo-next',
  },
}, (span) => {
  span.recordException(new Error('falhou para fulano@exemplo.com em /conta?token=segredo-excecao'))
  span.end()
})

await encerrarOtel()
alvo.close()
