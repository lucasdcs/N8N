// ============ CONFIG — Ativar contrato na RESOLUTTO (espelho das bases de origem) ============
// Regra: O.S. de "Ativação Link Normal" FINALIZADA numa base de origem + contrato dessa O.S. ATIVO na origem
//        -> o cliente de mesmo CNPJ/CPF na RESOLUTTO tem o seu ÚNICO pré-contrato (status P) ativado.
const cfg = {
  // NENHUM = não faz nada | SIMULAR = mostra o que faria (padrão) | REAL = ativa de verdade (só no n8n de PRODUÇÃO)
  MODO: 'SIMULAR',

  // Base de origem -> assuntos que disparam (Ativação Link Normal). A RESOLUTTO é sempre o destino.
  ORIGENS: {
    '4B':  [16],
    PONTO: [4],
    CACTA: [43],
    BUZZ:  [45],
  },

  // Olha as O.S. finalizadas nas últimas N horas (data_fechamento). O que já foi resolvido não é relido (memória do workflow).
  JANELA_HORAS: 48,
  MAX_OS_RODADA: 200,          // O.S. lidas por rodada (as mais antigas primeiro)
  MAX_ATIVACOES_RODADA: 10,    // trava: contratos ativados por rodada

  STATUS_ORIGEM_OK: ['A'],     // status do contrato na origem que libera a ativação
  STATUS_PRE: ['P'],           // pré-contrato na RESOLUTTO (o único que pode ser ativado)
  STATUS_ATIVO: ['A'],         // já ativo na RESOLUTTO = nada a fazer

  IGNORAR_DOCS: [],            // CNPJ/CPF (só dígitos) que nunca são ativados automaticamente
  TZ: 'America/Sao_Paulo',
};

const local = (d) => d.toLocaleString('sv-SE', { timeZone: cfg.TZ }).replace('T', ' ');
const agora = new Date();
cfg.agora = local(agora);
cfg.desde = local(new Date(agora.getTime() - cfg.JANELA_HORAS * 3600000));

// Corpo da leitura das O.S. finalizadas, por base (1 chamada por base).
const filtroIds = (tb, ids) => {
  const v = [...new Set((ids || []).map(String).filter(x => /^\d+$/.test(x) && x !== '0'))];
  if (!v.length) return { TB: tb, OP: '=', P: '0' };
  return v.length === 1 ? { TB: tb, OP: '=', P: v[0] } : { TB: tb, OP: 'IN', P: v.join(',') };
};
cfg.corpoOS = {};
for (const [b, assuntos] of Object.entries(cfg.ORIGENS)) {
  const grid = cfg.MODO === 'NENHUM'
    ? [{ TB: 'su_oss_chamado.id', OP: '=', P: '0' }]
    : [filtroIds('su_oss_chamado.id_assunto', assuntos),
       { TB: 'su_oss_chamado.status', OP: '=', P: 'F' },
       { TB: 'su_oss_chamado.data_fechamento', OP: '>=', P: cfg.desde }];
  cfg.corpoOS[b] = { qtype: 'su_oss_chamado.id', query: '0', oper: '>', page: '1', rp: '1000',
    sortname: 'su_oss_chamado.id', sortorder: 'asc', grid_param: JSON.stringify(grid) };
}
return [{ json: { cfg } }];
