FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npm ci

COPY . .

EXPOSE 8080


CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]