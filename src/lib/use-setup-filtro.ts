'use client'
// src/lib/use-setup-filtro.ts
// Liga/desliga o pré-filtro do Setup da Empresa numa tela. Complementa os hooks que
// APLICAM o setup (useSetupUFDefault / useSetupCategoriasDefault) com o caminho
// inverso, que faltava: ver a base inteira sem o recorte da empresa.
//
// Desligar não é só esvaziar os filtros — é preciso marcar "tocado" nos hooks de
// default, senão a próxima hidratação da conta (HYDRATED_EVENT, que chega assíncrona
// depois do login) reaplicaria o setup por cima e o filtro voltaria sozinho.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getEmpresa, categoriasDoSetup } from './empresa'
import { categoriasMercadoDoSetup } from './categoria-mercado'

interface Opcoes {
  /** Seta as UFs do filtro da página (lista vazia = todas). */
  aplicarUfs?: (ufs: string[]) => void
  /** Seta as categorias de mercado do filtro da página (lista vazia = todas). */
  aplicarCats?: (cats: string[]) => void
  /** marcarTocado dos hooks de default — impede a reaplicação na hidratação. */
  marcarTocado?: () => void
  /** Efeito extra da tela ao trocar de modo (ex.: zerar uma seleção derivada). */
  aoTrocar?: () => void
}

export function useSetupFiltro(opts: Opcoes): {
  semSetup: boolean
  limpar: () => void
  restaurar: () => void
} {
  const [semSetup, setSemSetup] = useState(false)
  // As callbacks da tela mudam de identidade a cada render; guardar em ref mantém
  // limpar/restaurar estáveis sem capturar uma versão velha. A sincronia vai DENTRO
  // de um efeito (não no corpo do render) — escrever `.current` durante o render é o
  // que a regra react-hooks/refs acusa, e num render interrompido o valor gravado
  // pode não corresponder ao render que ficou de pé. As callbacks só disparam por
  // clique, então sempre depois do efeito ter rodado.
  const ref = useRef(opts)
  useEffect(() => { ref.current = opts })

  const limpar = useCallback(() => {
    const o = ref.current
    o.marcarTocado?.()
    o.aplicarUfs?.([])
    o.aplicarCats?.([])
    o.aoTrocar?.()
    setSemSetup(true)
  }, [])

  const restaurar = useCallback(() => {
    const o = ref.current
    const e = getEmpresa()
    o.marcarTocado?.()
    o.aplicarUfs?.(e.ufs)
    o.aplicarCats?.(categoriasMercadoDoSetup(categoriasDoSetup(e)))
    o.aoTrocar?.()
    setSemSetup(false)
  }, [])

  return { semSetup, limpar, restaurar }
}
