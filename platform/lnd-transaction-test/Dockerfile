FROM golang:1.17-alpine as build

WORKDIR /app

COPY go.mod /app

RUN go mod download -x

COPY . .

RUN go build -o /lnd-test

FROM alpine:3.11.3
COPY --from=build /lnd-test /lnd-test


ENTRYPOINT ["/lnd-test"]