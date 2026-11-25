// ---- comum (inserido no início dos nós de código pelo gerar.py) ----
function parseTolerante(v) {
  if (v && typeof v === 'object' && v.data === undefined) return v;
  const txt = v && typeof v === 'object' ? v.data : v;
  const limpo = String(txt || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  try { return JSON.parse(limpo); } catch (e) { return { erro_parse: 'JSON inválido: ' + e.message }; }
}
const msgErro = (e) => typeof e === 'string' ? e : (e && (e.message || e.description)) || JSON.stringify(e);
function falhou(r) {
  if (!r) return 'sem resposta';
  if (r.erro_parse) return r.erro_parse;
  if (r.error) return msgErro(r.error);
  if (r.type === 'error') return 'IXC recusou: ' + String(r.message || JSON.stringify(r)).slice(0, 300);
  if (!Number.isFinite(Number(r.total))) return 'resposta inesperada (sem "total"): ' + JSON.stringify(r).slice(0, 200);
  if (Number(r.total) > 0 && !Array.isArray(r.registros)) return 'IXC informou ' + r.total + ' registros mas não mandou a lista';
  return '';
}
const regs = (r) => Array.isArray(r && r.registros) ? r.registros : [];
const digitos = (s) => String(s || '').replace(/\D/g, '');
const formatarDoc = (d) => d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d;
const filtroIds = (tb, ids) => {
  const v = [...new Set((ids || []).map(String).filter(x => /^\d+$/.test(x) && x !== '0'))];
  if (!v.length) return { TB: tb, OP: '=', P: '0' };
  return v.length === 1 ? { TB: tb, OP: '=', P: v[0] } : { TB: tb, OP: 'IN', P: v.join(',') };
};
const corpoIds = (tab, campo, ids) => ({ qtype: tab + '.id', query: '0', oper: '>', page: '1', rp: '5000',
  sortname: tab + '.id', sortorder: 'asc', grid_param: JSON.stringify([filtroIds(tab + '.' + campo, ids)]) });
const VAZIO = (tab) => ({ qtype: tab + '.id', query: '0', oper: '=', page: '1', rp: '1' });
// Campo do contrato na O.S.: o IXC usa id_contrato_kit (confirmado no painelixc); id_contrato fica de reserva.
const CAMPOS_CONTRATO_OS = ['id_contrato_kit', 'id_contrato'];
// ---- fim do comum ----
