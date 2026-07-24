# Coletor Licitações-e (Banco do Brasil)

Puxa licitações de **saúde** do portal `licitacoes-e.com.br` (BB) e grava em
`contratacoes` com `fonte='licitacoes-e'`, para aparecerem junto às do PNCP nas telas
(sobretudo em **/oportunidades**), sempre como **"Em aberto"** (não coletamos resultado).

## Por que roda fora da Vercel
O portal do BB tem **Cloudflare + CAPTCHA de imagem** na busca pública e **não tem API
oficial**. Então o coletor usa **navegador real (Playwright)** e resolve o CAPTCHA com
**OCR local grátis** (`tesseract.js` + `jimp`), com retry (errar é grátis — pega outra
imagem e tenta de novo). Uma função serverless não roda navegador, então isto roda no
**PC do dono via Task Scheduler**, igual ao ETL do PNCP.

> ⚠️ Contorna o CAPTCHA do portal do BB via OCR. Uso sob sua responsabilidade
> (ver termos de uso do Licitações-e). Se o BB trocar por reCAPTCHA/hCaptcha, o OCR
> grátis para de funcionar.

## Peças
- `ocr.mjs` — resolve o CAPTCHA (pré-processa + Tesseract, whitelist, 5 chars).
- `collect.mjs` — abre a Pesquisa avançada, resolve o CAPTCHA (retry), submete por
  (UF × situação) e parseia a tabela de resultados.
- `db.mjs` — upsert em `contratacoes` (chave `LICE-<numero>`, `link_externo` = detalhe).
- `run.mjs` — orquestrador: varre UFs × situações, filtra saúde, grava.

## Uso
```
npm run licite:migrate      # 1x: adiciona colunas fonte/link_externo em contratacoes
npm run licite:sync         # coleta e grava (roda periodicamente)
```
Ajuste fino por env:
```
LICITE_UF=SP,MG,RJ          # UFs (default: 27)
LICITE_SITUACOES=2,3,4,5    # publicada, acolhimento, abertura, propostas abertas
LICITE_DELAY=1500           # ms entre buscas
```

## Agendar (Windows Task Scheduler)
Como o ETL do PNCP. Crie uma tarefa diária que rode:
```
node "<caminho-do-projeto>\scripts\licite\run.mjs"
```
com "Iniciar em" = a pasta do projeto (para achar o `.env.local`).

## Limitações da v1
- **Valor e datas** não vêm na listagem pública (só no detalhe) → ficam nulos. Por isso
  o piso de R$10k não é aplicado a estas licitações em `/api/opportunities`.
- Sem itens/equipamentos (não abrimos o detalhe de cada edital).
- Cobertura depende do OCR vencer o CAPTCHA (retry cobre; taxa por tentativa ~40-60%).
