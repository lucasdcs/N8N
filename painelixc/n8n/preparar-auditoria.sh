#!/bin/bash
# =====================================================================
# Plugin Painel IXC (GLPI) — cria/atualiza o workflow "Painel IXC - Auditoria (5 bases)" (id pixcAuditoria01)
#   A cada 10 min: O.S. de Auditoria abertas -> O.S. de Ativação de origem (mesmo atendimento) ->
#   mensagens e anexos dela -> envia ao plugin (ingest.php, tipo "auditorias"). Só LÊ do IXC.
#
# Rodar como root (su -), DEPOIS de atualizar o plugin para 0.5.0 e com o coletor de O.S. já importado
# (o script copia dele o endereço do ingest, as URLs do IXC e as credenciais de cada base).
#   bash /var/www/html/glpi/plugins/painelixc/n8n/preparar-auditoria.sh             # gera e importa (inativo)
#   bash /var/www/html/glpi/plugins/painelixc/n8n/preparar-auditoria.sh --executar  # idem + roda 1x
# Assuntos de Auditoria/Ativação por base: nó "Config" do workflow (editar na tela do n8n).
# Reimportar é seguro (id fixo), mas SOBRESCREVE o nó Config: se mudou assuntos na tela, refaça depois.
# =====================================================================
set -euo pipefail
export PATH="$PATH:/usr/sbin:/sbin"

GLPI_DIR=${GLPI_DIR:-/var/www/html/glpi}
PLUGIN=$GLPI_DIR/plugins/painelixc
COMPOSE_DIR=/root/n8n-compose
CT=n8n-compose-n8n-1
COLETOR=$COMPOSE_DIR/workflows/painelixc/coletor-5-bases.json
SAIDA=$COMPOSE_DIR/workflows/painelixc-auditoria
EXECUTAR=0; [ "${1:-}" = "--executar" ] && EXECUTAR=1

ok(){  echo "  [OK] $*"; }
falha(){ echo "  [ERRO] $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falha "rode como root (su -)"
[ -f "$PLUGIN/n8n/auditoria.json" ] || falha "não achei $PLUGIN/n8n/auditoria.json — o plugin 0.5.0 foi aplicado?"
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
TAB=$(mariadb -N -e "SHOW TABLES LIKE 'glpi_plugin_painelixc_auditorias'" "$DB")
[ -n "$TAB" ] || falha "tabela glpi_plugin_painelixc_auditorias não existe: rode plugin:install --force e plugin:activate (versão atual: $VERSAO)"
TOKEN=$(mariadb -N -e "SELECT value FROM glpi_configs WHERE context='plugin:painelixc' AND name='ingest_token'" "$DB")
[ ${#TOKEN} -ge 20 ] || falha "ingest_token vazio na configuração do plugin"
ok "banco $DB, plugin $VERSAO ativo, tabela de auditorias presente, token lido"

echo "== n8n"
[ "$(curl -s -m 5 http://localhost:2077/healthz)" = '{"status":"ok"}' ] || falha "n8n não respondeu em http://localhost:2077/healthz"
ok "n8n no ar"

echo "== Gerando o workflow a partir do coletor de O.S."
mkdir -p "$SAIDA"
python3 - "$PLUGIN/n8n/auditoria.json" "$COLETOR" "$SAIDA/auditoria.json" "$TOKEN" "${PAINEL_URL:-}" <<'PY'
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
ok "gerado $SAIDA/auditoria.json"

echo "== Importando no n8n"
JA_ATIVO=$(docker exec "$CT" n8n list:workflow --active=true 2>/dev/null | grep -c '^pixcAuditoria01|' || true)
docker exec "$CT" sh -c 'rm -rf /tmp/pixc-aud && mkdir -p /tmp/pixc-aud'
docker cp "$SAIDA/auditoria.json" "$CT":/tmp/pixc-aud/auditoria.json >/dev/null
docker exec "$CT" n8n import:workflow --input=/tmp/pixc-aud/auditoria.json 2>&1 | grep -v -iE 'deprecat|runner' | sed 's/^/  /' || true
docker exec "$CT" sh -c 'rm -rf /tmp/pixc-aud'
N=$(docker exec "$CT" n8n list:workflow 2>/dev/null | grep -cE '^pixcAuditoria01\|' || true)
[ "$N" -eq 1 ] && ok "workflow pixcAuditoria01 importado" || falha "não achei pixcAuditoria01 depois da importação"
if [ "$JA_ATIVO" = "1" ]; then
  docker exec "$CT" n8n publish:workflow --id pixcAuditoria01 >/dev/null 2>&1 || docker exec "$CT" n8n update:workflow --id pixcAuditoria01 --active=true >/dev/null 2>&1 || true
  docker restart "$CT" >/dev/null && sleep 15
  ok "já estava publicado: republicado e n8n reiniciado"
fi

if [ $EXECUTAR -eq 1 ]; then
  echo "== Executando 1x (5 bases; só leitura no IXC)"
  docker exec -e N8N_RUNNERS_BROKER_PORT=5680 "$CT" n8n execute --id pixcAuditoria01 >/dev/null 2>&1 || true
  mariadb -e "SELECT b.codigo base, s.quando, s.ok, s.recebidas auditorias, s.novas, s.sairam, LEFT(s.erro,90) erro_aviso
                FROM glpi_plugin_painelixc_synclogs s JOIN glpi_plugin_painelixc_bases b ON b.id = s.plugin_painelixc_bases_id
               WHERE s.tipo = 'auditorias' AND s.id IN (SELECT MAX(id) FROM glpi_plugin_painelixc_synclogs WHERE tipo='auditorias' GROUP BY plugin_painelixc_bases_id)
               ORDER BY b.ordem" "$DB" | sed 's/^/  /'
  mariadb -e "SELECT b.codigo base, a.ixc_id os_auditoria, a.id_ticket atendimento, a.origem_ixc_id os_ativacao, a.qtd_msgs msgs, a.qtd_arquivos anexos
                FROM glpi_plugin_painelixc_auditorias a JOIN glpi_plugin_painelixc_bases b ON b.id = a.plugin_painelixc_bases_id
               WHERE a.is_active = 1 ORDER BY b.ordem, a.ixc_id LIMIT 30" "$DB" | sed 's/^/  /'
fi

echo
echo "Pronto. Tela no GLPI: Assistência > Painel IXC > botão Auditoria."
echo "No n8n: abra 'Painel IXC - Auditoria (5 bases)', rode pelo 'Manual', confira o nó 'Enviar ao painel' (ok: true nas 5 bases) e clique em Publish."
