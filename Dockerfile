# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1.3.10@sha256:b86c67b531d87b4db11470d9b2bd0c519b1976eee6fcd71634e73abfa6230d2e AS base
WORKDIR /usr/src/app

# copy production dependencies and source code into final image
FROM base AS release
COPY . .
RUN bun install --frozen-lockfile --production

# run the app
USER bun
ENV NODE_ENV=production
ENTRYPOINT [ "bun", "--preload", "./src/sentry.ts", "./src/index.ts" ]
