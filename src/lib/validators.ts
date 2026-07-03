// src/lib/validators.ts — validação de CPF/CNPJ (dígitos verificadores).

export function soDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

export function validarCPF(cpf: string): boolean {
  const c = soDigitos(cpf)
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  let s = 0
  for (let i = 0; i < 9; i++) s += +c[i] * (10 - i)
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0
  if (d1 !== +c[9]) return false
  s = 0
  for (let i = 0; i < 10; i++) s += +c[i] * (11 - i)
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0
  return d2 === +c[10]
}

export function validarCNPJ(cnpj: string): boolean {
  const c = soDigitos(cnpj)
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const calc = (len: number) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let s = 0
    for (let i = 0; i < len; i++) s += +c[i] * pesos[i]
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === +c[12] && calc(13) === +c[13]
}

/** Aceita CPF (11) ou CNPJ (14). */
export function validarCpfOuCnpj(v: string): boolean {
  const d = soDigitos(v)
  if (d.length === 11) return validarCPF(d)
  if (d.length === 14) return validarCNPJ(d)
  return false
}
