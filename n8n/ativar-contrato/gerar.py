#!/usr/bin/env python3
"""Gera o workflow n8n "IXC - Ativar contrato RESOLUTTO (espelho)" a partir dos nós em js/.

Uso: python3 -I gerar.py [saida.json]
Padrão de saída: ../workflows/ixc-ativar-contrato-resolutto-espelho.json
Determinístico: os ids dos nós são derivados do nome (uuid5), então gerar de novo não muda o arquivo.
"""
import json, sys, uuid
from pathlib import Path

AQUI = Path(__file__).resolve().parent
VERSAO = (AQUI / 'VERSAO').read_text().strip()
SAIDA = Path(sys.argv[1]) if len(sys.argv) > 1 else AQUI.parent / 'workflows' / 'ixc-ativar-contrato-resolutto-espelho.json'
NS = uuid.UUID('6f0e7c1a-3b1d-4c55-9d2e-a1c0ffee0001')

BASES = {  # base -> (url, id da credencial n8n, nome da credencial)  — os mesmos do Encaminhar GLOBAL
    'RESOLUTTO': ('https://ixc.resolutto.com.br', 'ixcApiAutomacao1', 'IXC API (RESOLUTTO)'),
    '4B':        ('https://ixc.4btelecom.com.br', 'Sar2wecxMvwt297d', 'IXC API (4BTELECOM)'),
    'PONTO':     ('https://ixc.pontotelecom.com', 'SQr92hzbZKnat5kl', 'IXC API (Ponto telecom)'),
    'CACTA':     ('https://ixc.cactatelecom.com.br', '00ORMvXflPQheEJ1', 'IXC API (CACTA TELECOM)'),
    'BUZZ':      ('https://ixc.buzztelecom.com.br', 'CYZcvcYaydyP88Uu', 'IXC API (BUZZ TELECOM)'),
}
ORIGENS = ['4B', 'PONTO', 'CACTA', 'BUZZ']
COMUM = (AQUI / 'js' / 'comum.js').read_text()

nodes, conn, x = [], {}, [0]

def nid(nome):
    return str(uuid.uuid5(NS, nome))

def add(no, y=0, dx=220):
    no['id'] = nid(no['name'])
    no['position'] = [x[0], y]
    x[0] += dx
    nodes.append(no)
    return no['name']

def liga(a, b, saida=0):
    outs = conn.setdefault(a, {'main': []})['main']
    while len(outs) <= saida:
        outs.append([])
    outs[saida].append({'node': b, 'type': 'main', 'index': 0})

def code(nome, arq, cada_item=False, comum=True, y=0):
    js = (AQUI / 'js' / arq).read_text()
    p = {'jsCode': (COMUM + '\n' if comum else '') + js}
    if cada_item:
        p['mode'] = 'runOnceForEachItem'
    return add({'parameters': p, 'name': nome, 'type': 'n8n-nodes-base.code', 'typeVersion': 2}, y)

def http(nome, base, tabela, corpo, y=0, continua=True):
    url, cid, cnome = BASES[base]
    no = {'parameters': {
        'method': 'POST', 'url': f'{url}/webservice/v1/{tabela}',
        'authentication': 'genericCredentialType', 'genericAuthType': 'httpBasicAuth',
        'sendHeaders': True, 'headerParameters': {'parameters': [{'name': 'ixcsoft', 'value': 'listar'}]},
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ JSON.stringify(' + corpo + ') }}',
        'options': {'response': {'response': {'responseFormat': 'text'}}, 'timeout': 60000}},
        'name': nome, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
        'credentials': {'httpBasicAuth': {'id': cid, 'name': cnome}}}
    if continua:
        no['onError'] = 'continueRegularOutput'
    return add(no, y)

# ---- gatilhos e config
add({'parameters': {}, 'name': 'Executar manualmente', 'type': 'n8n-nodes-base.manualTrigger', 'typeVersion': 1}, -160, 0)
add({'parameters': {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': 10}]}},
     'name': 'A cada 10 min', 'type': 'n8n-nodes-base.scheduleTrigger', 'typeVersion': 1.2}, 160)
cadeia = [code('Config', '01-config.js', comum=False)]
liga('Executar manualmente', 'Config'); liga('A cada 10 min', 'Config')
# ---- leitura nas bases de origem (1 chamada por base)
for b in ORIGENS:
    cadeia.append(http(f'OS {b}', b, 'su_oss_chamado', f"$('Config').first().json.cfg.corpoOS['{b}']"))
cadeia.append(code('Finalizadas', '02-finalizadas.js'))
for b in ORIGENS:
    cadeia.append(http(f'Contratos {b}', b, 'cliente_contrato', f"$('Finalizadas').first().json.corpos.contratos['{b}']"))
for b in ORIGENS:
    cadeia.append(http(f'Clientes {b}', b, 'cliente', f"$('Finalizadas').first().json.corpos.clientes['{b}']"))
cadeia.append(code('Candidatos', '03-candidatos.js'))
# ---- RESOLUTTO (1 chamada por O.S. candidata)
cadeia.append(http('Cliente RESOLUTTO (formatado)', 'RESOLUTTO', 'cliente', '$json.corpo_doc_fmt'))
cadeia.append(http('Cliente RESOLUTTO (dígitos)', 'RESOLUTTO', 'cliente', "$('Candidatos').item.json.corpo_doc_num"))
cadeia.append(code('Casar cliente', '04-casar-cliente.js', cada_item=True))
cadeia.append(http('Contratos RESOLUTTO', 'RESOLUTTO', 'cliente_contrato', '$json.corpo_contratos_res'))
cadeia.append(code('Decidir', '05-decidir.js'))
cadeia.append(add({'parameters': {'conditions': {
    'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 2},
    'conditions': [{'id': nid('cond-ativar'), 'leftValue': '={{ $json.acao }}', 'rightValue': 'ativar',
                    'operator': {'type': 'string', 'operation': 'equals'}}],
    'combinator': 'and'}, 'options': {}},
    'name': 'Ativar?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2}))
for a, b in zip(cadeia, cadeia[1:]):
    liga(a, b)
# ---- ramo verdadeiro: ativa e confere
y_at = -200
at = http('Ativar RESOLUTTO', 'RESOLUTTO', 'cliente_contrato_ativar_cliente', '$json.payload', y=y_at, continua=False)
x[0] -= 220
rel = http('Reler contrato RESOLUTTO', 'RESOLUTTO', 'cliente_contrato', "$('Ativar?').item.json.corpo_reler", y=y_at)
conf = code('Conferir ativação', '06-conferir.js', y=y_at)
liga('Ativar?', at, 0); liga(at, rel); liga(rel, conf)
# ---- ramo falso: relatório
x[0] -= 440
relat = code('Relatório', '07-relatorio.js', y=200)
liga('Ativar?', relat, 1)
# reposiciona os dois ramos logo depois do IF
xif = next(n for n in nodes if n['name'] == 'Ativar?')['position'][0]
for i, nome in enumerate([at, rel, conf]):
    next(n for n in nodes if n['name'] == nome)['position'][0] = xif + 220 * (i + 1)
next(n for n in nodes if n['name'] == relat)['position'][0] = xif + 220

nota = ('## IXC - Ativar contrato RESOLUTTO (espelho) v' + VERSAO + '\n'
        'O.S. "Ativação Link Normal" FINALIZADA na 4B/PONTO/CACTA/BUZZ + contrato da O.S. ATIVO na origem '
        '-> ativa o ÚNICO pré-contrato (P) do cliente de mesmo CNPJ/CPF na RESOLUTTO.\n\n'
        'Modo no nó Config (MODO): NENHUM / SIMULAR / REAL. REAL só no n8n de PRODUÇÃO.\n'
        'Fonte: github.com/lucasdcs/N8N, pasta n8n/ativar-contrato (gerar.py). Não edite os nós de código aqui: '
        'mude o js/ e gere de novo.')
add({'parameters': {'content': nota, 'height': 220, 'width': 520}, 'name': 'Nota',
     'type': 'n8n-nodes-base.stickyNote', 'typeVersion': 1}, -420, 0)
next(n for n in nodes if n['name'] == 'Nota')['position'][0] = 0

wf = {'name': 'IXC - Ativar contrato RESOLUTTO (espelho)', 'nodes': nodes, 'connections': conn,
      'active': False, 'settings': {'executionOrder': 'v1', 'timezone': 'America/Sao_Paulo',
                                    'saveDataSuccessExecution': 'all', 'saveManualExecutions': True},
      'id': 'ixcAtivContrEsp01', 'meta': {'versao': VERSAO}, 'tags': []}
SAIDA.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + '\n')
print(f'{SAIDA} ({len(nodes)} nós, v{VERSAO})')
