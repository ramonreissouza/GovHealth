'use client'
// src/lib/use-setup-categorias.ts
// Hook irmão do useSetupUFDefault, mas para as CATEGORIAS de interesse: ao abrir
// Fornecedores/Concorrentes, o filtro de categoria já vem marcado com as categorias
// (de mercado) que a empresa vende — derivadas do Setup da Empresa. Reaplica quando a
// conta termina de hidratar e para assim que o usuário mexe no filtro (marcarTocado).

import { useEffect, useRef } from 'react'
import { getEmpresa, categoriasDoSetup } from './empresa'
import { categoriasMercadoDoSetup } from './categoria-mercado'
import { HYDRATED_EVENT } from './synced'

/**
 * @param aplicar recebe as categorias de MERCADO do setup e seta o filtro da página.
 * @returns marcarTocado — chame nos handlers que mudam a categoria (clique do usuário).
 */
export function useSetupCategoriasDefault(
  aplicar: (cats: string[]) => void,
): { marcarTocado: () => void } {
  const tocadoRef = useRef(false)

  useEffect(() => {
    const run = () => {
      if (tocadoRef.current) return
      const mercado = categoriasMercadoDoSetup(categoriasDoSetup(getEmpresa()))
      if (mercado.length === 0) return
      aplicar(mercado)
    }
    run()
    window.addEventListener(HYDRATED_EVENT, run)
    return () => window.removeEventListener(HYDRATED_EVENT, run)
    // aplicar é estável (fecha sobre o setter); rodar só no mount + hidratação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { marcarTocado: () => { tocadoRef.current = true } }
}
