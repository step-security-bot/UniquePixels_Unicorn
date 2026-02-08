# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1.3.9@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521 AS base
WORKDIR /usr/src/app

# copy production dependencies and source code into final image
FROM base AS release
COPY . .
RUN bun install --frozen-lockfile --production

# run the app
USER bun
ENV NODE_ENV=production
ENTRYPOINT [ "bun", "--preload", "./src/sentry.ts", "./src/index.ts" ]
