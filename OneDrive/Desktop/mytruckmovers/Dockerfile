# Single-container deployment: Node API + realtime server, which also serves the
# built-in web app as static files. Works on Render, Railway, Fly.io, a plain VPS,
# or any host that can run a Docker image.
FROM node:20-alpine

WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
COPY web ./web

ENV NODE_ENV=production
ENV PORT=4000
# Driver document uploads live here — mount persistent storage at this path.
ENV UPLOADS_DIR=/app/server/data/uploads
RUN mkdir -p /app/server/data

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "server.js"]
