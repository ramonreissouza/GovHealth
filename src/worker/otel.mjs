// src/worker/otel.mjs — carregado com `--import` antes de src/worker/index.ts (CMD do
// alvo `worker` no deploy/app/Dockerfile). Precisa vir antes de tudo: a
// instrumentação do `pg` só enxerga o módulo se estiver de pé quando ele for
// carregado. No worker entra também o fetch de saída (PNCP, Resend, TransfereGov).
import { iniciarOtel } from '../lib/otel.mjs'

iniciarOtel({ fetchDeSaida: true })
