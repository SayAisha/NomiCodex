# Playwright image ships node + chromium + all shared libs (Render has none)
FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app
COPY package.json server.js ./
RUN npm install --omit=dev

ENV PORT=8788 NODE_ENV=production
EXPOSE 8788
CMD ["node", "server.js"]
