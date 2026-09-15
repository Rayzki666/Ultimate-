FROM node:22-alpine
WORKDIR /app
COPY server/server.mjs ./server/server.mjs
COPY js/ai-contract.mjs ./js/ai-contract.mjs
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node","server/server.mjs"]
