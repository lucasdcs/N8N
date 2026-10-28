#!/usr/bin/env python3
"""Indexa as plantas comerciais atuais de cada shopping (plantas.json) num formato legível por n8n/IA:
  indice/<chave>.json  -> {loja: [{arquivo, piso, pagina, rotulo, nome, contorno, exato}]}
  indice/<chave>.csv   -> loja;piso;nome;rotulo;arquivo;pagina
Número da loja normalizado: sem prefixo (L, LJ, LOJA, LUC, T), sem zero à esquerda, compostos expandidos
(1171/72/73 -> 1171,1172,1173; L001/002 -> 1,2). Quiosque mantém o Q (Q123). Piso-loja 'L0-10' -> '0-10'.
Opções por shopping (plantas.json 'opcoes', vêm do montar_plantas.py):
  min_digitos  (3)     dígitos mínimos de número SEM prefixo
  zeros        (False) aceita número sem prefixo com zero à esquerda ('096')
  sem_area     (False) aceita número sem prefixo mesmo fora de loja pintada e sem 'xx m²' perto
  sem_tabela   (False) descarta tabela/legenda de lojas (coluna de rótulos alinhados)
  so_prefixo   (False) só rótulo com prefixo (L2-13, Q-05, LOJA 123) — plantas lidas por OCR
  circulo      (False) aceita número dentro de um círculo desenhado (Park City: '27' num círculo)
Sempre: número repetido em escalas diferentes (planta + miniatura) fica só o da planta maior (rótulo 1,4x maior);
arquivo do piso 'Quiosques' só indexa quiosque (Q).
(29/09/2026)"""
import json, os, re, csv, sys
import pymupdf

BASE = os.path.dirname(os.path.abspath(__file__))
PLANTAS = os.path.join(BASE, 'plantas')
PREFIXOS = r'(?:LOJAS?|LJ|LUC|L|T)'
RX_PISO_LOJA = re.compile(r'^L(\d)-(\d{1,3}[A-Z]?)$')


def rx_rotulo(op):
    """Q12 | L458, LUC.20/21, T32 | 1132, 1171/72/73 (sem prefixo: regras da opção)."""
    mn = max(1, int(op.get('min_digitos', 3)))
    ini = r'\d' if op.get('zeros') else r'[1-9]'
    semp = ini + r'\d{%d,4}[A-Z]?(?:\s*/\s*L?\d{1,5}[A-Z]?)*' % (mn - 1) if not op.get('so_prefixo') else r'(?!)'  # (?!) = nunca casa
    return re.compile(r'^(?:(Q)[.\-]?\s*(\d{1,4}[A-Z]?)|(' + PREFIXOS + r')\.?\s*(\d{2,5}[A-Z]?(?:\s*[/,]\s*L?\d{1,5}[A-Z]?)*)|(' + semp + r'))$')


def normalizar(num):
    """Número de loja vindo do IXC ou da planta -> chave de busca."""
    s0 = re.sub(r'\s', '', str(num or '')).upper()
    m = RX_PISO_LOJA.match(s0) or re.fullmatch(r'(\d)-(\d{1,3}[A-Z]?)', s0)  # 'L2-13' ou '2-13'
    if m: return m.group(1) + '-' + m.group(2).lstrip('0')
    s = re.sub(r'[.\-]', '', s0)
    s = re.sub(r'(?<=\d)(?:LOJAS?|LJ)$', '', s)  # '800-Lj'
    m = re.fullmatch(r'Q0*(\d+[A-Z]?)', s)
    if m: return 'Q' + m.group(1)
    s = re.sub('^' + PREFIXOS, '', s)
    m = re.fullmatch(r'0*(\d+[A-Z]?)', s)
    return m.group(1) if m else None


def expandir(txt):
    """'1165A/66/67' -> ['1165A','1166','1167']; 'L001/002' -> ['1','2']; 'L4/L5' -> ['4','5']."""
    partes = [p.strip().lstrip('L') for p in re.split(r'[/,]', txt) if p.strip()]
    base = re.match(r'\d+', partes[0]).group(0)
    out = []
    for p in partes:
        d = re.match(r'\d+', p).group(0)
        if len(d) < len(base): p = base[:len(base) - len(d)] + p
        out.append(p)
    return [n for n in (normalizar(x) for x in out) if n]


def rotulos(ws, rx):
    """(texto, Rect) de cada rótulo de loja; junta prefixo solto ('T', '32' / 'L', '14/15') na mesma linha."""
    i = 0
    while i < len(ws):
        w = ws[i]; t = w[4].strip().upper().rstrip(':'); r = pymupdf.Rect(w[:4])
        if RX_PISO_LOJA.match(t):
            yield t, r; i += 1; continue
        prox = pymupdf.Rect(ws[i + 1][:4]) if i + 1 < len(ws) else None
        colado = prox is not None and (ws[i + 1][5:7] == w[5:7] or (abs(prox.y0 - r.y1) < r.height * 0.8 and abs(prox.x0 - r.x0) < r.width * 1.5))
        if re.fullmatch(PREFIXOS + r'\.?|Q', t) and colado:  # 'LOJA' em cima do '14' também vale
            t2 = t + ws[i + 1][4].strip().upper()
            if rx.match(t2):
                yield t2, r | pymupdf.Rect(ws[i + 1][:4]); i += 2; continue
        if rx.match(t) and re.search(r'\d', t):
            yield t, r
        i += 1


def tem_area_perto(areas, r):
    """Loja sem preenchimento: aceita se tem uma área (97,50 m²) a até ~3 alturas do número."""
    h = max(r.height, r.width * 0.3)
    c = (r.tl + r.br) * 0.5
    return any(abs(((a.tl + a.br) * 0.5).x - c.x) < max(r.width, a.width) * 1.5 and 0 < ((a.tl + a.br) * 0.5).y - c.y < h * 3.5
               for a in areas)


def em_tabela(r, todos):
    """Rótulo numa coluna com 6+ rótulos alinhados à esquerda = tabela/legenda, não planta."""
    return sum(1 for o in todos if abs(o.x0 - r.x0) < 1.0 and abs(o.height - r.height) < 0.5) >= 6


def circulos(pg):
    """Caixas quase quadradas de desenhos com curva (círculo em volta do número da loja)."""
    out = []
    for d in pg.get_cdrawings():
        x0, y0, x1, y1 = d['rect']; w, h = x1 - x0, y1 - y0
        if 3 < w < 40 and 0.8 < w / max(h, 0.01) < 1.25 and any(it[0] == 'c' for it in d['items']):
            out.append((x0, y0, x1, y1))
    return out


def dentro_de_circulo(circ, r):
    c = (r.tl + r.br) * 0.5
    return any(x0 <= c.x <= x1 and y0 <= c.y <= y1 and (x1 - x0) < max(r.width, r.height) * 4 for x0, y0, x1, y1 in circ)


def preenchimentos(pg):
    lim = pg.rect.get_area() * 0.05
    return [d['rect'] for d in pg.get_cdrawings() if d.get('fill') and 4 < pymupdf.Rect(d['rect']).get_area() < lim]


def nome_da_loja(words, contorno, rotulo_rect):
    ws = [w for w in words if pymupdf.Rect(w[:4]).intersects(contorno)
          and not pymupdf.Rect(w[:4]).intersects(rotulo_rect)]
    txt = [w[4] for w in ws if not re.search(r'\d', w[4]) and w[4] not in ('m²', '(pl)', '(ct)', '&')]
    return ' '.join(txt)[:60]


def indexar(chave, cfg):
    op = cfg.get('opcoes', {})
    rx = rx_rotulo(op)
    idx = {}
    for arq in cfg['arquivos']:
        caminho = os.path.join(PLANTAS, cfg['pasta'], arq['arquivo'])
        doc = pymupdf.open(caminho)
        for pg in doc:
            if pg.rotation: pg.remove_rotation()  # planta girada: coordenadas de texto/desenho/recorte iguais
            fills = preenchimentos(pg)
            words = pg.get_text('words')
            areas = [pymupdf.Rect(w[:4]) for w in words if re.search(r'm[²2]', w[4]) or re.fullmatch(r'\d+[.,]\d+', w[4])]
            circ = circulos(pg) if op.get('circulo') else []
            achados = list(rotulos(words, rx))
            todos = [r for _, r in achados]
            for txt, r in achados:
                if op.get('sem_tabela') and em_tabela(r, todos):
                    continue
                if arq['piso'] == 'Quiosques' and not re.match(r'Q', txt):
                    continue  # planta de quiosques também desenha as lojas: só Q
                m = rx.match(txt)
                c = (r.tl + r.br) * 0.5
                dentro = [pymupdf.Rect(f) for f in fills if f[0] <= c.x <= f[2] and f[1] <= c.y <= f[3]]
                dentro = [f for f in dentro if f.get_area() > r.get_area() * 2]
                if not dentro and not tem_area_perto(areas, r) and not op.get('sem_area') and not (circ and dentro_de_circulo(circ, r)):
                    continue  # número solto fora de loja e sem "xx m²" colado = cota/medida/vaga
                cont = min(dentro, key=lambda x: x.get_area()) if dentro else None
                if cont is not None and not cont.contains(r):
                    cont = None  # preenchimento menor que o rótulo (loja diagonal/recortada): marca em volta do rótulo
                if RX_PISO_LOJA.match(txt): nums = [normalizar(txt)]
                elif m.group(1): nums = ['Q' + (m.group(2).lstrip('0') or '0')]
                else: nums = expandir(m.group(4) or m.group(5))
                for n in nums:
                    lst = idx.setdefault(n, [])
                    pos = [round(v / 5) for v in (cont or r)]
                    if any(e['arquivo'] == arq['arquivo'] and e['pagina'] == pg.number + 1 and e['_pos'] == pos for e in lst):
                        continue  # texto duplicado no próprio PDF
                    lst.append({'_pos': pos, '_h': round(r.height, 2),
                        'arquivo': arq['arquivo'], 'piso': arq['piso'], 'pagina': pg.number + 1,
                        'rotulo': txt, 'nome': nome_da_loja(words, cont, r) if cont else '',
                        'contorno': [round(v, 1) for v in (cont or r)], 'exato': bool(cont), 'h': round(r.height, 2)})
    for n, lst in idx.items():  # planta + miniatura/legenda: fica o rótulo claramente maior
        if len(lst) > 1:
            mx = max(e['_h'] for e in lst)
            if sum(1 for e in lst if e['_h'] * 1.4 > mx) == 1:
                idx[n] = [e for e in lst if e['_h'] == mx]
    return idx


if __name__ == '__main__':
    conf = json.load(open(os.path.join(BASE, 'plantas.json')))
    os.makedirs(os.path.join(BASE, 'indice'), exist_ok=True)
    so = sys.argv[1:]
    for chave, cfg in conf.items():
        if so and chave not in so: continue
        idx = indexar(chave, cfg)
        for v in idx.values():
            for e in v: e.pop('_pos', None); e.pop('_h', None)  # 'h' (altura do rótulo) fica: server.py usa no zoom
        json.dump({'shopping': cfg['nome'], 'lojas': idx}, open(os.path.join(BASE, 'indice', chave + '.json'), 'w'),
                  ensure_ascii=False, indent=1)
        with open(os.path.join(BASE, 'indice', chave + '.csv'), 'w', newline='') as f:
            w = csv.writer(f, delimiter=';'); w.writerow(['loja', 'piso', 'nome', 'rotulo', 'arquivo', 'pagina', 'repetida'])
            for n in sorted(idx, key=lambda x: (len(x), x)):
                for e in idx[n]: w.writerow([n, e['piso'], e['nome'], e['rotulo'], e['arquivo'], e['pagina'], 'SIM' if len(idx[n]) > 1 else ''])
        unicas = sum(1 for v in idx.values() if len(v) == 1)
        print(f'{chave:24} lojas={len(idx):4} unicas={unicas:4} repetidas={len(idx) - unicas:3}')
