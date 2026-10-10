# FieldOps API guide

Complete endpoint reference, authorization rules, request examples, concurrency policies and payment recovery.

[Project overview and setup](../README.md) · [Importable API collection](fieldops.postman_collection.json)

## Available endpoints

All routes use `/api/v1`. C = CUSTOMER, T = TECHNICIAN, A = ADMIN. Dispatch and finance duties belong to ADMIN. Private resource queries enforce ownership/current assignment; ADMIN has no automatic bypass on technician-only actions.

| Method | Path                            | Access and purpose                                            |
| ------ | ------------------------------- | ------------------------------------------------------------- |
| GET    | `/health`                       | Public liveness                                               |
| GET    | `/health/ready`                 | Public database readiness                                     |
| POST   | `/auth/register`                | Public customer registration                                  |
| POST   | `/auth/login`                   | Public password login                                         |
| POST   | `/auth/google`                  | Public verified Google login                                  |
| POST   | `/auth/refresh`                 | Public refresh token rotation                                 |
| POST   | `/auth/logout`                  | C/T/A current session revocation                              |
| GET    | `/users/me`                     | C/T/A own profile                                             |
| PATCH  | `/users/me`                     | C/T/A audited name/phone/owned-avatar update                  |
| POST   | `/media/images`                 | C/T/A own avatar upload; A catalog upload                     |
| GET    | `/services`                     | Public search, pagination and sorting                         |
| GET    | `/services/:id`                 | Public active service details                                 |
| POST   | `/services`                     | A audited creation                                            |
| PATCH  | `/services/:id`                 | A audited update                                              |
| DELETE | `/services/:id`                 | A audited soft deletion                                       |
| POST   | `/requests`                     | C request creation                                            |
| GET    | `/requests`                     | C own / A scoped list                                         |
| GET    | `/requests/:id`                 | C own / A details                                             |
| PATCH  | `/requests/:id`                 | C own PENDING edit                                            |
| PATCH  | `/requests/:id/review`          | A approve/reject                                              |
| POST   | `/requests/:id/cancel`          | C own / A atomic cancellation                                 |
| PUT    | `/technicians/:id/skills`       | A skill replacement                                           |
| GET    | `/technicians/:id/skills`       | A complete current skill snapshot, including retired services |
| GET    | `/technicians`                  | A availability by skill/window                                |
| POST   | `/requests/:id/assignment`      | A assignment and price snapshot                               |
| GET    | `/work-orders`                  | C own / T assigned / A list                                   |
| GET    | `/work-orders/:id`              | Scoped details and safe timeline                              |
| PATCH  | `/work-orders/:id/schedule`     | A reschedule/reassignment                                     |
| PATCH  | `/work-orders/:id/status`       | Assigned T ordered progress                                   |
| POST   | `/work-orders/:id/complete`     | Assigned T completion and invoice                             |
| GET    | `/invoices/:id`                 | C own / A frozen invoice                                      |
| POST   | `/invoices/:id/payment-session` | C own idempotent checkout creation/recovery                   |
| GET    | `/payments/:id`                 | C own / A safe database payment state                         |
| POST   | `/payments/sslcommerz/ipn`      | Public provider notification; server verification             |
| POST   | `/payments/sslcommerz/success`  | Public verified success callback                              |
| POST   | `/payments/sslcommerz/fail`     | Public gateway lookup; verified failure                       |
| POST   | `/payments/sslcommerz/cancel`   | Public gateway lookup; verified cancellation                  |
| POST   | `/work-orders/:id/feedback`     | C own completed, paid work; one immutable review              |
| PATCH  | `/admin/users/:id`              | A audited role/status change and session revocation           |
| GET    | `/admin/users`                  | A safe user search, filters and pagination                    |
| GET    | `/admin/audit-logs`             | A filtered, safe append-only audit history                    |
| GET    | `/admin/overview`               | A bounded workload and verified revenue report                |

Success: `{ success: true, message, data }`. Error: `{ success: false, message, errors: [] }`. Missing authentication is `401`, disallowed role `403`, private resources outside ownership scope `404`, invalid input `400`, state/version conflicts `409`, oversized bodies `413`, unsupported request formats/encodings `415`, rate limiting `429`, gateway/verification failure `502` and temporary unavailability `503`. Private responses and errors use `Cache-Control: no-store`.

## Administration

ADMIN user search supports `q`, `role`, `status`, `page`, `limit` and `sort`; deleted accounts are excluded and authentication fields are never returned. Audit history supports entity, actor, action and date filters with an explicit metadata allowlist. Reports default to the last 30 days; explicit `from`/`to` ranges must increase and span at most 366 days. Dates use `[from,to)`. Completion rate describes work created in the period; technician counts are current totals. Revenue counts paid invoices by `paidAt` once and returns `verifiedRevenueMinor` as an exact decimal string in BDT minor units.

`PATCH /admin/users/:id` accepts only optional `role` and `status`, with at least one provided. Actual changes revoke all sessions and commit their audit atomically; identical access is a no-op. The last active ADMIN cannot be suspended/demoted. A technician with active work must be reassigned before changing role; leaving that role removes obsolete skills. Suspension retains assignments and prevents account use. Reactivation requires a fresh login. Use a separate disposable account for manual access-change tests.

## API client setup and authentication

### Import the completed API documentation

Import [the Postman v2.1 collection](fieldops.postman_collection.json) through **Settings → Import Data → Postman** in Apidog. It covers all 40 implemented domain APIs, two health routes and the browser-return transport, with 48 request examples including separate role logins and return outcomes. Each request documents its input, authorization, lifecycle rules, expected success and relevant error scenarios. [Official import guide](https://docs.apidog.io/import-from-postman-635043m0)

Set the imported variables in your local environment: `base_url`, account credentials, role-specific Bearer tokens and IDs extracted from actual responses. Keep secrets in **Local Value**. Set actual future scheduling dates and replace request/work-order versions after each mutation. Review Apidog's variable mapping after import.

Use the Default module's folders **01–11** for normal testing. Main bodies contain editable inputs; named **MANUAL** debug cases document 159 branch expectations, while **ACTUAL** examples preserve 92 sanitized historical live responses. The [complete walkthrough](backend-walkthrough.md) explains the order, real fixture IDs, copyable bodies, role tokens, state branches and focused errors, with the authorized delivery extension below. The current collection covers 43 route templates. Local environment values override collection defaults: inspect IDs and versions before writing. GET, DELETE and logout have no body.

Run requests manually in workflow order: authentication → catalog → request/review → skills/assignment → progress/completion → verified gateway payment → feedback. Cancellation, deletion and logout are separate scenarios; do not run the entire collection as one sequence. The earlier **FieldOps — Actual scenarios** module and [live sample collection](fieldops-live-samples.postman_collection.json) remain historical backups with 92 actual responses and 17 prepared requests; normal testing no longer requires that module. Never publish populated environments or authentication responses. [Executed manual checks and verification limits](manual-verification.md) include real Google sign-in and SSLCommerz sandbox settlement.

After changing an API or the collection, run `npm run build` and `npm run docs:check`. The offline checker compares coverage, authorization and success statuses with compiled Nest route metadata and checks request inputs through the actual validation pipes. It does not call the database/gateway or establish response correctness; integration tests and manual checks cover runtime behavior.

### Configure local variables

Set `base_url = http://localhost:3000/api/v1`. Keep credentials/tokens in **Local Value**, never shared environment values. Use Bearer `{{access_token}}` for customer requests and separate `admin_access_token` / `technician_access_token` variables for other accounts.

### Register and log in

`POST {{base_url}}/auth/register`, No Auth, JSON:

```json
{
  "name": "Rafi Ferdos",
  "email": "rafi@example.com",
  "password": "a long unique passphrase"
}
```

Registration accepts only these three fields. Name is trimmed; email is trimmed/lowercased; password is 15–128 characters with spaces preserved. Role is server-fixed CUSTOMER; passwords use Argon2id. Expected `201`, safe user `{ id, name, email, role, createdAt, avatarUrl }`; registration does not issue tokens. Invalid input is `400`; duplicate email, including a soft-deleted account, is `409`. Limit: 10 attempts/minute per IP.

`POST /auth/login` with the same email/password returns `200`. Its `data` contains `user`, `accessToken`, `refreshToken`, `tokenType`, `expiresIn: 900` and `refreshExpiresAt`. In **Post Processors → Extract Variable**, save `$.data.accessToken` as `access_token` and `$.data.refreshToken` as `refresh_token` in the local environment. [Apidog extraction guide](https://docs.apidog.io/extract-variable-588468m0)

Wrong passwords and unknown emails both return `401`, `Invalid email or password`. Extra fields such as role return `400`; login limit is 10 attempts/minute. Access JWTs last 15 minutes; session/refresh lifetime is at most seven days. Raw refresh tokens are never stored in PostgreSQL.

### Google login

1. Follow the [Google client setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). Create a Web application client; add your account as a test user where required. Add `http://localhost` and `FRONTEND_ORIGIN` (default `http://localhost:3001`) as Authorized JavaScript origins. The helper uses a popup callback and requires no redirect URI.
2. Set `GOOGLE_CLIENT_ID=<your-id>.apps.googleusercontent.com` in `.env` and restart. No client secret is required. Blank configuration disables this endpoint with `503`; invalid nonempty configuration fails startup.
3. Run `npm run google:test`, open the printed local URL, sign in, and copy the **ID token** into Apidog's `google_credential` Local Value. The helper does not persist/log credentials.
4. `POST /auth/google`, No Auth, JSON: `{ "credential": "{{google_credential}}" }`. Expected `200`, `Signed in successfully`, with the same token contract as password login. Reuse token extraction, then test profile/refresh/logout.

| Scenario                                                | Expected                      |
| ------------------------------------------------------- | ----------------------------- |
| New verified identity                                   | `200`, CUSTOMER and session   |
| Same identity again                                     | `200`, same user, new session |
| Invalid/expired token, wrong audience, unverified email | `401`, no account/session     |
| Missing credential or extra fields                      | `400`                         |
| Email belongs to another account                        | `409`, no automatic linking   |
| Bound account suspended/deleted                         | `401`                         |
| Foreign Origin                                          | `403`                         |
| Form body / wrong Content-Type                          | `415`, JSON exchange only     |
| Missing client ID / certificate service outage          | `503`                         |
| More than 10 attempts/minute                            | `429`                         |

The official Google library verifies signature, audience, issuer and expiry; verified email is mandatory. Identity is bound by `(GOOGLE, sub)`, not email. A changed provider email does not rebind the existing account. First-login races serialize by subject; account, identity and session commit together. Existing email collisions require a future authenticated linking flow. [Google verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

Browser Origin must match `FRONTEND_ORIGIN`; Apidog/server requests may omit Origin. This JSON endpoint sets no cookies and accepts no Google direct form/redirect callback. Real sign-in was manually verified with the configured client/account; repeat that check when changing clients/origins. Automated tests replace certificate download with test keys while exercising the real library and database transactions.

### Refresh and logout

- `POST /auth/refresh`, No Auth, JSON `{ "refreshToken": "{{refresh_token}}" }` → `200`. Extract both replacement tokens; expiry remains within the original session's seven-day lifetime.
- Before refreshing, copy the token to `old_refresh_token`. Reusing the consumed token returns `401` and revokes that entire session. Its latest access/refresh tokens then return `401`; log in again for a new session.
- `POST /auth/logout`, Bearer token, no body → `200`, `data: null`. Subsequent access/refresh on that session returns `401`; other sessions remain usable.
- Malformed refresh input is `400`; unknown/expired/revoked tokens are `401`. Refresh limit is 30 attempts/minute. Concurrent refreshes with the same token revoke the session; clients must serialize refresh requests.

Consumed refresh records remain until session expiry for reuse detection. Logout/rotation serialize on the Session row; reuse revocation commits before returning `401`.

### Own profile

`GET /users/me` with Bearer returns `{ id, name, email, role, createdAt, phone, avatarUrl }`, where phone and avatarUrl are nullable. Missing/invalid/expired/revoked authentication or suspended/deleted accounts return `401`.

`PATCH /users/me`, Bearer, JSON:

```json
{ "name": "Rafi Ferdos", "phone": "+8801712345678" }
```

Expected `200`, `Profile updated successfully`, with the same safe profile. All three roles may update their own account. At least one field is required; omitted fields are preserved. Optional `avatarUrl` must reference a recorded AVATAR upload owned by this account; `null` removes it. See [owned image upload and attachment](media-images.md). Name trims to 2–100 characters. Phone trims and accepts international `+` format, 2–15 digits, first digit nonzero; `null` removes it. This validates format, not phone ownership. Role/status/email/password/userId and all other extra fields are rejected (`400`).

The transaction rechecks the active account/session. Update and `USER_PROFILE_UPDATED` audit commit together; audit failure rolls back the update. Metadata contains field names only. Parallel independent name/phone changes both survive; repeating a valid PATCH records another audit. Default limit is 120 requests/minute per IP/endpoint.

Authentication is global; only explicit `@Public()` routes bypass it. Current database state supplies roles, not JWT role claims. `@Roles()` supports method overrides of controller defaults and does not replace ownership checks. Do not combine `@Public()` with `@Roles()`.

## Admin bootstrap and catalog

Set ignored `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (15–128 characters) and optional `SEED_ADMIN_NAME`; run `npm run seed:admin`. New ADMIN and system audit commit together. Existing active ADMIN credentials stay unchanged; other roles or suspended/deleted accounts are never promoted/reset. Use dedicated sandbox accounts for demonstrations.

Log in and extract `admin_access_token`. `POST /services`, ADMIN Bearer:

```json
{
  "name": "AC Maintenance",
  "description": "Inspect and clean the air conditioner.",
  "basePriceMinor": 150000
}
```

Expected `201`; extract `service_id = $.data.id`. Prices are integer paisa: `150000` = BDT 1,500; range 0–1,000,000,000. Currency is server-fixed BDT; no currency input. Name trims to 2–100 and description to 10–2,000 characters. Safe response includes id/name/description/basePriceMinor/currency and ISO createdAt/updatedAt.

- `PATCH /services/{{service_id}}`, `{ "basePriceMinor": 175000 }` → `200`; at least one allowed field, omitted fields preserved.
- `DELETE /services/{{service_id}}` → `200`, `data: null`; retained row, subsequent mutation/details `404`.
- Non-ADMIN writes `403`; missing authentication `401`; invalid UUID/unknown fields/bad price `400`. Mutation and safe audit are atomic; historical request/work/invoice data remain intact.
- Public `GET /services?q=AC&page=1&limit=20&sort=price_asc` returns `{ items, pagination }`; public detail returns an active service. Search is literal and case-insensitive; `%`, `_` and backslash are escaped. Sorts: `newest`, `oldest`, `name_asc`, `price_asc`, `price_desc`. Page 1–100,000; limit 1–100; q up to 100 characters. Unknown query fields are rejected.

Only public catalog projections are cached. Redis is optional; outages/timeouts fall back to PostgreSQL. Every read checks the database catalog revision; every audited mutation increments it in the same transaction. Revision-based keys prevent stale results after outages/in-flight reads. Cache TTL is 60 seconds; namespaces isolate database/schema. Database failure cannot serve unchecked stale cache data. No authentication, request or financial data enter Redis.

## request lifecycle

`POST /requests`, CUSTOMER Bearer:

```json
{
  "serviceId": "{{service_id}}",
  "description": "The cooling unit needs inspection.",
  "address": "House 12, Road 3, Dhaka",
  "preferredStart": "2099-01-01T10:00:00+06:00"
}
```

Use your actual future time, with an ISO timezone offset; responses use UTC. Description trims to 10–2,000 and address to 10–500 characters. Owner comes from authentication; customerId/status/version/price input is rejected. Active service is required (`404`); A/T cannot create (`403`). Expected `201`, PENDING/version 1; extract `request_id` and numeric `request_version`.

`GET /requests?status=PENDING&serviceId={{service_id}}&page=1&limit=20&sort=newest` returns customer-owned items/totals or ADMIN's active scope. Optional literal q searches description/address/service name; sorts are newest/oldest/preferred_start_asc. Pagination bounds match catalog. Detail is C own / A; foreign/missing/soft-deleted requests `404`, T `403`, No Auth `401`.

Responses include service `{ id, name }`, request facts and a nullable safe workOrder summary with its nullable invoice. No private profiles/credentials. Catalog soft deletion preserves request history. Price is snapshotted at assignment, not request creation. Audits exclude descriptions/addresses.

| Action                                  | Auth      | JSON body                                                |
| --------------------------------------- | --------- | -------------------------------------------------------- |
| `PATCH /requests/{{request_id}}`        | C own     | `{ "version": 1, "address": "House 25, Road 4, Dhaka" }` |
| `PATCH /requests/{{request_id}}/review` | A         | `{ "version": 2, "decision": "APPROVE" }`                |
| `POST /requests/{{request_id}}/cancel`  | C own / A | `{ "version": 3, "reason": "Plans have changed" }`       |

Each returns `200` with the updated request. Extract numeric version after every mutation (positive integer ≤2,147,483,646); stale versions return `409`. Fetch latest state and review the proposed change before retrying.

Edit requires PENDING and at least one description/address/preferredStart field. Owner/service/status/price/deletedAt cannot change. A newly supplied time must be future; omitted existing time is preserved. Review requires PENDING, APPROVE or REJECT; REJECT needs a reason, APPROVE accepts an optional reason (trimmed 3–500 characters).

Cancellation requires PENDING/APPROVED and a reason. A linked ASSIGNED work order is cancelled atomically with the request; both versions increment and its slot releases. EN_ROUTE/IN_PROGRESS/COMPLETED reject cancellation (`409`). REJECTED/CANCELLED are terminal; repeated cancellation is `409`. No hard-delete endpoint exists.

Same-version edit/edit, approve/reject or review/cancel races have one winner (`200`) and one conflict (`409`), one increment and one audit. Audit failure rolls back all state/version changes. Foreign customer mutations return `404`; customer review/admin edit `403`; missing version/bad fields `400`.

## scheduling and progress

Set ignored `SEED_TECHNICIAN_EMAIL`, `SEED_TECHNICIAN_PASSWORD` (15–128 characters), optional `SEED_TECHNICIAN_NAME`; run `npm run seed:technician`. Bootstrap creates a new technician/system audit only; never promotes/resets existing accounts. ADMIN/TECHNICIAN bootstrap share the same email lock. Log in and extract `technician_access_token` and `technician_id = $.data.user.id`.

1. A `GET /technicians/{{technician_id}}/skills` → `{ technicianId, serviceIds, services: [{ id, name, active }] }`. The complete set includes deleted service identities, never credentials. Interactive editors then `PUT` `{ "serviceIds": ["{{service_id}}"], "expectedServiceIds": [...] }`, using all IDs from that read. Under the technician lock, a changed set returns `409` without writes/audit. The optional precondition preserves legacy API callers. Replacement accepts at most 100 unique active service UUIDs; `[]` explicitly clears idle skills. Removing a skill required by active work is `409`; missing/deleted service or non-technician `404`.
2. A `GET /technicians?serviceId={{service_id}}&start=2099-01-01T10%3A00%3A00%2B06%3A00&end=2099-01-01T11%3A00%3A00%2B06%3A00&page=1&limit=20` → `{ items: [{ id, name }], pagination }`. Use actual future times; Apidog's query editor encodes raw values. Availability is a snapshot, not a reservation.
3. C creates a request, A approves it, then A `POST /requests/{{request_id}}/assignment` → `201`:

```json
{
  "technicianId": "{{technician_id}}",
  "start": "2099-01-01T10:00:00+06:00",
  "end": "2099-01-01T11:00:00+06:00"
}
```

Extract `work_order_id = $.data.id`, `work_order_version = $.data.version` and **`request_version = $.data.request.version`**. Assignment increments the request version too.

4. A `PATCH /work-orders/{{work_order_id}}/schedule`, same window/technician JSON plus numeric `"version": 1` → `200`. Only ASSIGNED work may reschedule/reassign; agreed price stays frozen. Extract the updated version.
5. C own / assigned T / A `GET /work-orders/{{work_order_id}}` → scoped details, nullable invoice and latest 100 safe timeline events in chronological order. List supports status/serviceId/q/page/limit and sorts newest (default), oldest, scheduled_start_asc. Public query fields cannot alter owner/technician scope.
6. Assigned T `PATCH /work-orders/{{work_order_id}}/status`, `{ "version": 2, "status": "EN_ROUTE" }`, then `{ "version": 3, "status": "IN_PROGRESS" }` → `200` each. Use actual latest versions. Only ASSIGNED → EN_ROUTE → IN_PROGRESS is allowed; skipping/backward/repeat `409`, COMPLETED input `400`.

Windows must start in the future, start < end, last at most eight hours, carry a timezone and at most millisecond precision. Active ASSIGNED/EN_ROUTE/IN_PROGRESS visits cannot overlap for one technician; adjacent `[start,end)` visits are allowed. One retained work order per request, including cancelled history; replacement requires a new request. Assignment snapshots the current catalog price; price/currency/status input is rejected.

Reassignment removes the former technician's access. Non-ADMIN dispatch operations `403`; C/A progress `403`; foreign customers/former technicians `404`; bad dates/UUID/version/extra fields `400`; missing skill/duplicate assignment/overlap/ineligible state `409`; inactive/deleted/wrong-role technician or unavailable service `404`.

Cancel/start and same-version reschedule/progress races have one winner; no partial cancellation. Existing catalog soft deletion permits historical progress, but new scheduling requires an active service. Request soft deletion hides linked work reads/mutations.

Scheduling/skill replacement use sorted technician locks, bounded Serializable retries (four attempts, exponential backoff/jitter) and a PostgreSQL exclusion constraint. Progress/cancel/completion share request → work-order row locks and recheck latest state. External calls stay outside retryable transactions. Exhausted serialization retries return `503`; audit failure rolls back the domain mutation. Future technician role changes must take the same User lock. [PostgreSQL ranges](https://www.postgresql.org/docs/18/rangetypes.html)

## completion and immutable invoices

Assigned T `POST /work-orders/{{work_order_id}}/complete`:

```json
{ "version": 4, "report": "Inspected, cleaned and repaired the cooling unit." }
```

Use the actual latest version: typically 4 after rescheduling, 3 without. Expected `200`, COMPLETED, incremented version, frozen trimmed report and server completedAt. Report is 10–2,000 characters; no amount/customer/currency/status/paidAt input. Extract `invoice_id = $.data.invoice.id` and the new work-order version.

```json
{
  "id": "<invoice UUID>",
  "workOrderId": "<work-order UUID>",
  "customerId": "<owner UUID>",
  "amountMinor": 150000,
  "currency": "BDT",
  "status": "UNPAID",
  "issuedAt": "<UTC ISO timestamp>",
  "paidAt": null
}
```

Completion, invoice and WORK_ORDER_COMPLETED/INVOICE_ISSUED audits commit atomically. Failure rolls everything back. Invoice owner/price/currency/issue time and completed work facts are immutable. Amount uses the assignment snapshot, not the current catalog price. Work becomes COMPLETED before inserting its validated invoice; a deferred constraint verifies invoice presence at COMMIT. Completed work cannot persist without an invoice, and deleting its invoice alone is rejected.

- Same normalized report plus original completion version or committed current version → `200`, same invoice/timestamps/version, no duplicate audit. Different report/other stale version `409`. Two identical concurrent calls both succeed with one invoice; different reports have one winner.
- C own / A `GET /invoices/{{invoice_id}}` → `200`, safe projection above. Other customer `404`, T `403`, missing/invalid session `401`, invalid UUID `400`.
- Scoped work-order views and request work summaries expose the same nullable invoice. Assigned T sees the invoice through its own work view, but cannot access the finance endpoint.
- Catalog/request soft deletion preserves invoice financial history. Financial data never enter Redis.
- Invoices begin UNPAID; clients/admins cannot directly mark them paid. Gateway settlement must verify the provider.
- ASSIGNED/EN_ROUTE completion is `409`; C/A completion `403`; unassigned/former T `404`; bad report/version/extra fields `400`; completed work cancellation/rescheduling/report rewrites `409`.

## SSLCommerz payments

### Gateway configuration

Configure all four payment settings in the ignored `.env`, then restart:

```dotenv
SSLCOMMERZ_MODE=sandbox
SSLCOMMERZ_STORE_ID=<your sandbox store ID>
SSLCOMMERZ_STORE_PASSWORD=<your sandbox merchant password>
PUBLIC_API_URL=https://<your publicly reachable API host>
```

`PUBLIC_API_URL` is an HTTPS origin, with no `/api/v1` suffix/path, credentials, query or fragment. Callback routes must be reachable by SSLCommerz; localhost alone cannot receive IPNs. Configure the merchant panel's IPN listener as `<PUBLIC_API_URL>/api/v1/payments/sslcommerz/ipn`. Sandbox/live credentials are separate; live mode targets the official production host. Blank settings disable initiation (`503`); partial/invalid settings fail startup. Existing attempts retain their mode/store identity and cannot be verified using different merchant configuration.

SSLCommerz supports BDT 10–500,000 per session. Our catalog retains its existing wider price range, so frozen invoices outside the gateway range return `409`; they are never silently marked paid. The hosted checkout handles payment details; FieldOps never collects/stores card data. [Official SSLCommerz integration documentation](https://developer.sslcommerz.com/doc/v4/)

### Create or replay a checkout

Complete the work first and extract `invoice_id`. As the invoice's CUSTOMER, update `/users/me` with an international phone number. Gateway customer name/email must each fit within 50 characters; unsupported contact details return `409`.

Set `idempotency_key` to a UUID and retain it for this attempt. `POST {{base_url}}/invoices/{{invoice_id}}/payment-session`, CUSTOMER Bearer, header `Idempotency-Key: {{idempotency_key}}`, JSON:

```json
{
  "billing": {
    "address": "House 12, Road 3",
    "city": "Dhaka",
    "postcode": "1000"
  }
}
```

Billing address trims to 5–50 characters, city 2–50, postcode 1–30; country is fixed Bangladesh. Name/email/phone come from the authenticated account; invoice owner/amount/currency come from PostgreSQL. Extra fields, including amount/currency/customerId/status, return `400`. The key accepts 16–100 ASCII characters: letters, digits, `.`, `_`, `:`, `-`, starting with a letter/digit. Missing/malformed keys return `400`. Initiation/replay limit is 10 requests/minute per IP.

Expected first successful creation `201`. Extract `payment_id = $.data.id` and `checkout_url = $.data.checkoutUrl`; open the checkout URL in a browser and complete the sandbox checkout. Replay the **same key and same JSON** for `200` with the same attempt. Billing differences or using that key for another invoice return `409`. A different key while an attempt is active/unresolved also returns `409`.

```json
{
  "id": "<payment UUID>",
  "invoiceId": "<invoice UUID>",
  "amountMinor": 150000,
  "currency": "BDT",
  "gateway": "SSLCOMMERZ",
  "mode": "SANDBOX",
  "status": "PENDING",
  "checkoutUrl": "https://sandbox.sslcommerz.com/<provider checkout path>",
  "reviewReason": null,
  "requiresReview": false,
  "createdAt": "<UTC ISO timestamp>",
  "updatedAt": "<UTC ISO timestamp>",
  "verifiedAt": null,
  "settledAt": null
}
```

Only an unpaid PENDING attempt exposes its checkout URL. `GET /payments/{{payment_id}}` is C own / A; foreign customer `404`, T `403`, missing/revoked session `401`, invalid UUID `400`. It reads database state without calling the gateway. Merchant IDs, raw session keys, idempotency hashes, validation IDs, bank references and merchant credentials are excluded.

### Verify callbacks and financial state

The four callback routes accept URL-encoded forms or JSON without Bearer authentication. Their identifiers are `tran_id` (our 24-character hexadecimal merchant reference) and optional `val_id` (provider validation reference). Provider fields may include additional data, but claimed status/amount/risk/store/bank reference never decide settlement. Browser success is insufficient; the backend calls the provider validation API and compares the stored transaction, gross amount, original amount and BDT currency.

Successful processing returns `200`, `{ "success": true, "message": "Payment notification verified and processed", "data": { "received": true } }`; this also acknowledges a verified lookup that remains pending. It does not imply a paid invoice. Read `/payments/{{payment_id}}` and `/invoices/{{invoice_id}}` afterward. Verified safe settlement produces SUCCEEDED / PAID with matching settledAt/paidAt; invalid/unavailable verification returns `502` and preserves financial state. Malformed IDs `400`, unknown merchant reference `404`, unsupported body format `415`. No financial/private details appear in public acknowledgements.

Duplicates and simultaneous IPN/success calls create one settlement, one settled receipt and one audit per financial event. Late fail/cancel cannot reverse success. An individual failed bank attempt does not close the hosted checkout: failure/cancellation needs a verified terminal session with matching identity/amount/currency. Pending/uncertain lookup retains the existing attempt.

Each verified captured bank transaction gets an immutable receipt. High risk, amount/currency mismatch, reused provider references and multiple captures require review. A later additional charge preserves the original settlement, records a REVIEW receipt and exposes `requiresReview: true`; revenue is counted once. Review cases need operator investigation and any applicable provider refund; automatic refund/review approval is outside this stage. Reconciliation never overrides a recorded review decision.

### Browser return transport

New checkout sessions use `POST /api/v1/payments/sslcommerz/return/success`,
`/return/fail` and `/return/cancel` for browser navigation. The existing four JSON
callbacks and server `/ipn` contract remain available. After resolving the stored
merchant reference and running the same settlement service, the browser receives
a no-store `303` to `FRONTEND_ORIGIN/payment/success?paymentId=<stored UUID>` or
`/payment/cancel?paymentId=<stored UUID>`. Supplied destinations and payment IDs
are ignored; no provider credentials or payload enter the redirect.

A provider/transaction failure still returns a known attempt for inspection;
it never marks an invoice paid. The frontend authenticates and reads actual payment
and invoice state again. Malformed/unknown references retain `400`/`404`, unsupported
formats retain `415`, and IPN retains JSON acknowledgements/errors. Already-created
gateway sessions keep their original destinations. The current hosted release uses
this transport with the verified frontend HTTPS origin.

`FRONTEND_ORIGIN` must be a clean HTTPS origin in production. `PUBLIC_API_URL` must
be publicly reachable HTTPS for live/production. Non-production sandbox browser
tests alone may use loopback HTTP; provider server IPN cannot reach that origin.

The payment integration checkpoint verified real sandbox cancellation, explicit replacement,
safe dummy-card/OTP settlement and paid feedback through the production frontend
and updated local backend against an isolated database. Stored proof confirms one
safe receipt, one settlement/invoice-paid event and one feedback/audit. The gateway's
closed session reports `FAILED` with BDT original currency/amounts but no settlement
currency, while its merchant query reports `CANCELLED`; the adapter accepts that
corroborated terminal shape, never merchant cancellation alone. Gross/original
amounts and stored merchant/session identity must match; any supplied settlement
currency must be BDT. Tests reject open sessions and incomplete/mismatched evidence.
That local checkpoint did not claim deployed HTTPS/server-IPN. The October 9 hosted
release now verifies actual provider IPN, HTTPS cancel/success returns and a single
immutable settlement; see [the verification record](manual-verification.md).
Safe notification logs contain only the callback kind and stored payment UUID after
verification/commit, never provider payloads or validation keys. A notification log
does not itself mean an invoice is paid. Real fail/risk UI and live funds are not claimed.

### Recover uncertainty safely

A timeout/invalid initiation response returns `502` and retains UNKNOWN. A crash or database failure after initiation can retain INITIATING. Retry the original key/JSON to retrieve its payment ID; **do not switch keys**. After 15 seconds, replaying an INITIATING/UNKNOWN/PENDING attempt queries the existing merchant reference and revalidates any captured transaction. It never initiates another checkout. Gateway failure during recovery returns `502` without releasing the attempt. No-record/pending results remain unresolved; time alone does not prove failure.

An operator may reconcile one attempt immediately:

```bash
npm run payment:reconcile -- <payment UUID>
```

The command uses the same validation/settlement service, prints only payment ID/status/review flag and closes the app. It requires matching configured merchant credentials. A definitive initiation rejection or verified terminal failure/cancellation permits a **new key**; reusing the old key still retrieves the original attempt. A paid invoice rejects new attempts.

Reservation, state/audit writes and settlement use short database transactions with invoice → payment locks; provider calls stay outside transactions. Cross-invoice provider identities serialize separately. PostgreSQL protects snapshots, one live checkout, one settlement and unique checkout sessions. Deferred constraints reject a PAID invoice without a matching SUCCEEDED payment and settled safe receipt; payment/invoice/receipt/audits roll back together on failure. No direct PAID mutation API exists.

Automated tests exercise the real Nest app, guards, JWTs, PostgreSQL and gateway adapter while replacing only gateway HTTP transport. Built HTTP tests cover checkout, replay, form callbacks and settlement. Tests never inherit actual merchant credentials. Real SSLCommerz sandbox checkout, IPN settlement and settled replay were manually verified on the hosted service; repeat verification after changing merchant settings.

## customer feedback

After completing work and verifying its invoice is PAID, use customer Bearer authentication:

`POST {{base_url}}/work-orders/{{work_order_id}}/feedback`

```json
{ "rating": 5, "comment": "The technician explained the repair clearly." }
```

Rating must be an integer from 1 to 5. Comment is optional; when supplied it must be a nonblank string of at most 1,000 characters after trimming. Normal line breaks/tabs are supported; database NUL and unsafe control characters are rejected. Send only rating/comment; ownership and work/payment state come from PostgreSQL.

Expected `201`:

```json
{
  "success": true,
  "message": "Feedback submitted successfully",
  "data": {
    "id": "<feedback UUID>",
    "workOrderId": "<work-order UUID>",
    "rating": 5,
    "comment": "The technician explained the repair clearly.",
    "createdAt": "<UTC ISO timestamp>"
  }
}
```

Rating-only `{ "rating": 4 }` stores/returns `comment: null`. Extract `feedback_id = $.data.id`. Submission and FEEDBACK_SUBMITTED audit commit together. Audit metadata contains only feedbackId/rating, never the review text or contact details. Submitted feedback is immutable; there is no edit/delete endpoint.

- Read `GET /work-orders/{{work_order_id}}`: `data.feedback` matches the submission; `null` before submission. Scoped work lists and request work summaries use the same projection. C own / assigned T / A may read it; public catalog responses never include feedback.
- Repeat the same body, change its rating, or submit simultaneously: one submission/audit persists; all later attempts return `409`. After a lost response, read the work-order detail to recover the existing review.
- COMPLETED with UNPAID invoice, a payment held for review, unfinished work or cancelled work → `409`. Browser success alone does not enable feedback.
- Other customer/missing work/soft-deleted request → `404`; ADMIN/TECHNICIAN submission → `403`; unavailable session/account → `401`. Authority is rechecked after waiting on lifecycle locks.
- Invalid UUID, rating 0/6/fraction/string, blank/oversized/null comment, array body or extra fields → `400`. Catalog soft deletion does not remove historical feedback or prevent eligible submission.

Manual checks: verify one successful paid submission, read it as each permitted role, repeat for `409`, switch customer for `404`, switch to technician/admin for `403`, and try an unpaid order for `409`. Private responses use `Cache-Control: no-store`.
