# Cafe POS APIs

Cafe POS API reference for BookingQube V2.

## Postman

Use the **CAFE** folder in the main collection:

`docs/customer-checkout/postman/BookingQube-Customer-Checkout.postman_collection.json`

Environment: `docs/customer-checkout/postman/BookingQube-Local.postman_environment.json`

## Folder layout

```
docs/cafe/
├── README.md
└── openapi/
    └── cafe.openapi.yaml
```

## Postman collection structure (CAFE folder)

| Subfolder | Endpoints |
|-----------|-----------|
| **Auth** | `POST /pos/cafe/auth/login`, `GET /pos/cafe/me` |
| **Menu** | context, menu list/create category/subcategory/item |
| **Tables & Orders** | tables, book, clear |
| **Instant order** | `POST /pos/cafe/orders` (book + settle in one call) |
| **Customers** | `GET /pos/cafe/customers/search?q=` |
| **Promocodes** | `POST /pos/cafe/promocodes/apply` |
| **Report** | `POST /pos/cafe/report` |
| **Daily Closings** | list, create, note |

## Typical POS flow

1. **Cafe POS Login** → saves `cafePosToken` (JWT `typ: cafe_pos_access`)
2. **Get Menu** (or create categories/items from POS)
3. **Table flow:** Apply promocode (optional) → Book table → Clear table  
   **OR counter flow:** Search customer (optional) → `POST /pos/cafe/orders` (instant settle)
4. **Report** + **Daily Closings** for the day

## Auth

| Route | Auth |
|-------|------|
| `POST /pos/cafe/auth/login` | Public |
| All other `/pos/cafe/**` | Bearer `cafePosToken` |

## Import

- **Postman:** import the customer-checkout collection + environment (see above)
- **Swagger:** import `openapi/cafe.openapi.yaml`

Base URL: `http://localhost:3002/api/v1`
