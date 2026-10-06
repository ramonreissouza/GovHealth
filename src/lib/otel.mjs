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
// Sem handler de SIGTERM, de propósito. O worker não trata o sinal, e um listener
// aqui impediria o processo de encerrar. O custo é perder, num deploy, os spans
// que ainda estavam no lote (até 5 s).

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { defaultResource, detectResources, envDetector } from '@opentelemetry/resources'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

let ligado = false

/** @param {{ fetchDeSaida?: boolean }} [opcoes] */
export function iniciarOtel({ fetchDeSaida = false } = {}) {
  if (ligado || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return
  ligado = true

  const provider = new NodeTracerProvider({
    resource: defaultResource().merge(detectResources({ detectors: [envDetector] })),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  })
  provider.register()

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Sem o texto dos parâmetros: o `pg` registra só a query com `$1`, `$2`.
      // Os valores (e-mail, CNPJ, hash de senha) nunca saem do processo.
      new PgInstrumentation(),
      ...(fetchDeSaida ? [new UndiciInstrumentation()] : []),
    ],
  })
}
