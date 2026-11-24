# Simulador do whatsapp-ixc (teste). O pacote de teste traz o node_modules (build sem internet); sem ele, instala o pg.
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN [ -d node_modules/pg ] || npm install --omit=dev --no-audit --no-fund
RUN mkdir -p /dados && chown node:node /dados
ENV PORTA=3999 DADOS=/dados TZ=America/Sao_Paulo
USER node
EXPOSE 3999
CMD ["node", "servidor.js"]
