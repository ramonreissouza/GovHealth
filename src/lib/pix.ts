// src/lib/pix.ts — dados do Pix para pagamento MANUAL (sem gateway).
// A pessoa paga pelo QR / copia-e-cola e envia o comprovante; o admin ativa a
// conta manualmente. Nenhuma cobrança automática, nenhum dado de cartão.

/** Chave Pix (CNPJ) e "copia e cola" (BR Code) — usados na tela de pagamento. */
export const PIX = {
  chave: '33.888.916/0001-89',          // CNPJ (exibição)
  beneficiario: 'Tec Health Engenharia Hospitalar',
  cidade: 'São Paulo',
  // BR Code oficial (Pix copia e cola) — gera um QR escaneável pelos bancos.
  copiaECola:
    '00020101021126360014br.gov.bcb.pix0114338889160001895204000053039865802BR5925TEC HEALTH ENGENHARIA HOS6009SAO PAULO622905251KX44JDZ080QF3Z956MF4W5RQ63042545',
}

/** E-mail de contato/suporte e destino dos comprovantes de pagamento. */
export const CONTATO_EMAIL = 'contato@techealth.com.br'
