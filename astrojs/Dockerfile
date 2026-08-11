# Multi-stage production build for the Astro.js dashboard.
# The dashboard proxies Google Health server-side; it does NOT need the Rust MCP.

# 1) install + check + test + build
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm test && npm run build

# 2) minimal runtime with a non-root user
FROM node:20-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY .env.example ./

# Chrome/Playwright not needed; just the standalone Node server.
RUN useradd --create-home --uid 10001 dashboard
USER dashboard
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server/entry.mjs"]
