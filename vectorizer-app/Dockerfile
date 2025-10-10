FROM node:20-alpine

# Sharp dependency
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm ci --omit=dev

# Copy app files (all root-level frontend assets)
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
