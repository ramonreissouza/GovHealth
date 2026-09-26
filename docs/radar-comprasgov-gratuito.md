# Compras.gov.br sem tarifa de API

Decisão de 24/09/2026: usar o painel **público** de mensagens como caminho de piloto, conforme a restrição de custo do produto. O Integra Compras permanece desativado; não é pré-requisito deste caminho. Há consumo da infraestrutura existente e manutenção do navegador, mas nenhuma chamada ao serviço pago.

**Situação após o teste automatizado:** o portal apresentou um desafio hCaptcha antes de carregar a compra. Acesso público não significa acesso automatizado livre de CAPTCHA. O modo assistido local está implementado para o usuário resolver o desafio no navegador oficial; a captura ponta a ponta ainda depende dessa validação manual. Por escolha do usuário, a janela assistida não foi aberta nesta etapa. Não anunciar conexão ativa ou monitoramento autônomo 24 horas.

## Evidência observada

Foi aberta, sem login gov.br nem credenciais Serpro, a [consulta pública do pregão 90012/2025, UASG 201057](https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=20105705900122025). O botão de envelope abriu o painel “Mensagens”. A primeira página exibiu dez mensagens, com remetente, grupo quando aplicável, data/hora e controles de paginação. A segunda página exibiu outras dez, incluindo suspensão/retomada da sessão e registro de envio de anexos por participante. A navegação entre as páginas foi verificada no navegador.

Isto prova acesso público a mensagens reais nessa compra **homologada**. Não prova cobertura de todas as compras, diligências restritas, latência durante disputa ou disponibilidade contínua. A API oficial paga deixou de ser a recomendação principal. A documentação da Effecti não demonstra um método gratuito universal nem revela sua implementação de CAPTCHA.

No teste seguinte, executado pelo próprio coletor Playwright, a página e seus scripts responderam HTTP 200, mas um desafio visual bloqueou o carregamento. A evidência local ficou em `scripts/radar/.calibra/comprasgov-publico-1790253530801.png` (ignorada pelo Git). Não foi erro de seletor comprovado nem recusa HTTP 403. O diagnóstico agora separa navegador ausente, permissão de execução, timeout, recusa HTTP e CAPTCHA visível; o selo pequeno do hCaptcha não é tratado como desafio.

No teste assistido posterior, o portal consultou a compra e respondeu HTTP 204, redirecionando para `/comprasnet-web/compra-nao-encontrada` (evidência `comprasgov-publico-1790269258069-rede.json`). O coletor inicialmente classificou isso como timeout; foi corrigido para registrar a página de erro explicitamente. A mesma compra foi localizada pela pesquisa oficial, com UASG `201057`, número/ano `900122025` e situação Finalizadas. O botão “Acompanhar compra” levou à mesma URL e o painel exibiu as mensagens, no navegador de pesquisa. Isso confirma a existência da compra, mas não estabelece por si só a causa da diferença entre os navegadores.

O coletor agora tenta a pesquisa oficial quando o acesso direto retorna “Compra não encontrada”, sem chamar diretamente a API nem manipular tokens de CAPTCHA. Pesquisa Finalizadas e, se não houver resultado utilizável, Em andamento. Mais de um resultado ou uma chave de compra diferente interrompem a captura. O probe aceita `--pela-pesquisa` para testar esse caminho desde o início.

**Resultado do segundo teste assistido:** o usuário informou novo erro no desafio e a pesquisa do coletor não trouxe resultado confirmável; o log registrou HTTP 204 na consulta pública (`comprasgov-publico-1790270080533-rede.json`). Nenhuma mensagem foi capturada pelo coletor. A mudança para navegação pela pesquisa não resolveu a falha neste ambiente. Não insistir em novos desafios sem uma hipótese verificável. Pesquisa sem resposta confirmada é distinta da tela explícita de compra não encontrada; nenhum dos casos prova inexistência do pregão. O modo assistido continua experimental, sem validação ponta a ponta.

Após essas correções, nove testes unitários passaram, incluindo regressões para redirecionamento, pesquisa ambígua, resultado de outra compra e pesquisa sem confirmação. O teste PostgreSQL foi validado na etapa anterior; não precisou ser repetido nesta alteração de navegação.

## Implementação local

- O cadastro normal do Radar agora pede título e link da consulta pública. Não pede CPF, sessão gov.br ou contrato Serpro. URLs de item são normalizadas para a compra.
- O leitor abre o painel observado, extrai remetente/texto/grupo/horário e percorre a paginação. Não procura mensagens na página ASP legada.
- O comando abaixo atende apenas compras explicitamente cadastradas neste fluxo. A seleção automática antiga não inicia milhares de consultas. Credenciais antigas não impedem o acesso público.
- A deduplicação inclui empresa e processo; o grupo também faz parte da mensagem. A interface pública informa horário com precisão de minuto; mensagens idênticas do mesmo remetente/grupo/minuto podem ser indistinguíveis. Não há UUID de origem confirmado nesta leitura DOM.
- Mantém as regras e filas de notificação do coletor existente, extraídas para um módulo testável. No Compras.gov.br, mensagens, notificações, rodízio e saúde são gravados na mesma transação. Uma falha desfaz o lote para permitir nova tentativa sem perder alertas. A entrega de e-mails depende do despachante separado; não foi disparado envio de e-mail nesta investigação.
- No máximo cinco compras e vinte páginas por compra em cada passada. Histórico maior permanece explicitamente parcial. Não há retomada de páginas históricas além desse limite nesta versão; o leitor recomeça pela primeira página em cada passada.
- HTTP 401/403/429, desafio interativo, painel vazio sem confirmação ou mudança de estrutura não viram saúde verde. A presença do logotipo hCaptcha, sozinha, não é tratada como bloqueio. O leitor não resolve nem contorna desafios.
- Um lease no PostgreSQL impede sobreposição entre o serviço dedicado e o coletor geral, inclusive em máquinas diferentes. É renovado durante a coleta; se o dono perde o lease, não grava. A pausa de pelo menos 30 minutos após CAPTCHA/recusa persiste entre reinícios; `Retry-After` é respeitado até sete dias. Após coleta normal, há intervalo mínimo de cinco minutos.
- A saúde deixa de mostrar OK quando a última verificação fica atrasada (15 minutos por padrão), ou existe compra recém-cadastrada ainda não verificada.
- O serviço recorrente aguarda o término de uma passada antes de contar o intervalo da seguinte. O modo assistido usa um perfil Chromium exclusivo em `.calibra/comprasgov-publico-perfil`; não copia a sessão do navegador pessoal, nem exige CPF/senha gov.br. Enquanto houver desafio, o usuário tem até dez minutos para resolvê-lo manualmente. A sessão pública permanece somente nesse perfil local.

## Ativar o piloto

1. Manter `RADAR_COMPRASGOV_ENABLED=0` (variável que habilita exclusivamente o serviço pago).
2. Abrir Radar → Adicionar pregão fora do perfil e colar o link público de uma compra real (o "Conectar portal" saiu em 25/09/2026).
3. Preparar o ambiente local:

```sh
npx playwright install chromium
npm run radar:publico:migrate
```

A instalação do Chromium foi verificada neste computador e a migração aditiva `db/schema-radar-publico.sql` já foi aplicada ao banco configurado nesta task. Ela cria somente a tabela de coordenação `radar_coletor_leases`. Outros ambientes precisam executar a migração. Na última conferência havia **zero compras ativas cadastradas pelo novo fluxo público**; os processos automáticos antigos não são convertidos silenciosamente.

4. Primeiro validar o navegador, sem tocar no banco:

```sh
npm run radar:comprasgov:publico:probe -- "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=20105705900122025" --assistido
```

Resolver pessoalmente o desafio na janela oficial que abrir. O script continua a leitura e salva o resultado em `.calibra`, sem enviar mensagens ou e-mails. Não compartilhe o diretório do perfil do navegador.

5. Depois de cadastrar a compra no Radar, executar a coleta assistida:

```sh
npm run radar:comprasgov:publico -- --assistido
```

O comando carrega DATABASE_URL de `.env.local`. Confirmar mensagens e horário na caixa, comparar com o portal, executar de novo e verificar ausência de duplicatas. O modo de captura normal pode enfileirar alertas recentes para o despachante do produto; o `probe` acima nunca enfileira.

Para manter rodadas neste computador, enquanto ele estiver ligado:

```sh
npm run radar:comprasgov:publico:servico -- --assistido
```

A janela pode exigir intervenção novamente. O modo assistido não é serviço autônomo e não roda em um servidor sem interface gráfica. O intervalo é de cinco minutos **após terminar** cada passada, configurável por `RADAR_PUBLICO_INTERVAL_SECONDS` (300–86400). Um bloqueio já registrado continua respeitando a pausa no banco; o modo assistido não a remove.

6. Validar também uma compra em sessão ativa. Caso as mensagens necessárias não estejam disponíveis publicamente, será necessário investigar outra fonte autorizada. A extensão de navegador ainda não foi implementada; não deve ser vendida como cobertura existente.

## Execução no servidor existente

Foi preparado o profile Docker `radar-publico`, com Node/Chromium e dependências no Debian. Não recebe chaves Serpro, credenciais gov.br ou serviço de resolução de CAPTCHA. Não deve ser habilitado como monitoramento confiável antes de validar a leitura no IP do servidor. Se houver desafio, registra `captcha_2fa` e pausa; não muda IP, não usa proxy e não resolve o CAPTCHA.

Na raiz do repositório, com as variáveis do deploy já carregadas:

```sh
docker compose -f deploy/app/docker-compose.yml --profile radar-publico build radar-comprasgov-publico
docker compose -f deploy/app/docker-compose.yml --profile radar-publico run --rm radar-comprasgov-publico node scripts/migrate-radar-publico.mjs
docker compose -f deploy/app/docker-compose.yml --profile radar-publico up -d radar-comprasgov-publico
docker compose -f deploy/app/docker-compose.yml logs --tail=100 radar-comprasgov-publico
```

O código da aplicação também precisa ser publicado para disponibilizar o novo cadastro e os estados de saúde. O profile pago `radar-comprasgov` continua separado e não faz parte destes comandos.

## Validação e pendências

Teste local: `npm run radar:comprasgov:publico:teste`; tipagem: `npm run type-check`.

Os oito testes passaram, incluindo teste com PostgreSQL real em tabelas temporárias, transação externa e rollback final: exclusão mútua, pausa persistida, expiração do lease, deduplicação, isolamento entre empresas, preservação de grupo, classificação, fila in-app/e-mail e rollback se a fila falhar. Nenhuma linha de cliente ou sequência real de mensagens foi alterada pelo teste. Para repetir o teste do banco, definir `RADAR_COMPRASGOV_TEST_DB=1` e executar `node --env-file=.env.local --test scripts/radar/comprasgov-publico.teste.mjs`.

Tipagem, verificação de sintaxe e 31 verificações de rodízio passaram. ESLint não encontrou erros nos arquivos TS/TSX verificados; permanecem nove avisos preexistentes de hooks/render na página Radar. O orquestrador rodou com a fila pública vazia, sem envio de alertas. YAML foi validado; o build Docker não foi executado, pois Docker não está instalado neste computador. Nenhum deploy ou contratação foi feito.

Pendências de aceitação: coleta real depois de o usuário resolver o CAPTCHA, comparação em disputa ativa, conferência na caixa de usuário autenticado, medição no servidor e retomada de históricos acima de vinte páginas. Até essas validações, a funcionalidade deve permanecer identificada como piloto.
