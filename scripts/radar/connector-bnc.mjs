// scripts/radar/connector-bnc.mjs — conector do BNC (Bolsa Nacional de Compras).
//
// O BNC roda a MESMA aplicação do BLL (mesma rota, mesmas abas, mesmo `#MsgProcess`),
// então a implementação é uma só: connector-bll.mjs. Aqui só se escolhe o portal.
//
// Por que dois ids e não um conector "bll+bnc": o cliente vê o nome do portal no card
// de saúde e no rótulo de cada mensagem. Um id só faria o Radar dizer "BLL" sobre um
// pregão que corre no BNC — e aí o fornecedor abre o portal errado.

import { criarConectorBllBnc } from './connector-bll.mjs'

export const sync = criarConectorBllBnc({ id: 'bnc' })
