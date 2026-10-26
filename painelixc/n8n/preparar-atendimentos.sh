#!/bin/bash
# =====================================================================
# Plugin Painel IXC (GLPI) — cria/atualiza o workflow "Painel IXC - Atendimentos (5 bases)" (id pixcAtendimentos01)
#   A cada 10 min: atendimentos ABERTOS (su_ticket) -> O.S. de cada atendimento + nome do cliente -> ingest (tipo "atendimentos").
#   De hora em hora (min 25): FINALIZADOS (su_status S) com última alteração nos últimos 3 dias.
#   "Manual (carga finalizados 90 dias)": 1ª carga do histórico. Só LÊ do IXC.
#
# Rodar como root (su -), DEPOIS de atualizar o plugin para 0.11.0 e com o coletor de O.S. já importado
# (o script copia dele o endereço do ingest, as URLs do IXC e as credenciais de cada base).
#   bash /var/www/html/glpi/plugins/painelixc/n8n/preparar-atendimentos.sh            # gera e importa (inativo)
#   bash /var/www/html/glpi/plugins/painelixc/n8n/preparar-atendimentos.sh --status   # só mostra a última coleta por base
# Reimportar é seguro (id fixo), mas SOBRESCREVE o nó Config: se mudou algo na tela, refaça depois.
# =====================================================================
set -euo pipefail
export PATH="$PATH:/usr/sbin:/sbin"

GLPI_DIR=${GLPI_DIR:-/var/www/html/glpi}
PLUGIN=$GLPI_DIR/plugins/painelixc
COMPOSE_DIR=/root/n8n-compose
CT=n8n-compose-n8n-1
COLETOR=$COMPOSE_DIR/workflows/painelixc/coletor-5-bases.json
SAIDA=$COMPOSE_DIR/workflows/painelixc-atendimentos
STATUS=0; [ "${1:-}" = "--status" ] && STATUS=1

ok(){  echo "  [OK] $*"; }
falha(){ echo "  [ERRO] $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falha "rode como root (su -)"
[ -f "$PLUGIN/n8n/atendimentos.json" ] || falha "não achei $PLUGIN/n8n/atendimentos.json — o plugin 0.11.0 foi aplicado?"
[ -f "$COLETOR" ] || falha "não achei $COLETOR (coletor de O.S.). Rode antes o preparar-coletores.sh."
command -v docker >/dev/null || falha "docker não encontrado"
command -v mariadb >/dev/null || falha "cliente mariadb não encontrado"

echo "== GLPI"
CFG=""; for c in /etc/glpi/config_db.php "$GLPI_DIR/config/config_db.php"; do [ -f "$c" ] && { CFG="$c"; break; }; done
[ -n "$CFG" ] || falha "não achei config_db.php"
DB=$(grep -oP "dbdefault\s*=\s*['\"]\K[^'\"]+" "$CFG" 2>/dev/null || true)
[ -n "$DB" ] || falha "não achei o nome do banco do GLPI"
ATIVO=$(mariadb -N -e "SELECT state FROM glpi_plugins WHERE directory='painelixc'" "$DB" 2>/dev/null || true)
VERSAO=$(mariadb -N -e "SELECT version FROM glpi_plugins WHERE directory='painelixc'" "$DB" 2>/dev/null || true)
[ "$ATIVO" = "1" ] || falha "plugin painelixc não está ativo (state=${ATIVO:-nenhum})"
TAB=$(mariadb -N -e "SHOW TABLES LIKE 'glpi_plugin_painelixc_atendimentos'" "$DB")
[ -n "$TAB" ] || falha "tabela glpi_plugin_painelixc_atendimentos não existe: rode plugin:install --force e plugin:activate (versão atual: $VERSAO)"

mostrar_status(){
  echo "== Última coleta por base (atendimentos = abertos; atend_fin = finalizados)"
  mariadb -e "SELECT b.codigo base, s.tipo, s.quando, s.ok, s.total_ixc, s.recebidas, s.novas, s.sairam, LEFT(s.erro,100) erro_aviso
                FROM glpi_plugin_painelixc_synclogs s JOIN glpi_plugin_painelixc_bases b ON b.id = s.plugin_painelixc_bases_id
               WHERE s.id IN (SELECT MAX(id) FROM glpi_plugin_painelixc_synclogs WHERE tipo IN ('atendimentos','atend_fin') GROUP BY plugin_painelixc_bases_id, tipo)
               ORDER BY b.ordem, s.tipo" "$DB" | sed 's/^/  /'
  mariadb -e "SELECT b.codigo base, SUM(a.is_active=1) abertos, SUM(a.is_active=0 AND a.status='S') finalizados, SUM(a.qtd_os) os
                FROM glpi_plugin_painelixc_atendimentos a JOIN glpi_plugin_painelixc_bases b ON b.id = a.plugin_painelixc_bases_id
               GROUP BY b.codigo ORDER BY MIN(b.ordem)" "$DB" | sed 's/^/  /'
}
if [ $STATUS -eq 1 ]; then mostrar_status; exit 0; fi
TOKEN=$(mariadb -N -e "SELECT value FROM glpi_configs WHERE context='plugin:painelixc' AND name='ingest_token'" "$DB")
[ ${#TOKEN} -ge 20 ] || falha "ingest_token vazio na configuração do plugin"
ok "banco $DB, plugin $VERSAO ativo, tabela de atendimentos presente, token lido"

echo "== n8n"
[ "$(curl -s -m 5 http://localhost:2077/healthz)" = '{"status":"ok"}' ] || falha "n8n não respondeu em http://localhost:2077/healthz"
ok "n8n no ar"

echo "== Gerando o workflow a partir do coletor de O.S."
mkdir -p "$SAIDA"
python3 - "$PLUGIN/n8n/atendimentos.json" "$COLETOR" "$SAIDA/atendimentos.json" "$TOKEN" "${PAINEL_URL:-}" <<'PY'
import json, re, sys
modelo, coletor, saida, token, painel_env = sys.argv[1:6]
c = json.load(open(coletor, encoding="utf-8"))
cfg = next(n for n in c["nodes"] if n["name"] == "Config")["parameters"]["jsCode"]
painel = painel_env or re.search(r"PAINEL_URL\s*=\s*'([^']+)'", cfg).group(1)
BASES = [("resolutto", "Resolutto", "RESOLUTTO"), ("4btelecom", "4BTELECOM", "4BTELECOM"), ("ponto", "PONTO", "PONTO"),
         ("cacta", "CACTA", "CACTA"), ("buzz", "BUZZ", "BUZZ")]
txt = open(modelo, encoding="utf-8").read().replace("__PAINEL_URL__", painel).replace("__PAINEL_TOKEN__", token)
falta = []
for cod, nome, up in BASES:
    m = re.search(r"codigo:\s*'%s'[^\n]*url:\s*'([^']+)'" % re.escape(cod), cfg)
    url = m.group(1) if m else "https://PREENCHER-URL-IXC-" + up
    if not m or "PREENCHER" in url: falta.append(nome + " (URL)")
    no = next((n for n in c["nodes"] if n["name"] == "IXC " + nome), None)
    cred = (no or {}).get("credentials", {}).get("httpBasicAuth") if no else None
    if not cred: falta.append(nome + " (credencial)"); cred = {"id": "", "name": ""}
    txt = txt.replace("__URL_%s__" % up, url).replace("__CRED_ID_%s__" % up, cred["id"]).replace("__CRED_NOME_%s__" % up, cred["name"])
    print("  %-10s URL: %-40s credencial: %s" % (nome, url, cred["name"] or "NÃO ENCONTRADA"))
w = json.loads(txt)
if any("__" in json.dumps(n.get("credentials", {})) for n in w["nodes"]): sys.exit("  [ERRO] sobrou placeholder de credencial")
json.dump(w, open(saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("  PAINEL_URL: " + painel)
if falta: print("  [ATENCAO] não encontrado: " + ", ".join(falta) + " — ajuste na tela do n8n")
PY
ok "gerado $SAIDA/atendimentos.json"

echo "== Importando no n8n"
JA_ATIVO=$(docker exec "$CT" n8n list:workflow --active=true 2>/dev/null | grep -c '^pixcAtendimentos01|' || true)
docker exec "$CT" sh -c 'rm -rf /tmp/pixc-atd && mkdir -p /tmp/pixc-atd'
docker cp "$SAIDA/atendimentos.json" "$CT":/tmp/pixc-atd/atendimentos.json >/dev/null
docker exec "$CT" n8n import:workflow --input=/tmp/pixc-atd/atendimentos.json 2>&1 | grep -v -iE 'deprecat|runner' | sed 's/^/  /' || true
docker exec "$CT" sh -c 'rm -rf /tmp/pixc-atd'
N=$(docker exec "$CT" n8n list:workflow 2>/dev/null | grep -cE '^pixcAtendimentos01\|' || true)
[ "$N" -eq 1 ] && ok "workflow pixcAtendimentos01 importado" || falha "não achei pixcAtendimentos01 depois da importação"
if [ "$JA_ATIVO" = "1" ]; then
  docker exec "$CT" n8n publish:workflow --id pixcAtendimentos01 >/dev/null 2>&1 || docker exec "$CT" n8n update:workflow --id pixcAtendimentos01 --active=true >/dev/null 2>&1 || true
  docker restart "$CT" >/dev/null && sleep 15
  ok "já estava publicado: republicado e n8n reiniciado"
fi

echo
echo "Pronto. No n8n, abra 'Painel IXC - Atendimentos (5 bases)':"
echo "  1) rode 'Manual (abertos)' e confira o nó 'Enviar ao painel' (ok: true nas 5 bases);"
echo "  2) rode 'Manual (carga finalizados 90 dias)' uma vez (histórico);"
echo "  3) clique em Publish."
echo "Depois: bash $PLUGIN/n8n/preparar-atendimentos.sh --status"
