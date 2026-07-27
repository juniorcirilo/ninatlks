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

COPY . .

EXPOSE 8080 3001

# Roda web (server.mjs via vite dev) e api (Nest) no mesmo container.
CMD ["npm", "run", "start:all"]
