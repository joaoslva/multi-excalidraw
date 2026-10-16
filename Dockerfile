FROM golang:1.23 AS build
WORKDIR /src
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/mx .

FROM scratch
COPY --from=build /out/mx /mx
EXPOSE 8080
ENTRYPOINT ["/mx"]
