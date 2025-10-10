# Use full Debian base image for Sharp + Potrace compatibility
FROM node:20-slim

# Install system dependencies for Sharp and Potrace
RUN apt-get update && apt-get install -y \
    libc6 libjpeg-dev libpng-dev potrace \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
