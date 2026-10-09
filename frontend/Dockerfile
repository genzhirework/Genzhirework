# One image per Angular app; the APP service variable (web | employer | recruiter | admin)
# is passed by Railway as a build argument.
FROM node:24-bookworm-slim AS build
ARG APP
ENV NG_CLI_ANALYTICS=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN test -n "$APP" || (echo "APP build variable is required (web|employer|recruiter|admin)" && exit 1)
RUN npx ng build "$APP"

FROM node:24-bookworm-slim
ARG APP
ENV APP=$APP NODE_ENV=production
WORKDIR /app
COPY --from=build /app/server.mjs ./
COPY --from=build /app/dist/$APP ./dist/$APP
USER node
CMD ["node", "server.mjs"]
