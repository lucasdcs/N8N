// Workflow: Escalas - Sync planilha ESCALAS (aba HOJE) (WAHA)
// No: Tem Alerta?

const a = $('Montar Escala').first().json.alerta;
return a ? [{ json: { texto: a } }] : [];
