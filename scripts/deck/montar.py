# -*- coding: utf-8 -*-
"""Apresentacao comercial GovHealth AI — 5 slides, .pptx editavel.

    npm run deck:numeros     # mede no banco (opcional; ha um numeros.json commitado)
    npm run deck             # gera scripts/deck/out/GovHealth AI - Apresentacao Comercial.pptx

Precisa de: pip install python-pptx pillow

IDENTIDADE
Todas as cores saem de public/logo-govhealth.png, amostradas por pixel — navy do
"Gov", azul do simbolo, teal do "Health". Os dois ultimos NAO passam contraste
sobre fundo claro no valor puro do arquivo, entao entram escurecidos (ver a tabela
em PALETA). O oxblood aparece so onde se fala de perda: e sinal semantico.

TIPOGRAFIA
Familia Segoe UI (Light / Regular / Semibold). A landing usa Syne + DM Sans, que
NAO vem instaladas no Windows: num .pptx a fonte tem de existir na maquina de quem
abre, senao o PowerPoint substitui e o layout quebra no notebook do cliente. Para
usar a tipografia exata da landing, instale as duas fontes em todas as maquinas
que vao abrir o arquivo e troque LIGHT/REG/SEMI abaixo.

IMAGENS
Os recortes sao DERIVADOS de public/shots/*.png na hora (nada de binario extra no
repo). Cada recorte tira a barra lateral do app, que rouba um terco da largura sem
informar nada. O recorte do mapa e do Painel de Precos tem a MESMA proporcao de
proposito: as duas pranchas do slide 4 precisam terminar na mesma altura.

RESSALVA HONESTA
Os contadores DENTRO dos prints sao da data da captura. Por isso nenhum numero da
plataforma fica colado numa imagem: os numeros vivem no texto, e as legendas dizem
"tela de producao". Recapturou os prints? Rode de novo, sai tudo casado.

POSICOES
Em polegadas, conferidas exportando os slides em PNG pelo PowerPoint. Tres
colisoes foram encontradas assim, e nao por leitura do codigo: titulo de duas
linhas caindo sobre a linha de apoio (slides 2 e 5) e a prancha de precos passando
por cima da grade de numeros (slide 4). Mexeu em tamanho de fonte ou em largura de
caixa? Exporte e olhe.
"""
import json
import os
import sys

from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..'))
SHOTS = os.path.join(RAIZ, 'public', 'shots')
OUT = os.path.join(AQUI, 'out')
os.makedirs(OUT, exist_ok=True)
ALVO = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT, 'GovHealth AI - Apresentacao Comercial.pptx')

# ── numeros ──────────────────────────────────────────────────────────────────
with open(os.path.join(AQUI, 'numeros.json'), encoding='utf-8') as f:
    N = json.load(f)


def mil(v):
    return f'{v:,}'.replace(',', '.')


# ── recortes derivados de public/ ────────────────────────────────────────────
# Coordenadas em pixels do print original (2880x1800 = 1440x900 em 2x).
# left=447 corta a barra lateral do app; 432 no mapa porque ali o conteudo
# comeca um pouco antes.
RECORTES = {
    'dashboard': ('dashboard.png', (447, 0, 447 + 2433, 1800)),
    'mapa': ('mapa.png', (432, 0, 432 + 2448, 1450)),
    'precos': ('precos.png', (447, 150, 447 + 2433, 150 + 1441)),  # mesma proporcao do mapa
}


def recorte(nome):
    origem, caixa = RECORTES[nome]
    destino = os.path.join(OUT, f'recorte-{nome}.png')
    with Image.open(os.path.join(SHOTS, origem)) as im:
        im.crop(caixa).save(destino, optimize=True)
    return destino


def logo_sem_fundo():
    """O PNG oficial tem fundo BRANCO. Sobre o navy da capa isso seria um
    retangulo branco; aqui o branco vira transparente e a logo pousa num cartao."""
    destino = os.path.join(OUT, 'logo-alpha.png')
    with Image.open(os.path.join(RAIZ, 'public', 'logo-govhealth.png')).convert('RGBA') as im:
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if r > 238 and g > 238 and b > 238:
                    px[x, y] = (r, g, b, 0)
        im.save(destino)
    return destino


IMG_DASH, IMG_MAPA, IMG_PRECOS = recorte('dashboard'), recorte('mapa'), recorte('precos')
IMG_LOGO = logo_sem_fundo()

# ── PALETA ───────────────────────────────────────────────────────────────────
# contraste sobre o papel #F2F5F7:  navy 11:1 · azul 4,9:1 · teal 4,8:1 · ink 15:1
NAVY = RGBColor(0x04, 0x2C, 0x64)        # "Gov" da logo, direto do arquivo
AZUL = RGBColor(0x0B, 0x63, 0xB8)        # simbolo #0C6CC8 escurecido (4,33 -> 4,94:1)
TEAL = RGBColor(0x00, 0x72, 0x6F)        # "Health" #00ACA8 escurecido (2,32 -> 4,79:1)
TEAL_CLARO = RGBColor(0x00, 0xAC, 0xA8)  # teal puro do arquivo: só sobre o navy
PAPEL = RGBColor(0xF2, 0xF5, 0xF7)
BRANCO = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x0D, 0x1A, 0x24)
MUT = RGBColor(0x4A, 0x5A, 0x66)
FRACO = RGBColor(0x7A, 0x8A, 0x96)
FIO_COR = RGBColor(0xD5, 0xDD, 0xE4)
OX = RGBColor(0x8D, 0x2D, 0x26)          # perda, e mais nada
FIO_NAVY = RGBColor(0x1C, 0x44, 0x7A)
CLARO_1 = RGBColor(0xC8, 0xD4, 0xDE)
CLARO_2 = RGBColor(0x9F, 0xB4, 0xC6)
CLARO_3 = RGBColor(0xB9, 0xC9, 0xD8)

LIGHT, REG, SEMI = 'Segoe UI Light', 'Segoe UI', 'Segoe UI Semibold'
L, R = 0.72, 12.61          # margens em polegadas
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)


def slide(fundo=PAPEL):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    r.fill.solid(); r.fill.fore_color.rgb = fundo
    r.line.fill.background(); r.shadow.inherit = False
    return s


def texto(s, x, y, w, h, linhas, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    """linhas = [(texto, fonte, pt, cor, bold, line_spacing, tracking_pt, space_after)]"""
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, cfg in enumerate(linhas):
        t, fonte, tam, cor, bold, ls, tr, sd = (list(cfg) + [None] * 8)[:8]
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if ls: p.line_spacing = ls
        if sd: p.space_after = Pt(sd)
        run = p.add_run(); run.text = t
        f = run.font
        f.name, f.size, f.bold = fonte, Pt(tam), bool(bold)
        f.color.rgb = cor
        if tr:  # tracking nao e' exposto pelo python-pptx: vai no XML, em centesimos de ponto
            f._rPr.set('spc', str(int(tr * 100)))
    return tb


def fio(s, x, y, w, cor=FIO_COR, esp=1.25):
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Pt(esp))
    r.fill.solid(); r.fill.fore_color.rgb = cor
    r.line.fill.background(); r.shadow.inherit = False
    return r


def olho(s, x, y, rotulo, cor=TEAL, w=6.0):
    """Sobrancelha: fio curto + rotulo em caixa alta espacada."""
    fio(s, x, y, 0.42, cor, 2.0)
    texto(s, x + 0.58, y - 0.075, w, 0.3,
          [(rotulo.upper(), SEMI, 10.5, cor, False, None, 1.7, None)])


def prancha(s, x, y, w, img, legenda=None):
    """Print do produto num cartao branco com fio, como figura de documento."""
    with Image.open(img) as im:
        prop = im.height / im.width
    pad = 0.085
    hi = w * prop
    cartao = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y),
                                Inches(w + pad * 2), Inches(hi + pad * 2))
    cartao.adjustments[0] = 0.035
    cartao.fill.solid(); cartao.fill.fore_color.rgb = BRANCO
    cartao.line.color.rgb = FIO_COR; cartao.line.width = Pt(0.75)
    cartao.shadow.inherit = False
    s.shapes.add_picture(img, Inches(x + pad), Inches(y + pad), Inches(w))
    fim = y + hi + pad * 2
    if legenda:
        texto(s, x, fim + 0.1, w + pad * 2, 0.4,
              [(legenda, REG, 10, FRACO, False, 1.15, None, None)])
    return fim


# ═══════════════════════════════════════════════════════════════════════════════
# 1 · CAPA
# ═══════════════════════════════════════════════════════════════════════════════
s1 = slide(NAVY)
plate = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(L), Inches(0.62), Inches(2.62), Inches(0.86))
plate.adjustments[0] = 0.12
plate.fill.solid(); plate.fill.fore_color.rgb = BRANCO
plate.line.fill.background(); plate.shadow.inherit = False
s1.shapes.add_picture(IMG_LOGO, Inches(L + 0.26), Inches(0.79), Inches(2.1))

# Tres verbos = as tres formas de perder dinheiro. O terceiro no teal do "Health"
# porque e' a unica das tres que ninguem mais promete.
texto(s1, L, 2.06, 9.4, 2.9, [
    ('Ache a licitação.', LIGHT, 46, BRANCO, False, 0.98, None, 2),
    ('Ganhe a disputa.', LIGHT, 46, BRANCO, False, 0.98, None, 2),
    ('Receba o pagamento.', LIGHT, 46, TEAL_CLARO, False, 0.98, None, None),
])
fio(s1, L, 5.18, 3.3, TEAL_CLARO, 2.0)
texto(s1, L, 5.44, 7.4, 0.9, [
    ('Inteligência comercial de licitações de saúde pública. Onde disputar, o que já foi pago, '
     'e se o município tem como pagar — antes do seu lance.', REG, 14, CLARO_1, False, 1.35, None, None)])

fio(s1, L, 6.42, R - L, FIO_NAVY, 1.0)
CAPA_NUMS = [
    (mil(N['abertasAno']), f"licitações de saúde\nabertas em {N['ano']}"),
    (mil(N['total']), 'contratações classificadas\nem 14 categorias'),
    (mil(N['munis']), f"municípios em\n{N['ufs']} estados"),
    (str(N['portais']), 'portais de disputa\nreunidos'),
]
for i, (v, rot) in enumerate(CAPA_NUMS):
    x = L + i * 2.98
    texto(s1, x, 6.58, 2.7, 0.4, [(v, LIGHT, 23, BRANCO, False, 0.95, None, None)])
    texto(s1, x, 6.94, 2.7, 0.5, [(rot, REG, 8.5, CLARO_2, False, 1.18, None, None)])

texto(s1, 8.9, 0.78, 3.71, 0.6,
      [('gov-health.vercel.app', REG, 11, CLARO_1, False, 1.2, None, None),
       ('contato@techealth.com.br', REG, 11, CLARO_2, False, 1.2, None, None)], align=PP_ALIGN.RIGHT)

# ═══════════════════════════════════════════════════════════════════════════════
# 2 · O PROBLEMA
# ═══════════════════════════════════════════════════════════════════════════════
s2 = slide()
olho(s2, L, 0.78, 'o problema')
texto(s2, L, 1.08, R - L, 0.7, [
    ('Três formas de perder dinheiro vendendo para a saúde pública', LIGHT, 29, INK, False, 1.02, None, None)])
texto(s2, L, 1.74, 9.8, 0.5, [
    ('As ferramentas do mercado resolvem a primeira. As outras duas são onde o dinheiro escapa '
     'de verdade — e é onde ninguém mais chega.', REG, 13, MUT, False, 1.3, None, None)])

COLS = [
    ('01', 'Não achar', 'O edital sai em um portal que você não acompanha, na semana em que ninguém olhou. '
     'Perde-se antes de começar.', False),
    ('02', 'Achar e perder no detalhe', 'O pregoeiro pede documento no chat da sessão, com prazo em horas. '
     'Quem não está com a tela aberta é desclassificado por procedimento.', True),
    ('03', 'Ganhar e não receber', 'Município sem caixa transforma a venda em processo: '
     'o empenho não sai, e o estoque já saiu.', True),
]
for i, (n, tit, corpo, alarme) in enumerate(COLS):
    x = L + i * 4.03
    cor = OX if alarme else FRACO
    fio(s2, x, 2.44, 3.62, cor, 2.5)
    texto(s2, x, 2.62, 3.6, 0.3, [(n, SEMI, 10.5, cor, False, None, 1.7, None)])
    texto(s2, x, 2.96, 3.6, 0.6, [(tit, REG, 17.5, INK, True, 1.1, None, None)])
    texto(s2, x, 3.58, 3.6, 1.2, [(corpo, REG, 11.5, MUT, False, 1.35, None, None)])

faixa = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(L), Inches(5.16), Inches(R - L), Inches(1.54))
faixa.adjustments[0] = 0.06
faixa.fill.solid(); faixa.fill.fore_color.rgb = BRANCO
faixa.line.color.rgb = FIO_COR; faixa.line.width = Pt(0.75); faixa.shadow.inherit = False
texto(s2, L + 0.42, 5.44, 5.1, 1.1, [
    ('“O pregoeiro pediu documento no chat. Ninguém viu.”', REG, 14, INK, True, 1.2, None, 6),
    ('Convocação, diligência e proposta ajustada têm prazo contado em horas — inclusive nos portais '
     'municipais, onde não existe app nem notificação.', REG, 10.5, MUT, False, 1.3, None, None)])
fio(s2, 6.72, 5.44, 0.012, FIO_COR, 66)
texto(s2, 7.1, 5.44, 5.1, 1.1, [
    ('“Ganhamos, entregamos, e o empenho não saiu.”', REG, 14, INK, True, 1.2, None, 6),
    (f"Dos {mil(N['capag'])} municípios com nota de capacidade de pagamento do Tesouro Nacional, "
     f"{mil(N['capagFraca'])} têm nota C ou D — capacidade fraca.", REG, 10.5, MUT, False, 1.3, None, None)])
texto(s2, L, 6.94, R - L, 0.3, [
    ('A GovHealth cobre as três: onde disputar, o chat sob vigília e a capacidade de pagamento antes do lance.',
     SEMI, 11, NAVY, False, 1.2, None, None)])

# ═══════════════════════════════════════════════════════════════════════════════
# 3 · A PLATAFORMA
# ═══════════════════════════════════════════════════════════════════════════════
s3 = slide()
olho(s3, L, 0.78, 'a plataforma')
texto(s3, L, 1.06, 6.0, 1.4, [
    ('Descubra, dispute\ne receba — no\nmesmo lugar', LIGHT, 31, INK, False, 1.04, None, None)])

ATOS = [
    ('Descubra', 'Emendas, convênios e editais abertos de todo o Brasil, em 14 categorias de saúde, '
     'filtrados pelo que a sua empresa vende.',
     f"{mil(N['emendas'])} emendas de saúde de {N['ano']} na base"),
    ('Dispute', 'O portal certo da sessão, o preço que o governo já pagou pelo mesmo item (CATMAT) '
     'e o chat do pregão sob vigília, com alerta por e-mail.',
     f"{N['portais']} portais · alerta por e-mail"),
    ('Receba', 'Nota CAPAG do Tesouro na própria licitação e o histórico de quem vence — inclusive '
     'quando o contrato do concorrente vence.',
     f"{mil(N['fornecedores'])} fornecedores rastreados"),
]
y = 2.82
for i, (tit, corpo, metrica) in enumerate(ATOS):
    fio(s3, L, y, 5.42, NAVY if i == 0 else FIO_COR, 2.0 if i == 0 else 1.0)
    texto(s3, L, y + 0.14, 5.4, 0.32, [(tit.upper(), SEMI, 10.5, TEAL, False, None, 1.7, None)])
    texto(s3, L, y + 0.46, 5.4, 0.66, [(corpo, REG, 11.5, MUT, False, 1.33, None, None)])
    texto(s3, L, y + 1.08, 5.4, 0.3, [(metrica, SEMI, 10.5, AZUL, False, 1.2, None, None)])
    y += 1.48

prancha(s3, 6.62, 1.32, 5.9, IMG_DASH,
        'Priorização por score dentro do portfólio de produtos da empresa · tela de produção')

# ═══════════════════════════════════════════════════════════════════════════════
# 4 · PROVA E PROCEDENCIA
# ═══════════════════════════════════════════════════════════════════════════════
s4 = slide()
olho(s4, L, 0.78, 'prova e procedência')
texto(s4, L, 1.06, R - L, 0.6, [
    ('Todo número desta apresentação sai de fonte oficial', LIGHT, 29, INK, False, 1.04, None, None)])
texto(s4, L, 1.62, 7.6, 0.4, [(f"R$ {str(N['valorBi']).replace('.', ',')} bi", SEMI, 15, AZUL, False, 1.2, None, None)])
texto(s4, L + 1.42, 1.65, 6.4, 0.4, [
    ('em licitações de saúde mapeadas — valor estimado informado pelos próprios órgãos.',
     REG, 12, MUT, False, 1.2, None, None)])
texto(s4, 8.6, 1.6, 4.01, 0.6,
      [('Nenhum dado privado. Metodologia de score pública.', REG, 10.5, FRACO, False, 1.25, None, None),
       (f"Base atualizada em {N['atualizado']}.", REG, 10.5, FRACO, False, 1.25, None, None)], align=PP_ALIGN.RIGHT)

prancha(s4, L, 2.24, 5.68, IMG_MAPA,
        f"Mapa de calor: onde a sua categoria está sendo comprada esta semana · "
        f"{mil(N['munis'])} municípios em {N['ufs']} estados")
prancha(s4, 6.76, 2.24, 5.68, IMG_PRECOS,
        'Preço já praticado no mesmo item — fornecedor, órgão, UF, data e código CATMAT')

fio(s4, L, 6.62, R - L)
for i, (f, oq) in enumerate([('PNCP', 'contratações e editais'), ('Compras.gov', 'preço já praticado'),
                             ('Tesouro Nacional', 'capacidade de pagamento'),
                             ('TransfereGov', 'emendas e convênios')]):
    x = L + i * 2.98
    texto(s4, x, 6.80, 2.8, 0.3, [(f, SEMI, 11.5, NAVY, False, 1.15, None, None)])
    texto(s4, x, 7.05, 2.8, 0.3, [(oq, REG, 10, FRACO, False, 1.15, None, None)])

# ═══════════════════════════════════════════════════════════════════════════════
# 5 · PLANOS E PROXIMO PASSO
# ═══════════════════════════════════════════════════════════════════════════════
s5 = slide()
olho(s5, L, 0.78, 'planos')
texto(s5, L, 1.06, R - L, 0.6, [
    ('Uma assinatura no lugar de duas ou três ferramentas', LIGHT, 29, INK, False, 1.04, None, None)])
texto(s5, L, 1.66, 10.6, 0.4, [
    ('Mensal, sem fidelidade. Três dias grátis para testar, sem cartão. Nota fiscal em todos os planos.',
     REG, 12.5, MUT, False, 1.3, None, None)])

# Precos e features espelham src/lib/planos.ts. Mexeu lá, mexa aqui.
PLANOS = [
    ('Essencial', 'R$ 990', '/mês', ['Oportunidades do PNCP em tempo real', 'Vencedores e fornecedores',
                                     'Radar de Verba (emendas)', 'Preços de referência (Compras.gov)',
                                     'Exportação Excel / CSV / PDF', '1 usuário · cobertura nacional'], False),
    ('Pro', 'R$ 1.990', '/mês', ['Tudo do Essencial', 'Concorrentes por UF e breakdown de preços',
                                 'Mapa de inteligência e Meu Território', 'Agenda de prazos e dossiês de edital',
                                 'Pipeline CRM e matching CATMAT', '1 usuário · suporte prioritário'], True),
    ('Empresa', 'Sob consulta', '', ['Tudo do Pro', 'Radar de Chat (exclusivo)',
                                     'Equipe: vários usuários e assentos', 'Gestão de acessos por CNPJ',
                                     'Onboarding e suporte dedicados', 'Preço conforme o nº de assentos'], False),
]
for i, (nome, preco, ciclo, itens, destaque) in enumerate(PLANOS):
    x = L + i * 4.03
    card = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(2.24), Inches(3.66), Inches(3.5))
    card.adjustments[0] = 0.05
    card.fill.solid(); card.fill.fore_color.rgb = NAVY if destaque else BRANCO
    card.line.color.rgb = NAVY if destaque else FIO_COR
    card.line.width = Pt(1.0); card.shadow.inherit = False
    ct = BRANCO if destaque else INK
    cm = CLARO_3 if destaque else MUT
    ca = TEAL_CLARO if destaque else AZUL
    texto(s5, x + 0.34, 2.50, 3.0, 0.4, [(nome, REG, 19, ct, True, 1.1, None, None)])
    if destaque:
        texto(s5, x + 0.34, 2.55, 2.98, 0.3,
              [('MAIS COMPLETO', SEMI, 8.5, TEAL_CLARO, False, None, 1.4, None)], align=PP_ALIGN.RIGHT)
    texto(s5, x + 0.34, 2.96, 3.0, 0.5, [(preco + ciclo, LIGHT, 26, ca, False, 1.0, None, None)])
    texto(s5, x + 0.34, 3.64, 3.0, 2.0,
          [(('· ' + it), REG, 10.5, cm, False, 1.25, None, 5) for it in itens])

faixa = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(L), Inches(6.08), Inches(R - L), Inches(0.92))
faixa.adjustments[0] = 0.12
faixa.fill.solid(); faixa.fill.fore_color.rgb = NAVY
faixa.line.fill.background(); faixa.shadow.inherit = False
texto(s5, L + 0.42, 6.34, 7.6, 0.45, [
    ('Próximo passo: três dias de teste na sua categoria, com os seus estados.',
     REG, 14, BRANCO, False, 1.2, None, None)])
texto(s5, 8.4, 6.26, 3.79, 0.6,
      [('gov-health.vercel.app', REG, 12, TEAL_CLARO, False, 1.2, None, None),
       ('contato@techealth.com.br', REG, 11, CLARO_3, False, 1.2, None, None)], align=PP_ALIGN.RIGHT)

prs.save(ALVO)
print('gravado:', ALVO)
print(f"numeros de {N['medidoEm']} — abertas em {N['ano']}: {mil(N['abertasAno'])}"
      f" · base: {mil(N['total'])} · portais: {N['portais']}")
