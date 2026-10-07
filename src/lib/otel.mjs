// src/lib/otel.mjs — liga o envio de traces ao SigNoz do k3s (TS-540).
//
// Dois processos chamam isto: o app Next (src/instrumentation.ts) e o worker
// (src/worker/otel.mjs, carregado com `--import` antes de qualquer `pg`). Fica
// INERTE sem OTEL_EXPORTER_OTLP_ENDPOINT: em dev e na Vercel nada muda.
//
// Nome do serviço, versão e ambiente vêm do env que o chart põe
// (OTEL_SERVICE_NAME e OTEL_RESOURCE_ATTRIBUTES), e não daqui.
//
// Só traces, e com o SDK de traces, não o `sdk-node` inteiro. O Next já abre um
// span por requisição; aqui entram as queries do Postgres e, no worker, o fetch
// de saída (no app o Next já mede o fetch). Os erros viram eventos `exception`
// nos spans, e é deles que o SigNoz monta a aba Exceptions (ver src/lib/rastreio.ts).
//
// Nada sai sem passar pelo ExportadorRedigido abaixo. Ele vale para TODO span,
// inclusive os nativos do Next e os do fetch, que levam a URL completa com a
// query string. Redigir só onde o código cria o span deixaria esses de fora.
//
// Sem handler de SIGTERM, de propósito. O worker não trata o sinal, e um listener
// aqui impediria o processo de encerrar. O custo é perder, num deploy, os spans
// que ainda estavam no lote (até 5 s).

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { defaultResource, detectResources, envDetector } from '@opentelemetry/resources'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { redigir, redigirAtributos } from './redigir.mjs'

/**
 * O span com nome, atributos e eventos redigidos. O resto (ids, tempos, status,
 * resource) vem do original pela cadeia de protótipo, sem copiar nada interno do SDK.
 * @param {import('@opentelemetry/sdk-trace-node').ReadableSpan} span
 */
export function redigirSpan(span) {
  return Object.create(span, {
    name: { value: redigir(span.name), enumerable: true },
    attributes: { value: redigirAtributos(span.attributes), enumerable: true },
    events: {
      value: span.events.map((e) => ({ ...e, attributes: redigirAtributos(e.attributes) })),
      enumerable: true,
    },
  })
}

/** Embrulha um exportador e redige cada span antes de entregá-lo a ele. */
export class ExportadorRedigido {
  /** @param {import('@opentelemetry/sdk-trace-node').SpanExporter} interno */
  constructor(interno) { this.interno = interno }
  /** @type {import('@opentelemetry/sdk-trace-node').SpanExporter['export']} */
  export(spans, aoTerminar) { this.interno.export(spans.map(redigirSpan), aoTerminar) }
  shutdown() { return this.interno.shutdown() }
  forceFlush() { return this.interno.forceFlush?.() ?? Promise.resolve() }
}

let ligado = false
/** @type {NodeTracerProvider | null} */
let provider = null

/** @param {{ fetchDeSaida?: boolean }} [opcoes] */
export function iniciarOtel({ fetchDeSaida = false } = {}) {
  if (ligado || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return
  ligado = true

  provider = new NodeTracerProvider({
    resource: defaultResource().merge(detectResources({ detectors: [envDetector] })),
    spanProcessors: [new BatchSpanProcessor(new ExportadorRedigido(new OTLPTraceExporter()))],
  })
  provider.register()

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Sem o texto dos parâmetros: o `pg` registra só a query com `$1`, `$2`.
      // Os valores (e-mail, CNPJ, hash de senha) nunca saem do processo.
      //
      // Só a query que roda dentro de um span (requisição do Next, `job <nome>`
      // do worker), e sem o span de cada `pool.connect`. Sem isso, o polling do
      // pg-boss, que consulta a fila a cada poucos segundos, era 99% dos spans do
      // worker: ~30 mil por hora, contra 15 dos jobs. Falha de conexão continua
      // aparecendo no erro da query e no `health: banco fora`.
      new PgInstrumentation({ requireParentSpan: true, ignoreConnectSpans: true }),
      ...(fetchDeSaida ? [new UndiciInstrumentation()] : []),
    ],
  })
}

/** Envia o que está no lote e desliga. Para testes e scripts que terminam sozinhos. */
export async function encerrarOtel() {
  await provider?.shutdown()
}
