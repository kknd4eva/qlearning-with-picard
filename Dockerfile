# Use the official Node.js 14 image as a parent image
FROM node:14

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json into the working directory
COPY package*.json ./

# Install any dependencies
RUN npm install

# Copy the rest of your app's source code from your host to your image filesystem
COPY . .

# Inform Docker that the container listens on the specified network port at runtime.
EXPOSE 3000

# Define the command to run your app using CMD which defines your runtime
CMD [ "node", "server.js" ]
