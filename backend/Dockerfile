FROM node:18-alpine

WORKDIR /app

COPY . .

RUN npm ci

RUN npx prisma generate

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main.js"]