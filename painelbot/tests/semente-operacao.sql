-- 0.5.0: parâmetros e bases fictícios para os testes da operação (rodar como ixc depois do reset-banco.sh)
INSERT INTO ixc.parametros (chave, valor, descricao) VALUES
  ('envio', 'NENHUM', 'Modo dos workflows 01/02'), ('envio_lembretes', '', 'Modo dos lembretes'),
  ('envio_teste_para', '5541900000000', 'Numero de teste'), ('semtec_min', '10', 'Minutos sem tecnico'),
  ('realerta_horarios', '11:00,15:30', 'Horarios do reaviso'), ('aviso_privado', 'sim', 'Particular'),
  ('grupo_automacao', '120363000000000001@g.us', 'Grupo de automacao'), ('waha_session', 'sessao_teste', 'Sessao'),
  ('escala_trocar_nomes', '', 'Trocas'), ('chave_livre', 'x', NULL);
INSERT INTO ixc.empresas (id, nome, base_url, auth, last_evento_id, dono_id, ignorar_assuntos, semtec_sem_local, ativo, atualizado, assuntos_financeiros) VALUES
  ('AAA', 'Base Teste A', 'https://ixc.teste-a.com.br', 'Basic dGVzdGU6YQ==', 100, '52', '{30}', true, true, now() - interval '90 minutes', '{}'),
  ('BBB', 'Base Teste B', 'https://ixc.teste-b.com.br', 'Basic dGVzdGU6Yg==', 200, NULL, '{}', false, false, NULL, '{7,9}');
