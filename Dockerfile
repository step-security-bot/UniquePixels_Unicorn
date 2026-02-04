# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1.3.8@sha256:371d30538b69303ced927bb5915697ac7e2fa8cb409ee332c66009de64de5aa3 AS base
WORKDIR /usr/src/app

# copy production dependencies and source code into final image
FROM base AS release
COPY . .
RUN bun install --frozen-lockfile --production

# run the app
USER bun
ENV NODE_ENV=production
ENTRYPOINT [ "bun", "--preload", "./src/sentry.ts", "./src/index.ts" ]
