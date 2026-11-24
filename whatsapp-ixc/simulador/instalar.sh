#!/usr/bin/env bash
# Instala/atualiza o simulador do whatsapp-ixc no servidor de TESTE (10.120.100.54). Rodar como root:
#   bash /opt/ixc-simulador/instalar.sh
# Faz: imagem + container ixc-simulador (porta 3999) na rede do n8n de teste, liga o pbot-pg-teste nessa rede,
# aponta o banco de teste para o simulador (banco-sim.sql) e importa no n8n de teste a credencial "Postgres SIMULADOR"
# e os 4 workflows [SIM] (despublicados: publicar na tela do n8n). Pode rodar de novo (atualiza).
# Variáveis opcionais: N8N_CONTAINER=<nome>  PG_CONTAINER=pbot-pg-teste  PORTA=3999  FORCAR=1 (pula a checagem do servidor)
set -euo pipefail
VERSAO=0.1.1
DIR="$(cd "$(dirname "$0")" && pwd)"
PG="${PG_CONTAINER:-pbot-pg-teste}"
PORTA="${PORTA:-3999}"
ok() { echo "  ✔ $*"; }
falha() { echo "  ✘ $*" >&2; exit 1; }

echo "Simulador whatsapp-ixc $VERSAO"
# 1. só no servidor de teste
[ "$(id -u)" = 0 ] || falha "rode como root"
if [ "${FORCAR:-}" != 1 ]; then
  [ "$(hostname)" != glpi ] || falha "este é o servidor de PRODUÇÃO (hostname glpi). O simulador é só para o teste."
  [[ " $(hostname -I) " == *" 10.120.100.54 "* ]] || falha "não é o 10.120.100.54 (servidor de teste). Se tiver certeza: FORCAR=1 bash $0"
fi
command -v docker >/dev/null || falha "docker não encontrado"
docker inspect "$PG" >/dev/null 2>&1 || falha "container $PG (banco de teste) não existe. Ver roteiro-painelbot-0.1.0, A2."
[ "$(docker inspect -f '{{.State.Running}}' "$PG")" = true ] || falha "container $PG está parado: docker start $PG"
ok "servidor de teste, banco $PG rodando"

# 2. n8n de teste e a rede dele
N8N="${N8N_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -E 'n8n' | grep -vE 'postgres|runner|worker|redis|simulador' | sed -n 1p || true)}"
[ -n "$N8N" ] || falha "não achei o container do n8n. Rode: N8N_CONTAINER=<nome> bash $0   (nomes: docker ps --format '{{.Names}}')"
REDE="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$N8N" | awk '{print $1}')"
[ -n "$REDE" ] || falha "não achei a rede do container $N8N"
N8N_PORTA="$(docker exec "$N8N" printenv N8N_PORT 2>/dev/null || true)"; N8N_PORTA="${N8N_PORTA:-5678}"
ok "n8n: $N8N (rede $REDE, porta interna $N8N_PORTA)"
REDES_PG=" $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$PG") "
if [[ "$REDES_PG" != *" $REDE "* ]]; then
  docker network connect "$REDE" "$PG"
fi
ok "$PG ligado na rede $REDE (o n8n enxerga como $PG:5432; a porta 127.0.0.1:5434 do GLPI continua)"

# 3. credenciais do banco de teste (lidas do próprio container; não aparecem na tela)
PGU="$(docker exec "$PG" printenv POSTGRES_USER)"; PGD="$(docker exec "$PG" printenv POSTGRES_DB 2>/dev/null || echo "$PGU")"; PGS="$(docker exec "$PG" printenv POSTGRES_PASSWORD)"
[ -n "$PGU" ] && [ -n "$PGS" ] || falha "não li POSTGRES_USER/POSTGRES_PASSWORD do $PG"
[ -s "$DIR/.senha" ] || { head -c 400 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-12 > "$DIR/.senha"; }
chmod 600 "$DIR/.senha"
umask 077
cat > "$DIR/.env" <<EOF
PGHOST=$PG
PGPORT=5432
PGUSER=$PGU
PGPASSWORD=$PGS
PGDATABASE=$PGD
SIM_SENHA=$(cat "$DIR/.senha")
N8N_URL=http://$N8N:$N8N_PORTA
EOF
umask 022
ok "configuração em $DIR/.env (só root lê)"

# 4. imagem e container
docker build -q -t "ixc-simulador:$VERSAO" "$DIR" >/dev/null
docker rm -f ixc-simulador >/dev/null 2>&1 || true
docker run -d --name ixc-simulador --restart unless-stopped --network "$REDE" -p "$PORTA:3999" \
  -v ixc_simulador_dados:/dados --env-file "$DIR/.env" "ixc-simulador:$VERSAO" >/dev/null
for i in $(seq 1 20); do curl -fs "http://127.0.0.1:$PORTA/saude" >/dev/null 2>&1 && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORTA/saude" >/dev/null || { docker logs --tail 20 ixc-simulador; falha "simulador não respondeu"; }
docker exec "$N8N" node -e "fetch('http://ixc-simulador:3999/saude').then(r=>r.text()).then(t=>{console.log(t);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})" >/dev/null \
  || falha "o n8n não enxerga http://ixc-simulador:3999 (rede $REDE)"
ok "container ixc-simulador no ar (porta $PORTA) e visível pelo n8n"

# 5. banco de teste -> simulador
docker exec -i "$PG" psql -U "$PGU" -d "$PGD" -q -v ON_ERROR_STOP=1 < "$DIR/banco-sim.sql" | sed 's/^/    /'
ok "banco de teste apontado para o simulador"

# 6. n8n de teste: credencial + 4 workflows [SIM]
TMPC="$(mktemp)"; chmod 600 "$TMPC"
PGS_JSON="$(printf '%s' "$PGS" | sed 's/\\/\\\\/g; s/"/\\"/g')"
cat > "$TMPC" <<EOF
[{"id": "SimIxcPostgres01", "name": "Postgres SIMULADOR", "type": "postgres",
  "data": {"host": "$PG", "port": 5432, "database": "$PGD", "user": "$PGU", "password": "$PGS_JSON", "ssl": "disable", "allowUnauthorizedCerts": false, "sshTunnel": false}}]
EOF
docker cp "$TMPC" "$N8N:/tmp/sim-cred.json"; rm -f "$TMPC"
docker exec -u 0 "$N8N" chmod 644 /tmp/sim-cred.json
docker exec -u node "$N8N" n8n import:credentials --input=/tmp/sim-cred.json 2>&1 | grep -viE 'deprecat|^\s*$' | tail -2 | sed 's/^/    /' || true
docker exec -u 0 "$N8N" rm -f /tmp/sim-cred.json
docker exec -u 0 "$N8N" rm -rf /tmp/sim-wf
docker cp "$DIR/n8n" "$N8N:/tmp/sim-wf"
docker exec -u 0 "$N8N" chmod -R a+rX /tmp/sim-wf
docker exec -u node "$N8N" n8n import:workflow --separate --input=/tmp/sim-wf 2>&1 | grep -viE 'deprecat|^\s*$' | tail -3 | sed 's/^/    /' || true
docker exec -u 0 "$N8N" rm -rf /tmp/sim-wf
ok "n8n: credencial 'Postgres SIMULADOR' + 4 workflows [SIM] importados"
PUB=0
for W in SimIxcWf01Avisos SimIxcWf02Lembre SimIxcWf03Comand SimIxcWf04Escala; do
  docker exec -u node "$N8N" n8n publish:workflow --id=$W >/dev/null 2>&1 && PUB=$((PUB+1))
done
[ "$PUB" = 4 ] && ok "4 workflows [SIM] publicados (o n8n aplica em alguns segundos)" || echo "  ! publicar pela tela: $PUB de 4 publicados pelo comando"

IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

PRONTO. Falta só:
  1) No n8n de teste, conferir que os 4 workflows "[SIM] ..." estão publicados (senão: abrir e clicar Publish).
     NÃO publique cópias SEM [SIM] no teste.
  2) Abrir no navegador: http://$IP:$PORTA/   usuário: sim   senha: cat $DIR/.senha
     (não cole a senha no chat)
EOF
