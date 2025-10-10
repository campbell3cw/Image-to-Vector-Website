# Use Node.js 20 Alpine base image
FROM node:20-alpine

# Sharp needs this on Alpine
RUN apk add --no-cache libc6-compat

# Set working directory
WORKDIR /app

# Copy and install dependencies
COPY package.json ./
RUN npm ci --omit=dev

# Copy all project files (server.js, index.html, CSS, JS, etc.)
COPY . .

# Set environment variables
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start the app
CMD ["npm", "start"]
