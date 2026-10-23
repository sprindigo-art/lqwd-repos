FROM golang:1.17-alpine as build

WORKDIR /app
COPY . .
RUN go mod download -x
RUN go build -o /lnd_updater

FROM alpine:3.11.3
COPY --from=build /lnd_updater /lnd_updater
COPY --from=build /app/config-kubernetes.yml /config-kubernetes.yml


ENTRYPOINT ["/lnd_updater"]
CMD ["-inCluster"]