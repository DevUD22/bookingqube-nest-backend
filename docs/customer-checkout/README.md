# Customer Checkout, POS & Cafe API Docs

Importable API documentation for BookingQube V2 — customer storefront, event POS, and cafe menus/booking.

## Folder layout

```
docs/customer-checkout/
├── README.md
├── openapi/
│   └── customer-checkout.openapi.yaml   ← Swagger UI / Postman / Insomnia
└── postman/
    ├── BookingQube-Customer-Checkout.postman_collection.json
    └── BookingQube-Local.postman_environment.json
```

## Import — Swagger UI

1. Open [https://editor.swagger.io](https://editor.swagger.io) **or** your self-hosted Swagger UI.
2. **File → Import file** → select `openapi/customer-checkout.openapi.yaml`.
3. Tags appear as folders:
   - `01 Auth`
   - `02 Browse Catalog`
   - `03 Registration Events`
   - `04 Promocodes`
   - `05 Checkout Book Pay`
   - `06 Customer Account`
   - `07 POS Checkout`
   - `CAFE` (cafe POS auth, menu, tables, report, daily closings)

## Import — Postman

1. Postman → **Import** → select both files under `postman/`.
2. Choose environment **BookingQube Local**.
3. Set `baseUrl` (default `http://localhost:3002/api/v1`) and optionally `eventSlug`.
4. Run **01 Auth → Login** (saves `token`), **07 POS Checkout → POS Login** (saves POS `token`/`agentId`), or **CAFE → Auth → Cafe POS Login** (saves `cafePosToken`).
5. Folders match journey order. Set `posEmail` / `posPassword` for POS auth; `cafeAgentEmail` / `cafeAgentPassword` for cafe POS.

## Base URL

| Env | Example |
|-----|---------|
| Local (Nest `.env`) | `http://localhost:3002/api/v1` |
| Next.js upstream (Laravel/prod) | `https://bookingqube.com/api/v2` |
| Pattern | `{host}/{API_PREFIX}/{API_VERSION}` |

- Customer: `Authorization: Bearer <token>` from `POST /login`
- Admin cafe menus: `Authorization: Bearer <adminToken>` from `POST /admin/auth/login`
- POS / Cafe POS: primarily `agent_id` / `cafeAgentId` (JWT optional)

## Typical flows

**Customer (Next.js website):** browse → login → promo → MyFatoorah initiate/confirm **or** QPay → book-ticket → bookings  

**Payment methods on event detail:** `GET /events/{slug}/detail` returns `payment_methods` from **admin Payment settings** only (gateway `enabled` + `isActive`):

| Admin gateway | Method IDs | Names |
|---------------|------------|-------|
| `myfatoorah` | 10, 11, 12 | Apple Pay, Google Pay, MyFatoorah Card |
| `qpay` | 7 | NAPS |
| `mastercard` | 8 | Visa/MasterCard |

Free / zero-total uses `payment_method: 0` (always allowed; not listed). Nest rejects `book-ticket` / MyFatoorah initiate when the matching gateway is disabled.

**POS:** list agents → book-ticket (cash/card/split/advance/comp) → complete advance  

**Cafe:** admin login → menu CRUD → POS context/menu → book table → clear/settle  

## Not in system

| Method | Path | Status |
|--------|------|--------|
| GET | `/page/{slug}` | HTTP **501** — `{ "success": false, "message": "not in system", "data": null }` |

All other endpoints in this collection map to Nest controllers under `/api/v1`.

## Related (standalone copies)

- [`../pos-checkout/`](../pos-checkout/)  
- [`../cafe/`](../cafe/)  
- [`../README.md`](../README.md)  

## Live Nest Swagger

When the backend is running: `http://localhost:3002/docs`
