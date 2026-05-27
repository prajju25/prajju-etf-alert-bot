# Use official Node image (Alpine = smaller memory footprint)
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy project files
COPY . .

# Limit Node.js heap to stay within free tier 256MB RAM
ENV NODE_OPTIONS=--max-old-space-size=200

# Expose health check port (required by Back4App Containers)
EXPOSE 3000

# Run the main bot (all cron jobs: daily savings, market scan, monthly reset)
CMD ["node", "index.js"]