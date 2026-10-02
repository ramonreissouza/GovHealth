// src/lib/radar/diagnostico.ts — quem pode ver o motivo técnico de um conector.
//
// O `detalhe` (e o `duracao_ms`) de radar_saude e de radar_credenciais é diagnóstico de
// operação: "locator.click: Timeout 10000ms", call log do Playwright. Para o cliente não
// diz nada que ele possa usar. Só o administrador da plataforma (master) o recebe, e esta
// é a única porta: toda rota que devolve saúde de conector pergunta aqui e passa o item
// por `semDiagnostico` (lib/radar/saude.ts).

import type { NextRequest } from 'next/server'
import { tokenMaster } from '@/lib/admin-guard'

export async function podeVerDiagnostico(req: NextRequest): Promise<boolean> {
  return !!(await tokenMaster(req))
}
