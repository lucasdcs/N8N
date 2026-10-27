// Workflow: WhatsApp - Comandos ixc e consulta de escala (WAHA)
// No: IXC Cmd: Finalizar

// Confere no WAHA (/api/contacts/check-exists) se o numero tem WhatsApp (usa o chatId real, que resolve o 9o digito) e monta o SQL.
// Valores do usuario vao escapados como literal; quem altera as tabelas e a funcao ixc.aplicar_comando.
const d = $('IXC Cmd: Interpretar').first().json;
const f = $('IXC Cmd: Filtrar').first().json;
const lit = v => v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";
let resposta = d.resposta, sql = 'SELECT NULL::text AS msg';
if (d.aplicar) sql = 'SELECT ixc.aplicar_comando(' + lit(f.autor) + ') AS msg';
else if (d.cancelar) sql = 'SELECT ixc.cancelar_comando() AS msg';
else if (d.acao) {
  const acao = Object.assign({}, d.acao);
  let aviso = '';
  if (d.fone_validar) {
    let r = $input.first().json;
    if (typeof r.data === 'string') { try { r = JSON.parse(r.data); } catch (e) {} }
    if (Array.isArray(r)) r = r[0] || {};
    const existe = (r.numberExists !== undefined) ? r.numberExists : r.exists; // WAHA: numberExists/chatId; Evolution: exists/jid
    const jidRaw = r.chatId || r.jid || '';
    if (existe === false) {
      return [{ json: { sql, resposta: '❌ O número ' + d.fone_validar + ' não tem WhatsApp. Confere e manda de novo.' } }];
    }
    const jid = String(jidRaw).split('@')[0];
    if (existe && /^\d+$/.test(jid)) { if (jid !== acao.fone) aviso = '\n(no WhatsApp o número é ' + jid + ', vou usar esse)'; acao.fone = jid; }
    else aviso = '\n⚠️ Não consegui confirmar se o número tem WhatsApp.';
  }
  sql = 'SELECT ixc.registrar_comando(' + lit(JSON.stringify(acao)) + '::jsonb, ' + lit(d.resumo) + ', ' + lit(f.autor) + ', ' + lit(f.texto) + ')::text AS msg';
  resposta = '📝 *Alteração pendente:* ' + d.resumo + aviso + '\n\nResponda *ixc ok* em até 15 min pra aplicar (ou *ixc cancelar*).';
}
return [{ json: { sql, resposta } }];

