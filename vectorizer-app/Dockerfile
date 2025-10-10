FROM node:20-alpine

# Sharp needs this on Alpine
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm ci --omit=dev

# Copy app
COPY server.js ./
COPY public ./public

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
