#!/usr/bin/env python3
"""
Gera a copia PUBLICA (GitHub) da pasta whatsapp-ixc: sem telefones, nomes de funcionarios, JIDs de grupo e segredos.

Uso:  python3 sanitizar_publico.py <sanitizar-workflows.py do repo> <pasta adaptada> <pasta original Exportacao_Automacao_IXC> <pasta saida> [valores.json]

Saida:
  <saida>/whatsapp-ixc/{n8n,banco,fontes}/...   adaptado (WAHA), limpo
  <saida>/whatsapp-ixc/original/...             pacote original do terceiro (Evolution), limpo, so para diff
  <saida>/RELATORIO-SANITIZACAO.txt
"""
import importlib.util
import json
import os
import re
import shutil
import sys
from collections import Counter

# Mapas de JID de grupo -> marcador e nome -> marcador vem do valores.json (chaves "grupos_publicos" e "nomes_publicos")
GRUPOS = {}
NOMES_PARAM = {}


def carregar_sanitizador(caminho):
    spec = importlib.util.spec_from_file_location('san', caminho)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def trocar_grupos(s, cont):
    for jid, marca in GRUPOS.items():
        n = s.count(jid)
        if n:
            cont['grupo_jid'] += n
            s = s.replace(jid, marca)
    return s


def limpar_sql(txt, san, cont):
    txt = trocar_grupos(txt, cont)
    # nomes de pessoas nas tabelas de cadastro -> rotulo com o id
    def tec(m):
        cont['nome_tecnico'] += 1
        return f"{m.group(1)}'Tecnico {m.group(2)}-{m.group(3)}'"
    txt = re.sub(r"(INSERT INTO ixc\.tecnicos \(empresa, id_func, nome, fone, grupo\) VALUES \('([A-Z0-9]+)', '(\d+)', )'[^']*'", tec, txt)
    def func(m):
        cont['nome_funcionario'] += 1
        return f"{m.group(1)}'Funcionario {m.group(2)}-{m.group(3)}'"
    txt = re.sub(r"(INSERT INTO ixc\.funcionarios \(empresa, id_func, nome\) VALUES \('([A-Z0-9]+)', '(\d+)', )'[^']*'", func, txt)
    def cont_setor(m):
        cont['nome_contato_setor'] += 1
        return f"{m.group(1)}'Contato {m.group(2)} {m.group(3)}'"
    txt = re.sub(r"(INSERT INTO ixc\.contatos_setor \([^)]*\) VALUES \(\d+, '([a-z0-9]+)', (\d+), )'[^']*'", cont_setor, txt)
    # escala_base.tecnicos: "Fulano (DD) NNNN-NNNN; Beltrano (DD) NNNN-NNNN" -> "__TECNICOS__"
    def esc(m):
        cont['escala_base_tecnicos'] += 1
        return f"{m.group(1)}'__TECNICOS__'"
    txt = re.sub(r"(INSERT INTO ixc\.escala_base \([^)]*\) VALUES \('[A-Z0-9]+', '\d+', '[a-z0-9]+', )'[^']*'", esc, txt)
    # contatos_setor.obs pode citar pessoas/setores: mantem (texto operacional); nomes em descricao de parametros:
    for nome, marca in NOMES_PARAM.items():
        n = txt.count(nome)
        if n:
            cont['nome_parametro'] += n
            txt = txt.replace(nome, marca)
    # descricao dos feriados e nomes de shopping ficam. Telefones/e-mails/segredos pelo sanitizador do repo:
    return san.limpar_texto(txt, cont)


def limpar_json(caminho_in, caminho_out, san, cont):
    wf = json.load(open(caminho_in, encoding='utf-8'))
    for k in ('pinData', 'staticData', 'shared'):
        wf.pop(k, None)
    wf['active'] = False
    s = json.dumps(wf, ensure_ascii=False)
    s = trocar_grupos(s, cont)
    wf = json.loads(s)
    wf['nodes'] = san.limpar(wf.get('nodes', []), cont)
    with open(caminho_out, 'w', encoding='utf-8') as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
        f.write('\n')


def limpar_texto_arquivo(caminho_in, caminho_out, san, cont):
    s = open(caminho_in, encoding='utf-8', errors='replace').read()
    s = trocar_grupos(s, cont)
    for nome, marca in NOMES_PARAM.items():
        if nome in s:
            cont['nome_parametro'] += s.count(nome)
            s = s.replace(nome, marca)
    s = san.limpar_texto(s, cont)
    os.makedirs(os.path.dirname(caminho_out), exist_ok=True)
    open(caminho_out, 'w', encoding='utf-8').write(s)


def primeiros_nomes(sql):
    nomes = set()
    for m in re.finditer(r"INSERT INTO ixc\.(?:tecnicos|contatos_setor) \([^)]*\) VALUES \((?:\d+, )?'[^']*', (?:'\d+', |\d+, )?'([^']+)'", sql):
        p = m.group(1).split()[0]
        if len(p) >= 4 and p.lower() not in ('contato', 'financeiro', 'rh'):
            nomes.add(p)
    for m in re.finditer(r"VALUES \('(?:supervisor_fone|coordenador_fone|dono_nome)', '[^']*', '([^']*)'", sql):
        for w in re.findall(r"[A-Za-zÀ-ÿ]{4,}", m.group(1)):
            if w[0].isupper() and w.lower() not in ('marcado', 'grupo', 'nome', 'chamado', 'chamados', 'escalonamento', 'responsavel', 'exibido', 'numero', 'onde', 'membro', 'dono'):
                nomes.add(w)
    return nomes


def main():
    global GRUPOS, NOMES_PARAM
    san_path, adaptado, original, saida = sys.argv[1:5]
    val = json.load(open(sys.argv[5] if len(sys.argv) > 5 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'valores.json'), encoding='utf-8'))
    GRUPOS = val.get('grupos_publicos', {})
    NOMES_PARAM = val.get('nomes_publicos', {})
    san = carregar_sanitizador(san_path)
    dst = os.path.join(saida, 'whatsapp-ixc')
    if os.path.exists(dst):
        shutil.rmtree(dst)
    rel = []
    # --- adaptado
    for sub in ('n8n', 'banco', 'fontes'):
        for raiz, _, arqs in os.walk(os.path.join(adaptado, sub)):
            for a in sorted(arqs):
                cont = Counter()
                src = os.path.join(raiz, a)
                out = os.path.join(dst, os.path.relpath(src, adaptado))
                os.makedirs(os.path.dirname(out), exist_ok=True)
                if a.endswith('.json'):
                    limpar_json(src, out, san, cont)
                elif a.endswith('.sql') and sub == 'banco':
                    open(out, 'w', encoding='utf-8').write(limpar_sql(open(src, encoding='utf-8').read(), san, cont))
                else:
                    limpar_texto_arquivo(src, out, san, cont)
                rel.append(f"{os.path.relpath(out, saida)} | " + (', '.join(f'{k}={v}' for k, v in sorted(cont.items())) or 'nada'))
    # --- 2a passada: primeiros nomes dos tecnicos/contatos (da configuracao original) em qualquer arquivo publico -> __NOME__
    nomes = primeiros_nomes(open(os.path.join(original, 'banco', '02_configuracao_atual.sql'), encoding='utf-8').read())
    rx = re.compile(r'\b(' + '|'.join(sorted(map(re.escape, nomes), key=len, reverse=True)) + r')\b', re.I)
    for raiz, _, arqs in os.walk(dst):
        for a in arqs:
            caminho = os.path.join(raiz, a)
            txt = open(caminho, encoding='utf-8').read()
            txt2, n = rx.subn('__NOME__', txt)
            if n:
                open(caminho, 'w', encoding='utf-8').write(txt2)
                rel.append(f"{os.path.relpath(caminho, saida)} | primeiros_nomes={n}")
    with open(os.path.join(saida, 'RELATORIO-SANITIZACAO.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(rel) + '\n')
    print('\n'.join(rel))


if __name__ == '__main__':
    main()
