FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# SENTRY_DSN must be visible to `npm run build`, not just at runtime: Vite inlines
# it into the CLIENT bundle via `envPrefix: ["VITE_", "SENTRY_DSN"]`. Railway does
# NOT inject service variables into a Dockerfile build unless the Dockerfile
# declares a matching ARG — without these two lines the browser SDK is compiled as
# `Sentry.init({ dsn: undefined })` and client-side error capture is silently dead
# while the server side (which reads process.env at runtime) keeps working.
# A Sentry DSN is a public, write-only ingest key, so persisting it as ENV in the
# image is safe. SENTRY_AUTH_TOKEN is NOT — when source-map upload is enabled it
# must be consumed as a build-only ARG and never promoted to ENV, or the secret is
# baked into an image layer.
ARG SENTRY_DSN
ENV SENTRY_DSN=$SENTRY_DSN

RUN npm run build

CMD ["npm", "run", "docker-start"]
