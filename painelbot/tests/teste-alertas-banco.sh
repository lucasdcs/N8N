#!/bin/bash
# 0.5.2 (F2a): tabelas ixc.alertas / ixc.alertas_sombra do sql/01 + permissões do sql/02.
# Recria o banco de teste (reset-banco.sh) e confere: linhas padrão, permissões do painel_glpi, restrições e
# que rodar o sql/01 de novo não desfaz o que foi editado. Uso: tests/teste-alertas-banco.sh  (PGH/PGP como no LEIA-ME)
set -u
D="$(cd "$(dirname "$0")" && pwd)"; PBOT="$(cd "$D/.." && pwd)"
PGH="${PGH:-/tmp/pg}"; PGP="${PGP:-5499}"
"$D/reset-banco.sh" "$PBOT" || { echo "FALHOU reset-banco"; exit 1; }
DONO="psql -h $PGH -p $PGP -U ixc -d ixc -qAt -v ON_ERROR_STOP=1"
PAINEL="env PGPASSWORD=teste psql -h $PGH -p $PGP -U painel_glpi -d ixc -qAt -v ON_ERROR_STOP=1"
ok=0; ruim=0
igual() { if [ "$2" = "$3" ]; then ok=$((ok+1)); else ruim=$((ruim+1)); echo "FALHOU: $1 — esperado [$3], veio [$2]"; fi; }
falha() { if $2 -c "$3" >/dev/null 2>&1; then ruim=$((ruim+1)); echo "FALHOU: $1 — deveria recusar"; else ok=$((ok+1)); fi; }

# 1. linhas padrão
igual "9 alertas padrão" "$($DONO -c "SELECT count(*) FROM ixc.alertas WHERE padrao")" "9"
igual "3 ativos" "$($DONO -c "SELECT string_agg(chave, ',' ORDER BY ordem) FROM ixc.alertas WHERE situacao = 'ativo'")" "padrao.aberto,padrao.transferido,padrao.infra"
igual "6 pausados (modo grupo)" "$($DONO -c "SELECT count(*) FROM ixc.alertas WHERE situacao = 'pausado' AND destino = 'grupo_shopping'")" "6"
igual "textos existem no catálogo" "$($DONO -c "SELECT count(*) FROM ixc.alertas a LEFT JOIN ixc.mensagens m ON m.chave = a.texto_chave WHERE a.texto_chave IS NOT NULL AND m.chave IS NULL")" "0"
igual "infra lê o parâmetro" "$($DONO -c "SELECT destino || ':' || destino_valor FROM ixc.alertas WHERE chave = 'padrao.infra'")" "parametro:infra_fone"
igual "particular sem marcar" "$($DONO -c "SELECT count(*) FROM ixc.alertas WHERE destino = 'tecnico' AND marcar <> 'nenhum'")" "0"

# 2. painel_glpi: edita, cria (nasce só teste), exclui; não grava na sombra
$PAINEL -c "UPDATE ixc.alertas SET situacao = 'pausado', nome = 'Aberto (editado)', atualizado = now(), atualizado_por = 'teste' WHERE chave = 'padrao.aberto'" >/dev/null
igual "painel edita" "$($DONO -c "SELECT nome || '|' || situacao FROM ixc.alertas WHERE chave = 'padrao.aberto'")" "Aberto (editado)|pausado"
NOVO=$($PAINEL -c "INSERT INTO ixc.alertas (nome, quando, destino, destino_valor, filtros, criado_por) VALUES ('Teste Jockey', 'aberto', 'numero', '5500000000000', '{\"shoppings\": [\"RESOLUTTO:1\"]}', 'teste') RETURNING id" | head -1)
igual "alerta novo nasce só teste" "$($DONO -c "SELECT situacao || '|' || padrao FROM ixc.alertas WHERE id = $NOVO")" "teste|false"
igual "filtros em JSON" "$($DONO -c "SELECT filtros->'shoppings'->>0 FROM ixc.alertas WHERE id = $NOVO")" "RESOLUTTO:1"
igual "painel lê a sombra" "$($PAINEL -c "SELECT count(*) FROM ixc.alertas_sombra")" "0"
falha "painel não grava na sombra" "$PAINEL" "INSERT INTO ixc.alertas_sombra (empresa) VALUES ('X')"
$DONO -c "INSERT INTO ixc.alertas_sombra (empresa, id_chamado, quando, alerta_id, destino_motor, destino_wf01, status_wf01, bate) VALUES ('RESOLUTTO', '1', 'aberto', 1, 'a@c.us', 'a@c.us', 'enviado', true)" >/dev/null
igual "dono (n8n) grava na sombra" "$($DONO -c "SELECT count(*) FROM ixc.alertas_sombra WHERE bate")" "1"

# 3. restrições
falha "número sem valor" "$PAINEL" "INSERT INTO ixc.alertas (nome, quando, destino) VALUES ('x', 'aberto', 'numero')"
falha "evento desconhecido" "$PAINEL" "INSERT INTO ixc.alertas (nome, quando, destino) VALUES ('x', 'chuva', 'tecnico')"
falha "situação desconhecida" "$PAINEL" "UPDATE ixc.alertas SET situacao = 'ligado' WHERE chave = 'padrao.infra'"
falha "texto fora do catálogo" "$PAINEL" "UPDATE ixc.alertas SET texto_chave = 'nao.existe' WHERE chave = 'padrao.infra'"
falha "minutos fora da faixa" "$PAINEL" "UPDATE ixc.alertas SET quando_min = 0 WHERE chave = 'padrao.sem_tecnico'"
falha "chave padrão repetida" "$PAINEL" "INSERT INTO ixc.alertas (chave, nome, quando, destino) VALUES ('padrao.aberto', 'x', 'aberto', 'tecnico')"

# 4. rodar o 01 e o 02 de novo: nada editado é desfeito, nada duplica
$DONO < "$PBOT/sql/01-mensagens-perguntas.sql" >/dev/null || { ruim=$((ruim+1)); echo "FALHOU: 01 de novo"; }
psql -h $PGH -p $PGP -U ixc -d ixc -q -v ON_ERROR_STOP=1 -v senha="'teste'" < "$PBOT/sql/02-usuario-painel.sql" >/dev/null || { ruim=$((ruim+1)); echo "FALHOU: 02 de novo"; }
igual "01 de novo mantém a edição" "$($DONO -c "SELECT nome || '|' || situacao FROM ixc.alertas WHERE chave = 'padrao.aberto'")" "Aberto (editado)|pausado"
igual "01 de novo não duplica" "$($DONO -c "SELECT count(*) FROM ixc.alertas")" "10"
igual "conferência do 02" "$($DONO -c "SELECT has_table_privilege('painel_glpi', 'ixc.alertas', 'UPDATE')::text || has_table_privilege('painel_glpi', 'ixc.alertas_sombra', 'INSERT')::text")" "truefalse"
$PAINEL -c "DELETE FROM ixc.alertas WHERE id = $NOVO" >/dev/null
igual "painel exclui o criado" "$($DONO -c "SELECT count(*) FROM ixc.alertas WHERE id = $NOVO")" "0"

# 5. excluir mensagem do catálogo não quebra o alerta (texto volta ao do bot)
$DONO -c "INSERT INTO ixc.mensagens (chave, grupo, titulo, wf, texto_padrao, criada_painel) VALUES ('resp.999', 'x', 'x', '03', 'x', true)" >/dev/null
$PAINEL -c "INSERT INTO ixc.alertas (nome, quando, destino, texto_chave) VALUES ('usa resp', 'aberto', 'tecnico', 'resp.999')" >/dev/null
$PAINEL -c "DELETE FROM ixc.mensagens WHERE chave = 'resp.999'" >/dev/null
igual "texto excluído vira nulo" "$($DONO -c "SELECT coalesce(texto_chave, 'nulo') FROM ixc.alertas WHERE nome = 'usa resp'")" "nulo"

echo "alertas (banco): $ok ok, $ruim falhas"
[ "$ruim" -eq 0 ]
