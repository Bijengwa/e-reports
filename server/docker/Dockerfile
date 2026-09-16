# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Dependencies are installed from the lockfile only, so the layer caches on
# package.json / pnpm-lock.yaml rather than on source changes.
#
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: `playwright`'s own postinstall would otherwise fetch a
# Chromium build for glibc, which does not run on this image's musl libc. The runtime stage below
# installs Alpine's own `chromium` package instead and points `PDF_CHROMIUM_PATH` at it.
FROM base AS deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
# Playwright's bundled Chromium is a glibc build and does not run on Alpine; this is the standard
# workaround — a system Chromium, launched with the same package's driver.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PDF_CHROMIUM_PATH=/usr/bin/chromium-browser
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
COPY drizzle ./drizzle

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
