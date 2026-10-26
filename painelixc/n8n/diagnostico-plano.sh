#!/bin/bash
# Painel IXC — por que o "Plano contratado" não aparece? (só leitura; rodar como root)
#   bash /var/www/html/glpi/plugins/painelixc/n8n/diagnostico-plano.sh
CT=n8n-compose-n8n-1
CFG=""; for c in /etc/glpi/config_db.php /var/www/html/glpi/config/config_db.php; do [ -f "$c" ] && { CFG="$c"; break; }; done
DB=$(grep -oP "dbdefault\s*=\s*['\"]\K[^'\"]+" "$CFG" 2>/dev/null)
echo "== 1) workflow pixcAuditoria01 no n8n"
N=$(docker exec "$CT" n8n export:workflow --id=pixcAuditoria01 2>/dev/null | grep -c radgrupos)
if [ "${N:-0}" -gt 0 ]; then echo "  [OK] versão nova (plano pelo login: radusuarios → radgrupos)"; else echo "  [FALTA] versão antiga: rode  bash /var/www/html/glpi/plugins/painelixc/n8n/preparar-auditoria.sh --executar"; fi
docker exec "$CT" n8n list:workflow --active=true 2>/dev/null | grep -q '^pixcAuditoria01|' && echo "  [OK] publicado (roda a cada 10 min)" || echo "  [ATENÇÃO] não está publicado/ativo — publique no n8n (Publish)"
echo "== 2) última coleta de auditorias por base (avisos)"
mariadb -t "$DB" -e "SELECT b.codigo base, s.quando, s.ok, LEFT(COALESCE(s.erro,''),200) aviso FROM glpi_plugin_painelixc_synclogs s
  JOIN glpi_plugin_painelixc_bases b ON b.id = s.plugin_painelixc_bases_id
  WHERE s.id IN (SELECT MAX(id) FROM glpi_plugin_painelixc_synclogs WHERE tipo='auditorias' GROUP BY plugin_painelixc_bases_id) ORDER BY b.ordem"
echo "== 3) plano gravado nas auditorias abertas"
mariadb -t "$DB" -e "SELECT b.codigo base, a.ixc_id os, a.id_cliente cliente, a.ultimo_visto,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.detalhe,'$.plano.nome')),'(sem plano)') plano,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.detalhe,'$.plano.login')),'-') login_usado
  FROM glpi_plugin_painelixc_auditorias a JOIN glpi_plugin_painelixc_bases b ON b.id = a.plugin_painelixc_bases_id
  WHERE a.is_active = 1 ORDER BY b.ordem, a.ixc_id LIMIT 30"
