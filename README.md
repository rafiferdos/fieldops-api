# FieldOps API

Programming Hero Assignment 6-এর Field Service Management backend। Foundation ও customer registration প্রস্তুত; বাকি domain APIs implementation চলছে। Assignment 7 frontend পরে হবে।

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

| Method | Endpoint                | Purpose                              |
| ------ | ----------------------- | ------------------------------------ |
| GET    | `/api/v1/health`        | API liveness                         |
| GET    | `/api/v1/health/ready`  | Prisma দিয়ে database readiness check |
| POST   | `/api/v1/auth/register` | Customer account তৈরি                |
| POST   | `/api/v1/auth/login`    | Password যাচাই ও session/token pair  |

Success: `{ success: true, message, data }`। Error: `{ success: false, message, errors: [] }`।

Roles: `CUSTOMER`, `TECHNICIAN`, `ADMIN`। Dispatch ও finance duties `ADMIN` role-এর মধ্যে থাকবে। Google login পরবর্তী কাজ।

### Apidog: login test

Local environment: `base_url = http://localhost:3000/api/v1`। Credentials/token local values রাখুন। Server: `npm run start:dev`।

1. `POST {{base_url}}/auth/register` — নিচের registration JSON দিয়ে নতুন account তৈরি করুন (`201`)।
2. `POST {{base_url}}/auth/login` — JSON body-তে একই `email` ও `password` দিন (`200`)। `data`-তে safe `user`, `accessToken`, `refreshToken`, `tokenType`, `expiresIn: 900`, `refreshExpiresAt` থাকবে।
3. Login-এর **Post Processors → Extract Variable**: Environment scope-এ `access_token` = `$.data.accessToken`, `refresh_token` = `$.data.refreshToken` save করুন। [Apidog guide](https://docs.apidog.io/extract-variable-588468m0)
4. ভুল password বা অজানা email দিয়ে login: একই `401` ও `Invalid email or password` message। Body-তে `role` দিলে `400`। Login প্রতি IP-তে ১০ attempts/minute।

Access JWT ১৫ মিনিট, session ও refresh token সর্বোচ্চ ৭ দিন। Auth response/error `Cache-Control: no-store`। Raw refresh token database-এ রাখা হয় না।

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

পরবর্তী কাজ: login/session, Google login, ownership checks এবং domain modules।

## Known dependency advisories

2026-10-06-এর `npm audit`-এ Prisma 7.10 tooling-এর `deepmerge-ts` ও `mysql2` dependency paths থেকে ৪টি high package warning আছে। Runtime PostgreSQL adapter ব্যবহার করে; audit এখনো clean নয়। Suggested forced Prisma downgrade বর্তমান setup-এর সঙ্গে compatible নয়, তাই প্রয়োগ করা হয়নি।
