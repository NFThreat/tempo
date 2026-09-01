FROM node:24-alpine

WORKDIR /app

# deps first for layer caching (tsx runs the TS source directly)
COPY package.json ./
RUN npm install

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
