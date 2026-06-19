FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY . .

RUN npm ci

RUN npx prisma generate

RUN npm run build

FROM node:20-alpine AS production

RUN apk add --no-cache openssl

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/src/main.js"]