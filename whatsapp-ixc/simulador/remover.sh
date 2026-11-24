#!/usr/bin/env bash
# Remove o simulador do servidor de TESTE e devolve o banco de teste como estava (base_url/auth/waha_url/envio).
#   bash /opt/ixc-simulador/remover.sh
# Os workflows [SIM] no n8n de teste: despublicar e arquivar pela tela (o script não mexe no n8n).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PG="${PG_CONTAINER:-pbot-pg-teste}"
docker rm -f ixc-simulador >/dev/null 2>&1 && echo "  ✔ container ixc-simulador removido" || echo "  - container ixc-simulador não existia"
if docker exec "$PG" psql -U ixc -d ixc -tAc "select to_regclass('ixc.sim_antes') is not null" | grep -q t; then
  docker exec -i "$PG" psql -U ixc -d ixc -q -v ON_ERROR_STOP=1 < "$DIR/banco-desfazer.sql" && echo "  ✔ banco de teste devolvido"
else echo "  - banco de teste já estava sem o simulador"; fi
echo "Conversas e chamados simulados ficam no volume ixc_simulador_dados (apagar: docker volume rm ixc_simulador_dados)."
