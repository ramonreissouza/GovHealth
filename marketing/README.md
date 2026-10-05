# marketing/

Ferramentas para preparar os posts da GovHealth no Instagram da TecHealth.

**Este repositório é público.** Por isso só as ferramentas são versionadas. O conteúdo estratégico fica fora do git (ver `.gitignore`):

| Versionado | Só no disco (privado) |
|---|---|
| `instagram/PLAYBOOK.md`: regras de formato, visual e conteúdo | `PLANO_COMERCIAL.md`: estratégia, calendário, metas |
| `instagram/render.mjs`: `slides.html` → PNG 1080x1350 | `LGPD_PROSPECCAO.md`: governança de dados para prospecção |
| `instagram/template/`: `slides.css` + fontes locais (OFL) | `instagram/HISTORICO.md` |
| `instagram/exemplos/componentes/slides.html`: exemplo canônico, conteúdo neutro | `instagram/fila/` e `instagram/publicados/`: posts e PNGs |

Renderizar um post (da raiz do repo):

```bash
node marketing/instagram/render.mjs marketing/instagram/exemplos/componentes
```

O render é atômico: se falhar, os PNGs anteriores ficam intactos. Ele também falha se as fontes locais ou alguma imagem não carregarem, ou se um slide não tiver 1080x1350.
