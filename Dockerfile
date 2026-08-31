# polycode hosted server — same Agent loop over HTTP+SSE.
#
#   docker build -t polycode-server .
#   docker run --rm -p 8787:8787 \
#     -e POLYCODE_AUTH_TOKEN=... \
#     -e OPENAI_API_KEY=sk-... \
#     -v ${PWD}:/work \
#     polycode-server
#
# POST /chat  Authorization: Bearer <token>  {"message":"..."}  (SSE)
# GET  /health  public

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @polycode/cli build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY --from=build /app/packages/cli/package.json ./package.json
COPY --from=build /app/packages/cli/dist ./dist
RUN corepack pnpm install --prod --no-frozen-lockfile \
  && mkdir -p /work \
  && chown -R node:node /work

ENV NODE_ENV=production
ENV POLYCODE_HOST=0.0.0.0
EXPOSE 8787
WORKDIR /work
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["--serve", "--port", "8787"]
