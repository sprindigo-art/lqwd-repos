.PHONY: build run mock test test-race clean

BINARY=lnd-gateway
CMD_DIR=./cmd/lnd-gateway

build:
	CGO_ENABLED=1 go build -o $(BINARY) $(CMD_DIR)

run: build
	./$(BINARY)

mock: build
	GATEWAY_MOCK=true ./$(BINARY)

test:
	CGO_ENABLED=1 go test ./...

test-v:
	CGO_ENABLED=1 go test -v ./...

test-race:
	CGO_ENABLED=1 go test -race ./...

clean:
	rm -f $(BINARY)
	rm -f data/audit.db data/audit-fallback.jsonl data/idempotency.db

lint:
	go vet ./...
	@echo "Lint passed"
