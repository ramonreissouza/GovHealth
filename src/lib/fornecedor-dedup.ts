// src/lib/fornecedor-dedup.ts — deduplicação de fornecedor (SQL).
// A MESMA empresa aparece em `resultados` sob dezenas de grafias do nome
// (ex.: Cristália em 25 variações). Agrupar por nome infla o ranking e fragmenta
// as vendas. A chave correta é o CNPJ/CPF (só dígitos) quando houver; senão, o nome
// normalizado (maiúsculas + trim). Usado por Fornecedores, Concorrentes e
// Concorrentes por Estado para um ranking consistente entre as telas.

/** Expressão SQL da CHAVE de dedup: CNPJ/CPF só-dígitos ou, na falta, nome normalizado. */
export function fornecedorKeySql(ni = 'r.ni_fornecedor', nome = 'r.nome_fornecedor'): string {
  return `COALESCE(NULLIF(regexp_replace(COALESCE(${ni}, ''), '[^0-9]', '', 'g'), ''), UPPER(TRIM(${nome})))`
}

/** Nome canônico do grupo: a grafia mais frequente do fornecedor. */
export function fornecedorNomeSql(nome = 'r.nome_fornecedor'): string {
  return `MODE() WITHIN GROUP (ORDER BY TRIM(${nome}))`
}
