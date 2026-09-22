FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY service/package.json service/package.json
RUN npm ci
COPY . .
ARG CHATE2EE_API_URL
ARG CHATE2EE_ICE_SERVERS=[]
ARG CHATE2EE_ICE_TRANSPORT_POLICY=all
ENV CHATE2EE_API_URL=$CHATE2EE_API_URL
ENV CHATE2EE_ICE_SERVERS=$CHATE2EE_ICE_SERVERS
ENV CHATE2EE_ICE_TRANSPORT_POLICY=$CHATE2EE_ICE_TRANSPORT_POLICY
RUN npm run client:build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
