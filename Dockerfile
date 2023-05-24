# Dockerfile for building a docker image for a type script web project. 
# pull base image
FROM node:12.2.0-alpine

# set working directory
WORKDIR /usr/src/app

# add `/usr/src/app/node_modules/.bin` to $PATH
ENV PATH /usr/src/app/node_modules/.bin:$PATH

# install and cache dependencies
COPY ./package.json /usr/src/app/package.json
COPY ./main.ts /usr/src/app/main.ts
COPY ./tsconfig.json /usr/src/app/tsconfig.json
COPY ./yarn.lock /usr/src/app/yarn.lock
RUN yarn
CMD ["yarn", "start"]