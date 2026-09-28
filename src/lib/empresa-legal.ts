// src/lib/empresa-legal.ts — quem é a empresa por trás da Plataforma, em UM lugar só.
//
// Existe porque a Política de Privacidade e os Termos de Uso precisam dizer exatamente
// a mesma coisa sobre o controlador. Dois arquivos com os mesmos dados divergem na
// primeira alteração, e num documento legal divergir é pior que faltar.
//
// Razão social e CNPJ NÃO são novidade pública: já aparecem em /assinar, no bloco do Pix
// (src/lib/pix.ts), que qualquer visitante vê antes de pagar. Aqui eles só passam a ser
// citados também nos documentos.
//
// ⚠️ ENCARREGADO (DPO): a LGPD (art. 41) exige que o controlador indique um encarregado e
//    divulgue publicamente sua identidade. `DPO_NOME` abaixo precisa do nome de uma PESSOA
//    (ou do setor formalmente designado) — não invente. Enquanto estiver vazio, as páginas
//    mostram o canal de contato sem nomear ninguém, que é melhor que nomear errado.

/** Nome comercial da plataforma. */
export const CONTROLADOR_NOME = 'GovHealth AI'

/** Razão social da empresa operadora — a mesma que aparece no Pix de /assinar. */
export const CONTROLADOR_RAZAO_SOCIAL = 'Tec Health Engenharia Hospitalar'

export const CONTROLADOR_CNPJ = '33.888.916/0001-89'

/** Cidade/UF da sede. Endereço completo entra aqui quando for definido. */
export const CONTROLADOR_SEDE = 'São Paulo/SP'

/**
 * Nome do Encarregado pelo Tratamento de Dados Pessoais (LGPD art. 41).
 * Vazio = ainda não designado formalmente; as páginas se adaptam.
 */
export const DPO_NOME = ''

export const DPO_EMAIL = 'privacidade@govhealth.ai'

/** E-mail comercial/suporte, usado nos Termos. */
export const CONTATO_EMAIL = 'contato@techealth.com.br'

/** Comarca do foro eleito nos Termos de Uso. */
export const FORO = 'São Paulo/SP'

/**
 * VERSÃO DOS DOCUMENTOS — é ela que o aceite grava (assinaturas.termos_versao).
 *
 * Sem versão, depois de qualquer alteração em /termos não dava para demonstrar qual
 * texto acompanhou cada contratação (revisão da #45). Regra: MUDOU O TEXTO de /termos
 * ou /privacidade, MUDA A VERSÃO aqui, no mesmo commit. A rota de assinatura recusa um
 * aceite de versão que não é a vigente (a pessoa leu um texto que já não vale).
 */
export const TERMOS_VERSAO = '2026-09-27'
export const PRIVACIDADE_VERSAO = '2026-09-27'
