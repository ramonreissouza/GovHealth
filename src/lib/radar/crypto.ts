// src/lib/radar/crypto.ts — cofre de credenciais de portal (AES-256-GCM).
// SERVER-ONLY: a chave vive só em process.env.RADAR_CRED_KEY (nunca NEXT_PUBLIC_*).
// Formato armazenado: base64(iv):base64(authTag):base64(ciphertext).
// O worker (scripts/radar/run.mjs) implementa o MESMO algoritmo para decifrar.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'

/** Chave de 32 bytes a partir de RADAR_CRED_KEY (hex de 64 chars). Lança se ausente/curta. */
function getKey(): Buffer {
  const raw = process.env.RADAR_CRED_KEY
  if (!raw) {
    throw new Error(
      'RADAR_CRED_KEY não configurada — gere 32 bytes hex (ex.: openssl rand -hex 32) e defina no .env.local',
    )
  }
  const key = Buffer.from(raw.trim(), 'hex')
  if (key.length !== 32) throw new Error('RADAR_CRED_KEY inválida — precisa ter 64 caracteres hex (32 bytes)')
  return key
}

/** Cifra um texto em claro. Retorna "iv:tag:ct" (base64). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

/** Decifra "iv:tag:ct". Lança se o blob foi adulterado (integridade GCM). */
export function decrypt(blob: string): string {
  const [ivB64, tagB64, ctB64] = blob.split(':')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('blob cifrado malformado')
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}

/** true se a chave está configurada (para a rota recusar cadastro sem cofre). */
export function cofreDisponivel(): boolean {
  try { getKey(); return true } catch { return false }
}
