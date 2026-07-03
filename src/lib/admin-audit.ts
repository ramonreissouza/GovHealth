// src/lib/admin-audit.ts — trilha de auditoria das ações do admin (quem/o quê/quando).
import { query } from '@/lib/db'

export async function registrarAudit(adminId: string, acao: string, alvo?: string | null, detalhes?: unknown): Promise<void> {
  await query(
    `INSERT INTO admin_audit_log (admin_id, acao, alvo, detalhes) VALUES ($1,$2,$3,$4)`,
    [adminId, acao, alvo ?? null, detalhes != null ? JSON.stringify(detalhes) : null],
  )
}
