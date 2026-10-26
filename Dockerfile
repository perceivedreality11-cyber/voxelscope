FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/app/data HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --chown=node:node package.json index.html styles.css favicon.svg ./
COPY --chown=node:node src ./src
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
