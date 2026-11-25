FROM node:26-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci --include=dev \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY data/translations ./data/translations
RUN node scripts/build.ts && npm prune --omit=dev

# Seed translations shipped with the image; /data is the persistent volume.
RUN mkdir -p /data && cp -r data/translations /data/translations

VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server/index.ts"]
