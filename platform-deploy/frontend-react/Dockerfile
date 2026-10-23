FROM  node:alpine AS builder

ARG env=prod # Optional default value to be `prod`
ARG NODE_ENV_ARG

WORKDIR /app

COPY package*.json ./

RUN npm cache clean --force && npm install --legacy-peer-deps

ENV PORT 3000
ENV NODE_ENV=$NODE_ENV_ARG

# COPY src/ src/
COPY . .
COPY .env.${env} .env
RUN ls -la && npm run build

# nginx state for serving content
FROM nginx:alpine

ARG env=prod # Optional default value to be `prod`

# to enable single page app support
# this action will be done in deployment yaml files
# COPY ./nginx/default.${env}.conf /etc/nginx/conf.d/default.conf

# Set working directory to nginx asset directory
WORKDIR /usr/share/nginx/html
# Remove default nginx static assets
RUN rm -rf ./*
# Copy static assets from builder stage
COPY --from=builder /app/build .
# Containers run nginx with global directives and daemon off
ENTRYPOINT ["nginx", "-g", "daemon off;"]