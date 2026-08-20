# Legacy → V2 Event Migration Tool

Migrates **one event at a time** from old BookingQube (`Laravel + MySQL`) into the new backend (`NestJS + PostgreSQL / Prisma`).

## Admin UI

Open **Migration Tool** in the admin sidebar (`/migration-tool`).

**Hide with one click:** use **Hide from menu** on that page (this browser).

**Hide permanently:**
- set `SHOW_MIGRATION_TOOL = false` in `bookingqube-admin/src/lib/feature-flags.ts`, or
- set `NEXT_PUBLIC_ENABLE_MIGRATION_TOOL=false` in admin `.env.local`

## CLI

Core logic: `src/modules/admin-legacy-migration/legacy/`

```bash
npm run legacy:list
npm run legacy:inspect -- --old-event=58
npm run legacy:migrate -- --old-event=58 --create-event --dry-run
npm run legacy:migrate -- --old-event=58 --create-event
npm run legacy:verify -- --old-event=58 --new-event=<slug>
```

Env: `LEGACY_MYSQL_*` + `DATABASE_URL`

### Mapping

| Legacy MySQL | V2 PostgreSQL |
|--------------|---------------|
| `events.user_id` (organiser) | `Event.primaryOrganizerId` + org `owner` member + `AdminProfile` (organiser) |
| `bookings.pos_id` | `Order.bookedByAgentId` / `OrderItem.bookedByAgentId` + POS `StaffAssignment` |
| `organiser_groups` | `ThirdPartyVendor` |
| `tickets.org_group_id` | `TicketType.thirdPartyVendorId` (+ `OrderItem.thirdPartyVendorId`) |
| `tickets` (no packs) | `TicketType` normal/simple (`legacy-ticket-{id}`) |
| `playtime_packs` | `TicketVariant` on parent ticket (`legacy-pack-{id}`) |
| `bookings.playtime_pack_id` | `OrderItem` as `ticket_variant` + `metadata.legacy.booking_lines[]` |
| `common_order` group | `Order` |
| each `bookings` row | `OrderItem` |
| customer fields | `User` + `CustomerProfile` |
| `event_timing` + `event_timing_slots` / preferred | `Event.timingConfig` + `EventDate` / `EventSession` (weekly Individual → `daily.style=individual` day groups) |

Idempotent via `idempotencyKey = legacy-mysql:{oldCommonOrder}`. Use `--force` to re-import.
