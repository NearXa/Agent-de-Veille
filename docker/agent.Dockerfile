# Agent de veille (scheduler) : Node 22 + pnpm, exécute `pnpm agent watch` selon config/sources.yaml.
FROM node:22-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY agent ./agent
COPY config ./config
CMD ["pnpm", "agent", "watch"]
