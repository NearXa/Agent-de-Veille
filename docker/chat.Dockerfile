# Assistant de chat (Next.js + AI SDK) : lit le store monté en volume et le .env de la racine.
FROM node:22-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY chat/package.json ./chat/package.json
RUN pnpm install --frozen-lockfile --filter veille-grc-chat
COPY chat ./chat
RUN pnpm --filter veille-grc-chat build
ENV VEILLE_ROOT=/app
EXPOSE 3000
CMD ["pnpm", "--filter", "veille-grc-chat", "start"]
