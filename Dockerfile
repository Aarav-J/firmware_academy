FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git cmake ninja-build python3 gcc-arm-none-eabi libnewlib-arm-none-eabi libstdc++-arm-none-eabi-newlib && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/workbench
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY firmware ./firmware
COPY scripts/setup-pico.ts ./scripts/setup-pico.ts
COPY server ./server
RUN node --import tsx scripts/setup-pico.ts && chmod -R a+rX /opt/workbench
ENV NODE_ENV=production
USER 65534:65534
ENTRYPOINT ["node", "--import", "tsx", "server/compile-job.ts"]
