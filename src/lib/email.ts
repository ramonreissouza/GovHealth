// src/lib/email.ts — e-mails transacionais (Resend). Best-effort: se RESEND_API_KEY
// não estiver configurada, apenas loga e segue (não quebra o fluxo).

import { appUrl } from '@/lib/stripe'
import { planoPorId } from '@/lib/planos'

/** Envia um HTML via Resend. Retorna se enviou (best-effort). */
async function enviar(to: string, subject: string, html: string): Promise<{ enviado: boolean; motivo?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { enviado: false, motivo: 'sem RESEND_API_KEY' }
  const from = process.env.RESEND_FROM_EMAIL ?? 'contato@techealth.com.br'
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
          <tr><td style="padding:20px 26px;border-bottom:1px solid #eef2f7;">
            <img src="${appUrl()}/logo-govhealth.png" alt="GovHealth" height="26" style="height:26px;width:auto;display:block;" />
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
  `<a href="${href}" style="display:inline-block;margin-top:14px;background:#2f80ed;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:9px;">${label}</a>`

/** Formata número em BRL (para os e-mails do Radar). */
function brl(v?: number | null): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/**
 * RADAR — Alerta de NOVA LICITAÇÃO relevante ao perfil do fornecedor.
 * Disparado pela seleção automática (lib/radar/selecao) quando surge um processo
 * que casa com as preferências (UFs/categorias/termos/portfólio).
 */
export async function enviarNovaLicitacaoRadar(params: {
  to: string; nome?: string | null; objeto: string; uf?: string | null; municipio?: string | null;
  valor?: number | null; motivo?: string | null; link: string
}): Promise<{ enviado: boolean; motivo?: string }> {
  const local = [params.municipio, params.uf].filter(Boolean).join(' / ')
  const corpo = `
    <p style="font-size:14px;color:#334155;margin:0 0 12px;">${params.nome ? params.nome + ', ' : ''}o Radar encontrou uma <strong>nova licitação</strong> que combina com o seu perfil:</p>
    <table style="width:100%;font-size:13px;color:#334155;border-collapse:collapse;margin:0 0 8px;">
      <tr><td style="padding:4px 0;color:#64748b;width:90px;">Objeto</td><td style="padding:4px 0;font-weight:600;">${params.objeto || '—'}</td></tr>
      ${local ? `<tr><td style="padding:4px 0;color:#64748b;">Local</td><td style="padding:4px 0;">${local}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#64748b;">Valor est.</td><td style="padding:4px 0;">${brl(params.valor)}</td></tr>
      ${params.motivo ? `<tr><td style="padding:4px 0;color:#64748b;">Combinou por</td><td style="padding:4px 0;">${params.motivo}</td></tr>` : ''}
    </table>
    ${btn(params.link, 'Ver a licitação')}
    <p style="font-size:11.5px;color:#94a3b8;margin:16px 0 0;">Você recebe este alerta porque a licitação corresponde às preferências do seu perfil no GovHealth. Ajuste-as em Perfil & Preferências.</p>`
  return enviar(params.to, `📡 Nova licitação para o seu perfil`, moldura('Nova licitação no Radar', corpo))
}

/**
 * RADAR — Alerta de NOVA MENSAGEM/convocação de chat em processo monitorado.
 * Disparado pela captura (worker) → cron radar-notify.
 */
export async function enviarAlertaRadar(params: {
  to: string; nome?: string | null; processo: string; autor?: string | null; trecho: string;
  categorias?: string[]; link: string
}): Promise<{ enviado: boolean; motivo?: string }> {
  const tags = (params.categorias ?? []).length
    ? `<p style="margin:0 0 10px;">${params.categorias!.map((c) => `<span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;margin-right:6px;">${c}</span>`).join('')}</p>`
    : ''
  const corpo = `
    <p style="font-size:14px;color:#334155;margin:0 0 10px;">${params.nome ? params.nome + ', ' : ''}há uma <strong>nova mensagem</strong> no chat do processo <strong>${params.processo}</strong>${params.autor ? ` (${params.autor})` : ''}:</p>
    ${tags}
    <blockquote style="margin:0 0 12px;padding:10px 14px;background:#f8fafc;border-left:3px solid #2f80ed;font-size:13px;color:#334155;">${params.trecho}</blockquote>
    ${btn(params.link, 'Abrir no Radar')}
    <p style="font-size:11.5px;color:#94a3b8;margin:16px 0 0;">Responda no portal dentro do prazo. Este alerta é do monitoramento de chat do GovHealth.</p>`
  return enviar(params.to, `🔔 Nova mensagem — ${params.processo}`, moldura('Mensagem no chat da licitação', corpo))
}

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
/** Código de acesso (2FA por e-mail). */
export async function enviarCodigoAcesso(params: { to: string; nome?: string | null; codigo: string }) {
  const corpo = `
    <p style="font-size:15px;color:#334155;">Olá${params.nome ? ' ' + params.nome : ''},</p>
    <p style="font-size:15px;color:#334155;">Use o código abaixo para concluir o acesso à sua conta:</p>
    <p style="font-size:30px;font-weight:bold;letter-spacing:6px;color:#0f172a;margin:18px 0;">${params.codigo}</p>
    <p style="font-size:13px;color:#64748b;">O código expira em 10 minutos. Se você não tentou entrar, ignore este e-mail e troque sua senha.</p>`
  return enviar(params.to, `Seu código de acesso GovHealth: ${params.codigo}`, moldura('Código de acesso', corpo))
}

/** Redefinição de senha ("esqueci minha senha"): link com token de uso único. */
export async function enviarRedefinicaoSenha(params: { to: string; nome?: string | null; link: string }) {
  const corpo = `
    <p style="font-size:15px;color:#334155;">Olá${params.nome ? ' ' + params.nome : ''},</p>
    <p style="font-size:15px;color:#334155;">Recebemos um pedido para redefinir a senha da sua conta GovHealth AI. Clique no botão abaixo para criar uma nova senha:</p>
    ${btn(params.link, 'Redefinir minha senha')}
    <p style="font-size:12px;color:#94a3b8;margin-top:16px;">Ou copie e cole no navegador: ${params.link}</p>
    <p style="font-size:13px;color:#64748b;margin-top:12px;">O link expira em 30 minutos e só pode ser usado uma vez. Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.</p>`
  return enviar(params.to, 'Redefinir sua senha — GovHealth AI', moldura('Redefinição de senha', corpo))
}

/** Convite para entrar numa conta de equipe. */
export async function enviarConviteEquipe(params: { to: string; empresa?: string | null; link: string }) {
  const corpo = `
    <p style="font-size:15px;color:#334155;">Você foi convidado(a) para a conta${params.empresa ? ' da <strong>' + params.empresa + '</strong>' : ''} no GovHealth AI.</p>
    <p style="font-size:15px;color:#334155;">Crie a sua própria senha e comece a usar — cada pessoa tem o seu login.</p>
    <p style="margin:20px 0;"><a href="${params.link}" style="background:#16a34a;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Aceitar convite</a></p>
    <p style="font-size:12px;color:#94a3b8;">Ou copie e cole no navegador: ${params.link}</p>
    <p style="font-size:12px;color:#94a3b8;">O convite expira em 7 dias.</p>`
  return enviar(params.to, 'Convite para o GovHealth AI', moldura('Convite de equipe', corpo))
}

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
 * Lembrete enviado quando falta 1 dia para o teste grátis expirar.
 * Convida a assinar para não perder o acesso.
 */
export async function enviarLembreteTrial(params: {
  email: string; nome?: string | null; plano: string; expiraEm?: string | null
}): Promise<{ enviado: boolean; motivo?: string }> {
  const nomePlano = planoPorId(params.plano)?.nome ?? params.plano
  const ate = dataBR(params.expiraEm)
  const corpo = `
    <p style="font-size:13px;color:#334155;margin:0 0 12px;">
      ${params.nome ? params.nome + ', ' : ''}seu teste grátis termina <strong>amanhã${ate ? ` (${ate})` : ''}</strong>.
    </p>
    <p style="font-size:13px;color:#334155;margin:0 0 12px;">
      Para não perder o acesso às oportunidades, aos vencedores/concorrentes e aos alertas, assine o plano <strong>${nomePlano}</strong> — leva 2 minutos e você mantém tudo sem interrupção.
    </p>
    ${btn(`${appUrl()}/assinar?plano=${params.plano}`, `Assinar ${nomePlano}`)}
    <p style="font-size:11.5px;color:#94a3b8;margin:16px 0 0;">Sem fidelidade — cancele quando quiser. Emitimos nota fiscal.</p>`
  return enviar(params.email, `Seu teste do GovHealth.ai expira amanhã`, moldura('Seu teste está acabando ⏳', corpo))
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

/**
 * PAGAMENTO RECUSADO — disparado no webhook do Stripe (invoice.payment_failed).
 * Avisa o cliente para atualizar a forma de pagamento antes de suspender o acesso.
 */
export async function enviarPagamentoFalhou(params: {
  email: string; nome?: string | null; plano: string
}): Promise<{ enviado: boolean; motivo?: string }> {
  const nomePlano = planoPorId(params.plano)?.nome ?? params.plano
  const corpo = `
    <p style="font-size:13px;color:#334155;margin:0 0 12px;">
      ${params.nome ? params.nome + ', ' : ''}não conseguimos processar o pagamento da sua assinatura <strong>${nomePlano}</strong>.
    </p>
    <p style="font-size:13px;color:#334155;margin:0 0 12px;">
      Costuma ser cartão vencido, sem limite ou dados desatualizados. Atualize a forma de pagamento para <strong>manter seu acesso sem interrupção</strong> — faremos novas tentativas automaticamente.
    </p>
    ${btn(`${appUrl()}/conta`, 'Atualizar pagamento')}
    <p style="font-size:11.5px;color:#94a3b8;margin:16px 0 0;">Se o pagamento não for regularizado, o acesso pode ser suspenso. Dúvidas? Responda este e-mail.</p>`
  return enviar(params.email, 'Problema no pagamento da sua assinatura — GovHealth AI', moldura('Falha no pagamento ⚠️', corpo))
}

/**
 * ASSINATURA CANCELADA — disparado no webhook do Stripe (customer.subscription.deleted).
 * Confirma o cancelamento, tranquiliza sobre os dados e convida a reativar.
 */
export async function enviarAssinaturaCancelada(params: {
  email: string; nome?: string | null; plano: string
}): Promise<{ enviado: boolean; motivo?: string }> {
  const nomePlano = planoPorId(params.plano)?.nome ?? params.plano
  const corpo = `
    <p style="font-size:13px;color:#334155;margin:0 0 12px;">
      ${params.nome ? params.nome + ', ' : ''}sua assinatura do plano <strong>${nomePlano}</strong> foi cancelada e o acesso será encerrado ao fim do período já pago.
    </p>
    <p style="font-size:13px;color:#334155;margin:0 0 12px;">
      Seus dados (portfólio, monitores e CRM) ficam <strong>guardados</strong> — se você voltar, está tudo lá. Você pode reativar quando quiser.
    </p>
    ${btn(`${appUrl()}/assinar?plano=${params.plano}`, 'Reativar assinatura')}
    <p style="font-size:11.5px;color:#94a3b8;margin:16px 0 0;">Cancelou por engano ou quer nos dar um feedback? É só responder este e-mail.</p>`
  return enviar(params.email, 'Sua assinatura foi cancelada — GovHealth AI', moldura('Assinatura cancelada', corpo))
}
