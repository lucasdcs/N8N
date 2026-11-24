# Simulador do whatsapp-ixc (ambiente de teste) — 0.1.1

WhatsApp e IXC **de mentira** para testar o bot e os avisos no servidor de teste antes da produção.
Nada sai para o WhatsApp real nem chega ao IXC real.

```
navegador ──► ixc-simulador:3999 (tela de grupos + IXC simulado)
                 │  ▲
  mensagem do    │  │ envios do bot (sendText/sendImage), consultas ao IXC, planta
  grupo (webhook)▼  │
              n8n de teste: [SIM] 01, 02, 03, 04 ──► pbot-pg-teste (banco de teste)
```

| Peça | O que faz |
|---|---|
| `servidor.js` | Um serviço Node (porta 3999): WAHA simulado (`/api/sendText`, `/api/sendImage`, `/api/contacts/check-exists`), IXC simulado (`/ixc/<empresa>/webservice/v1/...`: `su_oss_chamado_mensagem`, `su_oss_chamado`, `cliente`, `su_oss_assunto`, com `qtype/oper/query/grid_param`), planta de exemplo (`/planta`) e a tela (usuário `sim`, senha em `.senha`). Lê grupos, shoppings e técnicos do banco de teste. Conversas e chamados ficam no volume `ixc_simulador_dados`. |
| `public/` | Tela: grupos à esquerda, conversa no meio (escrever "como" você ou como um técnico), IXC simulado à direita (abrir chamado, assumir, transferir, agendar, envelhecer, fechar), botões ▶ para rodar os workflows na hora, chave "WAHA fora do ar". |
| `gerar_sim.py` | Gera as cópias `[SIM]` dos 4 workflows de produção: endereços do WAHA, IXC e planta **fixos** no simulador, sem credencial do WAHA, Postgres = credencial "Postgres SIMULADOR", webhook `sim-ixc-whatsapp` e webhooks `sim-rodar-01/02/04`. No fim confere que nenhum nó HTTP aponta para fora (só a planilha do Google no 04, leitura). |
| `banco-sim.sql` / `banco-desfazer.sql` | Aponta o banco de teste para o simulador (`base_url`, `auth` fictício, `waha_url`, `envio = REAL`) guardando os valores antigos em `ixc.sim_antes`; o desfazer devolve. |
| `instalar.sh` / `remover.sh` | Instala/atualiza tudo no servidor de teste (recusa rodar na produção) / remove. |
| `check/` | `teste_api.js` (26), `teste_e2e.js` (15, com n8n de verdade), `teste_painel.js` (texto editado no painel vale no aviso), `teste_12x36.js` (5: nome do cadastro no 12x36, resumo do botão). |

**0.1.1** — os botões ▶ esperam a rodada terminar e mostram um resumo (empresas consultadas, eventos novos, chamados sem técnico, visitas, mensagens enviadas e, quando não sai nada, o porquê). Workflows [SIM] gerados da whatsapp-ixc 0.4.1.

## Gerar o pacote de teste

O pacote leva os workflows de **produção** convertidos (têm telefones e grupos reais): **não vai para o GitHub**.

```bash
python3 gerar_sim.py <pasta com os 4 JSON de producao 0.4.1> n8n
npm install --omit=dev          # node_modules vai no zip (o build no servidor não precisa de internet para o npm)
```

## Instalar (servidor de teste, root)

```bash
cd /opt && unzip -oq /home/resolutto/ixc-simulador-0.1.1.zip && bash /opt/ixc-simulador/instalar.sh
```

Abrir `http://10.120.100.54:3999/` (usuário `sim`, senha: `cat /opt/ixc-simulador/.senha`).

## Limites

- Re-alerta de sem técnico segue `realerta_min`/horário do banco (o tempo real conta); para testar rápido, baixar o `realerta_min` no banco de teste.
- O WF 04 lê a planilha ESCALAS real (só leitura) e grava a escala no banco de teste.
- Comandos `ixc ...` aplicados (`ixc ok`) mudam o **banco de teste**, como na produção.
- Se o banco de teste for refeito a partir da produção, rodar o `instalar.sh` de novo.
