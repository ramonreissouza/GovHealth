# Conectar o Jira (backlog de "Reporte um problema")

O app espelha cada relato do widget **"Reporte um problema"** como um card no Jira.
A integração fica **inerte** (no-op) até as variáveis abaixo existirem — nada quebra
sem elas. Depois de conectar, use o comando `/check-bugs` (semanal, manual) para
ranquear os issues abertos por prioridade × custo e escolher o que implementar.

## Passo a passo

1. **Tenha um site Jira Cloud.** Se não tiver, crie grátis em
   <https://www.atlassian.com/software/jira> (plano Free serve). O endereço fica no
   formato `https://SEU-SITE.atlassian.net`.

2. **Crie/escolha um projeto** para o suporte (ex.: "Suporte GovHealth"). Anote a
   **Project Key** (as letras maiúsculas antes do número do card, ex.: `SUP`).

3. **Gere um API token** (não é a senha da conta):
   - Acesse <https://id.atlassian.com/manage-profile/security/api-tokens>
   - **Create API token** → dê um nome (ex.: "GovHealth") → **copie** o token
     (ele só aparece uma vez).

4. **Descubra o tipo de issue** do projeto (normalmente `Task` ou `Bug`). Se não
   souber, deixe em `Task` (padrão) e ajuste depois.

5. **Configure as variáveis** — no `.env.local` (para rodar/local e o `/check-bugs`)
   **e** no painel da Vercel (Project → Settings → Environment Variables, para o app
   em produção espelhar novos relatos):

   ```
   JIRA_BASE_URL    = https://SEU-SITE.atlassian.net
   JIRA_EMAIL       = seu-email-da-conta-atlassian
   JIRA_API_TOKEN   = o-token-gerado-no-passo-3
   JIRA_PROJECT_KEY = SUP
   JIRA_ISSUE_TYPE  = Task        # opcional (padrão: Task)
   ```

6. **Redeploy** para o app em produção carregar as envs:

   ```
   vercel --prod
   ```

## Testar a conexão

```
npm run jira:issues
```

- `"jiraConfigurado": true` e `"source": "jira"` → está lendo do Jira. 🎉
- `"jiraConfigurado": false` → falta alguma env; revise o passo 5.
- Um **novo relato** pelo widget deve criar um card no projeto (com labels
  `govhealth`, `sev-<severidade>`, `<tipo>`). O status muda pelo painel admin
  (`PATCH /api/feedback`), e o Jira recebe um comentário a cada mudança.

## Como funciona o fluxo semanal

1. Você roda `/check-bugs` no Claude Code (quando quiser — nada roda sozinho).
2. Ele lista os issues abertos, estima **prioridade** e **custo de implementação**
   olhando o código, e mostra um ranking (quick wins primeiro).
3. Você escolhe quais devem ser implementados; só então o Claude Code mete a mão.
