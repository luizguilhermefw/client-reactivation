# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

COPY . .

RUN npm ci

RUN npx prisma generate

RUN npm run build

# Stage 2: Production
FROM node:18-alpine AS production

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/src/main.js"]