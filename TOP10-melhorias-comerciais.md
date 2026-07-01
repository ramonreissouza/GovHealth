# TOP 10 — O que falta para a GovHealth AI competir com os líderes mundiais

> Análise como especialista em vendas de saúde, comparando a GovHealth AI com
> GovWin IQ (Deltek), Civic IQ, GovSpend, AcuityMD, TechnoMile GovSearch e G LNK —
> as referências reais do mercado de sales intelligence para vendas governamentais
> e para MedTech. Ordenado por impacto comercial, do maior para o menor.

---

## ACHADO ZERO (antes do Top 10) — a tela de login

A plataforma hoje abre em `/login`, com credenciais de demo expostas publicamente
na própria tela (`demo@govhealth.ai / demo123`). Para uma ferramenta que vai lidar
com estratégia comercial sensível de milhões de reais, isso passa a mensagem errada
logo no primeiro contato: parece protótipo, não parece enterprise. Os líderes do
setor (GovWin, Civic IQ) fazem questão de mostrar dados/demo com controle — nunca
credenciais abertas na tela pública.

**Ação:** mover a demo para um fluxo de "solicitar acesso" ou vídeo, não deixar
login funcional visível para qualquer visitante.

---

## 1. Não existe CRM/pipeline — a plataforma para na informação, não chega na ação

**O que falta:** hoje, encontrar uma oportunidade quente não gera nenhum próximo
passo dentro da plataforma. O vendedor descobre e sai para anotar em outro lugar.

**Por que isso é o maior gap:** é exatamente o diferencial que GovWin IQ e Civic IQ
vendem como núcleo — GovWin IQ é a solução líder de vendas para contratação governamental
e conecta descoberta → pipeline → captura em um fluxo único. Sem isso, a
GovHealth AI é uma ferramenta de pesquisa, não de vendas.

**Ação:** cada oportunidade vira um card de pipeline (estágio: descoberta →
qualificação → proposta → fechado). Tarefas, notas e follow-up vinculados.
Isso já estava no PRD original da plataforma — nunca foi implementado.

---

## 2. Não há inteligência de contato/decisor — falta "com quem eu falo"

**O que falta:** as telas mostram o órgão, o valor, o item — mas nunca a pessoa.
Quem é o secretário de saúde, o responsável por compras, o diretor do hospital?

**Por que importa:** contact intelligence é fundamental para desenvolvimento comercial e gestão de captura
no setor. É por isso que ferramentas inteiras (TechnoMile GovSearch) existem só
para isso — informação de contato para tomadores de decisão sênior no governo, incluindo organogramas.
Sem contato, o vendedor sabe ONDE vender mas não A QUEM ligar.

**Ação:** enriquecer cada órgão/hospital com contatos públicos disponíveis
(portais de transparência costumam ter nome de gestores/secretários),
começando pelo cargo, depois evoluindo para contato direto.

---

## 3. Sinal de compra chega tarde demais comparado ao padrão global

**O que falta:** hoje o sinal mais precoce é a emenda parlamentar/convênio.
Os líderes globais vão além.

**Por que importa:** GovWin IQ usa IA para revelar leads até 5 anos antes de um RFP ser publicado,
com Civic IQ monitorando 50.000+ agências para sinais de compra 6-18 meses antes do procurement formal.
A GovHealth AI hoje capta a partir do convênio/emenda — já é bom, mas o próximo
nível é capturar sinais no orçamento (PPA, LOA) antes mesmo da emenda virar convênio.

**Ação:** mapear onde consultar o orçamento aprovado (PPA municipal/estadual)
como uma camada AINDA anterior à emenda no funil do Radar de Verba.

---

## 4. Preço de referência existe no código, mas não aparece na tela de oportunidade

**O que falta:** o módulo de preços BPS/CMED foi especificado e parcialmente
implementado, mas fica isolado — o vendedor não vê "este item, este preço de
referência" no mesmo lugar que vê a oportunidade.

**Por que importa:** um fabricante de implantes cirúrgicos usou machine learning para prever descontos por tipo de hospital, aumentando a taxa de vitória em licitações em 15% preservando margem.
Preço de referência junto da oportunidade é o que transforma dado em decisão de
proposta — não é um módulo à parte, é contexto obrigatório na mesma tela.

**Ação:** ao abrir uma oportunidade, mostrar automaticamente a faixa de preço
histórico do item (mín/mediana/máx) ao lado do valor estimado.

---

## 5. Mapa é decorativo, não funcional

**O que falta:** a tela de mapa hoje usa pontos animados estáticos (placeholder),
sem Mapbox real conectado, sem clique para drill-down por município.

**Por que importa:** em vendas de território (a forma como reps de saúde
trabalham fisicamente sua carteira por região), um mapa sem interação é só
ilustração. Os concorrentes mundiais tratam geografia como filtro primário,
não decoração.

**Ação:** conectar o Mapbox real (token já está no `.env.local.example`),
com clique no município abrindo as oportunidades daquele local.

---

## 6. Concorrentes e Timeline ainda mostram dados de exemplo, não dados reais

**O que falta:** essas duas telas foram construídas com dados mock (Siemens,
Philips, GE como exemplos fixos) para provar o conceito, mas nunca foram
reconectadas aos dados reais que o ETL de vencedores está populando agora.

**Por que importa:** é o risco mais silencioso da lista — um usuário pode
tomar decisão comercial baseado em dado de exemplo pensando que é real.
Isso quebra confiança de forma irreversível se descoberto.

**Ação:** assim que o ETL de vencedores (Tela 1-4 do PRD) estiver rodando,
essas duas telas devem ser as primeiras a substituir mock por dado real —
antes de qualquer nova funcionalidade.

---

## 7. Sem app mobile nem alertas push — e é exatamente onde os líderes falham também

**O que falta:** hoje só existe a versão web.

**Por que importa (e por que é oportunidade, não só gap):** mesmo o líder de
mercado é criticado por isso — "não há app para o GovWin IQ, então precisa usar em computador"
é reclamação recorrente nas avaliações. Um representante comercial de saúde
pública vive em campo, visitando hospitais e prefeituras. Resolver isso bem
seria um diferencial real, não só paridade.

**Ação:** não precisa ser app nativo no curto prazo — um PWA (web app instalável)
com notificação push já cobriria 80% do valor, com fração do esforço.

---

## 8. Copiloto IA não mostra a fonte da resposta

**O que falta:** o chat responde em linguagem natural, mas não linka de onde
tirou cada dado (qual licitação, qual convênio, qual emenda).

**Por que importa:** em decisões que envolvem propostas de milhões de reais,
"confie em mim" não é suficiente. A diferença entre ferramentas de IA genéricas e as validadas por analistas é que as últimas contextualizam e enriquecem antes de chegar ao time —
rastreabilidade é o que separa uma ferramenta confiável de um chatbot bonito.

**Ação:** cada resposta do copiloto deve citar os registros/IDs de origem
(numeroControlePNCP, codigoEmenda) com link para o dado bruto.

---

## 9. Nenhuma tela comunica a proveniência/atualidade do dado

**O que falta:** ao olhar uma oportunidade, o usuário não sabe se aquele dado
é de hoje, de uma semana atrás, ou de um snapshot desatualizado.

**Por que importa:** confiança é o produto, não só a informação. O usuário
de uma ferramenta que vai embasar propostas de milhões de reais precisa saber
"isso foi coletado quando" — sem isso, toda a plataforma fica sob suspeita
de estar errada, mesmo quando está certa.

**Ação:** todo card/tela deve ter um selo discreto "atualizado há Xh — fonte: PNCP".
O sistema de snapshot já guarda essa informação (`_meta.json`) — só falta exibir.

---

## 10. Falta um "kit de proposta" — o passo depois de encontrar a oportunidade

**O que falta:** depois que o vendedor identifica a oportunidade certa, a
plataforma não ajuda a preparar a resposta.

**Por que importa:** GovWin IQ oferece esboços de proposta e matriz de conformidade que transformam a pré-escrita de horas em minutos,
e no lado saúde/MedTech, o tempo de resposta a edital é uma métrica-chave, com meta de redução de 80-90%.
É o "último quilômetro" que fecha o ciclo entre inteligência e venda fechada.

**Ação (fase futura, não agora):** ao abrir um edital, gerar automaticamente
um checklist dos documentos/exigências técnicas extraídos do PDF do edital,
usando o Copiloto IA que já existe.

---

## RESUMO — priorização sugerida

| # | Item | Esforço | Impacto comercial |
|---|---|---|---|
| 6 | Trocar dados mock por reais (Concorrentes/Timeline) | Baixo | Crítico (risco de confiança) |
| 0 | Remover credenciais demo públicas | Baixo | Alto (primeira impressão) |
| 9 | Selo de atualidade do dado | Baixo | Alto (confiança) |
| 4 | Preço de referência na tela de oportunidade | Médio | Alto (decisão de proposta) |
| 5 | Mapa real com Mapbox | Médio | Médio-Alto |
| 1 | CRM/pipeline básico | Médio-Alto | Crítico (fecha o ciclo comercial) |
| 8 | Fontes citadas no Copiloto | Médio | Médio |
| 2 | Contatos/decisores por órgão | Alto | Alto |
| 3 | Sinal de compra mais precoce (orçamento) | Alto | Médio (diferencial futuro) |
| 7 | PWA + push | Alto | Médio (diferencial de campo) |
| 10 | Kit de proposta automático | Alto | Alto (fase madura) |

**Sugestão de próximos 2 sprints:** itens 6, 0 e 9 primeiro (rápidos, resolvem
riscos de confiança), depois 4 e 5 (aumentam valor percebido sem grande esforço),
depois entrar no item 1 (CRM) como a próxima grande frente, em paralelo ao
ETL de vencedores que já está em andamento.

---

*Nota de honestidade: esta análise não incluiu navegação autenticada real na
plataforma (limitação técnica desta sessão). Itens marcados com base em código/
arquitetura conhecida foram validados durante nossa construção conjunta; ajustes
podem ser necessários após revisão visual das telas atuais.*
