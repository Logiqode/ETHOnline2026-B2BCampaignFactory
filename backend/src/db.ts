import postgres from 'postgres'

// Connection is built from DATABASE_URL. Compose sets it for the backend container;
// local dev uses .env (see .env.example). Port 5433 = the compose mapping, so the
// Dockerized Postgres never collides with a host-local Postgres on 5432.
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://wizard:wizard@localhost:5433/wizard'

export const sql = postgres(connectionString, {
  max: 5, // small pool — hackathon backend
  onnotice: () => {}, // swallow NOTICEs from migrations/init
})