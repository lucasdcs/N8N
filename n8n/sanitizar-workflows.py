#!/usr/bin/env python3
"""
Limpa workflows exportados do n8n antes de publicar no GitHub (repo PÚBLICO).

Uso:  python3 sanitizar-workflows.py <pasta_export> <pasta_saida>

- <pasta_export>: saída de `n8n export:workflow --all --separate --output=...`
- <pasta_saida>: um .json por workflow, com nome estável (slug do nome do workflow)
  + RELATORIO.txt com o que foi trocado em cada arquivo.

O que sai do workflow:
- pinData, staticData, shared, meta.instanceId (dados de execução / instância);
- "active" vira false (cópia pública nunca nasce ativa ao importar).

O que é trocado por marcador (o workflow continua importável):
- constantes JS com nome de segredo  (const PAINEL_TOKEN = '...')  -> '__PAINEL_TOKEN__'
- campos/headers com nome de segredo (Authorization, X-Api-Key, token, senha...) com valor fixo
- "Bearer xxx" / "Basic xxx" fixos, hex/base64 longos (hash de API do IXC, chaves)
- telefones (55DDNNNNNNNNN, @c.us, (41) 9xxxx-xxxx), CPF, CNPJ, e-mails
- id de planilha Google, IPs públicos

Expressões do n8n ({{ ... }}, ={{ ... }}) e referências a credenciais (id/nome) são mantidas:
o segredo de verdade fica nas Credenciais do n8n, que NÃO são exportadas.
"""
import json
import os
import re
import sys
import unicodedata
from collections import Counter

SEGREDO_NOME = re.compile(r'(token|senha|password|passwd|secret|segredo|api[_-]?key|apikey|authorization|hash|bearer|cookie)', re.I)
IP_PRIVADO = re.compile(r'^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)')

PADROES = [
    # (categoria, regex, substituição)
    ('js_const_segredo',
     re.compile(r"""((?:const|let|var)\s+(\w*(?:TOKEN|SENHA|PASSWORD|SECRET|SEGREDO|API_?KEY|APIKEY|HASH|AUTH)\w*)\s*=\s*)(['"`])(?!__)([^'"`\n]{6,})\3""", re.I),
     lambda m: f"{m.group(1)}{m.group(3)}__{m.group(2).upper()}__{m.group(3)}"),
    ('js_prop_segredo',
     re.compile(r"""((['"]?)(\w*(?:token|senha|password|secret|apikey|api_key|x-api-key|authorization)\w*)\2\s*:\s*)(['"`])(?!__|\{\{|=)([^'"`\n]{6,})\4""", re.I),
     lambda m: f"{m.group(1)}{m.group(4)}__SEGREDO__{m.group(4)}"),
    ('bearer_basic',
     re.compile(r'\b(Bearer|Basic)\s+(?!\{\{|__)[A-Za-z0-9._~+/=:-]{12,}'),
     lambda m: f'{m.group(1)} __SEGREDO__'),
    ('hex_longo',
     re.compile(r'(?<![A-Za-z0-9])[A-Fa-f0-9]{32,}(?![A-Za-z0-9])'),
     lambda m: '__SEGREDO__'),
    ('id_hash_ixc',
     re.compile(r'(?<![\w.])\d{1,6}:[A-Za-z0-9]{24,}(?![\w])'),
     lambda m: '__ID__:__HASH__'),
    ('planilha_google',
     re.compile(r'(docs\.google\.com/spreadsheets/d/)[A-Za-z0-9_-]{20,}'),
     lambda m: m.group(1) + '__PLANILHA_ID__'),
    ('whatsapp_id',
     re.compile(r'\b\d{10,13}@(c\.us|s\.whatsapp\.net|g\.us)\b'),
     lambda m: '__TELEFONE__@' + m.group(1)),
    ('telefone',
     re.compile(r'(?<![\d.])55\d{10,11}(?!\d)'),
     lambda m: '55__TELEFONE__'),
    ('telefone_formatado',
     re.compile(r'\(?\b\d{2}\)?[ ]?9?\d{4}-\d{4}\b'),
     lambda m: '__TELEFONE__'),
    ('cpf',
     re.compile(r'\b\d{3}\.\d{3}\.\d{3}-\d{2}\b'),
     lambda m: '__CPF__'),
    ('cnpj',
     re.compile(r'\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b'),
     lambda m: '__CNPJ__'),
    ('email',
     re.compile(r'\b(?!__)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),
     lambda m: '__EMAIL__'),
]
IPV4 = re.compile(r'(?<![\d.])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![\d.])')


def limpar_texto(s, cont):
    for cat, rx, rep in PADROES:
        s, n = rx.subn(rep, s)
        if n:
            cont[cat] += n

    def ip(m):
        if IP_PRIVADO.match(m.group(1)):
            return m.group(1)
        cont['ip_publico'] += 1
        return '__IP_PUBLICO__'
    return IPV4.sub(ip, s)


def eh_expressao(v):
    v = v.strip()
    return v.startswith('=') or v.startswith('{{') or v.startswith('__')


def limpar(obj, cont, chave_pai=''):
    if isinstance(obj, dict):
        # header/parâmetro no formato {"name": "Authorization", "value": "..."}
        nome = obj.get('name')
        if isinstance(nome, str) and SEGREDO_NOME.search(nome) and isinstance(obj.get('value'), str):
            v = obj['value']
            if v and not eh_expressao(v):
                obj['value'] = '__SEGREDO__'
                cont['parametro_segredo'] += 1
        for k, v in list(obj.items()):
            if k == 'credentials':
                continue  # só id/nome da credencial; o segredo não é exportado
            if isinstance(v, str) and SEGREDO_NOME.search(k) and len(v) >= 6 and not eh_expressao(v) and k not in ('name',):
                obj[k] = '__SEGREDO__'
                cont['campo_segredo'] += 1
            else:
                obj[k] = limpar(v, cont, k)
        return obj
    if isinstance(obj, list):
        return [limpar(x, cont, chave_pai) for x in obj]
    if isinstance(obj, str):
        return limpar_texto(obj, cont)
    return obj


def slug(nome):
    s = unicodedata.normalize('NFKD', nome).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-').lower()
    return s or 'workflow'


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    origem, destino = sys.argv[1], sys.argv[2]
    os.makedirs(destino, exist_ok=True)
    relatorio, usados = [], set()
    arquivos = sorted(f for f in os.listdir(origem) if f.endswith('.json'))
    if not arquivos:
        print('Nenhum .json em', origem)
        sys.exit(1)
    for f in arquivos:
        with open(os.path.join(origem, f), encoding='utf-8') as fh:
            wf = json.load(fh)
        if isinstance(wf, list):  # export sem --separate
            print('ERRO: exporte com --separate (um arquivo por workflow).')
            sys.exit(1)
        cont = Counter()
        for k in ('pinData', 'staticData', 'shared'):
            if wf.pop(k, None):
                cont['removido_' + k] += 1
        if isinstance(wf.get('meta'), dict):
            wf['meta'].pop('instanceId', None)
        ativo = bool(wf.get('active'))
        wf['active'] = False
        wf['nodes'] = limpar(wf.get('nodes', []), cont)
        nome = wf.get('name', f)
        base = slug(nome)
        nome_arq, i = base, 2
        while nome_arq in usados:
            nome_arq, i = f'{base}-{i}', i + 1
        usados.add(nome_arq)
        with open(os.path.join(destino, nome_arq + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(wf, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        trocas = ', '.join(f'{k}={v}' for k, v in sorted(cont.items())) or 'nada'
        relatorio.append(f"{nome_arq}.json | {nome} | id {wf.get('id')} | {'ATIVO' if ativo else 'inativo'} na origem | {len(wf['nodes'])} nós | {trocas}")
    with open(os.path.join(destino, 'RELATORIO.txt'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(relatorio) + '\n')
    print('\n'.join(relatorio))
    print(f'\n{len(arquivos)} workflow(s) limpos em {destino}')


if __name__ == '__main__':
    main()
