// scripts/dispositivo-confiavel.teste.ts — o cookie que dispensa o 2FA por 7 dias.
// Uso: npm run auth:dispositivo:teste
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
// O módulo lê NEXTAUTH_SECRET e NODE_ENV na hora de cada chamada, não no import.
import {
  emitirDispositivo, dispositivoConfiavel, nomeCookieDispositivo, opcoesCookieDispositivo, DISPOSITIVO_DIAS,
} from '../src/lib/dispositivo-confiavel'

const env = process.env as Record<string, string | undefined>
env.NEXTAUTH_SECRET = 'segredo-so-do-teste'

/** Roda `fn` com NODE_ENV/NEXTAUTH_URL trocados e devolve o ambiente como estava. */
function comAmbiente(vars: Record<string, string | undefined>, fn: () => void) {
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]))
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete env[k]; else env[k] = v }
  try { fn() } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete env[k]; else env[k] = v }
  }
}

test('produção sem NEXTAUTH_URL: Secure obrigatório e prefixo __Host- (revisão da #68)', () => {
  comAmbiente({ NODE_ENV: 'production', NEXTAUTH_URL: undefined }, () => {
    const o = opcoesCookieDispositivo(60)
    assert.equal(o.secure, true)
    assert.equal(o.httpOnly, true)
    assert.equal(o.path, '/') // exigido pelo __Host-
    assert.equal(nomeCookieDispositivo(), '__Host-gh-dispositivo-2fa')
  })
})

test('produção com NEXTAUTH_URL em http (erro de configuração): continua Secure', () => {
  comAmbiente({ NODE_ENV: 'production', NEXTAUTH_URL: 'http://govhealth.techealth.com.br' }, () => {
    assert.equal(opcoesCookieDispositivo(60).secure, true)
  })
})

test('desenvolvimento (next dev em http): sem Secure e sem __Host-', () => {
  comAmbiente({ NODE_ENV: 'development' }, () => {
    assert.equal(opcoesCookieDispositivo(60).secure, false)
    assert.equal(nomeCookieDispositivo(), 'gh-dispositivo-2fa')
  })
})

test('cookie emitido vale para a mesma conta e a mesma versão da senha', () => {
  const d = emitirDispositivo('a@x.com', null)
  assert.equal(d.maxAge, DISPOSITIVO_DIAS * 86_400)
  assert.equal(dispositivoConfiavel(d.valor, 'a@x.com', null), true)
})

test('outra conta, senha trocada, assinatura adulterada ou ausente: pede o código', () => {
  const d = emitirDispositivo('a@x.com', null)
  assert.equal(dispositivoConfiavel(d.valor, 'b@x.com', null), false, 'outra conta')
  assert.equal(dispositivoConfiavel(d.valor, 'a@x.com', new Date().toISOString()), false, 'senha trocada depois')
  const [carga, ass] = d.valor.split('.')
  const outra = Buffer.from(JSON.stringify({ u: 'b@x.com', exp: Date.now() + 1e9, s: 0 })).toString('base64url')
  assert.equal(dispositivoConfiavel(`${outra}.${ass}`, 'b@x.com', null), false, 'carga trocada, assinatura antiga')
  assert.equal(dispositivoConfiavel(`${carga}.${ass.slice(0, -2)}xx`, 'a@x.com', null), false, 'assinatura adulterada')
  assert.equal(dispositivoConfiavel(undefined, 'a@x.com', null), false)
  assert.equal(dispositivoConfiavel('lixo', 'a@x.com', null), false)
})

test('depois de DISPOSITIVO_DIAS o cookie vence', () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    const d = emitirDispositivo('a@x.com', null)
    mock.timers.tick(DISPOSITIVO_DIAS * 86_400_000 - 1000)
    assert.equal(dispositivoConfiavel(d.valor, 'a@x.com', null), true, 'ainda dentro da semana')
    mock.timers.tick(2000)
    assert.equal(dispositivoConfiavel(d.valor, 'a@x.com', null), false, 'semana vencida')
  } finally { mock.timers.reset() }
})
