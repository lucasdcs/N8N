// Teste de ponta a ponta do workflow com um IXC falso (sem rede). Uso: node simular.js ../../workflows/ixc-ativar-contrato-resolutto-espelho.json
const fs = require('fs');
const wf = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const N = Object.fromEntries(wf.nodes.map(n => [n.name, n]));
const loc = (d) => d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' ');
const hoje = loc(new Date(Date.now() - 3600000)), velho = loc(new Date(Date.now() - 5 * 86400000));

function dados() {
  return {
    '4B': {
      su_oss_chamado: [
        { id: '100', id_assunto: '16', status: 'F', data_fechamento: hoje, id_cliente: '10', id_contrato_kit: '500' },
        { id: '101', id_assunto: '16', status: 'F', data_fechamento: hoje, id_cliente: '12', id_contrato_kit: '501' },
        { id: '102', id_assunto: '16', status: 'EN', data_fechamento: '', id_cliente: '10', id_contrato_kit: '500' },
        { id: '103', id_assunto: '99', status: 'F', data_fechamento: hoje, id_cliente: '10', id_contrato_kit: '500' },
        { id: '104', id_assunto: '16', status: 'F', data_fechamento: velho, id_cliente: '10', id_contrato_kit: '500' },
        { id: '105', id_assunto: '16', status: 'F', data_fechamento: hoje, id_cliente: '11', id_contrato_kit: '502' }],
      cliente_contrato: [{ id: '500', id_cliente: '10', status: 'A' }, { id: '501', id_cliente: '12', status: 'P' }, { id: '502', id_cliente: '11', status: 'A' }],
      cliente: [{ id: '10', razao: 'LOJA A', cnpj_cpf: '12.345.678/0001-90' }, { id: '11', razao: 'LOJA A FILIAL', cnpj_cpf: '12.345.678/0001-90' },
                { id: '12', razao: 'LOJA C', cnpj_cpf: '99.999.999/0001-99' }] },
    PONTO: {
      su_oss_chamado: [
        { id: '200', id_assunto: '4', status: 'F', data_fechamento: hoje, id_cliente: '20', id_contrato_kit: '600' },
        { id: '201', id_assunto: '4', status: 'F', data_fechamento: hoje, id_cliente: '21', id_contrato_kit: '601' }],
      cliente_contrato: [{ id: '600', id_cliente: '20', status: 'A' }, { id: '601', id_cliente: '21', status: 'A' }],
      cliente: [{ id: '20', razao: 'PF', cnpj_cpf: '111.222.333-44' }, { id: '21', razao: 'LOJA D', cnpj_cpf: '22.222.222/0001-22' }] },
    CACTA: {
      su_oss_chamado: [
        { id: '300', id_assunto: '43', status: 'F', data_fechamento: hoje, id_cliente: '30', id_contrato_kit: '700' },
        { id: '301', id_assunto: '43', status: 'F', data_fechamento: hoje, id_cliente: '31', id_contrato_kit: '0' },
        { id: '302', id_assunto: '43', status: 'F', data_fechamento: hoje, id_cliente: '32', id_contrato_kit: '702' }],
      cliente_contrato: [{ id: '700', id_cliente: '30', status: 'A' }, { id: '702', id_cliente: '32', status: 'A' }],
      cliente: [{ id: '30', razao: 'LOJA E', cnpj_cpf: '33.333.333/0001-33' }, { id: '31', razao: 'LOJA F', cnpj_cpf: '' },
                { id: '32', razao: 'LOJA G', cnpj_cpf: '44.444.444/0001-44' }] },
    BUZZ: { erro: 'Sem permissão para listar' },
    RESOLUTTO: {
      cliente: [{ id: '900', cnpj_cpf: '12345678000190' }, { id: '901', cnpj_cpf: '111.222.333-44' }, { id: '902', cnpj_cpf: '11122233344' },
                { id: '903', cnpj_cpf: '22.222.222/0001-22' }, { id: '904', cnpj_cpf: '33.333.333/0001-33' }, { id: '905', cnpj_cpf: '44.444.444/0001-44' }],
      cliente_contrato: [{ id: '7000', id_cliente: '900', status: 'P' }, { id: '7009', id_cliente: '900', status: 'I' },
                         { id: '7001', id_cliente: '903', status: 'A' },
                         { id: '7002', id_cliente: '904', status: 'P' }, { id: '7003', id_cliente: '904', status: 'P' },
                         { id: '7004', id_cliente: '905', status: 'P', falha: true }] },
  };
}
const URL2BASE = { 'ixc.resolutto.com.br': 'RESOLUTTO', 'ixc.4btelecom.com.br': '4B', 'ixc.pontotelecom.com': 'PONTO',
  'ixc.cactatelecom.com.br': 'CACTA', 'ixc.buzztelecom.com.br': 'BUZZ' };
let DB, chamadas;
function ixc(url, corpo) {
  const m = url.match(/^https:\/\/([^/]+)\/webservice\/v1\/(\w+)$/); const base = URL2BASE[m[1]], tab = m[2];
  chamadas.push(base + ' ' + tab);
  const db = DB[base];
  if (db.erro) return { type: 'error', message: db.erro };
  if (tab === 'cliente_contrato_ativar_cliente') {
    const c = db.cliente_contrato.find(x => x.id === corpo.id_contrato);
    if (!c) return { type: 'error', message: 'Contrato não encontrado' };
    if (c.falha) return { type: 'error', message: 'Contrato sem login vinculado' };
    c.status = 'A'; return { type: 'success', message: 'Contrato ativado com sucesso' };
  }
  const val = (r, tb) => String(r[tb.split('.')[1]] ?? '');
  const testa = (r, tb, op, p) => { const v = val(r, tb);
    if (op === '=') return v === String(p); if (op === '!=') return v !== String(p);
    if (op === '>=') return /^\d+$/.test(v) && /^\d+$/.test(p) ? +v >= +p : v >= p;
    if (op === '>') return /^\d+$/.test(v) ? +v > +p : v > p;
    if (op === 'IN') return String(p).split(',').includes(v); throw new Error('op ' + op); };
  let rs = (db[tab] || []).filter(r => testa(r, corpo.qtype, corpo.oper, corpo.query));
  for (const g of JSON.parse(corpo.grid_param || '[]')) rs = rs.filter(r => testa(r, g.TB, g.OP, g.P));
  rs = rs.slice(0, Number(corpo.rp || 20));
  return { page: '1', total: String(rs.length), registros: rs.map(r => ({ ...r })) };
}

async function rodar(modo, static_, extra = '') {
  const out = {};
  const mk = (cur) => (nome) => {
    const arr = out[nome]; if (!arr) throw new Error('nó ainda não rodou: ' + nome);
    return { first: () => arr[0], all: () => arr, get item() { return arr[cur.i]; } };
  };
  const cur = { i: 0 }; const $ = mk(cur);
  const gs = () => static_;
  const runCode = async (nome, entrada) => {
    let js = N[nome].parameters.jsCode;
    if (nome === 'Config') js = js.replace("MODO: 'SIMULAR'", `MODO: '${modo}'`) + '';
    if (nome === 'Config' && extra) js = js.replace('MAX_ATIVACOES_RODADA: 10', extra);
    if (N[nome].parameters.mode === 'runOnceForEachItem') {
      const r = [];
      for (let i = 0; i < entrada.length; i++) { cur.i = i;
        const f = new Function('$', '$input', '$json', '$getWorkflowStaticData', `return (async()=>{${js}\n})()`);
        r.push(await f($, { item: entrada[i] }, entrada[i].json, gs)); }
      return r;
    }
    const f = new Function('$', '$input', '$json', '$getWorkflowStaticData', `return (async()=>{${js}\n})()`);
    return f($, { all: () => entrada, first: () => entrada[0] }, entrada[0] && entrada[0].json, gs);
  };
  const runHttp = (nome, entrada) => entrada.map((it, i) => { cur.i = i;
    const p = N[nome].parameters; const ex = p.jsonBody.replace(/^=\{\{/, '').replace(/\}\}$/, '');
    const corpo = JSON.parse(new Function('$', '$json', '$itemIndex', 'return ' + ex)($, it.json, i));
    return { json: { data: JSON.stringify(ixc(p.url, corpo)) } }; });
  const run = async (nome, entrada) => { const t = N[nome].type;
    out[nome] = t.endsWith('.code') ? await runCode(nome, entrada) : runHttp(nome, entrada); return out[nome]; };
  let cur_ = [{ json: {} }];
  const ordem = Object.keys(N).filter(n => !['Executar manualmente', 'A cada 10 min', 'Nota'].includes(n));
  // segue as conexões a partir do Config (cadeia linear até o IF)
  let nome = 'Config';
  while (nome !== 'Ativar?') { cur_ = await run(nome, cur_); nome = wf.connections[nome].main[0][0].node; }
  const sim = cur_.filter(x => x.json.acao === 'ativar'), nao = cur_.filter(x => x.json.acao !== 'ativar');
  out['Ativar?'] = sim;
  let conf = [], rel = [];
  if (sim.length) { let e = await run('Ativar RESOLUTTO', sim); e = await run('Reler contrato RESOLUTTO', e); conf = await run('Conferir ativação', e); }
  if (nao.length) rel = await run('Relatório', nao);
  return { conf: conf.map(x => x.json), rel: rel.map(x => x.json) };
}

let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FALHA ') + msg); if (!cond) falhas++; };
const sit = (r) => Object.fromEntries([...r.rel.filter(x => !x.resumo), ...r.conf].map(x => [(x.base || '') + ':' + (x.os || x.id_os), x.situacao]));
(async () => {
  DB = dados(); chamadas = []; let st = {};
  console.log('1) SIMULAR');
  let r = await rodar('SIMULAR', st); let s = sit(r);
  ok(s['4B:100'] === 'simulado', '4B 100 → simulado (CNPJ formatado na origem, só dígitos na RESOLUTTO)');
  ok(s['4B:105'] === 'duplicada', '4B 105 (mesmo CNPJ, mesmo pré-contrato) → duplicada');
  ok(s['4B:101'] === 'aguardando', '4B 101 contrato P na origem → aguardando');
  ok(!s['4B:102'] && !s['4B:103'] && !s['4B:104'], '4B 102 (EN), 103 (outro assunto), 104 (fora da janela) não entram');
  ok(s['PONTO:200'] === 'revisar', 'PONTO 200 dois clientes com o mesmo CPF → revisar');
  ok(s['PONTO:201'] === 'ja_ativo', 'PONTO 201 → já ativo');
  ok(s['CACTA:300'] === 'revisar', 'CACTA 300 dois pré-contratos → revisar');
  ok(s['CACTA:301'] === 'aguardando', 'CACTA 301 sem contrato na O.S. → não segue');
  ok(s['CACTA:302'] === 'simulado', 'CACTA 302 → simulado');
  ok(r.rel[0].erros_leitura.BUZZ && /permiss/.test(r.rel[0].erros_leitura.BUZZ), 'BUZZ com erro não derruba as outras bases');
  ok(DB.RESOLUTTO.cliente_contrato.every(c => c.id === '7000' ? c.status === 'P' : true) && !chamadas.some(c => /ativar/.test(c)), 'SIMULAR não chama a ativação');
  ok(Object.keys(st.feitos || {}).length === 0, 'SIMULAR não grava memória');

  console.log('2) REAL com limite 1');
  DB = dados(); chamadas = []; st = {};
  r = await rodar('REAL', st, 'MAX_ATIVACOES_RODADA: 1'); s = sit(r);
  ok(s['4B:100'] === 'ativado' && DB.RESOLUTTO.cliente_contrato.find(c => c.id === '7000').status === 'A', '4B 100 → contrato 7000 ativado e conferido');
  ok(/limite/.test(r.rel.find(x => x.os === '302').motivo), 'CACTA 302 fica para a próxima rodada (limite)');
  ok(DB.RESOLUTTO.cliente_contrato.find(c => c.id === '7009').status === 'I', 'contrato inativo do mesmo cliente não é tocado');

  console.log('3) REAL');
  DB = dados(); chamadas = []; st = {};
  r = await rodar('REAL', st); s = sit(r);
  ok(s['4B:100'] === 'ativado', '4B 100 ativado');
  ok(s['CACTA:302'] === 'erro' && /sem login/.test(r.conf.find(x => x.id_os === '302').motivo), 'CACTA 302: IXC recusa → erro com a mensagem do IXC');
  ok(st.feitos['4B:100'] && st.feitos['PONTO:201'] && !st.feitos['CACTA:302'] && !st.feitos['4B:101'], 'memória: só ativado e já ativo');
  ok(chamadas.filter(c => /ativar/.test(c)).length === 2, 'duas chamadas de ativação (100 e 302), nenhuma para 105');

  console.log('4) REAL de novo (idempotente)');
  chamadas = [];
  r = await rodar('REAL', st); s = sit(r);
  ok(r.rel[0].ja_resolvidas === 2 && !s['4B:100'], '4B 100 e PONTO 201 não são relidas');
  ok(s['4B:105'] === 'ja_ativo', '4B 105 agora vê o contrato já ativo');
  ok(s['CACTA:302'] === 'erro', 'CACTA 302 tenta de novo');

  console.log('5) NENHUM');
  DB = dados(); chamadas = []; st = {};
  r = await rodar('NENHUM', st);
  ok(r.rel.length === 1 && r.rel[0].os_lidas === 0 && !chamadas.some(c => /ativar/.test(c)), 'nenhuma O.S. lida e nada ativado (só consultas vazias id=0)');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
