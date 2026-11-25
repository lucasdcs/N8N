# Ativar contrato na RESOLUTTO (espelho) — `ativar-contrato`

Workflow n8n **IXC - Ativar contrato RESOLUTTO (espelho)** (`ixcAtivContrEsp01`), a cada 10 min.

## Regra

1. Numa base de origem (4BTELECOM, PONTO, CACTA ou BUZZ), uma O.S. de **Ativação Link Normal** foi **finalizada** (`status = F`) nas últimas `JANELA_HORAS` (48 h).
2. O contrato dessa O.S. (`su_oss_chamado.id_contrato_kit`) está **ativo** na origem (`cliente_contrato.status = A`).
3. Na **RESOLUTTO**, existe **um único** cliente com o mesmo **CNPJ/CPF** (compara só os dígitos: `12.345.678/0001-90` = `12345678000190`).
4. Esse cliente tem **um único pré-contrato** (`status = P`).

Se as quatro valerem, o pré-contrato é ativado (`cliente_contrato_ativar_cliente`) e o contrato é **relido** para confirmar. Senão, a O.S. aparece no Relatório com o motivo:

| Situação | Quando | O que fazer |
|---|---|---|
| `simulado` | MODO = SIMULAR: ativaria | conferir e passar para REAL |
| `ativado` | ativou e a releitura mostrou `A` | — |
| `erro` | o IXC recusou ou o contrato continuou P (a mensagem do IXC vem junto) | ver no IXC; tenta de novo na próxima rodada |
| `aguardando` | contrato da origem ainda não está ativo, O.S. sem contrato, erro de leitura | nada; tenta de novo até sair da janela |
| `ja_ativo` | o cliente já tem contrato ativo e nenhum pré-contrato | nada |
| `revisar` | 0 ou 2+ clientes com o CNPJ/CPF, 0 ou 2+ pré-contratos, cliente sem documento | resolver à mão no IXC |
| `duplicada` | duas O.S. levam ao mesmo pré-contrato na mesma rodada | nada (uma só ativa) |
| `ignorado` | documento em `IGNORAR_DOCS` | — |

**Assuntos** (`ORIGENS` no Config): 4B 16 · PONTO 4 · CACTA 43 · BUZZ 45 — os mesmos da Auditoria (Ativação Link Normal).

## Proteções

- **MODO** no nó Config: `NENHUM` / `SIMULAR` (padrão) / `REAL`. REAL só no n8n de **produção**.
- No máximo `MAX_ATIVACOES_RODADA` (10) ativações por rodada.
- Só ativa contrato **P**. Nunca mexe em contrato ativo, inativo, bloqueado ou cancelado, nem em nada das bases de origem (lá só **lê**).
- Uma base com erro de leitura não derruba as outras.
- **Memória do workflow** (`staticData`): em REAL, a O.S. que terminou em `ativado` ou `ja_ativo` não é relida. Erros, `aguardando` e `revisar` são tentados de novo enquanto a O.S. estiver na janela. A memória só funciona com o workflow **publicado**: execução manual não grava.

## Permissões no IXC

- Origens (4B, PONTO, CACTA, BUZZ): **Listar** em `su_oss_chamado`, `cliente_contrato` e `cliente`.
- RESOLUTTO (usuário `automacao_n8n`): **Listar** em `cliente` e `cliente_contrato` + a ação **Ativar contrato** (`cliente_contrato_ativar_cliente`).

## Arquivos

| Arquivo | O quê |
|---|---|
| `js/*.js` | código dos nós (o `comum.js` entra no começo dos nós 02–07) |
| `gerar.py` | monta `../workflows/ixc-ativar-contrato-resolutto-espelho.json` (determinístico) |
| `teste/simular.js` | teste de ponta a ponta com um IXC falso (23 verificações) |
| `VERSAO` | versão atual |

Não edite os nós de código no n8n: mude o `js/`, rode `python3 -I gerar.py` e importe de novo.

```bash
python3 -I gerar.py
node ../../whatsapp-ixc/scripts/check/valida.js ../workflows
node teste/simular.js ../workflows/ixc-ativar-contrato-resolutto-espelho.json
```

## Versões

| Versão | Data | O quê |
|---|---|---|
| 0.1.0 | 25/11/2026 | 1ª versão: 4 origens → RESOLUTTO, vínculo por CNPJ/CPF, único pré-contrato, SIMULAR por padrão |
