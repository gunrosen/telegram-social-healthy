FROM node:lts-alpine

WORKDIR /app
COPY package.json ./
COPY package-lock.json.lock ./

RUN npm i -g pm2
RUN npm install
COPY . ./
RUN npm run build

CMD [ "pm2-runtime", "start", "pm2.config.json" ]