# FieldOps API

Programming Hero Assignment 6-এর Field Service Management backend। Password/Google login, session/token lifecycle, role authorization ও own profile update প্রস্তুত; domain APIs implementation চলছে। Assignment 7 frontend পরে হবে।

## Stack

Node.js 24, NestJS (Express adapter), strict TypeScript / ESM, PostgreSQL 18, Prisma 7, Zod, Helmet এবং Throttler। Tests: Vitest + Supertest; lint: oxlint; formatting: Prettier।

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
docker compose up -d postgres
npm run db:status
```

নতুন database-এ committed migrations apply করুন:

```bash
npm run db:deploy
npm run start:dev
```

আগে থেকেই migrated database থাকলে status up to date থাকবে। `.env`-এর `DATABASE_URL` ও `POSTGRES_PASSWORD` একই credentials ব্যবহার করবে। Example password শুধু local development-এর জন্য। Config file: `prisma.config.ts`। Existing project-এ আবার `prisma init` চালাতে হবে না।

## Available endpoints

| Method | Endpoint                | Purpose                               |
| ------ | ----------------------- | ------------------------------------- |
| GET    | `/api/v1/health`        | API liveness                          |
| GET    | `/api/v1/health/ready`  | Prisma দিয়ে database readiness check  |
| POST   | `/api/v1/auth/register` | Customer account তৈরি                 |
| POST   | `/api/v1/auth/login`    | Password যাচাই ও session/token pair   |
| POST   | `/api/v1/auth/google`   | Verified Google credential দিয়ে login |
| POST   | `/api/v1/auth/refresh`  | Refresh token rotation                |
| POST   | `/api/v1/auth/logout`   | Bearer দিয়ে current session revoke    |
| GET    | `/api/v1/users/me`      | Authenticated own profile             |
| PATCH  | `/api/v1/users/me`      | নিজের name/phone update ও audit       |
| POST   | `/api/v1/services`      | ADMIN service তৈরি ও audit            |
| PATCH  | `/api/v1/services/:id`  | ADMIN service update ও audit          |
| DELETE | `/api/v1/services/:id`  | ADMIN service soft delete ও audit     |

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

Authentication guard default-এ সব registered route protect করে; public health/register/login/google/refresh-এ explicit `@Public()` আছে। প্রতিটি private request-এ current database session/account check হয়; role JWT থেকে বিশ্বাস করা হয় না। Resource ownership checks domain modules-এর সঙ্গে যোগ হবে।

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

## Checks

```bash
npm run db:validate
npm run typecheck
npm run lint
npm test
npm run db:test:setup
npm run test:e2e
npm run build
```

E2E tests-এর জন্য `.env`-এ আলাদা `TEST_DATABASE_URL` দিন; database name `_test` দিয়ে শেষ হবে (example: `fieldops_test`)। `db:test:setup` প্রয়োজন হলে test database তৈরি করে committed migrations apply করে; existing data reset করে না। Database user-এর `CREATEDB` permission লাগবে। Tests নিজেদের registration fixtures cleanup করে; main `DATABASE_URL`-এর database ব্যবহার করে না। Unit tests-এ database লাগে না। Build স্বয়ংক্রিয়ভাবে Prisma Client generate করে; production entrypoint `dist/main.js`।

```bash
npm run start:prod
```

## Schema changes

`prisma/schema.prisma` edit করার পরে:

```bash
npm run db:migrate -- --name describe_your_change
npm run db:generate
```

Migration files Git-এ রাখতে হবে। `.env`, `node_modules/`, `dist/`, coverage, TypeScript cache, generated Prisma Client ও local agent skills ignored থাকবে। Auto-generated files disk-এ তৈরি হওয়া স্বাভাবিক; সেগুলো commit করার দরকার নেই। Shared `AGENTS.md`, `.github/copilot-instructions.md`, source, configs এবং `package-lock.json` Git-এ থাকবে।

## Requirements and plan

- [Assignment source](https://github.com/Apollo-Level2-Web-Dev/B7A6)
- [Reviewed Notion plan](https://app.notion.com/p/3f14ab5df14481b9bdccd1349fd83a18)

পরবর্তী কাজ: Public catalog search/pagination ও Redis cache; তারপর service requests ও ownership rules।

## Known dependency advisories

2026-10-06-এর `npm audit`-এ Prisma 7.10 tooling-এর `deepmerge-ts` ও `mysql2` dependency paths থেকে ৪টি high package warning আছে। Runtime PostgreSQL adapter ব্যবহার করে; audit এখনো clean নয়। Suggested forced Prisma downgrade বর্তমান setup-এর সঙ্গে compatible নয়, তাই প্রয়োগ করা হয়নি।
