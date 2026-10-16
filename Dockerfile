FROM node:22-alpine AS web
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
RUN npm run build

FROM golang:1.23 AS build
WORKDIR /src
COPY server/ ./
COPY --from=web /app/dist/ ./web/
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/mx .

FROM scratch
COPY --from=build /out/mx /mx
EXPOSE 8080
ENTRYPOINT ["/mx"]
