#!/usr/bin/env python3
"""planta-loja: recorte da planta comercial em volta da loja, marcada em vermelho (29/09/2026).
POST /planta {"empresa": "BUZZ", "id_condominio": 269, "loja": "1132"}
 -> {"ok": true, "imagem": "<png base64>", "piso": "Térreo", "nome": "KIDS PARK", "lojas": ["1132"]}
 -> {"ok": false, "motivo": "..."}   (número não achado / repetido / shopping sem planta = SEM imagem)
Busca SÓ pelo número (índice gerado por indexar.py). GET /saude = status."""
import base64, json, os, re, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from indexar import normalizar, expandir

DADOS = os.environ.get('DADOS', os.path.dirname(os.path.abspath(__file__)))
LOCK = threading.Lock()
CACHE = {}


def carregar():
    conf = json.load(open(os.path.join(DADOS, 'plantas.json')))
    por_local = {}
    for chave, c in conf.items():
        p = os.path.join(DADOS, 'indice', chave + '.json')
        if os.path.exists(p):
            por_local[(c['empresa'], str(c['id_condominio']))] = (chave, c, json.load(open(p))['lojas'])
    return por_local


def numeros(loja):
    s = str(loja or '').strip()
    if re.search(r'\d\s*[/,]\s*\d', s):
        base = re.sub(r'^\D+', '', s)
        try: return expandir(base)
        except Exception: pass
    # IXC com lixo em volta (02/10/2026): '2017201820192020' -> 2017/2018/..., '1056 ps 1' -> 1056, 'S1001' -> 1001.
    # Fallback só aceita 3+ dígitos ('SALA AD 01' NÃO vira loja 1).
    if re.fullmatch(r'\d{8,}', s) and len(s) % 4 == 0:
        return [normalizar(s[i:i + 4]) for i in range(0, len(s), 4)]
    n = normalizar(s)
    if n: return [n]
    m = re.match(r'^\s*(?:QUIOSQU?E?Q?|QUIOS|QQ)\s*[-.]?\s*(\d{1,3}[A-Z]?)\b', s, re.I)  # 'QUIOSQQ10 PISO L1', 'QUIOSQUE 10' -> Q10 (05/10/2026)
    if m: return ['Q' + m.group(1).lstrip('0')]
    for tok in re.split(r'[\s;,]+', s):  # 'Pav L2;L209' -> 'L209' (05/10/2026)
        tok = re.sub(r'^[^\d]+', '', tok)
        n = normalizar(tok) if re.match(r'\d{3}', tok) else None
        if n: return [n]
    return []


def alternativas(n, idx, nome):
    """Número do IXC que não bate direto com o rótulo da planta (05/10/2026):
    quiosque cadastrado só com o número ('Loja 10' do BOBS QUIOSQUE -> Q10) e loja de planta piso-loja ('L209' -> L2-09 = '2-9')."""
    alt = []
    if re.search(r'quiosque', nome or '', re.I) and re.fullmatch(r'\d{1,3}[A-Z]?', n): alt.append('Q' + n)
    if re.fullmatch(r'\d{3}[A-Z]?', n) and any(re.fullmatch(r'\d-\d', k[:3]) for k in idx):
        alt.append(n[0] + '-' + (n[1:].lstrip('0') or '0'))
    return [a for a in alt if a in idx]


def gerar(empresa, id_condominio, loja, nome=''):
    ent = CACHE['idx'].get((str(empresa).upper(), str(id_condominio)))
    if not ent:
        return {'ok': False, 'motivo': 'shopping sem planta indexada'}
    chave, cfg, idx = ent
    nums = numeros(loja)
    if not nums:
        return {'ok': False, 'motivo': f'número de loja inválido: {loja!r}'}
    achados = []
    for n in nums:
        if n not in idx:
            alt = alternativas(n, idx, nome)
            if len(alt) == 1: n = alt[0]
        hits = idx.get(n, [])
        if len(hits) > 1:
            return {'ok': False, 'motivo': f'loja {n} aparece {len(hits)}x na planta'}
        if hits: achados.append((n, hits[0]))
    if not achados:
        return {'ok': False, 'motivo': f'loja {loja} não encontrada na planta'}
    locs = {(e['arquivo'], e['pagina']) for _, e in achados}
    if len(locs) > 1:
        return {'ok': False, 'motivo': 'números da loja em pisos/páginas diferentes'}
    e0 = achados[0][1]
    with LOCK:
        doc = pymupdf.open(os.path.join(DADOS, 'plantas', chave, e0['arquivo']))
        pg = doc[e0['pagina'] - 1]
        if pg.rotation: pg.remove_rotation()  # mesmo sistema de coordenadas do indexar.py
        rects = [pymupdf.Rect(e['contorno']) for _, e in achados]
        exato = all(e['exato'] for _, e in achados)
        loja_r = rects[0]
        for r in rects[1:]: loja_r |= r
        hr = max(e.get('h') or loja_r.height for _, e in achados)  # altura da letra do rótulo
        if not exato:  # sem contorno desenhado: caixa justa em volta do rótulo (número + nome/área logo abaixo)
            loja_r = pymupdf.Rect(loja_r.x0 - hr * 0.8, loja_r.y0 - hr * 1.2, loja_r.x1 + hr * 0.8, loja_r.y1 + hr * 2.5)
        lado = max(loja_r.width, loja_r.height, hr * 4)
        # entorno: ~3 lojas pra cada lado, mas limitado pela letra (planta desenhada pequena não vira mapa ilegível)
        # 05/10/2026: recorte mais aberto, mais lojas em volta pro técnico se localizar
        mx, my = min(max(lado * 5, hr * 60), hr * 110), min(max(lado * 3, hr * 38), hr * 70)
        clip = pymupdf.Rect(loja_r.x0 - mx, loja_r.y0 - my, loja_r.x1 + mx, loja_r.y1 + my) & pg.rect
        pg.draw_rect(loja_r, color=(1, 0, 0), width=max(1.2, lado / 25))
        zoom = min(12, max(1, 2000 / max(clip.width, 1)))
        png = pg.get_pixmap(clip=clip, matrix=pymupdf.Matrix(zoom, zoom)).tobytes('png')
        doc.close()
    return {'ok': True, 'imagem': base64.b64encode(png).decode(), 'piso': e0['piso'], 'nome': e0['nome'],
            'lojas': [n for n, _ in achados], 'contorno_exato': exato, 'shopping': cfg['nome']}


class H(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path == '/saude':
            return self._json(200, {'ok': True, 'shoppings': len(CACHE['idx'])})
        self._json(404, {'ok': False})

    def do_POST(self):
        if self.path == '/recarregar':
            CACHE['idx'] = carregar(); return self._json(200, {'ok': True, 'shoppings': len(CACHE['idx'])})
        if self.path != '/planta':
            return self._json(404, {'ok': False})
        try:
            d = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            self._json(200, gerar(d.get('empresa'), d.get('id_condominio'), d.get('loja'), d.get('nome') or ''))
        except Exception as ex:
            self._json(200, {'ok': False, 'motivo': 'erro: ' + str(ex)[:200]})

    def log_message(self, fmt, *a):
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % a))


if __name__ == '__main__':
    CACHE['idx'] = carregar()
    ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', 3100))), H).serve_forever()
