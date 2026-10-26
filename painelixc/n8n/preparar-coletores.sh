#!/bin/bash
# =====================================================================
# Plugin Painel IXC (GLPI) — cria/atualiza o coletor no n8n da VM de teste
#   1 workflow "Painel IXC - Coletor (5 bases)" (id pixcColetor01):
#     gatilho a cada 5 min = O.S. abertas; gatilho 03:10 = resolvidas dos últimos N dias.
#   Substitui os 10 workflows antigos (pixcColetor*/pixcResolv*), que ficam DESATIVADOS
#   (apague-os na tela do n8n quando quiser — a CLI não apaga).
#
# Rodar como root (su -), DEPOIS de instalar/ativar o plugin no GLPI.
#   bash /var/www/html/glpi/plugins/painelixc/n8n/preparar-coletores.sh             # gera e importa (inativo)
#   bash /var/www/html/glpi/plugins/painelixc/n8n/preparar-coletores.sh --executar  # idem + roda 1x (abertas)
#
# URL do IXC por base: lida dos workflows existentes/backup; para forçar:
#   URL_4BTELECOM=https://ixc.exemplo.com.br bash .../preparar-coletores.sh
# Endereço do ingest: detectado por HTTP nos IPs do host; se o Apache redireciona para HTTPS:
#   PAINEL_URL=https://<host>/plugins/painelixc/front/ingest.php bash .../preparar-coletores.sh
# Token e endereço do ingest: lidos do próprio GLPI (Configurar > Geral > Painel IXC).
# Reimportar é seguro: id fixo, sobrescreve o anterior (mantém publicado se já estava).
# O coletor só LÊ do IXC (ixcsoft: listar).
# =====================================================================
set -euo pipefail
export PATH="$PATH:/usr/sbin:/sbin"

GLPI_DIR=${GLPI_DIR:-/var/www/html/glpi}
PLUGIN=$GLPI_DIR/plugins/painelixc
COMPOSE_DIR=/root/n8n-compose
CT=n8n-compose-n8n-1
SAIDA=$COMPOSE_DIR/workflows/painelixc
EXECUTAR=0; [ "${1:-}" = "--executar" ] && EXECUTAR=1

ok(){  echo "  [OK] $*"; }
aviso(){ echo "  [ATENCAO] $*"; }
falha(){ echo "  [ERRO] $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falha "rode como root (su -)"
[ -f "$PLUGIN/n8n/coletor-unificado.json" ] || falha "não achei $PLUGIN/n8n/coletor-unificado.json — o plugin está em $GLPI_DIR/plugins/painelixc?"
[ -f "$COMPOSE_DIR/docker-compose.yml" ] || falha "não achei $COMPOSE_DIR/docker-compose.yml"
command -v docker >/dev/null || falha "docker não encontrado"
command -v mariadb >/dev/null || falha "cliente mariadb não encontrado"

echo "== GLPI"
CFG=""; for c in /etc/glpi/config_db.php "$GLPI_DIR/config/config_db.php"; do [ -f "$c" ] && { CFG="$c"; break; }; done
[ -n "$CFG" ] || falha "não achei config_db.php (/etc/glpi ou $GLPI_DIR/config)"
DB=$(grep -oP "dbdefault\s*=\s*['\"]\K[^'\"]+" "$CFG" 2>/dev/null || true)
[ -n "$DB" ] || falha "não achei o nome do banco do GLPI em config_db.php"
ATIVO=$(mariadb -N -e "SELECT state FROM glpi_plugins WHERE directory='painelixc'" "$DB" 2>/dev/null || true)
[ "$ATIVO" = "1" ] || falha "plugin painelixc não está ativo no GLPI (state=${ATIVO:-nenhum}). Rode: sudo -u www-data php $GLPI_DIR/bin/console plugin:install painelixc && ... plugin:activate painelixc"
TOKEN=$(mariadb -N -e "SELECT value FROM glpi_configs WHERE context='plugin:painelixc' AND name='ingest_token'" "$DB")
[ ${#TOKEN} -ge 20 ] || falha "ingest_token vazio na configuração do plugin"
DIAS=$(mariadb -N -e "SELECT value FROM glpi_configs WHERE context='plugin:painelixc' AND name='historico_dias'" "$DB"); DIAS=${DIAS:-90}
ok "banco $DB, plugin ativo, token lido, histórico de resolvidas = $DIAS dias"

echo "== n8n"
cd "$COMPOSE_DIR"
RODANDO=$(docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null || echo false)
if [ "$RODANDO" != "true" ]; then
  echo "  n8n parado — conferindo workflows ativos antes de subir..."
  ATIVOS=$(docker compose run --rm --no-deps -T n8n list:workflow --active=true 2>/dev/null | grep '|' | grep -vE '^pixc(Coletor|Resolv|Auditoria|Atendimentos)' || true)
  if [ -n "$ATIVOS" ]; then
    echo "$ATIVOS" | sed 's/^/    /'
    falha "há workflows ATIVOS que não são do painel (acima). Subir agora poderia encaminhar O.S. junto com a produção."
  fi
  docker compose up -d >/dev/null
  echo -n "  aguardando o n8n subir"
  for i in $(seq 1 60); do
    [ "$(curl -s -m 2 http://localhost:2077/healthz)" = '{"status":"ok"}' ] && break
    echo -n "."; sleep 2
  done; echo
fi
[ "$(curl -s -m 5 http://localhost:2077/healthz)" = '{"status":"ok"}' ] || falha "n8n não respondeu em http://localhost:2077/healthz"
ok "n8n no ar"

echo "== Endereço do ingest do plugin visto de dentro do container"
if [ -n "${PAINEL_URL:-}" ]; then
  # informado à mão (ex.: produção com HTTPS / redirecionamento 80->443)
  R=$(docker exec "$CT" node -e "fetch('$PAINEL_URL',{signal:AbortSignal.timeout(6000)}).then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.log('ERRO '+e.message))" 2>/dev/null || true)
  echo "$R" | grep -q 'use POST' && ok "PAINEL_URL (informado) = $PAINEL_URL" || falha "PAINEL_URL informado ($PAINEL_URL) não respondeu como o ingest de dentro do container: ${R:0:200}"
else
PAINEL_URL=""
for H in $(hostname -I) $(docker network inspect n8n-compose_default bridge -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}' 2>/dev/null); do
  for P in /glpi ""; do
    U="http://$H$P/plugins/painelixc/front/ingest.php"
    R=$(docker exec "$CT" node -e "fetch('$U',{signal:AbortSignal.timeout(4000)}).then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.log('ERRO '+e.message))" 2>/dev/null || true)
    if echo "$R" | grep -q 'use POST'; then PAINEL_URL="$U"; break 2; fi
  done
done
[ -n "$PAINEL_URL" ] || falha "o container do n8n não alcança o ingest do plugin por HTTP nos IPs do host (se o Apache redireciona para HTTPS, rode com PAINEL_URL=https://<host>/plugins/painelixc/front/ingest.php)."
ok "PAINEL_URL = $PAINEL_URL"
fi

echo "== Credenciais e URLs do IXC"
TMP=$(mktemp -d /root/pixc-XXXX)
trap 'rm -rf "$TMP"; docker exec "$CT" rm -rf /tmp/pixc-exp /tmp/pixc-imp >/dev/null 2>&1 || true' EXIT
docker exec "$CT" sh -c 'rm -rf /tmp/pixc-exp && mkdir -p /tmp/pixc-exp/wf && n8n export:workflow --all --separate --output=/tmp/pixc-exp/wf/ >/dev/null 2>&1; n8n export:credentials --all --output=/tmp/pixc-exp/cred.json >/dev/null 2>&1; true'
docker cp "$CT":/tmp/pixc-exp/. "$TMP/" >/dev/null
mkdir -p "$SAIDA"

python3 - "$PLUGIN/n8n/coletor-unificado.json" "$TMP" "$SAIDA" "$PAINEL_URL" "$TOKEN" "$DIAS" <<'PY'
import json, os, re, sys, collections, glob, copy
modelo, tmp, saida, painel_url, token, dias = sys.argv[1:7]
BASES = [  # codigo, nome, id da credencial, id coletor abertas, id coletor resolvidas
  ("resolutto", "Resolutto", "ixcApiAutomacao1", "pixcColetorRes01", "pixcResolvRes01"),
  ("4btelecom", "4BTELECOM", "Sar2wecxMvwt297d", "pixcColetor4bt01", "pixcResolv4bt01"),
  ("ponto",     "PONTO",     "SQr92hzbZKnat5kl", "pixcColetorPto01", "pixcResolvPto01"),
  ("cacta",     "CACTA",     "00ORMvXflPQheEJ1", "pixcColetorCct01", "pixcResolvCct01"),
  ("buzz",      "BUZZ",      "CYZcvcYaydyP88Uu", "pixcColetorBuz01", "pixcResolvBuz01"),
]
try:
    creds = json.load(open(os.path.join(tmp, "cred.json")))
except Exception:
    creds = []
cred_por_id = {c["id"]: c for c in creds}
wfs = []
d = os.path.join(tmp, "wf")
arquivos = sorted(glob.glob(os.path.join(d, "*.json"))) if os.path.isdir(d) else []
arquivos += sorted(glob.glob("/root/backup/n8n-teste-*/workflows/*.json"))   # antigos já apagados
for f in arquivos:
    try:
        w = json.load(open(f))
    except Exception:
        continue
    wfs.append(w)

def urls_do_workflow(w):
    txt = json.dumps(w, ensure_ascii=False)
    achadas = re.findall(r"(https?://[A-Za-z0-9.\-]+(?::\d+)?)/webservice", txt)
    for n in w.get("nodes", []):
        for a in ((n.get("parameters") or {}).get("assignments") or {}).get("assignments") or []:
            if re.search(r"url", str(a.get("name", "")), re.I) and not re.search(r"painel", str(a.get("name", "")), re.I):
                m = re.match(r"^=?\s*(https?://[A-Za-z0-9.\-]+(?::\d+)?)", str(a.get("value", "")))
                if m and "PREENCHER" not in m.group(1): achadas.append(m.group(1))
    return achadas

resumo = []
achados = {}
for codigo, nome, cred_id, wf_ab, wf_res in BASES:
    cred = cred_por_id.get(cred_id)
    if not cred:
        cand = [c for c in creds if re.search(r"ixc", c.get("name", ""), re.I) and re.search(re.escape(nome if codigo != "ponto" else "ponto"), c.get("name", ""), re.I)]
        cred = cand[0] if len(cand) == 1 else None
    url = os.environ.get("URL_" + codigo.upper(), "").strip().rstrip("/")
    origem = "variável URL_" + codigo.upper() if url else ""
    if not url:   # coletor único já importado antes: URL está no nó Config (linha "{ codigo: 'x', ..., url: '...' }")
        for w in wfs:
            for n in w.get("nodes", []):
                m = re.search(r"codigo:\s*'%s'[^\n]*url:\s*'(https?://[^']+)'" % re.escape(codigo), str((n.get("parameters") or {}).get("jsCode", "")))
                if m and "PREENCHER" not in m.group(1):
                    url, origem = m.group(1).rstrip("/"), "coletor único existente"
        if url: pass
    if not url and cred:
        cont = collections.Counter()
        for w in wfs:
            usa = any(c.get("id") == cred["id"] for n in w.get("nodes", []) for c in (n.get("credentials") or {}).values())
            if usa:
                cont.update(set(urls_do_workflow(w)))
        if cont:
            url, _ = cont.most_common(1)[0]
            origem = "workflows existentes/backup"
    if not url:
        url = "https://PREENCHER-URL-IXC-" + codigo.upper()
        origem = "NÃO ENCONTRADA"

    achados[codigo] = (cred, url)
    resumo.append((nome, (cred or {}).get("name", "NÃO ENCONTRADA"), url, origem))

# um único workflow: URLs no nó Config, credencial nos nós "IXC <base>" e "IXC <base> (clientes)"
txt = open(modelo, encoding="utf-8").read()
txt = txt.replace("__PAINEL_URL__", painel_url).replace("__PAINEL_TOKEN__", token).replace("__DIAS__", str(int(dias)))
for codigo, nome, *_ in BASES:
    cred, url = achados[codigo]
    txt = txt.replace("__URL_%s__" % codigo.upper(), url)
w = json.loads(txt)
w["id"] = "pixcColetor01"; w["name"] = "Painel IXC - Coletor (5 bases)"; w["active"] = False
for n in w["nodes"]:
    marcas = json.dumps(n.get("credentials") or {})
    for codigo, nome, *_ in BASES:
        if marcas.find("__CRED_ID_%s__" % codigo.upper()) < 0:
            continue
        cred, _ = achados[codigo]
        if cred:
            t = cred.get("type", "httpBasicAuth")
            n["credentials"] = {t: {"id": cred["id"], "name": cred.get("name", "")}}
            n["parameters"]["genericAuthType"] = t
        else:
            n.pop("credentials", None)
        break
for f in glob.glob(os.path.join(saida, "*.json")): os.remove(f)
json.dump(w, open(os.path.join(saida, "coletor-5-bases.json"), "w"), ensure_ascii=False, indent=1)
for nome, c, u, o in resumo:
    print("  %-10s credencial: %-28s URL: %s (%s)" % (nome, c, u, o))
if any(r[1] == "NÃO ENCONTRADA" or r[3] == "NÃO ENCONTRADA" for r in resumo):
    print("  [ATENCAO] item NÃO ENCONTRADO acima: o coletor dessa base vai mostrar erro no painel até você")
    print("            ajustar no n8n (nó Config / credencial) ou rodar de novo com URL_<BASE>=...")
PY

echo "== Desativando os 10 coletores antigos (se existirem)"
ANTIGOS=$(docker exec "$CT" n8n list:workflow 2>/dev/null | grep -oE '^pixc(Coletor|Resolv)[A-Za-z0-9]+' | grep -v '^pixcColetor01$' || true)
for ID in $ANTIGOS; do
  docker exec "$CT" n8n update:workflow --id "$ID" --active=false >/dev/null 2>&1 && echo "  desativado: $ID" || echo "  (não consegui desativar $ID)"
done
[ -n "$ANTIGOS" ] && aviso "os antigos ficaram desativados; apague-os na tela do n8n (selecionar > Delete) quando quiser." || ok "nenhum coletor antigo encontrado"

echo "== Importando o coletor único no n8n"
JA_ATIVO=$(docker exec "$CT" n8n list:workflow --active=true 2>/dev/null | grep -c '^pixcColetor01|' || true)
docker exec "$CT" sh -c 'rm -rf /tmp/pixc-imp && mkdir -p /tmp/pixc-imp'
docker cp "$SAIDA/." "$CT":/tmp/pixc-imp/ >/dev/null
docker exec "$CT" n8n import:workflow --separate --input=/tmp/pixc-imp/ 2>&1 | grep -v -iE 'deprecat|runner' | sed 's/^/  /' || true
docker exec "$CT" n8n list:workflow 2>/dev/null | grep -E '^pixcColetor01' | sed 's/^/  /'
N=$(docker exec "$CT" n8n list:workflow 2>/dev/null | grep -cE '^pixcColetor01\|' || true)
[ "$N" -eq 1 ] && ok "coletor importado (arquivo em $SAIDA/coletor-5-bases.json)" || falha "não achei pixcColetor01 depois da importação"
if [ "$JA_ATIVO" = "1" ]; then
  docker exec "$CT" n8n publish:workflow --id pixcColetor01 >/dev/null 2>&1 || docker exec "$CT" n8n update:workflow --id pixcColetor01 --active=true >/dev/null 2>&1 || true
  docker restart "$CT" >/dev/null && sleep 15
  ok "já estava publicado: republicado e n8n reiniciado para recarregar os gatilhos"
fi

if [ $EXECUTAR -eq 1 ]; then
  echo "== Executando o coletor 1x (abertas, 5 bases; só leitura no IXC)"
  R=$(docker exec -e N8N_RUNNERS_BROKER_PORT=5680 "$CT" n8n execute --id pixcColetor01 2>&1 || true)
  echo "$R" | tr -d '\n' | grep -oE '"(base|recebidas|erro|registrado_erro)": ?("[^"]{0,120}"|[0-9]+|true|false)' | paste -sd' ' | sed 's/"base"/\n  base/g' | sed '/^$/d'
  mariadb -e "SELECT codigo, ultima_sync, ultimo_recebido, LEFT(ultimo_erro,80) erro FROM glpi_plugin_painelixc_bases ORDER BY ordem" "$DB" | sed 's/^/  /'
fi

echo
echo "Pronto. Painel no GLPI: Assistência > Painel IXC."
echo "No n8n (http://$(hostname -I | awk '{print $1}'):2077/): abra 'Painel IXC - Coletor (5 bases)', rode pelo 'Manual (abertas)',"
echo "confira o nó 'Enviar ao painel' (ok: true por base) e clique em Publish. 5 min = abertas; 03:10 = resolvidas."
