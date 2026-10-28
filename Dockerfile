# Портал «Калькулятор КП»: сервер (api) + движок расчёта (engine) + собранный интерфейс (web/dist).
# Копия kp-calc/Dockerfile для сборки из корня репозитория (Timeweb App Platform): docker build -t kp-calc .

# 1. Интерфейс: собираем, только если он есть (web/package.json).
FROM node:22-slim AS web
WORKDIR /src
COPY kp-calc/ .
RUN mkdir -p /out \
 && if [ -f web/package.json ]; then \
      cd web && npm ci && npm run build && cp -r dist /out/dist; \
    else echo "web/package.json нет — образ без интерфейса"; fi

# 2. Сервер: Node 22 запускает TypeScript напрямую (снятие типов), сборка не нужна.
FROM node:22-slim
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY kp-calc/api/package.json kp-calc/api/package-lock.json ./api/
RUN cd api && npm ci --omit=dev && npm cache clean --force
COPY kp-calc/api/src ./api/src
COPY kp-calc/engine/package.json ./engine/package.json
COPY kp-calc/engine/src ./engine/src
COPY kp-calc/data/catalog.json ./data/catalog.json
COPY --from=web /out/ ./web/
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "api/src/server.ts"]
