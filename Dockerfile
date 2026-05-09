# Stage 1: Build Go worker binary
FROM golang:1.23.3-alpine AS worker-builder

WORKDIR /worker
COPY services/worker/go.mod services/worker/go.sum ./
RUN go mod download

COPY services/worker/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /worker-bin ./cmd/worker/main.go

# Stage 2: Build Node.js app and bundle everything
FROM node:20-alpine

RUN apk add --no-cache openssl ca-certificates

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --include=dev && npm cache clean --force

COPY . .

RUN npx prisma generate
RUN npx react-router build
RUN npm prune --omit=dev

# Copy the Go worker binary into the final image
COPY --from=worker-builder /worker-bin /app/worker

CMD ["npm", "run", "start"]
