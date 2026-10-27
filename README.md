# N8N — Automações IXC + Painel IXC

Repositório da verdade das automações sobre a API do IXC em 5 bases (Resolutto, 4BTELECOM, PONTO, CACTA e BUZZ).

| Pasta | Conteúdo | Versões |
|---|---|---|
| `painelixc/` | Plugin **Painel IXC** para GLPI 11 (autor SCDell, GPLv3+). Copie para `glpi/plugins/painelixc` | tags `painelixc-vX.Y.Z` + Release com o zip |
| `painelixc/n8n/` | Modelos e scripts de geração dos workflows do painel | junto com o plugin |
| `n8n/` | Cópia limpa dos workflows **ativos** na produção ([detalhes](n8n/README.md)) | tags `n8n-AAAA-MM-DD` |
| `whatsapp-ixc/` | Notificações de chamados IXC nos grupos de WhatsApp (WAHA): 4 workflows + schema `ixc` no PostgreSQL ([detalhes](whatsapp-ixc/README.md)) | tags `whatsapp-ixc-vX.Y.Z` + Release com o zip |

## Plugin: instalar / atualizar

```bash
cd /var/www/html/glpi/plugins
unzip -o /home/resolutto/painelixc-X.Y.Z.zip
chown -R www-data:www-data painelixc
runuser -u www-data -- php /var/www/html/glpi/bin/console plugin:install --force --username=glpi painelixc
runuser -u www-data -- php /var/www/html/glpi/bin/console plugin:activate painelixc
runuser -u www-data -- php /var/www/html/glpi/bin/console cache:clear
systemctl restart apache2
```

Requisitos: GLPI 11.0.x e PHP 8.2+.

Quando a versão muda, o GLPI desativa o plugin até rodar o `plugin:install`. A instalação é idempotente e não apaga dados.

## Segurança (repositório público)

Nunca versionar:
- tokens, senhas, hash de API do IXC, `.ixc_token`;
- dumps `.sql`, backups;
- telefones, CPF ou nomes de clientes e de funcionários.

Antes de cada push, rode a busca de segredos, e ela tem que voltar vazia. Se algo vazar, revogue o segredo na hora: apagar do histórico não basta.
