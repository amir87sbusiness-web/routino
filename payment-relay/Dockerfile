FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json relay.js server-core.js server.js ./

USER node
EXPOSE 3000
CMD ["node", "server.js"]
