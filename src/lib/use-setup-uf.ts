'use client'
// src/lib/use-setup-uf.ts
// Hook compartilhado do item "pré-filtrar pelos ESTADOS DO SETUP DA EMPRESA": ao abrir
// uma tela com filtro de UF, já vêm marcados os estados de atuação salvos no Setup
// (getPreferences().ufs). Reaplica quando a conta termina de hidratar do servidor (as
// preferências chegam de forma assíncrona logo após o login) e para de aplicar assim
// que o usuário mexe no filtro (marcarTocado) — para não sobrescrever a escolha dele.

import { useEffect, useRef } from 'react'
import { getPreferences } from './preferences'
import { HYDRATED_EVENT } from './synced'

/**
 * @param aplicar recebe as UFs do setup e seta o estado de filtro da página.
 * @param opts.pular quando true (ex.: há deep-link ?uf= na URL), não aplica o default.
 * @param opts.apenasSeUnica para telas de UF ÚNICA (seletor de um estado só): aplica o
 *   default apenas quando o setup tem EXATAMENTE uma UF. Assim um vendedor multi-estado
 *   não fica preso num único estado numa tela que não representa vários (perderia dados);
 *   quem atua num estado só passa a ver essa tela já focada nele. Nas telas multi-UF
 *   (deixe false) todas as UFs do setup são aplicadas.
 * @returns marcarTocado — chame nos handlers que mudam a UF (clique/seleção do usuário).
 */
export function useSetupUFDefault(
  aplicar: (ufs: string[]) => void,
  opts: { pular?: boolean; apenasSeUnica?: boolean } = {},
): { marcarTocado: () => void } {
  const tocadoRef = useRef(false)
  // Inicializa com o valor do primeiro render (o `run()` do mount precisa dele já
  // correto) e sincroniza depois DENTRO de um efeito. Escrever `.current` durante o
  // render, como era antes, é o que a regra react-hooks/refs acusa: em render
  // interrompido/refeito o valor gravado pode não corresponder ao render aplicado.
  const pularRef = useRef(!!opts.pular)
  useEffect(() => { pularRef.current = !!opts.pular }, [opts.pular])
  const apenasSeUnica = !!opts.apenasSeUnica

  useEffect(() => {
    const run = () => {
      if (tocadoRef.current || pularRef.current) return
      const ufs = getPreferences().ufs
      if (ufs.length === 0) return
      if (apenasSeUnica && ufs.length !== 1) return
      aplicar(ufs)
    }
    run()
    window.addEventListener(HYDRATED_EVENT, run)
    return () => window.removeEventListener(HYDRATED_EVENT, run)
    // aplicar é estável (fecha sobre o setter); rodar só no mount + no evento de hidratação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { marcarTocado: () => { tocadoRef.current = true } }
}
