# BookingQube Backend

NestJS API for BookingQube. The backend owns the customer, administrator, organizer, checkout, reporting, and legacy-migration APIs. It uses PostgreSQL through Prisma and optionally uses Redis for queues and caching.

## Requirements

- Node.js 20
- npm
- Docker Desktop (for the provided PostgreSQL and Redis services)

## Local setup

Run these commands from `bookingqube-backend`:

```bash
cp .env.example .env
npm install
docker compose up -d
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

`prisma:migrate` applies all development migrations. `prisma:seed` creates the local roles, organization, sample data, and administrator required by the admin panel. Both commands are safe to run again during development.

The development administrator is:

```text
Email: admin@bookingqube.test
Password: AdminPass123!
```

The seeded customer account for testing checkout is:

```text
Email: customer@bookingqube.test
Password: CustomerPass123!
```

Set `SEED_ADMIN_PASSWORD` before running the seed to use a different local password. Never use the example password outside local development.

## Local services

| Service                | URL                                   |
| ---------------------- | ------------------------------------- |
| API                    | `http://localhost:4000/api/v2`        |
| Health check           | `http://localhost:4000/health`        |
| Versioned health check | `http://localhost:4000/api/v2/health` |
| Swagger UI             | `http://localhost:4000/docs`          |
| OpenAPI JSON           | `http://localhost:4000/docs-json`     |
| PostgreSQL             | `localhost:5432`                      |
| Redis                  | `localhost:6379`                      |

The health response includes separate `database` and `redis` checks. Use it to confirm that the API is ready, rather than only checking whether port 4000 is open.

## Configuration

Copy `.env.example` to `.env`. The most important settings are:

| Variable                                               | Purpose                                       | Local default/example                     |
| ------------------------------------------------------ | --------------------------------------------- | ----------------------------------------- |
| `PORT`                                                 | HTTP port                                     | `4000`                                    |
| `API_PREFIX` / `API_VERSION`                           | Versioned route prefix                        | `api` / `v2`                              |
| `DATABASE_URL`                                         | PostgreSQL connection                         | Local Docker PostgreSQL                   |
| `REDIS_URL`                                            | Redis connection                              | Local Docker Redis                        |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`             | Customer token signing                        | Must be changed outside local development |
| `ADMIN_JWT_ACCESS_SECRET` / `ADMIN_JWT_REFRESH_SECRET` | Admin token signing                           | Must be changed outside local development |
| `CORS_ORIGINS`                                         | Comma-separated allowed browser origins       | Customer and admin local URLs             |
| `BACKEND_PUBLIC_URL`                                   | Public backend origin used in generated links | `http://localhost:4000`                   |
| `STORAGE_PROVIDER`                                     | Media storage implementation                  | See `.env.example`                        |
| `SEED_ADMIN_PASSWORD`                                  | Password used only by the development seed    | `AdminPass123!`                           |

OAuth, Azure storage, Seats.io, MyFatoorah, and legacy MySQL settings are documented inline in `.env.example`. Keep secrets out of committed environment files.

## API authentication

Swagger displays a lock on routes that require a bearer token. Obtain the appropriate access token from one of these flows, then select **Authorize** in Swagger:

- Administrator: `POST /api/v2/admin/auth/login`
- Organizer: `POST /api/v2/organizer/auth/login`
- Customer: `POST /api/v2/login`

Send the access token as `Authorization: Bearer <token>`. Admin and organizer refresh tokens use their respective `/refresh` endpoints.

## Event ownership and organiser access

BookingQube uses a platform-controlled hierarchy:

- The seeded `admin` role is the BookingQube Super Admin. Admin routes create events, organiser accounts, and event staff.
- An event may have one explicit `primaryOrganizerId`. `createdByUserId` remains audit metadata and does not grant organiser access.
- The assigned organiser must have an active organiser account. Assignment is explicit and does not depend on the event's internal tenancy record.
- Organiser event lists, dashboards, and detail routes are scoped to events whose `primaryOrganizerId` matches the authenticated user.
- Organisers cannot create, publish, archive, delete, reassign, or staff events.
- `PUT /api/v2/organizer/events/:id` only permits customer-facing content and start/end schedule updates for an assigned event.
- `PUT /api/v2/admin/events/:id/organizer` assigns or clears the primary organiser.

Event Manager, POS, scanner, finance, and HR accounts remain scoped `StaffAssignment` records created through protected Super Admin routes.
Organization records remain internal tenancy and reporting details; the admin UI exposes only the event owner selection.

## Database workflow

After changing `prisma/schema.prisma`, create and apply a development migration:

```bash
npm run prisma:migrate
```

Check whether the local database is current:

```bash
npx prisma migrate status
```

For a deployed environment, apply committed migrations without creating a new one:

```bash
npx prisma migrate deploy
```

Do not run the development seed in production.

## Common commands

| Command                             | Purpose                                        |
| ----------------------------------- | ---------------------------------------------- |
| `npm run start:dev`                 | Start the API in watch mode                    |
| `npm run build`                     | Compile the production build                   |
| `npm start`                         | Run the compiled build                         |
| `npm run lint`                      | Run ESLint                                     |
| `npm test`                          | Run unit tests                                 |
| `npm run test:e2e`                  | Run end-to-end tests                           |
| `npm run prisma:generate`           | Regenerate Prisma Client                       |
| `npm run prisma:migrate`            | Create/apply development migrations            |
| `npm run prisma:seed`               | Seed local development data                    |
| `npm run prisma:seed-cafe-pos-demo` | Seed the complete BQFood Cafe POS test fixture |

## Cafe POS demo fixture

After the main and vendor demo seeds have run, create or reset the isolated Cafe POS fixture:

```bash
npm run prisma:seed-cafe-pos-demo
```

Sign in with `cafe.pos@bqfood.test` / `CafePos123!`. The fixture provides 12 tables,
12 menu items, searchable customers, cash/card/split report history, and table 2 as an
open order. Valid promo codes are `CAFE10`, `FLAT5`, `COFFEE2`, and `FREEWATER`.
Negative promo cases are `FUTURE20`, `EXPIRED15`, `LIMIT0`, and `OTHERCAFE`.

## Troubleshooting

- If Prisma reports `P1001`, wait until `docker compose ps` shows PostgreSQL running, then restart the API.
- If the health check reports a failed database check, run `npx prisma migrate status`.
- If admin login fails on a new database, run `npm run prisma:seed`.
- If the browser reports a CORS error, add the exact frontend origin to `CORS_ORIGINS` and restart the API.

## Structure

This folder is self-contained so it can be split into a separate repository later.
