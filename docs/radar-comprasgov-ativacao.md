# Ativação do Radar no Compras.gov.br — Integra Compras

> Em 24/09/2026, por decisão de custo do produto, o caminho padrão passou a ser a [leitura pública sem tarifa de API](radar-comprasgov-gratuito.md), cuja página de mensagens foi verificada em uma compra real. Este documento descreve apenas a alternativa paga, que permanece desativada.

Implementado em 23/09/2026. A leitura usa os endpoints oficiais de chat e diligências, com OAuth do contrato Serpro. O caminho padrão de cadastro não usa a sessão gov.br nem o navegador remoto. Uma compra cadastrada fica pendente até a leitura real; credenciais configuradas e login bem-sucedido não são prova de captura.

## Pré-requisitos

- Contrato Integra Compras habilitado para o ambiente escolhido e Consumer Key/Consumer Secret. Guarde no ambiente do servidor, nunca em `NEXT_PUBLIC_*` ou no repositório.
- Schema Radar existente, mais a migração aditiva abaixo.
- Compra confirmada no Compras.gov.br, com link oficial e chave SIASG. Não derive essa chave de `sequencial_compra` nem da modalidade do PNCP. UASG: 6 dígitos; modalidade SIASG: 03/05/06/20; número: 5; ano: 4. Exemplo apenas ilustrativo: `07000505000032026`.
- O órgão pode ser federal, estadual ou municipal. O critério é o portal onde a compra acontece, e não a esfera administrativa.

## Configuração

Defina estas variáveis no ambiente do app **e** do coletor:

```dotenv
RADAR_COMPRASGOV_ENABLED=1
RADAR_COMPRASGOV_AMBIENTE=producao
RADAR_COMPRASGOV_INTERVAL_SECONDS=300
RADAR_COMPRASGOV_MAX_REQUESTS=20
SERPRO_CONSUMER_KEY=<configurar-no-servidor>
SERPRO_CONSUMER_SECRET=<configurar-no-servidor>
```

`homologacao` é outro ambiente e mantém cadastros separados. Não troque para produção para validar uma carga de teste. O padrão sem `ENABLED=1` não consulta o Serpro. O limite é **por passada** do coletor, incluindo falhas e repetições de chamadas de dados; não é teto financeiro mensal nem limite global entre réplicas. Mantenha uma instância. Token OAuth não entra nessa contagem.

Preço comercial conferido em 24/09/2026: a loja do Serpro apresenta cobrança por **contratação monitorada/consultada no mês**, com valor unitário de R$ 1,56 para 1 a 2.000 contratações, decrescendo por faixa até R$ 0,80. Pela primeira faixa, 10 compras representam R$ 15,60/mês e 100 representam R$ 156,00/mês, considerando essa unidade comercial. Não multiplique o valor unitário pelo número de requisições HTTP.

A documentação técnica diz que respostas 200, 206 e 404 são bilhetadas. É necessário confirmar no contrato como essas chamadas são agrupadas por compra/mês, inclusive os dois endpoints, repetições e paginação. A informação técnica de bilhetagem não define, sozinha, a unidade da fatura.

Para dimensionar tráfego, sem paginação, N compras geram aproximadamente `N × 2 × 3600 / intervalo` chamadas/hora; por exemplo, 10 compras a cada 300 segundos podem gerar 240 chamadas/hora. Isso é estimativa de tráfego, não de unidades faturadas. O limite por passada pode atrasar compras; a saúde mostra a defasagem. O polling não promete tempo real.

### Desenvolvimento local

Na raiz do projeto, com `.env.local` configurado:

```powershell
npm run radar:comprasgov:migrate
npm run radar:comprasgov:sync
# Depois de validar uma passada, processo contínuo:
node --env-file=.env.local scripts/radar/serve-comprasgov-api.mjs
```

Reinicie o Next após alterar as variáveis. Em Radar → Conectar portal → Compras.gov.br, cadastre CNPJ, título, chave e link oficial. O cadastro independe das chaves do Serpro; sem elas, permanece aguardando ativação. Para pausar, use Desativar monitoramento no processo do Radar. Recadastrar não reativa uma compra pausada.

### VPS / Docker Compose

Adicione as variáveis ao arquivo de segredos já usado pelo deploy e carregue-o no shell. O compose fornece as variáveis ao app e ao serviço dedicado. A imagem app também precisa conter a nova versão da tela/rotas.

```sh
cd deploy/app
docker compose --profile radar-comprasgov build app radar-comprasgov
docker compose --profile radar-comprasgov run --rm radar-comprasgov node scripts/migrate-radar-comprasgov.mjs
docker compose up -d app
docker compose --profile radar-comprasgov up -d radar-comprasgov
docker compose logs --tail=50 radar-comprasgov
```

O serviço consulta apenas compras explicitamente cadastradas nesta integração. O coletor antigo não tenta mais sessões Compras.gov.br em execução real; continua atendendo os outros portais. As credenciais antigas são preservadas, mas sua saúde não determina a saúde desta integração. A seleção automática para de atribuir compras de outros portais ao Compras.gov.br; registros antigos não são apagados ou convertidos automaticamente.

## Critérios de aceite antes de anunciar conexão ativa

1. Cadastrar uma compra conhecida em produção e conferir sua chave no portal.
2. Comparar texto, item/grupo e horário de mensagens reais com o portal, para chat e diligências. A API declara UTC; a interface exibe o fuso do usuário.
3. Completar todas as páginas 206 e observar a hora da última leitura. Cadastro, token e leitura parcial não deixam o conector verde.
4. Gerar/observar uma mensagem nova no portal e confirmar entrada no Radar, depois repetir a coleta e confirmar ausência de duplicatas.
5. Interromper o coletor e confirmar indicação de atraso; retomar e confirmar recuperação. Verificar pausas e isolamento entre empresas.

Um 404 inicial é ambíguo (compra inexistente ou sem mensagens) e fica como leitura não confirmada. Um 404 incremental só conta como consulta vazia se **aquele canal** já teve leitura completa e tem filtro `desde`, na página zero. Se diligências só devolverem 404 desde o cadastro, o chat pode estar capturado, mas a cobertura completa continuará não confirmada; isso é exibido por canal. Não há promessa de acesso a conteúdo além do disponibilizado pelo contrato/API.

## Garantias e limites implementados

- OAuth com validade do token e uma renovação após 401; redirects recusados; timeout por chamada. Segredos e respostas do provedor não entram nos logs de erro.
- Paginação ascendente com checkpoint por canal, lease no banco, transação por página e dedup por empresa/processo/canal/UUID. Um erro no banco não avança a página.
- O filtro temporal fica fixo enquanto há páginas pendentes. Após completar, reconsulta os últimos dois minutos em relação à última mensagem. A API precisa preservar a ordenação das páginas; inserções retroativas anteriores a essa janela exigem uma reconciliação histórica, ainda não automática.
- 403 pede revisão do contrato; 429 respeita `Retry-After`; falhas sistêmicas adiam a fila do ambiente e encerram a passada. Backlog/paginação pendente não é apresentado como leitura completa.
- Histórico inicial entra no Radar sem e-mails retroativos. Depois, mensagens novas com até 48h entram na fila existente de e-mail, com máximo de cinco por processo/passada, e na notificação interna. A entrega de e-mails depende do despachante já existente (`/api/cron/radar-notify`) e suas configurações; esta mudança não executa nem libera o backlog antigo de notificações.
- Mensagens usam categoria do Serpro e identificação de diligências/prazos. Regras personalizadas adicionais de classificação do coletor legado ainda não são aplicadas por este coletor.

## Validação automatizada

```powershell
npm run radar:comprasgov:teste
$env:RADAR_COMPRASGOV_TEST_DB='1'
node --env-file=.env.local --test scripts/radar/comprasgov-api.teste.mjs
npm run type-check
```

O teste de banco cria apenas tabelas e sequência TEMP na própria conexão; não escreve em processos, mensagens ou notificações reais. As chamadas HTTP desses testes são simuladas e não usam as chaves do contrato.

## Fontes técnicas consultadas

- [Guia OAuth e utilização](https://apicenter.estaleiro.serpro.gov.br/documentacao/integra-compras/pt/guia_utilizacao/)
- [Contrato OpenAPI de produção](https://apicenter.estaleiro.serpro.gov.br/documentacao/integra-compras/pt/chamadas/producao/api-docs-prod.yaml)
- [Códigos de retorno e bilhetagem](https://apicenter.estaleiro.serpro.gov.br/documentacao/integra-compras/pt/codigos_retorno/)
- [Contratação Integra Compras](https://loja.serpro.gov.br/product/integracompras)
