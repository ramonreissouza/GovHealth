# Auditoria de usuário automatizada (Playwright)

Executa as 28 tarefas do `roteiro-auditoria-usuario.md`: faz login, percorre cada
tela, captura screenshot de cada passo e gera o relatório **tarefa → resultado → evidência**.

## Como rodar

```bash
# 1) instalar (uma vez)
npm install -D playwright
npx playwright install chromium

# 2) subir a app em outro terminal
npm run dev

# 3) rodar a auditoria
npm run audit
```

### Variáveis de ambiente (opcionais)
| Var | Padrão | O que faz |
|---|---|---|
| `AUDIT_BASE_URL` | `http://localhost:3000` | URL da app (use a de produção p/ auditar o site) |
| `AUDIT_EMAIL` | `demo@govhealth.ai` | e-mail de login |
| `AUDIT_PASSWORD` | `demo123` | senha |
| `AUDIT_HEADED` | `0` | `1` abre o navegador visível (útil p/ depurar) |

> ⚠️ O roteiro pede trocar a senha da conta demo antes de auditar em produção — use
> a nova credencial via `AUDIT_EMAIL`/`AUDIT_PASSWORD`.

## Saída
- `audit/relatorio-auditoria.md` — tabela `# | Tarefa | Resultado | Tempo | Evidência | Observação`
- `audit/relatorio-auditoria.json` — mesmo conteúdo em JSON
- `audit/screenshots/*.png` — evidência de cada passo

## Legenda dos resultados
- **PASSA / FALHA** — critério objetivo verificado automaticamente
- **PARCIAL** — atende em parte
- **MANUAL** — subjetivo/visual: o screenshot foi capturado para julgamento humano
- **INFO** — coleta de dado (ex.: contagem por ano), sem passa/falha
- **ERRO** — a automação falhou naquele passo (evidência do estado de erro)

As tarefas MANUAL existem porque parte do roteiro é subjetiva ("a tela diz o que fazer
agora?", "os números batem?", "é usável no celular?"). Para essas, o script garante a
evidência e registra uma observação objetiva; o julgamento final é humano.
```
