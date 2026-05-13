FROM node:22-alpine AS base
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/dev.sqlite

RUN mkdir -p /data

FROM base AS build
ENV NODE_ENV=development

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

FROM base AS production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json /app/package-lock.json ./
COPY . .

CMD ["npm", "run", "docker-start"]
