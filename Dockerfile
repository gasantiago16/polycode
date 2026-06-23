# polycode server image — runs the same agent engine over HTTP+SSE.
#
#   docker build -t polycode-server .
#   docker run --rm -p 8787:8787 -e OPENAI_API_KEY=sk-... polycode-server
#
# Provide provider keys via env (OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY /
# XAI_API_KEY). POST /chat {"message":"..."} streams SSE; GET /health -> {ok}.

# ---- build: install workspace + bundle the CLI ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @polycode/cli build

# ---- runtime: only the bundle + its production deps ----
FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY --from=build /app/packages/cli/package.json ./package.json
COPY --from=build /app/packages/cli/dist ./dist
RUN pnpm install --prod --no-frozen-lockfile

ENV NODE_ENV=production
EXPOSE 8787
# Tools run in the default (local) sandbox inside the container, which is the
# isolation boundary. For per-session container isolation, front this with an
# orchestrator that spawns one container per session.
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--serve", "--port", "8787"]
