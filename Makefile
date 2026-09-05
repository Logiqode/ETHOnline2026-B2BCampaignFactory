# Wizard — local dev helpers
# Dockerized Postgres + Hono backend + Vite app.
#
#   make db-up       start Postgres (no local install needed)
#   make backend     run the API backend (bun, port 4000)
#   make app         run the Vite dev server (app)
#   make test        backend + app typecheck/tests
#   make down        stop Postgres

.PHONY: db-up db-down db-logs backend app test typecheck

db-up:
	docker compose up -d

db-down:
	docker compose down

db-logs:
	docker compose logs -f db

backend:
	cd backend && bun run dev

app:
	cd app && bun run dev

test:
	cd backend && bun run typecheck && bun test
	cd app && bun run build

typecheck:
	cd backend && bun run typecheck
	cd app && bun run build

down:
	docker compose down