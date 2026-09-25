# Radar de Chat — diagnóstico e proposta de conexão

Análise de 23/09/2026. Código local: `e438276`, branch `feat/radar-cofre-participacao-unidade`; PR #34: `f38a22d`; PR #35: `b90e917`. As duas PRs estavam abertas e não integradas à main no momento da consulta. O código local já contém todos os commits da #34, mas não o commit da #35.

**Recomendação:** validar o Integra Compras do Serpro como fonte principal do chat e das diligências do Compras.gov.br; estabilizar e medir a cobertura do conector público do Licitanet, complementando-o com integração autorizada quando a página pública não entregar as mensagens necessárias. Autenticação, captura e entrega de alertas precisam de verificações separadas.

Foram examinados código, diffs das PRs, logs locais, as duas imagens e documentação pública dos fornecedores. Não foi feito login na conta gov.br, reprodução autenticada de um pregão ativo, contratação de API, alteração do banco, merge ou deploy. Relatos anteriores nos documentos são evidências históricas a conferir, não instruções para esta análise. Nenhum teste simulado demonstra funcionamento contra o portal real.

**1. O que as PRs resolvem**

| PR | Mudança verificada no diff | Limite da mudança |
|---|---|---|
| [#34](https://github.com/ramonreissouza/GovHealth/pull/34) | Espera do carregamento do BLL/BNC; captura local passa a abrir `loginUrl`; serviço local recebe mais tempo para login; worker passa de `pg.Client` para pool com tratamento de erro. | Não implementa a extração do chat do Compras.gov.br. Não elimina bloqueios 403/429 do Licitanet. Não resolve a recusa do CAPTCHA. |
| [#35](https://github.com/ramonreissouza/GovHealth/pull/35) | Publica browser-service em loopback e acrescenta configuração para o nginx do host; nginx/certbot próprios passam a um perfil opcional. | Resolve a topologia da hospedagem, sujeita a DNS/TLS/configuração e deploy. Não altera autenticação nem extração de mensagens. |

A imagem 2 já mostra `client_id=comprasnet.gov.br` e a tela do gov.br carregada. Portanto, nesse registro, nem a troca de client_id proposta para a captura local nem a exposição HTTPS do serviço explicam, sozinhas, o erro de CAPTCHA que aparece dentro do portal.

As correções da #34 são úteis, mas o checkout analisado já as contém. Reaplicá-las aqui não implementaria a etapa faltante. Não foi verificado qual SHA está efetivamente rodando na VPS.

**2. Compras.gov.br: há três obstáculos separados**

**Autenticação.** A imagem mostra `ERL0000900`, antes da etapa de senha/2FA. Isso comprova a recusa da verificação naquele fluxo; não identifica por si só a causa. Os textos das PRs atribuem o problema à automação e a uma mudança do gov.br após 13/09. O documento posterior do repositório reconhece que ambiente, navegador e rede não foram isolados. Não há aqui evidência suficiente para afirmar que o gov.br proibiu CDP, que Linux é sempre recusado ou que uma mudança de política ocorreu naquela data.

É compatível com o relato de que o login funcionava cerca de dez dias antes, mas também pode envolver versão/perfil do navegador, scripts de CAPTCHA que não carregam, sessão do desafio, IP de saída, proxy ou validação do servidor. A orientação oficial sobre [erro 403](https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/atendimento-gov.br/duvidas-na-conta-gov.br/erro-403-ao-fazer-o-login) menciona VPN e reputação de IP; ela não documenta especificamente o ERL0000900.

O túnel que publica o live view é uma conexão de entrada. Ele não determina automaticamente por qual IP o navegador acessa o gov.br. É necessário medir a saída real do navegador. Mudar o nginx ou o domínio do live view não equivale a mudar essa saída.

**Sessão utilizável pelo coletor.** O serviço captura `storageState`, encerra a sessão hospedada e o coletor abre outro Chromium headless com esse estado. Conseguir autenticar no primeiro navegador não prova que o segundo acessará o mesmo contexto do fornecedor. A sessão precisa ser validada contra uma leitura autenticada e a identidade/CNPJ esperado. Além disso, o Playwright não persiste `sessionStorage` por meio de `storageState`; é preciso descobrir se a aplicação depende dele, em vez de presumir que cookies bastam. [Documentação do Playwright](https://playwright.dev/docs/auth#session-storage).

Em `scripts/radar/browser-service.mjs:257`, a captura aceita URL fora do login e cookie não identificado como analytics. Em `:267`, já marca a saúde como `ok`. Um cookie ASP anônimo pode existir antes da autenticação; presença de cookie não prova acesso ao chat. O estado de conexão precisa ficar separado do estado de monitoramento.

**Extração incompleta.** O bloqueador mais importante está em `scripts/radar/connector-comprasgov.mjs:145`: quando existem licitações em acompanhamento, o código retorna `falha` informando que a leitura ainda não foi calibrada. No caminho real, não há extração que adicione mensagens à lista. O caminho de sucesso observado no código é o de lista vazia.

O conector entra no ASP clássico (`pregao1.asp` / `Acompanhar.asp`). É necessário distinguir processos antigos e o módulo moderno, seguindo a navegação oficial e seu repasse de sessão. A ausência de licitações numa página legada não demonstra ausência de participações ou de chats em todos os módulos. O fato de o login ter funcionado anteriormente não comprova que o Radar já tenha lido mensagens reais desse portal.

**3. Licitanet: já há captura, mas falta garantir cobertura e continuidade**

O conector atual lê `/sessao/<id>` sem login. Os logs locais contêm tanto sucessos quanto bloqueios:

| Evidência local | Interpretação |
|---|---|
| `radar.log:3310` e seguintes: HTTP 403, nenhuma página lida | Recusa de acesso, cuja causa exata não é demonstrada apenas pelo status. |
| `radar.log:3625`: HTTP 429 após 21 de 60 processos; 326 mensagens vistas | Limitação de requisições; a rodada ficou incompleta. |
| `radar.log:3663`: 1.024 mensagens, 57/60 processos com mensagem | Houve captura pública bem-sucedida. O número não representa mensagens novas nem comprova completude. |
| `radar.log:3703`: 965 mensagens, 55/60 processos com mensagem; rodízio a partir do 61º | O rodízio melhorou a distribuição do trabalho, mas não demonstra leitura contínua. |

O código impõe teto de 60 processos e espera pelo menos 6 + 3 segundos por página. São pelo menos nove minutos de espera para 60 processos, além de navegação, processamento e outros portais. A documentação local descreve rodadas completas de duas horas e rodadas urgentes de 15–20 minutos. Isso é insuficiente para prometer alertas imediatos durante uma disputa.

O painel é tratado pelo próprio conector como uma janela das mensagens recentes (`connector-licitanet.mjs:257`). Se mais mensagens chegarem entre duas leituras do que cabem nessa janela, mensagens intermediárias podem desaparecer sem jamais entrar no Radar. Deduplicação evita repetir o que foi visto; não recupera o que não foi lido.

Há também um falso positivo de saúde: quando existem processos mas nenhum possui URL `/sessao/` válida, o conector retorna `ok` com zero mensagens (`:162`). Isso deveria aparecer como falta de cobertura/mapeamento, não como monitoramento bem-sucedido.

O rodízio mais recente não faz parte da #34 nem da #35. Ele reduz a concentração nas primeiras páginas, mas não substitui um limite compartilhado de requisições, recuperação de histórico ou uma medição de atraso por processo.

**4. Duas premissas do plano anterior precisam ser corrigidas**

Em `src/lib/radar/selecao.ts:183` e `:235`, a seleção inclui os conectores de credenciais em todos os candidatos; sem credenciais, usa `comprasgov` como padrão. A identificação do portal é aplicada apenas aos conectores públicos adicionados em seguida. Assim, ter uma linha `conector_id='comprasgov'` não comprova que o certame tramita no Compras.gov.br.

A consequência é importante: a população usada no documento anterior para estimar cobertura da API pode conter processos de outros portais. Deve haver identificação explícita da plataforma, identificador nativo e evidência do vínculo com o PNCP; portal desconhecido deve permanecer desconhecido.

Também está incorreta a generalização de que somente órgãos federais possuem compras no Compras.gov.br/SIASG. O governo documenta a [adesão de milhares de municípios ao Compras.gov.br](https://www.gov.br/gestao/pt-br/acesso-a-informacao/acoes-e-programas/principais-acoes-na-area-economica/acoes-2022/mais-de-500-municipios-aderem-ao-compras-gov-br-em-um-ano). Isso não prova que a API paga cubra todos eles, mas invalida usar a esfera federal como único critério de inclusão ou exclusão.

Portanto, os “4–6% federais” não são uma estimativa válida da cobertura do Integra Compras. O percentual correto depende de processos comprovadamente realizados no portal e de respostas da API para uma amostra representativa. `codigoUnidade` com seis dígitos também não comprova UASG; o vínculo precisa ser conferido. O número sequencial PNCP não deve ser confundido com o número da compra.

**5. O que o mercado documenta — e o que não revela**

| Plataforma | Evidência pública consultada | Consequência para a GovHealth |
|---|---|---|
| Effecti | O manual de [credenciais do Comprasnet](https://ajuda.effecti.com.br/ajuda-2/como-cadastrar-credenciais-do-portal-comprasnet/) pede CPF/senha gov.br ou envio de certificado e sua senha. A página sobre [duas etapas](https://ajuda.effecti.com.br/ajuda-2/verificacao-de-duas-etapas-comprasnet-como-proceder/), atualizada em julho de 2025, orienta desabilitar 2FA. | O fluxo documentado mantém credenciais para autenticação; é diferente de uma captura única de sessão. Isso não revela como tratam CAPTCHA internamente nem prova imunidade às falhas atuais. |
| Effecti / Licitanet | O manual de [inclusão de acessos](https://ajuda.effecti.com.br/ajuda-2/configuracao-de-portais-2/) relaciona importação de chats ao cadastro de usuário/senha. A documentação de [Meus Acessos](https://ajuda.effecti.com.br/ajuda-2/meus-acessos-entenda-os-novos-fluxos-de-cadastro-de-credenciais/) inclui Licitanet entre os portais suportados nesse fluxo. | Não há fundamento para presumir que a Effecti dependa exclusivamente da mesma página pública que a GovHealth lê. A equivalência de cobertura precisa ser testada. |
| Licitei | Descreve [captura nos próprios servidores](https://www.licitei.com.br/blog/como-monitorar-chat-comprasnet), ativada por licitação, com funcionamento quando o computador do cliente está desligado. Inclui Comprasnet e Licitanet. | Comprova a oferta declarada de monitoramento em nuvem; não revela endpoints, credenciais internas ou eventual fornecedor de dados. |
| WaveCode | Anuncia [monitoramento em nuvem e diligências](https://www.wavecode.com.br/solucao/monitorar-licitacoes/), incluindo Compras.gov.br e Licitanet. | Contradiz a classificação genérica do plano anterior de que o produto dependeria sempre de um agente local ligado. A implementação interna continua desconhecida. |
| ConLicitação | Lista Comprasnet e Licitanet na [cobertura do Monitorar Chat](https://conlicitacao.com.br/ajuda/). | Demonstra cobertura anunciada, sem documentar publicamente o mecanismo de acesso nessa fonte. |

Essas páginas foram consultadas como documentação de produto, não como auditoria independente de disponibilidade. Não é possível concluir que determinada empresa use stealth, resolva CAPTCHA por terceiros ou use o Integra Compras. Também não há base para a afirmação anterior de que nenhuma plataforma brasileira usa a API do Serpro.

**6. Caminho recomendado para o Compras.gov.br**

O [Integra Compras](https://loja.serpro.gov.br/product/integracompras) é oferecido pelo próprio Serpro para integrar mensagens e diligências. A [documentação oficial](https://apicenter.estaleiro.serpro.gov.br/documentacao/integra-compras/) informa contratação com e-CNPJ e credenciais de API. É uma alternativa concreta à dependência do login gov.br do cliente para a leitura desses dados.

A [referência técnica](https://apicenter.estaleiro.serpro.gov.br/documentacao/integra-compras/pt/chamadas/producao/) publica:

```text
GET /chat/{chaveCompra}
GET /chat/{chaveCompra}/diligencias
```

O chat aceita `desde`, `ordem`, `page` e `size`; a referência descreve tamanho padrão de 20. A resposta inclui `chaveMensagem`, item, data/hora, remetente e destinatário. Implementar cursor com sobreposição de tempo, deduplicação por identificador de origem e paginação completa. O máximo efetivo de página e o fuso do filtro precisam ser verificados em homologação; “padrão 20” não demonstra que o tamanho seja fixo.

A implementação proposta é um adaptador HTTP separado, com dois cursores por compra, normalização para o modelo do Radar e uma fila de notificações. Usar fonte compartilhada somente para dados de fato públicos e permitidos para redistribuição; associação a clientes, preferências e mensagens restritas permanecem isoladas.

Antes de contratar para produção, validar uma amostra de 10–20 compras confirmadas no portal: federais, estaduais e municipais, fases distintas, mensagens gerais e diligências. Comparar com a interface oficial usando contas autorizadas. Confirmar explicitamente cobertura dos módulos, latência, disponibilidade, limites, licenciamento e quais comunicações são acessíveis. Uma API pública de editais ou do PNCP não substitui essa prova de chat.

O [FAQ oficial](https://apicenter.estaleiro.serpro.gov.br/documentacao/integra-compras/pt/duvidas/) informa cobrança de respostas 200, 206 e 404. Os [códigos de retorno](https://apicenter.estaleiro.serpro.gov.br/documentacao/integra-compras/pt/codigos_retorno/) distinguem paginação (206), ausência de compra ou de mensagens no filtro (404) e indisponibilidade (502). Logo, 404 não deve significar automaticamente “sem novidades” antes de validar a compra.

Exemplo de dimensionamento, não orçamento: 20 compras, dois canais, uma consulta por minuto, oito horas por dia e 22 dias resultam em **422.400 requisições/mês**, antes de páginas adicionais e recuperação. Medir tarifa e volume real. Priorizar participações e processos escolhidos pelo usuário; reduzir frequência conforme fase e retomada prevista, mantendo atenção às diligências após a disputa. A lista genérica de oportunidades não deve receber o mesmo ritmo dos pregões em andamento.

Se a API deixar lacunas, manter um caminho autenticado complementar. A prova deve começar num navegador normal controlado pelo usuário, acessando o portal pelo fluxo oficial, e completar uma leitura real de chat no mesmo contexto. Uma extensão/agente local pode operar com sessão local e enviar mensagens normalizadas, mas depende de disponibilidade do computador. Uma instância persistente hospedada por cliente exige validação de aceitação pelo portal e renovação de sessão; mudar o sistema operacional não é garantia de solução.

Para diagnosticar o CAPTCHA, comparar poucas tentativas controladas, alterando uma variável por vez: navegador/perfil, modo de execução e rede de saída. Registrar versões, horários, erros de carregamento e resultado, sem credenciais/tokens. Perfis diferentes impedem concluir que uma diferença isoladamente seja causada pelo CDP. QR e certificado são métodos oficiais a testar, não garantias de eliminar CAPTCHA. Desativar 2FA não trata necessariamente o erro mostrado, que ocorre antes dessa etapa.

**7. Caminho recomendado para o Licitanet**

1. Selecionar cinco certames reais ativos e comparar a comunicação pública com o chat visto por um fornecedor autorizado. Medir mensagens gerais, por item, direcionadas, diligências, histórico e atraso. Classificar cada modalidade de leitura explicitamente.
2. Validar o identificador nativo e a URL de sessão. Processos sem vínculo comprovado entram em “aguardando identificação”; não contam como monitorados.
3. Coletar cada sessão pública uma vez e distribuir as mensagens aos clientes que a acompanham. Hoje a leitura é repetida por titular, multiplicando carga para o mesmo processo.
4. Usar fila independente por portal e limite de tráfego compartilhado entre workers, com orçamento por processo. Respeitar `Retry-After`, pausa persistente em 429 e investigação/suporte para 403. Evitar que cada novo processo/tenant reinicie a sequência de tentativas. O sinal atual em memória dura somente uma rodada.
5. Verificar paginação/histórico e atualização incremental disponíveis na interface pública. Preferir a interface documentada/autorizada do portal; qualquer endpoint observado precisa ter escopo e condições de uso conferidos. Se a janela recente não permite recuperar perdas, declarar essa limitação.
6. Se o chat necessário não for público, buscar integração autorizada com o Licitanet ou sessão assistida do fornecedor. Cadastrar uma senha sem implementar a leitura autenticada não acrescenta cobertura: o conector atual ignora a sessão salva.
7. Exibir última leitura por processo, atraso e motivo de interrupção. Um portal pode responder enquanto um certame específico permanece sem cobertura.

**8. Ordem de execução e critério de pronto**

| Ordem | Entrega | Prova exigida |
|---|---|---|
| 1 | Corrigir identificação de portal e separar “conectado”, “leitura validada”, “parcial” e “atrasado”. | Processo de outro portal não é atribuído automaticamente ao Compras.gov.br; cookie ou URL ausente não produz saúde verde. |
| 2 | Prova do Integra Compras na amostra confirmada. | Mensagens e diligências correspondem à interface oficial, ao processo e aos itens corretos; cobertura e custo medidos. |
| 3 | Prova de cobertura do Licitanet e coleta com limites compartilhados. | Mensagens relevantes da amostra aparecem no Radar; lacunas da página pública ficam identificadas. |
| 4 | Coleta incremental, recuperação após queda e filas independentes. | Reinício não perde cursor; a indisponibilidade de um portal não paralisa outro; atraso detectado por processo. |
| 5 | Entrega de alertas com métricas. | Mensagem de origem → ingestão → alerta visível/entregue, com timestamps e sem duplicação. |
| 6 | Piloto acompanhando sessões reais por vários dias. | Comparação contínua, medição de perdas e latência; só então divulgar monitoramento ativo. |

Meta inicial proposta para sessões ativas: atraso p95 de até 60 segundos, condicionado ao limite autorizado e ao custo. Se a fonte não sustentar essa meta, a promessa do produto precisa refletir a frequência efetivamente alcançada. Diligências e retomadas posteriores continuam monitoradas; a janela atual baseada apenas em ontem/hoje/amanhã não basta para isso.

O `vercel.json` analisado não agenda `/api/cron/radar-notify`. Isso não prova ausência de agendamento externo na VPS, mas exige verificação: mensagens capturadas e notificações enfileiradas não demonstram e-mail entregue.

O resultado aceitável é uma mensagem real, de um processo identificado corretamente, chegando ao Radar e ao canal de alerta dentro da meta medida, inclusive após reconexão ou reinício. A tela de login funcionando é apenas uma das etapas possíveis dessa entrega.
