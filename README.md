# FieldOps API

Programming Hero Assignment 6-এর Field Service Management backend। এখন foundation প্রস্তুত; domain APIs এখনো implementation বাকি। Assignment 7 frontend পরে হবে।

## Stack

Node.js 24, NestJS (Express adapter), strict TypeScript / ESM, PostgreSQL 18, Prisma 7, Zod, Helmet এবং Throttler। Tests: Vitest + Supertest; lint: oxlint; formatting: Prettier।

## Local setup

```bash
nvm use
cp .env.example .env
npm ci
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

| Method | Endpoint               | Purpose                              |
| ------ | ---------------------- | ------------------------------------ |
| GET    | `/api/v1/health`       | API liveness                         |
| GET    | `/api/v1/health/ready` | Prisma দিয়ে database readiness check |

Success: `{ success: true, message, data }`। Error: `{ success: false, message, errors: [] }`।

Roles: `CUSTOMER`, `TECHNICIAN`, `ADMIN`। Dispatch ও finance duties `ADMIN` role-এর মধ্যে থাকবে। Authentication এবং domain APIs এখনো তৈরি হয়নি।

## Checks

```bash
npm run db:validate
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

E2E tests `.env`-এ configured running PostgreSQL ব্যবহার করে read-only readiness query চালায়। Unit tests-এ database লাগে না। Build স্বয়ংক্রিয়ভাবে Prisma Client generate করে; production entrypoint `dist/main.js`।

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

পরবর্তী কাজ: Zod request validation, authentication, ownership checks এবং domain modules।
