FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  fluxbox \
  procps \
  xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium

COPY . .

RUN chmod +x docker/start.sh

EXPOSE 3000

CMD ["./docker/start.sh"]
