# FieldOps API

Programming Hero Assignment 6-এর Field Service Management backend। Authentication, sessions, own profile, audited catalog, request lifecycle এবং technician scheduling/progress প্রস্তুত। Completion, invoicing ও payments পরবর্তী stage; Assignment 7 frontend পরে হবে।

## Stack

Node.js 24, NestJS (Express adapter), strict TypeScript / ESM, PostgreSQL 18, Prisma 7, Redis 8 / node-redis, Zod, Helmet এবং Throttler। Tests: Vitest + Supertest; lint: oxlint; formatting: Prettier।

## Local setup

```bash
nvm use
cp .env.example .env
npm ci
```

`.env`-এ `JWT_ACCESS_SECRET` বসাতে একটি secret generate করুন (Git-এ রাখবেন না):

```bash
node -e "console.log(require('node:crypto').randomBytes(64).toString('base64'))"
```

তারপর:

```bash
npm run db:generate
docker compose up -d --wait postgres redis
npm run db:status
```

নতুন database-এ committed migrations apply করুন:

```bash
npm run db:deploy
npm run start:dev
```

আগে থেকেই migrated database থাকলে status up to date থাকবে। `.env`-এর `DATABASE_URL` ও `POSTGRES_PASSWORD` একই credentials ব্যবহার করবে। Example password শুধু local development-এর জন্য। Config file: `prisma.config.ts`। Existing project-এ আবার `prisma init` চালাতে হবে না।

## Available endpoints

| Method | Endpoint                           | Purpose                                         |
| ------ | ---------------------------------- | ----------------------------------------------- |
| GET    | `/api/v1/health`                   | API liveness                                    |
| GET    | `/api/v1/health/ready`             | Prisma দিয়ে database readiness check            |
| POST   | `/api/v1/auth/register`            | Customer account তৈরি                           |
| POST   | `/api/v1/auth/login`               | Password যাচাই ও session/token pair             |
| POST   | `/api/v1/auth/google`              | Verified Google credential দিয়ে login           |
| POST   | `/api/v1/auth/refresh`             | Refresh token rotation                          |
| POST   | `/api/v1/auth/logout`              | Bearer দিয়ে current session revoke              |
| GET    | `/api/v1/users/me`                 | Authenticated own profile                       |
| PATCH  | `/api/v1/users/me`                 | নিজের name/phone update ও audit                 |
| POST   | `/api/v1/services`                 | ADMIN service তৈরি ও audit                      |
| PATCH  | `/api/v1/services/:id`             | ADMIN service update ও audit                    |
| DELETE | `/api/v1/services/:id`             | ADMIN service soft delete ও audit               |
| GET    | `/api/v1/services`                 | Public search, pagination, sorting              |
| GET    | `/api/v1/services/:id`             | Public active service details                   |
| POST   | `/api/v1/requests`                 | CUSTOMER service request তৈরি ও audit           |
| GET    | `/api/v1/requests`                 | CUSTOMER own / ADMIN scoped list                |
| GET    | `/api/v1/requests/:id`             | CUSTOMER own / ADMIN private details            |
| PATCH  | `/api/v1/requests/:id`             | CUSTOMER own PENDING edit ও version             |
| PATCH  | `/api/v1/requests/:id/review`      | ADMIN approve/reject ও version                  |
| POST   | `/api/v1/requests/:id/cancel`      | CUSTOMER own / ADMIN atomic cancellation        |
| PUT    | `/api/v1/technicians/:id/skills`   | ADMIN technician skill replacement              |
| GET    | `/api/v1/technicians`              | ADMIN skill/window-based availability           |
| POST   | `/api/v1/requests/:id/assignment`  | ADMIN assignment ও price snapshot               |
| GET    | `/api/v1/work-orders`              | CUSTOMER own / TECHNICIAN assigned / ADMIN list |
| GET    | `/api/v1/work-orders/:id`          | Scoped details ও recent safe timeline           |
| PATCH  | `/api/v1/work-orders/:id/schedule` | ADMIN versioned reschedule/reassignment         |
| PATCH  | `/api/v1/work-orders/:id/status`   | Assigned TECHNICIAN ordered progress            |

Success: `{ success: true, message, data }`। Error: `{ success: false, message, errors: [] }`।

Roles: `CUSTOMER`, `TECHNICIAN`, `ADMIN`। Dispatch ও finance duties `ADMIN` role-এর মধ্যে থাকবে।

### Apidog: login test

Local environment: `base_url = http://localhost:3000/api/v1`। Credentials/token local values রাখুন। Server: `npm run start:dev`।

1. `POST {{base_url}}/auth/register` — নিচের registration JSON দিয়ে নতুন account তৈরি করুন (`201`)।
2. `POST {{base_url}}/auth/login` — JSON body-তে একই `email` ও `password` দিন (`200`)। `data`-তে safe `user`, `accessToken`, `refreshToken`, `tokenType`, `expiresIn: 900`, `refreshExpiresAt` থাকবে।
3. Login-এর **Post Processors → Extract Variable**: Environment scope-এ `access_token` = `$.data.accessToken`, `refresh_token` = `$.data.refreshToken` save করুন। [Apidog guide](https://docs.apidog.io/extract-variable-588468m0)
4. ভুল password বা অজানা email দিয়ে login: একই `401` ও `Invalid email or password` message। Body-তে `role` দিলে `400`। Login প্রতি IP-তে ১০ attempts/minute।

Access JWT ১৫ মিনিট, session ও refresh token সর্বোচ্চ ৭ দিন। Auth response/error `Cache-Control: no-store`। Raw refresh token database-এ রাখা হয় না।

### Google setup and Apidog test

1. [Google setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) অনুসারে OAuth consent screen ও **Web application** Client তৈরি করুন। Testing audience হলে নিজের account test user হিসেবে রাখুন। **Authorized JavaScript origins**-এ `http://localhost` এবং `.env`-এর `FRONTEND_ORIGIN` (default `http://localhost:3001`) দিন। Helper popup/callback flow ব্যবহার করে; redirect URI লাগে না।
2. `.env`-এ `GOOGLE_CLIENT_ID=<your-id>.apps.googleusercontent.com` বসিয়ে backend restart করুন। Client secret লাগে না। Configuration খালি থাকলে password login চলবে, Google endpoint `503` দেবে; invalid nonempty configuration startup-এ reject হবে।
3. আলাদা terminal-এ `npm run google:test` চালিয়ে দেখানো local URL খুলুন। Google button-এ sign in করে পাওয়া **ID token** Apidog environment-এর `google_credential` **Local Value**-তে copy করুন। Helper credential disk/log-এ রাখে না; Assignment 7 frontend নয়।
4. `POST {{base_url}}/auth/google`, **No Auth**, **Body → JSON**:

```json
{ "credential": "{{google_credential}}" }
```

Expected `200`, `message: "Signed in successfully"`; `data` login-এর মতো `user`, `accessToken`, `refreshToken`, `tokenType`, `expiresIn`, `refreshExpiresAt`। Login-এর একই token extraction rules ব্যবহার করুন; এরপর `/users/me`, refresh ও logout test করুন। নতুন Google user-এর role `CUSTOMER`, password hash নেই। Return user-এর role/profile DB থেকেই আসে।

| Test                                                          | Expected                                     |
| ------------------------------------------------------------- | -------------------------------------------- |
| নতুন verified Google identity                                 | `200`, CUSTOMER ও token pair                 |
| একই Google account দিয়ে আবার login                            | `200`, একই user ও নতুন session               |
| Invalid/expired token, wrong audience, unverified email       | `401`, account/session তৈরি নয়               |
| Missing/empty credential, extra role/email field              | `400`                                        |
| Email আগে থেকেই অন্য account-এ আছে                            | `409`, automatic account linking নয়          |
| Bound account suspended/deleted                               | `401`                                        |
| Foreign Origin header                                         | `403`                                        |
| Form body / wrong Content-Type                                | `415`; শুধু JSON callback exchange supported |
| Google client ID অনুপস্থিত বা certificate service unavailable | `503`                                        |
| প্রতি IP-তে Google endpoint-এ ১০ requests/minute ছাড়ালে       | `429`                                        |

Google library signature/audience/issuer/expiry verify করে; verified email বাধ্যতামূলক। Identity lookup `(GOOGLE, sub)` দিয়ে; email বদলালে existing identity/profile rebind হয় না। Existing email collision-এ আগের sign-in method ব্যবহার করুন; authenticated linking আলাদা ভবিষ্যৎ কাজ। Subject lock parallel first sign-in serialize করে; user+identity+session একই transaction-এ লেখা হয়। [Google verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

Browser request-এর Origin `FRONTEND_ORIGIN`-এর সঙ্গে মিলতে হবে; Apidog/server client-এর Origin না থাকলেও চলে। এই endpoint cookies set করে না এবং Google-এর direct form/redirect callback গ্রহণ করে না; form flow-এর CSRF handling ভবিষ্যতে সেই flow যোগ করার সময় লাগবে। Real OAuth sign-in নিজস্ব Client ID/account দিয়ে manual verify করতে হবে। Automated tests শুধু certificate download replace করে test keys ব্যবহার করে; Google library-এর আসল signature/claim verification ও real PostgreSQL transactions চলবে।

### Apidog: refresh/logout test

- `POST {{base_url}}/auth/refresh`, JSON: `{ "refreshToken": "{{refresh_token}}" }`। Bearer লাগে না। Expected `200`; login-এর মতো extraction rules দিয়ে দুই token update করুন। Expiry original ৭ দিনের মধ্যেই থাকে।
- Refresh-এর আগে পুরোনো token `old_refresh_token` variable-এ copy করুন। Refresh সফল হওয়ার পরে পুরোনো token আবার পাঠান: `401`। নতুন refresh token-ও এরপর `401`; ওই session-এর access token দিয়ে logout-ও `401`। আবার login করে নতুন session নিন।
- `POST {{base_url}}/auth/logout`: Auth tab-এ Bearer Token = `{{access_token}}`, body নেই। Expected `200`, `data: null`। একই access token দিয়ে logout বা refresh token দিয়ে refresh এখন `401`। অন্য login-এর session কাজ করবে।
- Refresh malformed body `400`, unknown/expired/revoked token `401`। Refresh প্রতি IP-তে ৩০ attempts/minute। একই token-এর parallel refresh session revoke করবে; client-এ একবারে একটি refresh চালাতে হবে।

Consumed refresh records session expiry পর্যন্ত রাখতে হবে, যাতে পুরোনো token reuse detect হয়। Logout ও rotation একই Session row lock-এ serialize হয়; reuse revocation commit হওয়ার পরে `401` দেওয়া হয়।

### Apidog: protected profile test

`GET {{base_url}}/users/me` → Auth tab → Bearer Token = `{{access_token}}`। Expected `200`; নিজের safe profile পাবেন। Header ছাড়া, wrong/expired token, logout-এর পরে অথবা refresh reuse-এর পরে `401`।

GET/PATCH profile-এর `data`-তে `id`, `name`, `email`, `role`, `createdAt`-এর সঙ্গে `phone` (string অথবা null) থাকবে। Registration/login/refresh-এর user projection আগের মতো থাকবে।

### Apidog: update own profile

`PATCH {{base_url}}/users/me` → Auth → Bearer Token = `{{access_token}}` → Body → JSON:

```json
{
  "name": "Rafi Ferdos",
  "phone": "+8801712345678"
}
```

Expected `200`, `message: "Profile updated successfully"`; `data` GET profile-এর মতো। CUSTOMER/TECHNICIAN/ADMIN সবাই নিজের profile update করতে পারবেন। Owner authenticated actor থেকে আসে; request body/query থেকে নয়।

| Field         | Rules                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `name`        | Optional; trim করার পরে ২–১০০ characters                                                                        |
| `phone`       | Optional; trim হয়; `+` দিয়ে international format, ২–১৫ digits এবং প্রথম digit nonzero; example `+8801712345678` |
| `phone: null` | Stored phone মুছে দেয়                                                                                           |

অন্তত একটি field দিতে হবে। Omitted fields অক্ষত থাকবে। এটি phone format validation; phone ownership verification নয়। Role, status, email, password, userId এবং অন্যান্য extra fields reject হবে।

| Test                                                                | Expected                                |
| ------------------------------------------------------------------- | --------------------------------------- |
| Valid name/phone → GET profile                                      | PATCH `200`; GET-এ saved values         |
| শুধু name update                                                    | `200`; আগের phone অক্ষত                 |
| `{ "phone": null }`                                                 | `200`; profile phone null               |
| `{}`, blank/invalid fields, extra role/email/password               | `400`; profile/audit write নয়           |
| No Auth, invalid/revoked/expired session, suspended/deleted account | `401`; write নয়                         |
| একই সময়ে আলাদা name ও phone updates                                 | দুটোই `200`; final profile-এ দুটো value |

Profile update-এর সময় transaction-এর ভিতরে active account/current session আবার check হয়। Profile write ও `USER_PROFILE_UPDATED` audit একই transaction-এ commit হয়; audit fail হলে update rollback হয়। Audit metadata-তে শুধু `updatedFields` থাকে, personal values/credentials নয়। একই valid PATCH repeat করলে নতুন audit entry হয়। Default rate limit ১২০ requests/minute প্রতি IP/endpoint।

`AuditService.record(tx, event)` typed event নেয় এবং create-only operation দেয়; audit history update/delete API নেই। Administrative audit-log listing পরবর্তী domain stage।

Authentication guard default-এ সব registered route protect করে; public health/register/login/google/refresh-এ explicit `@Public()` আছে। প্রতিটি private request-এ current database session/account check হয়; role JWT থেকে বিশ্বাস করা হয় না। Requests ও work orders-এ resource ownership domain queries-তে enforce হয়।

### Role authorization

`RolesGuard` global authentication guard-এর পরে চলে। Private route-এ `@Roles(Role.ADMIN)` বা `@Roles(Role.ADMIN, Role.TECHNICIAN)` দিন; controller-level default method-level roles দিয়ে override করা যায়। Role current DB actor থেকে আসে, client input/JWT role থেকে নয়। Missing/invalid session `401`, allowed list-এর বাইরে role `403`; ADMIN-এর automatic bypass নেই। `@Public()` ও `@Roles()` একসঙ্গে দেবেন না—actor না থাকলে request deny হবে।

`/users/me` তিনটি role-এর জন্য খোলা; service mutations শুধু ADMIN। Resource ownership domain service-এর query-তে enforce করতে হবে; `@Roles()` ownership check-এর বিকল্প নয়। Integration tests-এর synthetic role-check routes production app-এ নেই। [NestJS guards](https://docs.nestjs.com/guards)

### Admin setup and Apidog: service mutations

`.env`-এ নিজের `SEED_ADMIN_EMAIL`, strong `SEED_ADMIN_PASSWORD` (১৫–১২৮ characters) এবং optional `SEED_ADMIN_NAME` বসিয়ে `npm run seed:admin` চালান। Script নতুন ADMIN ও system audit একই transaction-এ তৈরি করে। Existing active ADMIN থাকলে password বদলায় না; existing CUSTOMER/TECHNICIAN, suspended/deleted account modify করে না। Credentials Git/Apidog shared values-এ রাখবেন না। এটি local bootstrap; submission-এর dedicated demo admin credentials পরে আলাদা করে প্রস্তুত করতে হবে।

Apidog-এ ওই email/password দিয়ে `/auth/login` করে `admin_access_token = $.data.accessToken` extract করুন। নিচের তিনটি endpoint-এ Bearer `{{admin_access_token}}` দিন।

`POST {{base_url}}/services` → JSON:

```json
{
  "name": "AC Maintenance",
  "description": "Inspect and clean the air conditioner.",
  "basePriceMinor": 150000
}
```

Expected `201`; `service_id = $.data.id` extract করুন। `basePriceMinor` integer পয়সা: `150000` = ৳1,500; accepted range `0–1000000000`। Currency server-fixed `BDT`; body-তে currency দেওয়া যাবে না। Name trim করে ২–১০০ এবং description ১০–২০০০ characters। Response: `id`, `name`, `description`, `basePriceMinor`, `currency`, ISO `createdAt`/`updatedAt`।

- `PATCH {{base_url}}/services/{{service_id}}` → `{ "basePriceMinor": 175000 }`: `200`; অন্তত একটি allowed field দিতে হবে, omitted fields অক্ষত থাকে।
- `DELETE {{base_url}}/services/{{service_id}}`: `200`, `data: null`; database row retained থাকে। একই ID delete/update আবার করলে `404`।
- No Auth/invalid session `401`; CUSTOMER/TECHNICIAN `403`; unknown fields/empty PATCH/invalid price or UUID `400`; missing service `404`।

প্রতিটি mutation-এ current account/session/ADMIN role transaction-এর ভিতরে আবার check হয়। Service write, typed audit ও catalog revision একসঙ্গে commit হয়; audit fail হলে rollback। Price update-এর old/new snapshots row lock দিয়ে concurrent edits-এর সঙ্গেও সঠিক থাকে। Deleted services ভবিষ্যৎ work/invoice references-এর জন্য retained থাকবে।

### Apidog: public catalog and cache

`GET {{base_url}}/services?q=AC&page=1&limit=20&sort=price_asc` → **No Auth**। Expected `200`; `data: { items: [...], pagination: { page, limit, total, totalPages } }`। শুধু active services আসবে। Search name/description-এ case-insensitive literal match; `%`, `_`, `\` wildcard হিসেবে চলে না।

| Query   | Rules / default                                                     |
| ------- | ------------------------------------------------------------------- |
| `q`     | Trim করা search, সর্বোচ্চ ১০০ characters; default empty             |
| `page`  | Integer `1–100000`; default `1`                                     |
| `limit` | Integer `1–100`; default `20`                                       |
| `sort`  | `newest` (default), `oldest`, `name_asc`, `price_asc`, `price_desc` |

`GET {{base_url}}/services/{{service_id}}` → No Auth, `200`; create-এর একই public projection। Deleted/missing service `404`, invalid UUID `400`। Empty search result-এ `items: []`, `total: 0`, `totalPages: 0`; শেষ page-এর পরে items empty থাকে। Extra/invalid query fields `400`। Stable ID tie-break এবং একই DB snapshot-এ items/count দিয়ে pagination হয়।

Manual flow: ADMIN create → public list/details → ADMIN price PATCH → public list/details-এ নতুন price → DELETE → details `404`, list থেকে বাদ। CUSTOMER token দিয়ে mutation `403` verify করুন।

Redis শুধু public catalog cache করে, TTL ৬০ seconds। `.env`-এর optional `REDIS_URL` blank হলে cache disabled; connection/command failure-এ DB fallback। PostgreSQL revision প্রতিটি read-এ check হয় এবং write/audit-এর সঙ্গে transaction-এ increment হয়; নতুন revision পুরোনো cache keys ব্যবহার করে না, পুরোনো keys TTL-এ expire হয়। ফলে outage-এর সময় write অথবা পুরোনো in-flight cache fill-এর পরও stale price/deleted service ফেরত আসে না। DB unavailable হলে cache দিয়ে authority check bypass হয় না। Main/test database অনুযায়ী cache namespace আলাদা এবং cached JSON strict public schema দিয়ে validate হয়। [Official node-redis production guide](https://redis.io/docs/latest/develop/clients/nodejs/produsage/)

Local outage test: `docker compose stop redis` → public GET চালু থাকবে → ADMIN price update → `docker compose start redis` → public GET-এ updated price পাবেন। Server startup cache-এর জন্য অপেক্ষা করে না; auth/session/availability/payment data Redis-এ রাখা হয় না।

### Registration

```json
{
  "name": "Rafi Ferdos",
  "email": "rafi@example.com",
  "password": "a long unique passphrase"
}
```

শুধু `name`, `email`, `password` গ্রহণ করা হয়; unknown fields reject হবে। Name trim এবং email trim/lowercase হয়। Password ১৫–১২৮ characters; spaces অক্ষত থাকে। Role server থেকে `CUSTOMER` হয়। Password Argon2id দিয়ে hash হয় ([OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html))।

`201` response-এর `data`-তে শুধু `id`, `name`, `email`, `role`, `createdAt` থাকে। Invalid input `400`; duplicate email (soft-deleted account-সহ) `409`; registration প্রতি IP-তে ১০ attempts/minute। Login token এখানে দেওয়া হয় না।

### Apidog: customer requests

Customer login-এর `access_token` ব্যবহার করুন; ADMIN login-এর `admin_access_token` আলাদা রাখুন। `POST {{base_url}}/requests` → Bearer `{{access_token}}` → JSON:

```json
{
  "serviceId": "{{service_id}}",
  "description": "The cooling unit needs inspection.",
  "address": "House 12, Road 3, Dhaka",
  "preferredStart": "2099-01-01T10:00:00+06:00"
}
```

নিজের future preferred time বসান; timezone সহ ISO datetime বাধ্যতামূলক, response UTC-তে আসে। Description trim করে ১০–২০০০ ও address ১০–৫০০ characters। Owner token থেকে আসে; customerId/status/version/price input গ্রহণ হয় না। Active service দরকার, unavailable service `404`। ADMIN/TECHNICIAN create করলে `403`। Expected `201`, `status: PENDING`, `version: 1`; `request_id = $.data.id` এবং `request_version = $.data.version` extract করুন।

- `GET {{base_url}}/requests?status=PENDING&serviceId={{service_id}}&page=1&limit=20&sort=newest`: CUSTOMER নিজের items/totals; ADMIN সব active requests।
- Optional `q` (সর্বোচ্চ ১০০ characters) description/address/service name-এ case-insensitive literal search। Sort: `newest`, `oldest`, `preferred_start_asc`; page/limit catalog-এর মতো। Extra customerId বা invalid filters `400`।
- `GET {{base_url}}/requests/{{request_id}}`: own/customer অথবা ADMIN `200`; অন্য customer's ID, soft-deleted বা missing request `404`; TECHNICIAN `403`; No Auth `401`।

Request response-এ nullable `workOrder` summary (id, technicianId, status, version, scheduledStart/end, agreedPriceMinor, currency), customerId/serviceId, nested service `{ id, name }`, description/address/preferredStart, status/version, review/cancellation facts ও timestamps থাকে। Staff/customer credentials বা private profile আসে না। সব request response/error `Cache-Control: no-store`; Redis-এ request data রাখা হয় না। Catalog soft-delete হলেও existing request history retained থাকে; request price snapshot এখন নেওয়া হয় না—assignment-এর সময় agreed price snapshot নেওয়া হয়। Create+safe audit একই transaction; audit metadata-তে address/description থাকে না।

### Apidog: edit, review and cancellation

প্রতিটি successful mutation-এর পরে `request_version = $.data.version` আবার extract করুন। Body-তে version অবশ্যই JSON number হবে; Apidog variable numeric হিসেবে বসান। Version positive integer, সর্বোচ্চ `2147483646`। Server stored version-এর সঙ্গে না মিললে `409`; latest detail fetch করে নিজের পরিবর্তন review করার পরে নতুন version নিয়ে retry করুন।

| Operation                               | Auth                      | JSON body                                                |
| --------------------------------------- | ------------------------- | -------------------------------------------------------- |
| `PATCH /requests/{{request_id}}`        | Customer owner            | `{ "version": 1, "address": "House 25, Road 4, Dhaka" }` |
| `PATCH /requests/{{request_id}}/review` | ADMIN                     | `{ "version": 2, "decision": "APPROVE" }`                |
| `POST /requests/{{request_id}}/cancel`  | Customer owner অথবা ADMIN | `{ "version": 3, "reason": "Plans have changed" }`       |

সবগুলো `200` ও updated request ফেরত দেয়। Edit শুধু PENDING এবং description/address/preferredStart-এর অন্তত একটি field; owner/serviceId/status/price/deletedAt বদলানো যাবে না। শুধু অন্য field edit করলে existing preferred time রাখা হয়; নতুন preferredStart দিলে future timezoneসহ datetime চাই। Review শুধু PENDING; `decision` হলো `APPROVE` অথবা `REJECT`, resulting status `APPROVED`/`REJECTED`। REJECT-এর জন্য reason বাধ্যতামূলক; APPROVE-তে optional। Reason trim করে ৩–৫০০ characters।

Cancellation PENDING অথবা APPROVED requests-এ; reason বাধ্যতামূলক। Linked work order ASSIGNED থাকলে request ও work order একই transaction-এ CANCELLED হয়, দুই version বাড়ে এবং slot মুক্ত হয়। EN_ROUTE/IN_PROGRESS/COMPLETED work cancel করলে `409`। REJECTED/CANCELLED request terminal; repeat cancel-ও `409`। Request hard-delete হয় না।

Test flow: create v1 → edit v2 → ADMIN approve v3 → customer cancel v4। Old version repeat `409`; customer দিয়ে review/admin দিয়ে edit `403`; অন্য customer's edit/cancel `404`; missing version/invalid body `400`। Parallel same-version edit/edit, approve/reject বা review/cancel চালালে এক `200`, অন্য `409`; version একবার বাড়বে ও শুধু winning audit থাকবে। Audit failure হলে state/version rollback; metadata-তে reason/address/description নয়, safe status/version/field names থাকে।

### Apidog: technician scheduling and progress

`.env`-এ dedicated `SEED_TECHNICIAN_EMAIL`, `SEED_TECHNICIAN_PASSWORD` (১৫–১২৮ characters), optional `SEED_TECHNICIAN_NAME` বসিয়ে `npm run seed:technician` চালান। Script শুধু নতুন TECHNICIAN + system audit তৈরি করে; existing account promote/password reset করে না। ADMIN/TECHNICIAN bootstrap একই email lock ব্যবহার করে। Technician `/auth/login` থেকে `technician_access_token = $.data.accessToken` ও `technician_id = $.data.user.id` extract করুন।

Apidog variables: `service_id`, `request_id`, `technician_id`, `admin_access_token`, `technician_access_token`, customer `access_token`, `work_order_id`, numeric `work_order_version` ও `request_version`। সব credentials/token **Local Value**-তে রাখুন। Access token expired হলে নিজ নিজ account login/refresh করুন।

1. ADMIN Bearer দিয়ে `PUT /technicians/{{technician_id}}/skills` → `{ "serviceIds": ["{{service_id}}"] }` → `200`। এটি পুরো skill set replace করে; unique UUID সর্বোচ্চ ১০০, `[]` allowed। Active work-এর required skill সরালে `409`; missing/deleted service অথবা non-technician account `404`।
2. ADMIN `GET /technicians?serviceId={{service_id}}&start=2099-01-01T10%3A00%3A00%2B06%3A00&end=2099-01-01T11%3A00%3A00%2B06%3A00&page=1&limit=20` → `200`, `{ items: [{ id, name }], pagination }`। নিজের future start/end দিন; Apidog query editor-এ raw values দিলে URL encode নিজে হবে। শুধু active matching-skill technicians ও non-overlapping visits আসে। এটি availability snapshot; slot reserve করে না।
3. CUSTOMER request তৈরি করুন → ADMIN approve করুন → ADMIN `POST /requests/{{request_id}}/assignment` → নিচের JSON → `201`। `work_order_id = $.data.id`, `work_order_version = $.data.version`, **`request_version = $.data.request.version`** extract করুন। Assignment request version-ও বাড়ায়।

```json
{
  "technicianId": "{{technician_id}}",
  "start": "2099-01-01T10:00:00+06:00",
  "end": "2099-01-01T11:00:00+06:00"
}
```

4. ADMIN `PATCH /work-orders/{{work_order_id}}/schedule` → একই JSON-এর সঙ্গে numeric `"version": 1` → `200`। নতুন start/end বা skilled technician দিন; নিজের existing slot-ও allowed। `work_order_version = $.data.version` extract করুন। শুধু ASSIGNED work reschedule হয়; agreed price/currency অপরিবর্তিত থাকে।
5. CUSTOMER/assigned TECHNICIAN/ADMIN `GET /work-orders/{{work_order_id}}` → `200`। Timeline সর্বশেষ ১০০টি safe event, chronological order-এ। `GET /work-orders?status=ASSIGNED&serviceId={{service_id}}&page=1&limit=20&sort=scheduled_start_asc` scoped items/count দেয়। Optional literal `q` description/address/service name-এ; sort `newest` (default), `oldest`, `scheduled_start_asc`। Public query দিয়ে owner/technician scope বদলানো যায় না।
6. Assigned TECHNICIAN `PATCH /work-orders/{{work_order_id}}/status` → `{ "version": 2, "status": "EN_ROUTE" }` → `200`; updated version extract করুন। এরপর `{ "version": 3, "status": "IN_PROGRESS" }` → `200`। Exact versions নিজের response থেকে নিন। Allowed sequence **ASSIGNED → EN_ROUTE → IN_PROGRESS**; skip/backward/repeat `409`, body-তে COMPLETED `400`। Completion/report + invoice আলাদা পরবর্তী stage।

সব visit future-এ শুরু হবে, `start < end`, duration সর্বোচ্চ ৮ ঘণ্টা, timezoneসহ ISO datetime ও সর্বোচ্চ millisecond precision; response UTC। এক technician-এর active ASSIGNED/EN_ROUTE/IN_PROGRESS ranges overlap করতে পারে না; `[start,end)` হওয়ায় exact adjacent visits allowed। Service price assignment-এর সময় server থেকে snapshot হয়; body-তে price/currency/status দিলে `400`। একটি request-এর একটিই work order, cancelled history-ও retained থাকে। Cancelled request-এর replacement চাইলে নতুন request তৈরি করুন।

| Negative/race test                                                | Expected                                        |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| Non-ADMIN skills/availability/assignment/schedule                 | `403`                                           |
| Customer/ADMIN status update                                      | `403`; ADMIN bypass নেই                         |
| Foreign customer অথবা former/unassigned technician details/status | `404`                                           |
| Invalid timestamp/range/UUID/extra field/version                  | `400`                                           |
| Pending/rejected/cancelled request assignment; missing skill      | `409`                                           |
| Suspended/deleted/wrong-role technician; unavailable service      | `404`                                           |
| Duplicate assignment অথবা overlapping visit                       | `409`; state/price/audit অপরিবর্তিত             |
| Same-version parallel reschedule/status                           | একটি `200`, অন্য `409`                          |
| Approved request-এর assigned work cancel                          | `200`; request + work CANCELLED, slot available |
| Customer cancel বনাম technician EN_ROUTE race                     | একটি `200`, অন্য `409`; partial cancellation নয় |
| Work শুরু হয়ে গেলে cancel/reschedule                              | `409`                                           |
| Revoked/expired session বা suspended/deleted actor                | `401`                                           |

Reassignment-এর পরে পুরোনো technician access হারায়। Existing catalog service soft-delete হলেও work history/progress চলে; নতুন assignment/reschedule-এর জন্য active service চাই। Request soft-delete হলে linked work read/mutation `404`। Work-order ও technician response/error `Cache-Control: no-store`; Redis এখানে ব্যবহৃত হয় না।

Shared request lock, sorted technician locks, bounded Serializable retries (সর্বোচ্চ ৪ attempts), DB exclusion constraint এবং একই transaction-এর typed audits scheduling/cancellation races protect করে। Retry-তে external side effects নেই; retries exhausted হলে `503`, client সামান্য বিরতি দিয়ে latest state fetch করবে। Audit failure state/version rollback করে; metadata-তে address/report/credentials থাকে না। Future role-changing code-ও technician User lock নিতে হবে। [PostgreSQL range constraints](https://www.postgresql.org/docs/18/rangetypes.html), [Serializable transactions](https://www.postgresql.org/docs/18/transaction-iso.html)

## Checks

```bash
npm run db:validate
npm run typecheck
npm run lint
npm test
npm run db:test:setup
npm run test:e2e
npm run build
npm run test:compiled
```

E2E tests-এর জন্য `.env`-এ আলাদা `TEST_DATABASE_URL` দিন; database name `_test` দিয়ে শেষ হবে (example: `fieldops_test`)। `db:test:setup` প্রয়োজন হলে test database তৈরি করে committed migrations apply করে; existing data reset করে না। Database user-এর `CREATEDB` permission লাগবে। Tests নিজেদের registration/service fixtures cleanup করে; main `DATABASE_URL`-এর database ব্যবহার করে না। Real cache tests-এর জন্য `TEST_REDIS_URL=redis://localhost:6379/1` দিন—index অবশ্যই `0`-এর বেশি; main Redis URL tests ব্যবহার করে না এবং flush command চালায় না। URL absent হলে real Redis tests skip হয়, public API/DB fallback tests চলে। Unit tests-এ DB/Redis লাগে না। Build স্বয়ংক্রিয়ভাবে Prisma Client generate করে; production entrypoint `dist/main.js`।

```bash
npm run start:prod
```

### Continuous integration

[Backend CI](.github/workflows/ci.yml) push to `main`, pull request ও manual run-এ locked install, client generation, schema/type/lint checks, unit tests, fresh PostgreSQL migrations, real Redis integration tests, build এবং compiled HTTP request flow চালাবে। Production secrets লাগে না; signing key প্রতি run-এ নতুন এবং DB/Redis service containers temporary। Official actions immutable commit SHA-তে pinned; workflow read-only permissions নেয়। [GitHub service container guide](https://docs.github.com/en/actions/tutorials/use-containerized-services)

`npm run test:compiled` build-এর পরে চালান। শুধু separate `_test` DB এবং optional Redis index >0 ব্যবহার হয়; test environment নির্ধারণের পরে native built Nest app import হয়; actual database name assert করা হয়। Temporary loopback port-এ safe ADMIN/TECHNICIAN bootstrap, password login, request lifecycle, skills/availability, assignment/reschedule, scoped reads, progress, cancellation ও audits verify হয়। Script নিজের fixtures cleanup করে; main DB reset হয় না। GitHub-hosted run push-এর পরে verify করতে হবে; local checks remote CI success প্রমাণ করে না।

## Schema changes

`prisma/schema.prisma` edit করার পরে:

```bash
npm run db:migrate -- --name describe_your_change
npm run db:generate
```

Scheduling migration-এর `btree_gist` extension ও custom exclusion/check constraints পরের migrations-এ preserve করতে হবে; শুধু `db push` দিয়ে এটি recreate করবেন না। PostgreSQL host-এ extension create permission লাগবে। Migration files Git-এ রাখতে হবে। `.env`, `node_modules/`, `dist/`, coverage, TypeScript cache, generated Prisma Client ও local agent skills ignored থাকবে। Auto-generated files disk-এ তৈরি হওয়া স্বাভাবিক; সেগুলো commit করার দরকার নেই। Shared `AGENTS.md`, `.github/copilot-instructions.md`, source, configs এবং `package-lock.json` Git-এ থাকবে।

## Requirements and plan

- [Assignment source](https://github.com/Apollo-Level2-Web-Dev/B7A6)
- [Reviewed Notion plan](https://app.notion.com/p/3f14ab5df14481b9bdccd1349fd83a18)

পরবর্তী কাজ: atomic completion/report + immutable invoice; তারপর SSLCommerz initiation/validation/idempotent settlement। বর্তমানে ২৫টি domain API + ২টি health route আছে; payment/deployment/submission review বাকি।

## Known dependency advisories

2026-10-07-এর dependency install check-এ Prisma 7.10 tooling-এর `deepmerge-ts` ও `mysql2` dependency paths থেকে আগের ৪টি high package warning রয়ে গেছে। Runtime PostgreSQL adapter ব্যবহার করে; audit এখনো clean নয়। Suggested forced Prisma downgrade বর্তমান setup-এর সঙ্গে compatible নয়, তাই প্রয়োগ করা হয়নি।
