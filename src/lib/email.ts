// src/lib/email.ts — e-mails transacionais (Resend). Best-effort: se RESEND_API_KEY
// não estiver configurada, apenas loga e segue (não quebra o fluxo).

import { appUrl } from '@/lib/stripe'
import { planoPorId } from '@/lib/planos'

/** Envia um HTML via Resend. Retorna se enviou (best-effort). */
async function enviar(to: string, subject: string, html: string): Promise<{ enviado: boolean; motivo?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { enviado: false, motivo: 'sem RESEND_API_KEY' }
  const from = process.env.RESEND_FROM_EMAIL ?? 'contato@govhealth.ai'
  try {
    const { Resend } = await import('resend')
    const { error } = await new Resend(apiKey).emails.send({ from, to, subject, html })
    if (error) { console.warn('[email] falha Resend:', error.message); return { enviado: false, motivo: error.message } }
    return { enviado: true }
  } catch (e) {
    console.warn('[email] erro ao enviar:', e)
    return { enviado: false, motivo: String(e) }
  }
}

/** Molde padrão (cabeçalho/rodapé) para os e-mails. */
function moldura(titulo: string, corpo: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
    <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
          <tr><td style="padding:22px 26px;border-bottom:1px solid #eef2f7;">
            <span style="font-size:16px;font-weight:700;color:#0f172a;">GovHealth<span style="color:#059669;">.ai</span></span>
          </td></tr>
          <tr><td style="padding:26px;">
            <h1 style="font-size:19px;color:#0f172a;margin:0 0 12px;">${titulo}</h1>
            ${corpo}
          </td></tr>
          <tr><td style="padding:14px 26px;background:#f8fafc;border-top:1px solid #eef2f7;font-size:11px;color:#94a3b8;">
            Fontes 100% oficiais · metodologia pública. Dúvidas? Responda este e-mail.
          </td></tr>
        </table>
      </td></tr></table>
    </body></html>`
}

const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:14px;background:#059669;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:9px;">${label}</a>`

/** Formata 'YYYY-MM-DD' → 'DD/MM/YYYY'. */
function dataBR(iso?: string | null): string {
  if (!iso) return ''
  const [a, m, d] = iso.slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}

/**
 * Boas-vindas ao iniciar o TESTE GRÁTIS (autocadastro). Informa o plano e a data
 * de expiração do trial e convida a explorar a plataforma.
 */
export async function enviarBoasVindasTrial(params: {
  email: string; nome?: string | null; plano: string; expiraEm?: string | null
}): Promise<{ enviado: boolean; motivo?: string }> {
  const nomePlano = planoPorId(params.plano)?.nome ?? params.plano
  const ate = dataBR(params.expiraEm)
  const corpo = `
    <p style="font-size:13px;color:#334155;margin:0 0 12px;">
      ${params.nome ? params.nome + ', ' : ''}sua conta está pronta! Você tem <strong>3 dias de teste grátis</strong> no plano <strong>${nomePlano}</strong>${ate ? `, até <strong>${ate}</strong>` : ''} — sem precisar de cartão.
    </p>
    <p style="font-size:13px;color:#334155;margin:0 0 8px;">Comece por aqui:</p>
    <ul style="font-size:13px;color:#334155;margin:0 0 4px;padding-left:18px;line-height:1.7;">
      <li>Veja as <strong>licitações de saúde</strong> em tempo real no dashboard</li>
      <li>Explore <strong>vencedores e concorrentes</strong> por UF</li>
      <li>Ative <strong>alertas</strong> e monte seu <strong>território</strong></li>
    </ul>
    ${btn(`${appUrl()}/login`, 'Acessar a plataforma')}
    <p style="font-size:11.5px;color:#94a3b8;margin:16px 0 0;">Ao fim do teste, você poderá assinar para manter o acesso. Cancele quando quiser.</p>`
  return enviar(params.email, `Bem-vindo(a) ao GovHealth.ai — seu teste de 3 dias começou`, moldura('Seu teste grátis começou 🚀', corpo))
}

/**
 * E-mail de boas-vindas após a assinatura ser ativada.
 * `senhaTemporaria` só é enviada quando a conta foi criada agora.
 */
export async function enviarBoasVindas(params: {
  email: string; nome?: string | null; plano: string; senhaTemporaria?: string
}): Promise<{ enviado: boolean; motivo?: string }> {
  const nomePlano = planoPorId(params.plano)?.nome ?? params.plano
  const bloco = params.senhaTemporaria
    ? `<p style="font-size:13px;color:#334155;">Criamos seu acesso. Entre com:</p>
       <table style="margin:8px 0 16px;font-size:13px;">
         <tr><td style="padding:2px 8px;color:#64748b;">E-mail</td><td style="padding:2px 8px;font-weight:600;">${params.email}</td></tr>
         <tr><td style="padding:2px 8px;color:#64748b;">Senha temporária</td><td style="padding:2px 8px;font-family:monospace;font-weight:600;">${params.senhaTemporaria}</td></tr>
       </table>
       <p style="font-size:12px;color:#64748b;">Recomendamos trocar a senha no primeiro acesso.</p>`
    : `<p style="font-size:13px;color:#334155;">Sua assinatura foi renovada/atualizada. Acesse normalmente com sua senha atual.</p>`

  const corpo = `
    <p style="font-size:13px;color:#334155;margin:0 0 14px;">
      ${params.nome ? params.nome + ', ' : ''}sua assinatura do plano <strong>${nomePlano}</strong> está ativa.
    </p>
    ${bloco}
    ${btn(`${appUrl()}/login`, 'Acessar a plataforma')}
    <p style="font-size:11.5px;color:#94a3b8;margin:16px 0 0;">Emitimos nota fiscal.</p>`
  return enviar(params.email, `GovHealth.ai — assinatura ${nomePlano} ativada`, moldura('Assinatura confirmada 🎉', corpo))
}
