# GenZHire API. Dev dependencies stay in the image so `npx prisma migrate deploy`
# and `npm run db:seed` can be run from a Railway shell.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npx prisma generate && npm run build
ENV NODE_ENV=production
# Runs as root: Railway volumes (STORAGE_DIR) are mounted root-owned.
EXPOSE 3000
CMD ["node", "dist/main.js"]
