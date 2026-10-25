.PHONY: lint

include cardpod.env
export

BINARY := cardpod

# Ports used by the dev servers (frontend, backend, and PocketBase-style API)
PORTS := 3000 3001

.PHONY: all
all: # (*) Build frontend assets and start the server
	go run ./cmd/$(BINARY) superuser upsert admin@mail.internal password --dir=pb_data
	go run ./cmd/$(BINARY) serve


init:
	fastmod --hidden cardpod $(notdir $(CURDIR)) --glob '!Makefile'
	fastmod --hidden CARDEX $(shell echo '$(notdir $(CURDIR))' | tr '[:lower:]' '[:upper:]') --glob '!Makefile'
	find . -depth \( -type f -o -type d \) -name '*cardpod*' | while read -r f; do \
		mv -- "$$f" "$$(dirname "$$f")/$$(basename "$$f" | sed 's/cardpod/$(notdir $(CURDIR))/g')"; \
	done
	fastmod cardpod $(notdir $(CURDIR))



.PHONY: deps-front
deps-front:
	cd frontend && bun install

.PHONY: build-front
build-front: deps-front
	cd frontend && bun run build

.PHONY: build
build: build-front
	go build -ldflags="-X github.com/asano69/cardpod/internal/version.Version=$(VERSION)" -o $(BINARY) ./cmd/$(BINARY)

.PHONY: build-back
build-back:
	go build -ldflags="-X github.com/asano69/cardpod/internal/version.Version=$(VERSION)" -o $(BINARY) ./cmd/$(BINARY)


.PHONY: server
server: 
	#./cardpod migrate up --dir=pb_data
	./$(BINARY) superuser upsert admin@mail.internal password --dir=pb_data
	./$(BINARY) serve --dev

# --------------
.PHONY: clean
	rm -fr ./tmp/ # air
	rm -fr frontend/node_modules/.vite

# port: 3001
.PHONY: dev-front
dev-front: clean
	bunx concurrently -n "frontend,backend" -c "blue,green" "cd frontend && bun dev" "go run ./cmd/$(BINARY) serve --dev"

# port: 3000
.PHONY: dev-back
dev-back: clean
	bunx concurrently -n "frontend,backend" -c "blue,green" "cd frontend && bun watch" "air"


# Regenerates the TypeScript API types from internal/api. Commit the result:
# the Docker build has no Go toolchain in its frontend stage.
.PHONY: generate
generate:
	go tool tygo generate

.PHONY: test
test: test-front test-back

test-back:
	go test ./cmd/... ./internal/... ./scripts/...

test-front:
	cd frontend && bun run test

lint: typecheck
	golangci-lint run
	cd frontend && bun run lint --fix
	cd frontend && bun run lint:css

.PHONY: typecheck
typecheck: generate
	cd frontend && bun run typecheck



format:
	cd frontend && bunx prettier --write "src/**/*.{js,jsx,ts,tsx,css}"

# 本番では、後方互換性のために残しておいたほうが良いかも。
migrate-collections:
	ls -1 migrations/*.go | sort | head -n -1 | xargs rm -f
	yes | go run ./cmd/cardpod migrate collections
	ls -1 migrations/*.go | sort | head -n -1 | xargs rm -f

install: build
	go install ./cmd/$(BINARY)


