FROM node:20-slim
WORKDIR /srv/pedidos

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY tools ./tools
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
