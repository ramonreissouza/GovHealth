// scripts/radar/captura-hospedada.mjs — o fim da captura do navegador hospedado: decidir
// se o login terminou, e SÓ ENTÃO limpar o navegador e gravar o cofre.
//
// Saiu do browser-service.mjs porque aquele arquivo sobe o servidor HTTP ao ser
// importado, e a ordem dos efeitos aqui precisa de teste (captura-hospedada.teste.mjs).
//
// O DEFEITO QUE A ORDEM CORRIGE (revisão da #38). O serviço limpava cookies e storage e
// desconectava ANTES de decidir se o login tinha terminado. Quando o recorte deixava a
// sessão sem credencial — o fornecedor clicou "já concluí" no meio do 2FA —, ele
// respondia "login ainda em curso" com o navegador já zerado: o fornecedor voltava à
// janela e encontrava a tela de login de novo, sem saber por quê.
//
// Agora são três saídas, cada uma com o seu efeito:
//   - login em curso     → só desconecta do CDP. A sessão do steel, com o login pela
//                          metade, continua viva para o fornecedor terminar;
//   - portal sem política de domínios (o recorte falhou fechado) → nunca vai poder
//                          gravar: limpa, encerra e diz por quê;
//   - login concluído    → limpa o navegador ANTES de gravar e só então grava. Se a
//                          gravação falhar, o pior caso é refazer o login — nunca outro
//                          cliente herdar a sessão.

import { sessaoTemCredencial } from './capture.mjs'
import { serializarSessaoRecortada, resumoDescarte, auditarBypassSso } from './sessao-escopo.mjs'

/**
 * @param {{ ctx: object, browser: object, cred: object, credencialId: string }} alvo
 * @param {{
 *   limparEstado: (ctx: object, page: object) => Promise<void>,
 *   q: (sql: string, params: unknown[]) => Promise<unknown>,
 *   marcarSaude: (cred: object, status: string, detalhe: string) => Promise<void>,
 *   encerrarSessao: (id: string) => Promise<void>,
 *   soltar: (credencialId: string) => void,
 *   cifrar: (json: string) => string,
 * }} deps
 */
export async function concluirCaptura({ ctx, browser, cred, credencialId }, deps) {
  const url = ctx.pages()[0]?.url() ?? ''
  // RECORTE ANTES DE CIFRAR. O login acontece no `sso.acesso.gov.br`, mas o que o
  // monitor lê vive no comprasnet/cnetmobile — e o cookie do SSO é a sessão do Login
  // Único da pessoa física (e-CAC, Meu INSS, Conecte SUS). Ver sessao-escopo.mjs.
  const recorte = serializarSessaoRecortada(await ctx.storageState(), cred.conector_id, {
    aoDescartar: (d) => console.log(`[cofre] ${cred.conector_id}: fora do escopo, descartado ${resumoDescarte(d)}`),
  })
  const { json: storageState, estado } = recorte

  const limparEDesconectar = async () => {
    const pagina = ctx.pages()[0]
    if (pagina) await deps.limparEstado(ctx, pagina)
    await browser.close()
  }

  if (recorte.semLista) {
    const detalhe = `o portal '${cred.conector_id}' não tem domínios de sessão definidos — por segurança nada foi guardado`
    await limparEDesconectar()
    await deps.encerrarSessao(cred.conexao_session_id).catch(() => {})
    deps.soltar(credencialId)
    await deps.q(`UPDATE radar_credenciais SET conexao_status='erro', conexao_detalhe=$2 WHERE id=$1`, [cred.id, detalhe.slice(0, 180)])
    await deps.marcarSaude(cred, 'falha', detalhe)
    return { erro: detalhe, status: 422 }
  }

  // URL NÃO PROVA LOGIN — e este projeto já pagou por isso uma vez (o falso
  // "conectado" do Radar). Medido em 11/09/2026 contra o steel real: uma sessão em
  // que NINGUÉM logou parou em `/comprasnet-web/seguro/acompanhamento`, que não casa
  // com nenhum padrão de login. Só pela URL, o serviço declararia sucesso, cifraria
  // um cofre VAZIO e marcaria a saúde como ok.
  //
  // O sinal que não mente é o cofre ter credencial — e `sessaoTemCredencial` exige um
  // cookie que não seja de analytics/consentimento (`cookies.length` deixou passar um
  // cofre com só `_ga`). Ele roda DEPOIS do recorte, de propósito: o que interessa é se
  // sobrou credencial no que vai para o cofre.
  const emLogin = /acesso\.gov\.br|sso\.|\/login|autenticacao/i.test(url)
  const semCookie = !estado.cookies?.length || !sessaoTemCredencial(storageState)

  if (emLogin || semCookie) {
    // O LOGIN CONTINUA: não limpar, não encerrar. `close()` sobre `connectOverCDP` só
    // desconecta este processo — a sessão do steel segue viva, com o que o fornecedor
    // já digitou, para ele terminar e clicar de novo.
    await browser.close()
    const porque = semCookie ? 'nenhum cookie de sessão — o login não foi concluído' : 'ainda na tela de login do gov.br'
    await deps.marcarSaude(cred, 'sessao_expirada', `Login ainda não concluído: ${porque}`)
    return { status: 200, conexao: 'conectando', aviso: porque }
  }

  // Vai gravar. Lido o cofre, o navegador não guarda mais nada de ninguém — ANTES de
  // gravar, para que uma falha daqui para baixo nunca deixe a sessão para o próximo.
  await limparEDesconectar()

  await deps.q(`UPDATE radar_credenciais SET storage_state=$2, metodo='sessao', conexao_status='conectado', conexao_detalhe=NULL, ativo=true, atualizado_em=now() WHERE id=$1`,
    [cred.id, deps.cifrar(storageState)])
  await deps.marcarSaude(cred, 'ok', 'sessão capturada via gov.br (navegador hospedado)')
  await deps.q(`INSERT INTO radar_auditoria (titular_id,acao,entidade,entidade_id,detalhe) VALUES ($1,'cred_conectada','radar_credenciais',$2,$3::jsonb)`,
    [cred.titular_id, cred.id, JSON.stringify({ via: 'hosted' })])
  if (recorte.bypassSso) {
    await auditarBypassSso(deps.q, { titularId: cred.titular_id, credencialId: cred.id, conectorId: cred.conector_id, via: 'hosted' })
  }
  await deps.encerrarSessao(cred.conexao_session_id).catch(() => {})
  // Pista livre e token morto no mesmo instante em que a sessão é gravada: o live
  // view não pode sobreviver à captura, senão o link continuaria abrindo um
  // navegador autenticado depois de o fornecedor achar que terminou.
  deps.soltar(credencialId)
  return { status: 200, conexao: 'conectado' }
}
