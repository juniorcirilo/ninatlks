FROM node:22-alpine
WORKDIR /app

# Segredos não ficam hardcoded na imagem — passados via env_file/environment
# no docker-compose.yml em tempo de execução (ver .env.example).

# Frontend (TanStack Start / Vite)
COPY package*.json ./
RUN npm install

# Backend (NestJS)
COPY server/package*.json ./server/
RUN npm install --prefix server

# OpenCode CLI: agente de IA do atendimento. Fala com o provedor compatível
# com a API da OpenAI que a conta configurar (nunca os modelos gratuitos da
# Zen do próprio OpenCode). Roda como usuário sem privilégio ("node", uid
# 1000) em /data/opencode/<conta>.
RUN apk add --no-cache libstdc++ libgcc \
 && npm install -g opencode-ai \
 && mkdir -p /data/opencode && chown node:node /data/opencode

COPY . .

# API compilada (dist/main): em produção não roda "nest start --watch".
RUN npm run build --prefix server

EXPOSE 8080 3001

# Web (vite dev) e api (Nest compilado, NODE_ENV=production) no mesmo container.
CMD ["npm", "run", "start:container"]
