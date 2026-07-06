# Brief de Modernização — Página Inicial (/inicio)
## Para execução pelo Claude Code

> **Contexto honesto:** quem escreveu este brief NÃO conseguiu visualizar a página
> atual (preview da Vercel é protegido por login). Portanto:
>
> **PASSO 0 — OBRIGATÓRIO:** antes de mudar qualquer coisa, leia o código atual de
> `/inicio` e compare com este brief. Aplique só o que falta. Me diga o que já
> está atendido.
>
> **Princípio central do pedido:** moderna e atrativa, SEM ser extensa, cansativa
> ou cheia de texto. Na dúvida entre adicionar ou cortar: CORTE.

---

## 1. Estrutura da página (máximo 6 blocos, nesta ordem)

**Bloco 1 — Hero (o mais importante)**
- Headline: UMA frase de até 10 palavras que diz o valor
  (ex: "Descubra licitações de saúde antes do edital")
- Sub-headline: UMA frase de apoio (máx. 20 palavras)
- UM botão CTA primário ("Solicitar acesso") — nunca dois CTAs competindo
- Visual à direita/abaixo: screenshot real do dashboard (não ilustração genérica)

**Bloco 2 — Prova por números (faixa fina, 3-4 números)**
- Ex: "R$ XXM em licitações mapeadas · X.XXX municípios · Dados PNCP oficiais"
- ⚠️ REGRA: usar SOMENTE números reais vindos do banco/ETL. Se o número real
  ainda for pequeno, mostrar outro ângulo verdadeiro (ex: "27 estados cobertos",
  "atualização semanal") — NUNCA inventar volume.

**Bloco 3 — 3 cards de funcionalidade (não mais que 3)**
- Ícone + título de 3-4 palavras + UMA linha de descrição
- Sugestão: Radar de oportunidades · Inteligência de concorrentes · Verba antes
  do edital

**Bloco 4 — "Como funciona" em 3 passos**
- 3 números grandes, 3 frases curtas. Sem parágrafos.

**Bloco 5 — Um screenshot grande do produto**
- A tela mais impressionante (mapa ou dashboard com dados reais)
- Uma legenda de UMA linha

**Bloco 6 — CTA final**
- Repetir o CTA do hero. Fundo com destaque. Nada mais.

**O que NÃO ter:** carrossel, vídeo em autoplay, blocos de texto com 3+ linhas,
seção de "missão/visão/valores", mais de 6 blocos, ícones genéricos de stock.

---

## 2. Identidade visual (continuidade com o app)

- Manter o tema escuro e o verde de destaque do produto — a landing deve parecer
  o MESMO produto que o usuário verá após o login.
- ⚠️ Confirmar os tokens atuais no código (`globals.css` / config do Tailwind) —
  não usar valores de memória. Referência do que foi definido originalmente:
  fundo `#0a0c0f`, accent `#00e5a0`, fontes Syne (títulos) / DM Sans (texto) /
  DM Mono (números). Validar se ainda são esses.
- Números e dados sempre em fonte mono — reforça identidade de "plataforma de dados".
- Muito espaço em branco (respiro entre blocos: generoso, não compacto).

---

## 3. Movimento (sutil, não circense)

- Micro-animações apenas: fade-in suave dos blocos ao rolar, hover discreto nos
  cards e no CTA.
- Uma única animação "assinatura" permitida no hero (ex: contador subindo nos
  números reais, ou pontos pulsando num mini-mapa).
- Respeitar `prefers-reduced-motion` (desativar animações para quem configurou isso).
- Proibido: parallax pesado, elementos voando, animação em loop infinito que
  distrai.

---

## 4. Performance e qualidade técnica

- Imagens/screenshots via `next/image` com dimensões definidas (evita layout shift).
- A página deve carregar rápido: sem bibliotecas novas só para a landing;
  preferir CSS/Tailwind puro para animações.
- Testar em mobile PRIMEIRO: hero legível sem zoom, CTA alcançável com o polegar,
  números empilham verticalmente.
- Meta tags: título e descrição próprios para a página (compartilhamento em
  WhatsApp/LinkedIn deve mostrar preview decente — Open Graph).

---

## 5. Acessibilidade mínima

- Contraste do texto sobre fundo escuro validado (texto secundário não pode ser
  cinza ilegível).
- Um `<h1>` único (a headline do hero); hierarquia de headings correta.
- Botões e links navegáveis por teclado, com estado de foco visível.

---

## 6. Checklist de aceitação (validar antes de dar como pronto)

- [ ] A página inteira é compreendida em UM scroll de 10 segundos
- [ ] Nenhum bloco tem mais de 2 linhas de texto corrido
- [ ] Só existe UM CTA (repetido no fim)
- [ ] Todos os números exibidos são reais e verificáveis no banco
- [ ] Screenshot é do produto real, não mockup genérico
- [ ] Carrega bem no celular (testado em viewport mobile)
- [ ] Animações desligam com `prefers-reduced-motion`
- [ ] Preview de compartilhamento (OG) funciona
