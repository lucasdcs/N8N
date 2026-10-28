# planta-loja — recorte da planta do shopping com a loja marcada

Serviço HTTP (Python + PyMuPDF, em Docker) usado pelos workflows **01** (aviso de Ativação/Vistoria) e **02** (lembrete de visita 1 h antes) do `whatsapp-ixc`. Recebe empresa + `id_condominio` + número da loja e devolve um PNG com o entorno da loja e a loja em vermelho. Veio do pacote de terceiro de 28/10/2026 ("planta nos avisos"); aqui só o código — **as plantas (PDF) e o índice não vão para o repositório público**, ficam no pacote de produção `planta-loja-<versão>.zip`.

## API

| Rota | Resposta |
|---|---|
| `POST /planta` `{"empresa":"PONTO","id_condominio":84,"loja":"SALA 102","nome":"..."}` | `{"ok":true,"imagem":"<png base64>","piso":"L1","lojas":["102"],"shopping":"Pátio Chapecó", ...}` |
| idem, loja não achada / repetida na planta / shopping sem planta | `{"ok":false,"motivo":"..."}` — **sem imagem, de propósito: planta errada é pior que nenhuma** |
| `GET /saude` | `{"ok":true,"shoppings":23}` |
| `POST /recarregar` | relê `dados/indice` sem reiniciar |

Entende `LOJA 102`, `SALA 102`, `Q10`/`QUIOSQUE 10`, compostas `1171/72/73`, piso-loja `L209` → `L2-09`.

## Arquivos

| Arquivo | O quê |
|---|---|
| `server.py` | a API (porta 3100, dados em `/dados`) |
| `indexar.py` | gera `dados/indice/<chave>.json` + `.csv` (loja;piso;nome) a partir de `dados/plantas.json` e dos PDFs |
| `ocr_camada.py` | planta escaneada (só imagem): grava texto invisível por OCR (precisa de `tesseract`) antes de indexar |
| `Dockerfile`, `.dockerignore` | imagem `python:3.12-slim` + `pymupdf==1.28.2` |
| `instalar.sh` | build + `docker run` na **rede do n8n** com o nome/alias `planta-loja`, porta só em `127.0.0.1:3100`, `dados/` montado só leitura, 1 GB de memória |
| `testar.sh` | `bash testar.sh PONTO 84 102` → grava `teste-PONTO-84-102.png` |

Estrutura na produção (`/root/planta-loja`): estes arquivos + `dados/plantas.json`, `dados/indice/`, `dados/plantas/<chave>/*.pdf`.

## Cobertura (28/10/2026)

23 shoppings, todos com `id_condominio` iguais aos de `ixc.locais`: 4B 199 200 201 202 243 244 275 276 · BUZZ 269 271 280 · PONTO 84 104 134 159 216 273 · CACTA 206 247 248 253 260 263. **Sem planta:** PONTO 110 (Riviera) e 144 (IFashion Tijucas) — o aviso sai só com texto.

## Planta nova ou atualizada

```bash
cd /root/planta-loja
cp <novo>.pdf dados/plantas/<chave>/<arquivo>.pdf        # nome SEM acento (ver lição abaixo); ajuste dados/plantas.json se mudar piso/arquivo
docker run --rm -v "$PWD:/w" -w /w/dados --entrypoint sh planta-loja:0.2.0 -c "cp /w/indexar.py . && python indexar.py <chave> && rm indexar.py"
curl -s -X POST http://127.0.0.1:3100/recarregar
bash testar.sh <EMPRESA> <id_condominio> <loja>
```

## Lições

- **Nomes de arquivo sem acento.** O zip original tinha `térreo.pdf`, `piso-ipê.pdf`, `1º-pavimento.pdf`; um `unzip` sem suporte a UTF-8 grava `t#U00e9rreo.pdf` e o serviço passa a responder "erro" para 5 shoppings (Estação, Ventura, Itajaí, Cascavel, Patteo Urupema) — **sem avisar**. No pacote 0.2.0 os 13 arquivos foram renomeados para ASCII e o `plantas.json`/índice ajustados.
- O índice entregue foi refeito aqui a partir dos PDFs (`indexar.py`, PyMuPDF 1.28.2): idêntico ao do pacote nos 23 shoppings.
- `montar_plantas.py` (do pacote original) não está aqui: monta a pasta a partir do Drive "Plantas Shoppings" com caminhos do servidor antigo e geraria de novo os nomes com acento.
