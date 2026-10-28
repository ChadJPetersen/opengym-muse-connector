FROM node:22-alpine
WORKDIR /srv
COPY package.json ./
COPY src/ ./src/
USER node
ENV LISTEN_HOST=0.0.0.0
ENV PORT=8765
ENV ALLOW_REMOTE_LISTEN=yes
EXPOSE 8765
CMD ["node", "src/server.mjs"]
