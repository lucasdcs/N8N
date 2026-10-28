#!/bin/bash
# planta-loja 0.2.0 — sobe (ou atualiza) o servico na rede Docker do n8n, com o nome "planta-loja" (o WF 01/02 chama http://planta-loja:3100).
# Uso (root, na pasta que tem este arquivo e a pasta dados/):  bash instalar.sh
# Variavel opcional: N8N_CONTAINER (padrao n8n-compose-n8n-1)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
N8N="${N8N_CONTAINER:-n8n-compose-n8n-1}"
VERSAO=0.2.0

[ -f dados/plantas.json ] && [ -d dados/indice ] && [ -d dados/plantas ] || { echo "ERRO: falta dados/plantas.json, dados/indice ou dados/plantas"; exit 1; }
REDE=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$N8N" | head -n1)
[ -n "$REDE" ] || { echo "ERRO: rede do container $N8N nao encontrada (docker ps)"; exit 1; }
if ss -ltn 2>/dev/null | grep -q '127.0.0.1:3100 ' && ! docker ps --format '{{.Names}}' | grep -qx planta-loja; then
  echo "ERRO: porta 127.0.0.1:3100 ja usada por outro processo"; exit 1
fi
echo "rede do n8n: $REDE"

docker build -t "planta-loja:$VERSAO" .
docker rm -f planta-loja >/dev/null 2>&1 || true
docker run -d --name planta-loja --restart unless-stopped \
  --network "$REDE" --network-alias planta-loja \
  -p 127.0.0.1:3100:3100 \
  -v "$PWD/dados:/dados:ro" \
  --memory 1g \
  "planta-loja:$VERSAO"

for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  if R=$(curl -sf http://127.0.0.1:3100/saude); then echo "saude: $R"; exit 0; fi
done
echo "ERRO: servico nao respondeu; veja: docker logs --tail 50 planta-loja"; exit 1
