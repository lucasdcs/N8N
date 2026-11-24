#!/bin/bash
# recria o banco de teste: base -> sql/01 -> sql/02 (como na instalação)
set -e
PBOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PGH="${PGH:-/tmp/pg}"; PGP="${PGP:-5499}"
P="psql -h "$PGH" -p "$PGP" -U ixc -q -v ON_ERROR_STOP=1"
$P -d postgres -c "DROP DATABASE IF EXISTS ixc" -c "CREATE DATABASE ixc" >/dev/null
$P -d ixc -f "$(dirname "$0")/base-bot-minima.sql"
$P -d ixc < "$PBOT/sql/01-mensagens-perguntas.sql" >/dev/null
$P -d ixc -v senha="'teste'" < "$PBOT/sql/02-usuario-painel.sql" >/dev/null
