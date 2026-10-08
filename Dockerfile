# Backend image: Bun, Elysia and the Prisma client. Build with `docker build -t dating-backend .`
# Configuration comes only from environment variables (see .env.example), never from the image.

FROM oven/bun:1.4.2 AS deps
WORKDIR /app
# Dev dependencies are not needed to run the server. `prisma` is a normal dependency, because
# the container applies the migrations when it starts. The Prisma client is committed in
# src/generated, so nothing has to run `prisma generate` here.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://localhost:${process.env.PORT}/api/v1/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Apply pending migrations, then start the server. `exec` lets the server receive stop signals.
CMD ["sh", "-c", "bun run db:deploy && exec bun src/index.ts"]
