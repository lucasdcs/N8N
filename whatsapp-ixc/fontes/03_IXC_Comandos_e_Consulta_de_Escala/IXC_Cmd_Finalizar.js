// Workflow: WhatsApp - Comandos ixc e consulta de escala (WAHA)
// No: IXC Cmd: Finalizar

// 0.3.0 (Painel do Bot): textos editaveis em ixc.mensagens; sem texto editado usa o padrao embutido na chamada.
const MSG_ = (() => { try { let c = $('IXC Cmd: Carregar').first().json.cfg; if (typeof c === 'string') c = JSON.parse(c); return (c && c.mensagens) || {}; } catch (e) { return {}; } })();
const OFF_ = Object.keys(MSG_).some(k => MSG_[k] === null);  // 0.5.0: alguma mensagem desativada no Painel do Bot
function M(chave, padrao, v) {
  if (MSG_[chave] === null) return '';  // 0.5.0: desativada no Painel do Bot
  // 0.6.3: variavel do bot desativada no painel (vsys.<nome>) = vazia em todas as mensagens
  if (v) { const v2_ = {}; for (const k of Object.keys(v)) v2_[k] = MSG_['vsys.' + k] === null ? '' : v[k]; v = v2_; }
  const t = typeof MSG_[chave] === 'string' && MSG_[chave].trim() ? MSG_[chave] : padrao;
  if (!v) return t;
  const vazio = k => v[k] === null || v[k] === undefined || String(v[k]) === '';
  return t.split('\n').map(l => {
    const ks = [...l.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]).filter(k => k in v);
    const vz = ks.filter(vazio);
    // linha so com variaveis vazias (e emoji/pontuacao): some
    if (ks.length && vz.length === ks.length && !/[\p{L}\p{N}]/u.test(l.replace(/\{[a-z_]+\}/g, ''))) return null;
    const s = l.replace(/\{([a-z_]+)\}/g, (x, k) => (k in v ? (vazio(k) ? '' : String(v[k])) : x));
    return vz.length ? s.replace(/[\s—·:-]+$/u, '') : s;
  }).filter(l => l !== null).join('\n');
}
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
      return [{ json: { sql, resposta: M('cmd.sem_whatsapp', '❌ O número {telefone} não tem WhatsApp. Confere e manda de novo.', { telefone: d.fone_validar }) } }];
    }
    const jid = String(jidRaw).split('@')[0];
    if (existe && /^\d+$/.test(jid)) { if (jid !== acao.fone) aviso = '\n(no WhatsApp o número é ' + jid + ', vou usar esse)'; acao.fone = jid; }
    else aviso = '\n' + M('cmd.nao_confirmou_whatsapp', '⚠️ Não consegui confirmar se o número tem WhatsApp.');
  }
  sql = 'SELECT ixc.registrar_comando(' + lit(JSON.stringify(acao)) + '::jsonb, ' + lit(d.resumo) + ', ' + lit(f.autor) + ', ' + lit(f.texto) + ')::text AS msg';
  resposta = M('cmd.pendente', '📝 *Alteração pendente:* {alteracao}\n\nResponda *ixc ok* em até 15 min pra aplicar (ou *ixc cancelar*).', { alteracao: d.resumo + aviso });
}
if (typeof resposta === 'string' && !resposta.trim() && sql === 'SELECT NULL::text AS msg') return [];  // 0.5.0: resposta desativada no Painel do Bot
return [{ json: { sql, resposta } }];

