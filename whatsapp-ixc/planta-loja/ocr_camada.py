#!/usr/bin/env python3
"""Planta escaneada (só imagem): grava uma camada de TEXTO INVISÍVEL (OCR tesseract) dentro do PDF em plantas/<chave>/,
pra o indexar.py ler igual às plantas vetoriais. Só entra palavra com confiança >= CONF (padrão 90), pra não ler
número errado (regra do pacote: número errado = sem imagem). O PDF original baixado do Drive não é alterado. (29/09/2026)
uso: ocr_camada.py plantas/4b-275-cidade-lagos/l1.pdf [conf]"""
import csv, io, os, subprocess, sys, tempfile
import pymupdf

LARGURA_OCR = 10000  # px da imagem mandada pro OCR (legenda pequena precisa de ampliação)


def ocr_pagina(pg, conf_min):
    z = LARGURA_OCR / pg.rect.width
    with tempfile.TemporaryDirectory() as tmp:
        img = os.path.join(tmp, 'p.png')
        pg.get_pixmap(matrix=pymupdf.Matrix(z, z), colorspace=pymupdf.csGRAY).save(img)
        tsv = subprocess.run(['tesseract', img, '-', '--psm', '11', '-l', 'por', 'tsv'],
                             capture_output=True, text=True, check=True).stdout
    out = []
    for r in csv.DictReader(io.StringIO(tsv), delimiter='\t', quoting=csv.QUOTE_NONE):
        t = (r.get('text') or '').strip()
        if not t or float(r.get('conf') or -1) < conf_min: continue
        x, y, w, h = (int(r[k]) / z for k in ('left', 'top', 'width', 'height'))
        out.append((t, pymupdf.Rect(x, y, x + w, y + h)))
    return out


def main(caminho, conf_min=90):
    doc = pymupdf.open(caminho)
    if doc.metadata.get('keywords', '').startswith('ocr-camada'):
        print('já tem camada OCR:', caminho); return
    total = 0
    for pg in doc:
        if pg.rotation: pg.remove_rotation()
        palavras = ocr_pagina(pg, conf_min)
        for t, r in palavras:
            fs = max(r.height * 0.9, 1)
            pg.insert_text((r.x0, r.y1 - r.height * 0.15), t, fontsize=fs, render_mode=3)  # 3 = invisível
        total += len(palavras)
    doc.set_metadata(dict(doc.metadata, keywords=f'ocr-camada conf>={conf_min}'))
    tmp = caminho + '.tmp'
    doc.save(tmp, garbage=3, deflate=True); doc.close(); os.replace(tmp, caminho)
    print(f'{caminho}: {total} palavras (conf >= {conf_min}) gravadas como texto invisível')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 90)
