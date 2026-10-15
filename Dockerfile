FROM node:20-alpine3.20

WORKDIR /tmp

COPY package.json package-lock.json index.js index.html ./

RUN apk update && apk upgrade && \
    apk add --no-cache openssl curl gcompat iproute2 coreutils bash && \
    npm ci --omit=dev

CMD ["node", "index.js"]
