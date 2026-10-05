FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY dist ./dist
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node","server/index.js"]
