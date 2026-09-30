FROM node:22-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY patches ./patches
COPY firebase/package.json ./firebase/package.json
COPY firebase/functions/package.json ./firebase/functions/package.json
COPY shopify-client/package.json ./shopify-client/package.json
RUN npm ci

COPY . .
RUN cd shopify-client && npx prisma generate
RUN npm run build --workspace=shopify-client
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV SHOPIFY_SESSION_STORAGE=firestore
ENV DATABASE_URL=file:/tmp/rapex-sessions.sqlite
COPY --from=build /app ./

WORKDIR /app/shopify-client
EXPOSE 8080
CMD ["npm", "run", "start"]
