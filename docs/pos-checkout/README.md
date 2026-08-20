# POS Checkout & Booking APIs

Event POS workflow for BookingQube V2 — agent login, tickets, customers, book offline, advance payments, online ticket use, daily closing.

## Folder layout

```
docs/pos-checkout/
├── README.md
├── openapi/
│   └── pos-checkout.openapi.yaml
└── postman/
    ├── BookingQube-POS-Checkout.postman_collection.json
    └── BookingQube-POS-Local.postman_environment.json
```

## Folders / tags

| Folder | Endpoints |
|--------|-----------|
| **00 POS Auth** | `POST /pos/auth/login` |
| **00 POS Tickets** | `GET /pos/tickets` |
| **01 POS Agents** | `GET /pos/agents` |
| **01 POS Promocodes** | `GET /pos/promocodes/offers`, `POST /pos/promocodes/apply` |
| **02 POS Booking** | `POST /pos/book-ticket` |
| **03 POS Advance Payments** | `POST /pos/advance-payments/pending`, `.../complete` |
| **04 POS Customers** | `GET /pos/customers/options`, `GET /pos/customers/search`, `POST /pos/customers/resolve` |
| **05 POS Online Tickets** | `GET /pos/online-tickets/search`, `POST /pos/online-tickets/:id/use` |
| **06 POS Daily Closing (Shift)** | `GET /pos/shift` (sales report), `POST /pos/shift/close` |

## Inventory holds

Capacity **hold / sold** tracking runs only when schedule **"Limit tickets per bookable time (inventory)"** is enabled (`total_quantity` set). Unlimited sessions skip inventory reservation — paid POS/online bookings create the order directly; unpaid online still uses a short TicketHold only for payment-timeout expiry (no capacity hold).

## Typical POS flow

1. Set `posEmail` / `posPassword` (and optionally `eventId` if multi-event)
2. **POS Login** → saves `token`, `agentId`, `eventId`, `eventSlug`
3. **List POS Tickets** → saves `ticketId` (excludes `hide_from_pos`; shareholder-scoped when set). Also returns `addons` and `time_extensions` (each pack has a stable `id` and `scope`: `ticket` or `order`).
4. Optional: **Search / Resolve Customer** (`GET /pos/customers/search`, `POST /pos/customers/resolve`)
5. Optional: **List Offers** / **Apply Promocode** — with POS JWT, `event_slug` is optional on apply
6. **Book Ticket** with `offline_payment.mode` (`cash` | `card` | `split` | `advance` | `comp`). Optional `addons[]` and `time_extensions[{ id, quantity, ticket_id? }]`. With POS JWT, `agent_id` and `event_slug` are optional. **`schedule` is optional for POS** — when omitted, the server picks today’s current/next active slot, or else the next upcoming active session on a later date (Asia/Qatar).
7. If advance: **Pending** search → **Complete** with remaining `cash`/`card`
8. Optional: **Online tickets** search → use (RFID/barcode)
9. End of day: **Get Shift Report** → **Close Shift** (creates `DailyClosing`; blocks further sales that day)

Named addon / time-extension unit counts appear on event **Tickets** reports under **Addons & time extensions detail** (existing money columns stay unchanged).

## Auth

- **POS Login** issues a dedicated Bearer JWT (`typ: pos_access`) scoped to the agent's `StaffAssignment` event.
- Login `data.event` includes `currency`, `requires_waiver`, `waiver_form`, `waiver_form_ar`.
- Ticket list, customers, online tickets, and shift endpoints require that POS token.
- Booking endpoints still accept optional customer/admin JWT; effective seller identity is **`agent_id`**.

## Ticket visibility

`GET /pos/tickets` returns:

- **tickets** — `status = active`, `hide_from_pos = false`, sales window, shareholder / ticket_type scope
- **addons** — active, not cafe-only, `hide_from_pos = false`
- **time_extensions** — from event `more_ops_config`; legacy packs default to `scope: ticket`, while `scope: order` applies to every regular ticket and may be free or paid

**Shareholder scope (tickets):**
- Agent has third-party shareholder(s) → only tickets linked to those vendors
- No shareholder → all offline tickets for the event
- within assignment `ticket_type_ids` when configured (empty = all in scope)

## Local sample POS agent

After the main seed, create a shareholder-scoped POS agent on `sample-family-experience`:

```bash
npm run prisma:seed-sample-pos
```

| Field | Value |
|-------|-------|
| Email | `pos-agent@example.com` |
| Password | `password` |
| Event | `sample-family-experience` |
| Shareholder | Sample Share Partner |
| Tickets | Share Partner Adult, Share Partner Family Pack |

## Import

- **Swagger:** import `openapi/pos-checkout.openapi.yaml`
- **Postman (POS only):** `postman/BookingQube-POS-Checkout.postman_collection.json` + `BookingQube-POS-Local.postman_environment.json`
- **Postman (combined):** **07 POS Checkout** (and **CAFE**) in `docs/customer-checkout/postman/BookingQube Customer Checkout, POS & Cafe.postman_collection.json` with `BookingQube-Local.postman_environment.json`

Base URL: `http://localhost:3002/api/v1`
