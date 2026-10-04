// scripts/push.teste.ts — o que o servidor aceita como inscrição de push (src/lib/push.ts).
// Uso: npm run push:teste
// O endpoint vem do navegador do cliente e o servidor faz POST nele: só os serviços de
// push dos navegadores passam, senão um usuário logado faria o servidor chamar qualquer URL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { endpointValido, pushConfigurado } from '../src/lib/push'

test('aceita os serviços de push de Chrome, Firefox, Edge e Safari', () => {
  for (const e of [
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://wns2-by3p.notify.windows.com/w/?token=BQYAAA',
    'https://web.push.apple.com/QGuQyavXutnMH',
  ]) assert.equal(endpointValido(e), true, e)
})

test('recusa qualquer outro destino', () => {
  for (const e of [
    'http://fcm.googleapis.com/fcm/send/x',          // sem TLS
    'https://fcm.googleapis.com.atacante.com/x',      // sufixo enganoso
    'https://atacante.com/fcm.googleapis.com',
    'https://localhost/x', 'https://169.254.169.254/latest/meta-data',
    'https://pushapple.com/x',
    'nao-e-url', '', 42, null, `https://fcm.googleapis.com/${'x'.repeat(1100)}`,
  ]) assert.equal(endpointValido(e), false, String(e).slice(0, 60))
})

test('sem as duas chaves VAPID, push fica desligado', () => {
  const antes = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY
  assert.equal(pushConfigurado(), false)
  process.env.VAPID_PUBLIC_KEY = 'x'
  assert.equal(pushConfigurado(), false)
  process.env.VAPID_PRIVATE_KEY = 'y'
  assert.equal(pushConfigurado(), true)
  if (antes.pub === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = antes.pub
  if (antes.priv === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = antes.priv
})
