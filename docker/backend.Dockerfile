FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY service/package.json service/package.json
RUN npm ci --ignore-scripts
COPY . .
ARG CHATE2EE_API_URL=
ARG CHATE2EE_ICE_SERVERS=[]
ARG CHATE2EE_ICE_TRANSPORT_POLICY=all
ENV CHATE2EE_API_URL=$CHATE2EE_API_URL
ENV CHATE2EE_ICE_SERVERS=$CHATE2EE_ICE_SERVERS
ENV CHATE2EE_ICE_TRANSPORT_POLICY=$CHATE2EE_ICE_TRANSPORT_POLICY
RUN npm run build:backend && npm run client:build

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --workspaces=false
COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
