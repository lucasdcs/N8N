#!/usr/bin/env python3
"""Roda as consultas de configuracao dos workflows num banco de teste e grava o JSON que os testes usam (cfgs.json).
Uso: python3 scripts/check/cfgs_do_banco.py <pasta n8n> "<psql ... -d banco>" > cfgs.json
Banco: whatsapp-ixc/banco/01 + 02 + painelbot/sql/01 (dados ficticios). Chave = "<wf>:<no>", valor = o objeto cfg
(nos de config) ou a linha (Carregar Parametros, Carregar Trocas)."""
import json, os, subprocess, sys
NOS = {'01': ['Carregar Config'], '02': ['Carregar Config'], '03': ['IXC Cmd: Carregar', 'Escala: Buscar Dados', 'Carregar Parametros'], '04': ['Carregar Trocas']}
pasta, psql = sys.argv[1], sys.argv[2]
out = {}
for f in sorted(os.listdir(pasta)):
    wf = f.replace('SIM_', '')[:2]
    if wf not in NOS:
        continue
    for n in json.load(open(os.path.join(pasta, f), encoding='utf-8'))['nodes']:
        if n['name'] in NOS[wf]:
            q = n['parameters']['query']
            assert not q.startswith('='), n['name'] + ': consulta com expressao'
            r = subprocess.run(psql + " -X -q -tA -v ON_ERROR_STOP=1", shell=True, input='SELECT row_to_json(x) FROM (' + q.strip().rstrip(';') + ') x', capture_output=True, text=True)
            if r.returncode:
                out[wf + ':' + n['name']] = {'ERRO': r.stderr.strip()}
                continue
            row = json.loads(r.stdout.strip())
            if 'cfg' in row:   # nos que devolvem so a coluna cfg: grava o objeto (formato do teste05..07)
                row = json.loads(row['cfg']) if isinstance(row['cfg'], str) else row['cfg']
            out[wf + ':' + n['name']] = row
print(json.dumps(out, ensure_ascii=False))
