FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm install
COPY backend backend
COPY frontend frontend
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY package.json ./
EXPOSE 3000
CMD ["node","backend/src/server.js"]
