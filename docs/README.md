# BookingQube API Docs (importable)

Folder-wise OpenAPI + Postman collections for the V2 backend.

Base URL (local): `http://localhost:3002/api/v1`

| Folder | Scope | Import |
|--------|--------|--------|
| [`customer-checkout/`](./customer-checkout/) | **All-in-one:** Auth, browse, checkout, POS, cafe menus & POS | OpenAPI + Postman |
| [`pos-checkout/`](./pos-checkout/) | Event POS only (standalone copy) | OpenAPI + Postman |
| [`cafe/`](./cafe/) | Cafe menus + Cafe POS only (standalone copy) | OpenAPI + Postman |

## Quick import

### Swagger / OpenAPI
Import any `*/openapi/*.openapi.yaml` into [Swagger Editor](https://editor.swagger.io) or Postman (Import → OpenAPI).

### Postman
Import the matching `*/postman/*.postman_collection.json` **and** `*.postman_environment.json`, then select the environment.

## Suggested test order

1. **customer-checkout** — register/login → event tickets → hold → payments/confirm  
2. **pos-checkout** — agents → book-ticket (cash/advance) → complete advance  
3. **cafe** — admin login → menu CRUD → POS book table → clear/settle  

Live Nest Swagger (all decorated routes): `http://localhost:3002/docs`
