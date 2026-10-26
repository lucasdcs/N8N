# Workflows n8n (produção)

Cópia **limpa** dos workflows que estão **ativos** no n8n de produção. Cada publicação recebe uma tag `n8n-AAAA-MM-DD`.

> Este repositório é público. Os arquivos daqui **não** rodam como estão. Eles servem de histórico e de base para restaurar.

## Workflows

| Arquivo | Workflow | O que faz |
|---|---|---|
| `ixc-encaminhar-os-por-condominio-global.json` | IXC - Encaminhar OS por condominio GLOBAL | Encaminha as O.S. de ativação sem técnico ao técnico do condomínio, nas 5 bases. Com 2 ou mais técnicos, decide por continuidade e depois pela menor carga |
| `ixc-distribuir-os-documentacao-global.json` | IXC - Distribuir OS Documentacao GLOBAL | Distribui as O.S. de Documentação pela menor carga somada nas 5 bases, respeitando condomínio fixo e folgas |
| `whatsapp-lembrete-diario-os-paradas-t-i.json` | WhatsApp - Lembrete diario OS paradas T.I | Lembrete diário (WAHA) aos técnicos sobre as O.S. paradas, mais um resumo para a coordenação |
| `whatsapp-aviso-de-os-nova.json` | WhatsApp - Aviso de OS nova | Avisa o técnico pelo WhatsApp quando recebe uma O.S. nova |
| `ixc-cadastrar-cliente-no-glpi-5-bases.json` | IXC - Cadastrar cliente no GLPI (5 bases) | Cria no GLPI os clientes do IXC que ainda não existem |
| `painel-ixc-coletor-5-bases.json` | Painel IXC - Coletor (5 bases) | Envia as O.S. ao plugin Painel IXC (`front/ingest.php`) |
| `painel-ixc-auditoria-5-bases.json` | Painel IXC - Auditoria (5 bases) | Envia as auditorias de ativação ao painel |
| `painel-ixc-atendimentos-5-bases.json` | Painel IXC - Atendimentos (5 bases) | Envia os atendimentos ao painel |

Os workflows inativos, como as versões antigas por base, não foram publicados.

## O que foi trocado para publicar

| No arquivo | Original |
|---|---|
| `__PAINEL_TOKEN__` | token do ingest do Painel IXC (Configurar > Geral > Painel IXC) |
| `55__TELEFONE__` / `__TELEFONE__` | WhatsApp dos técnicos e da coordenação |
| `__PLANILHA_ID__` | id da planilha de escala (Google Planilhas) |
| `Técnico <id>` / `tec<id>` | nome do técnico. O número é o id de colaborador na base Resolutto (ou `BASE-id`). Nas `chaves` da escala, o nome original precisa voltar |
| `__IP_PUBLICO__`, `__EMAIL__`, `__SEGREDO__` | se aparecerem: endereço público, e-mail ou segredo fixo |

Além disso:
- `active` vem **false**;
- `pinData`, `staticData` e `shared` foram removidos.

As **Credenciais do n8n** (IXC API por base, WAHA API, GLPI API) **não** são exportadas. O workflow guarda só o id e o nome de cada uma. Ao importar em outro n8n, crie as credenciais com o mesmo nome ou religue-as nos nós.

## Restaurar um workflow

1. Importe o arquivo no n8n.
2. Preencha os marcadores (token, telefones, planilha, nomes).
3. Confira as credenciais.
4. Publique.

Use o mesmo id para substituir o workflow existente.

## Gerar uma nova cópia (produção, root)

```bash
rm -rf /root/wf-export /root/wf-limpo && mkdir -p /root/wf-export
docker exec -u node n8n-compose-n8n-1 sh -c 'rm -rf /tmp/wf && mkdir -p /tmp/wf && n8n export:workflow --all --separate --output=/tmp/wf/'
docker cp n8n-compose-n8n-1:/tmp/wf/. /root/wf-export/
docker exec -u node n8n-compose-n8n-1 rm -rf /tmp/wf
python3 -I sanitizar-workflows.py /root/wf-export /root/wf-limpo
rm -rf /root/wf-export
```

O `sanitizar-workflows.py` remove segredos, telefones, CPF/CNPJ, e-mails, IPs públicos e o id da planilha. **Ele não troca os nomes dos técnicos.** Essa troca e a revisão final são feitas antes de cada push. **Nunca publique a saída do script sem essa revisão.**
