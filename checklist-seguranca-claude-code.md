# Checklist de Segurança (Hardening) — GovHealth AI
## Para execução pelo Claude Code

> **Natureza deste documento (ler antes de agir):**
> Este NÃO é um relatório de pentest nem uma auditoria de vulnerabilidades
> confirmadas. É um checklist de hardening baseado em (a) a arquitetura conhecida
> desta plataforma — Next.js, NextAuth, rotas de API, chave do Portal da
> Transparência, deploy Vercel — e (b) práticas de segurança estabelecidas.
>
> Quem escreveu este checklist NÃO tem acesso ao código-fonte real. Portanto:
>
> **INSTRUÇÃO PARA O CLAUDE CODE — para CADA item:**
> 1. Verifique no código se o problema realmente se aplica. NÃO assuma.
> 2. Se aplicável, corrija.
> 3. Se não aplicável ou já resolvido, diga explicitamente.
> 4. Onde este documento sinaliza incerteza (nome de biblioteca, sintaxe, versão,
>    edição de padrão), CONFIRME na documentação vigente antes de implementar —
>    não use um nome de função ou biblioteca só porque aparece aqui.
>
> **Ordem sugerida:** começar pelos itens 1, 2, 3, 10 e 14 (exposições concretas),
> depois o restante (hardening preventivo).
>
> **Sobre padrões citados:** o OWASP Top 10 é um projeto real da OWASP Foundation.
> Este documento NÃO cita edição/ano específico porque a edição vigente pode ter
> mudado — confirmar em owasp.org a versão atual.

---

## Grau de certeza de cada item (legenda)

- 🔴 **FATO** — exposição concreta observada durante a construção da plataforma.
- 🟡 **SUPOSIÇÃO** — depende de como o código foi de fato implementado; verificar.
- ⚪ **PREVENTIVO** — boa prática padrão, aplicável independentemente.

---

## BLOCO 1 — Credenciais e segredos (prioridade máxima)

**1. 🔴 Rotacionar a credencial demo comprometida.**
A conta `demo@govhealth.ai` teve a senha (`demo123`) exposta publicamente na tela
de login por um período. Ação: desativar a conta OU trocar a senha; garantir que
a nova credencial não esteja em nenhum arquivo versionado.

**2. 🟡 Auditar segredos no repositório E no histórico do Git.**
Verificar se `.env.local`, chaves de API ou senhas foram commitados em algum
momento. IMPORTANTE: remover do commit atual não resolve — se foi commitado uma
vez, permanece no histórico. Escanear o histórico completo.
*(Não se sabe se isso ocorreu neste repo — é uma verificação, não um problema
confirmado.)*

**3. 🟡 Rotacionar na origem qualquer chave encontrada no histórico.**
Se o item 2 encontrar chave versionada, tratá-la como comprometida e rotacioná-la
na origem (Portal da Transparência; e a de IA, quando reativada) — não apenas
removê-la do código.

**4. ⚪ Confirmar que segredos vivem apenas em variáveis de ambiente da Vercel.**
Nunca em código. Verificar CRITICAMENTE que nenhuma chave sensível está com o
prefixo `NEXT_PUBLIC_` — esse prefixo expõe o valor no navegador (comportamento
documentado do Next.js). Confirmar caso a caso.

---

## BLOCO 2 — Autenticação e sessão

**5. 🟡 Revisar a configuração do NextAuth.**
Confirmar: `NEXTAUTH_SECRET` forte e único em produção; cookies de sessão com
flags `httpOnly`, `secure`, `sameSite`; expiração de sessão definida.
*(Assume-se NextAuth por ter sido o planejado; confirmar o que está implementado.)*

**6. ⚪ Política de senha e proteção contra força bruta.**
Se houver login por senha: senha mínima robusta, rate limiting nas tentativas,
considerar bloqueio temporário após N falhas.

**7. 🟡 Autorização por rota, não só autenticação.**
Verificar se cada rota de API checa não apenas SE o usuário está logado, mas SE
ele tem permissão para AQUELE dado. Em SaaS multi-tenant, o risco clássico é
acessar dado de outro usuário trocando um ID na URL (referência insegura a objeto
direto — categoria do OWASP Top 10). Confirmar verificação de propriedade do dado.

---

## BLOCO 3 — Rotas de API e entrada de dados

**8. 🟡 Validar e sanitizar toda entrada nas rotas de API.**
Parâmetros de query (UF, filtros, IDs) e corpo de requisições devem ser validados.
Verificar se há biblioteca de validação de schema no projeto. O `zod` é uma opção
real e comum em TypeScript, MAS confirmar no `package.json` se já está presente
antes de assumir — não instalar às cegas.

**9. 🟡 Rate limiting nas rotas públicas de API.**
Rotas que consultam PNCP/emendas e a de IA (quando ativa) devem limitar
requisições por IP/usuário, contra abuso e custo descontrolado.
*(Não há recomendação de biblioteca específica aqui: pesquisar as opções de rate
limiting vigentes e compatíveis com o ambiente Vercel antes de escolher — não
adotar um nome sem verificar que existe e é atual.)*

**10. 🔴 Proteger ou remover a rota `/api/debug`.**
Essa rota de diagnóstico foi criada durante o desenvolvimento e expõe status de
chaves e fontes de dados. NÃO pode ficar acessível em produção sem proteção.
Ação: removê-la, ou restringi-la a ambiente de desenvolvimento, ou exigir auth.

**11. 🟡 Proteger as rotas de cron/sync.**
As rotas `/api/cron/...` e `/api/sync/...` devem exigir o `CRON_SECRET` no header.
Isso foi previsto no design; confirmar que a checagem está IMPLEMENTADA, não apenas
planejada.

---

## BLOCO 4 — Cabeçalhos e transporte

**12. 🟡 Configurar security headers.**
Definir `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
`Strict-Transport-Security`. A CSP é a mais delicada — pode quebrar carregamento
de scripts/mapa se mal configurada; implementar e testar com cuidado.
IMPORTANTE: a sintaxe de configuração de headers no `next.config.js` deve ser
confirmada na documentação VIGENTE do Next.js — a API de configuração pode diferir
entre versões maiores, e este projeto migrou para o Next.js 16 durante o
desenvolvimento. Não copiar sintaxe de memória.

**13. ⚪ Confirmar HTTPS forçado.**
A Vercel serve HTTPS por padrão; confirmar ausência de conteúdo misto e redirect
de HTTP para HTTPS.

**14. 🔴 Restringir a política de CORS.**
No `next.config.js` foi configurado `Access-Control-Allow-Origin: *` para as rotas
de API. Isso é permissivo demais para dados sensíveis. Restringir aos domínios que
realmente precisam de acesso.

---

## BLOCO 5 — Dependências e IA

**15. ⚪ Auditoria de dependências.**
`npm audit` e manter as correções que não quebram. Considerar Dependabot (recurso
real e gratuito do GitHub) para atualizações de segurança automáticas.

**16. 🟡 Ao reativar a IA: proteger contra injeção de prompt.**
Como a plataforma alimentará o modelo com dados públicos + input do usuário: não
permitir que input do usuário sobrescreva instruções do sistema; limitar o escopo
de ação do modelo; nunca expor a chave de IA no cliente.
*(Relevante para o copiloto, que está desativado no momento por decisão de custo.)*

---

## BLOCO 6 — LGPD e dados

**17. 🟡 Mapear dados pessoais.**
Se a plataforma armazena e-mail/nome de usuários (ou futuramente contatos de
decisores), isso entra na LGPD. Confirmar base legal, política de privacidade e
mecanismo de exclusão.
*(Isto é orientação geral de conformidade, NÃO aconselhamento jurídico. Decisões
de LGPD devem ser validadas por um especialista jurídico.)*

**18. ⚪ Logs sem vazamento.**
Garantir que logs de erro não gravem segredos, tokens ou dados pessoais — erro
comum é `console.error` logando o objeto inteiro da requisição.

---

## Resumo de priorização

| Prioridade | Itens | Natureza |
|---|---|---|
| Imediata | 1, 2, 3, 10, 14 | Exposições concretas ou de código conhecido |
| Alta | 4, 5, 7, 11, 12 | Fundamentos de auth/API a verificar |
| Média | 6, 8, 9, 16, 18 | Hardening de robustez |
| Contínua | 13, 15, 17 | Manutenção e conformidade |

---

## Ressalvas finais (transparência)

- Quem elaborou este checklist não auditou o código real nem navegou na plataforma
  logada. Os itens 🔴 vêm de exposições observadas durante o desenvolvimento; os
  🟡 e ⚪ são pontos a VERIFICAR, não defeitos confirmados.
- Nenhum nome de biblioteca aqui deve ser adotado sem confirmar que existe e está
  vigente. Onde há incerteza, está sinalizado.
- Este documento não substitui um pentest profissional nem auditoria jurídica de
  LGPD para uma plataforma que lida com estratégia comercial sensível.
