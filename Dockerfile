# Stage 1: Build Stage
FROM node:20-alpine AS build

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy the rest of the application files
COPY src src
COPY config.yaml config.yaml
COPY sample_media sample_media

# Stage 2: Production Stage
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Copy only the necessary files from the build stage
COPY --from=build /app /app

# Declare a build argument for the port
ARG PORT=3000

# Expose the port supplied during build or default to 3000
EXPOSE ${PORT}

# Set the default command
CMD ["npm", "run", "server"]
