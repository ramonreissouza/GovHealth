// scripts/lib/raiz-empresa.mjs — a raiz do nome de uma empresa, sem o sufixo societário.
//
// É a chave com que prospeccao-fornecedores.mjs funde filiais do mesmo grupo. Estava
// escrita como `/s+/g` (a LETRA s, não espaço) e com um caractere de controle (U+0008)
// no lugar do `\b`, então "ACME MEDICAL LTDA" e "ACME MEDICAL S.A." viravam dois grupos
// e distorciam contratos, UFs, órgãos, pontuação e o top 50 (revisão da #45).

// Sufixo precedido de espaço e seguido de fim, espaço ou pontuação. O lookahead no lugar
// do `\b` é de propósito: "S.A." termina em ponto, e `\b` depois de ponto no fim da
// string não casa. E exigir o fim da palavra é o que impede cortar "ACME MEDICAL" em
// " ME" + "DICAL".
const SUFIXO = /\s(?:LTDA|S\.?\s?\/?\s?A|EIRELI|ME|EPP)(?=$|[\s.,\-/])/

/** "Acme  Medical S/A - EPP" → "ACME MEDICAL". */
export function raizEmpresa(nome) {
  return String(nome ?? '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(SUFIXO)[0]
    .replace(/[\s.,\-/]+$/, '')
    .trim()
}
