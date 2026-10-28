#!/bin/bash
# Teste do planta-loja: gera o recorte de uma loja e grava em /root/planta-loja/teste-<empresa>-<cond>-<loja>.png
# Uso: bash testar.sh [EMPRESA] [ID_CONDOMINIO] [LOJA]      (padrao: PONTO 84 102 = Ortobom, Patio Chapeco)
set -euo pipefail
E="${1:-PONTO}"; C="${2:-84}"; L="${3:-102}"
cd "$(dirname "$(readlink -f "$0")")"
OUT="teste-$E-$C-${L// /_}.png"
curl -s -X POST http://127.0.0.1:3100/planta -H 'Content-Type: application/json' \
  -d "{\"empresa\":\"$E\",\"id_condominio\":$C,\"loja\":\"$L\"}" > /tmp/planta-teste.json
python3 - "$OUT" <<'PY'
import base64, json, sys
d = json.load(open('/tmp/planta-teste.json'))
if d.get('ok'):
    open(sys.argv[1], 'wb').write(base64.b64decode(d['imagem']))
    print('OK  shopping=%s piso=%s lojas=%s  ->  %s' % (d.get('shopping'), d.get('piso'), '/'.join(d.get('lojas') or []), sys.argv[1]))
else:
    print('SEM PLANTA:', d.get('motivo'))
PY
