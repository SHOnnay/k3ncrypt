FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY service/package.json service/package.json
RUN npm ci --ignore-scripts
COPY . .
ARG CHATE2EE_API_URL=
ARG CHAT_LINK_DOMAIN=
ARG CHATE2EE_ICE_SERVERS=[]
ARG CHATE2EE_ICE_TRANSPORT_POLICY=all
ENV CHATE2EE_API_URL=$CHATE2EE_API_URL
ENV CHAT_LINK_DOMAIN=$CHAT_LINK_DOMAIN
ENV CHATE2EE_ICE_SERVERS=$CHATE2EE_ICE_SERVERS
ENV CHATE2EE_ICE_TRANSPORT_POLICY=$CHATE2EE_ICE_TRANSPORT_POLICY
RUN npm run build:backend && npm run client:build && node scripts/render-nginx.cjs /tmp/nginx.conf

FROM nginx:1.27-alpine
COPY --from=build /tmp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
