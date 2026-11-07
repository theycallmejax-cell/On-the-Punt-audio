FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY *.m4a ./
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
