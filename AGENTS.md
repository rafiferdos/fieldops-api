# Assignment 6 — FieldOps

This workspace is the Field Service Management backend for Programming Hero B7A6. The student ID ends in 7. Assignment 7 is a separate frontend workspace and is deferred until backend completion and review of its own requirements.

## Authoritative requirements

Read https://github.com/Apollo-Level2-Web-Dev/B7A6 and its four Markdown files when requirements need rechecking. The reviewed Notion plan is https://app.notion.com/p/3f14ab5df14481b9bdccd1349fd83a18; its child blueprint contains the endpoint/domain rules. Former local docs are currently absent; do not recreate them unless requested. Mandatory assignment rules override optional idea-hub features. Use the README's 5–10 minute video requirement if the timeline disagrees. Published deadlines are historical; do not assume an extension.

## Working agreement

Use Bengali as the primary language for user-facing notes and explanations, while retaining English technical terms, headings, endpoints, identifiers, and code. Keep explanations concise. When recommending résumé additions, explicitly distinguish existing listed skills from technologies/engineering capabilities not mentioned in the résumé; absence from the résumé does not mean the user lacks the skill. Prioritize Redis, automated testing, payment reliability and concurrency now; background jobs later.

The user writes the core application. Unless subsequently asked to implement it, provide focused explanations, near-code domain hints, and exact common utility code. The current artifacts are plans, not a completed application.

Use Node 24 LTS, strict TypeScript, NestJS with the default Express adapter, PostgreSQL and Prisma 7. The user selected NestJS. Preserve the current CLI-generated ESM, Vitest, oxlint/Prettier configuration and lockfile. Exactly three primary roles: CUSTOMER, TECHNICIAN, ADMIN. Use versioned routes, Bearer authentication, email/password and verified Google login, Zod validation, consistent success/error JSON, soft deletion, audit logs, pagination, filtering/search, and a real supported gateway. SSLCommerz/BDT is the planned gateway; sandbox grading acceptance is unconfirmed.

Use Nest modules, injectable providers, guards, pipes, exception filters and interceptors for shared concerns. Prisma goes through an injectable PrismaService with a driver adapter and lifecycle hooks. The earlier bare Express snippets in Notion are legacy reference, not NestJS-ready code. Provide setup guidance in Bengali in chat with exact commands and a literal `+ commit` after each working meaningful checkpoint. The user makes the commits; do not commit automatically.

The idea hub lists five possible user types as suggestions. The mandatory project rule requires three fixed primary roles. Our chosen mapping is Customer → CUSTOMER, Technician → TECHNICIAN, Dispatcher/Manager + Finance/Admin + Admin → ADMIN. All ADMIN users have dispatch and finance duties in this scope; do not silently invent five login roles or scoped admin permissions.

## Architecture and invariants

- Modular monolith: Nest feature modules → controllers → injectable domain services → PrismaService. Use simple typed shared helpers; keep business policy explicit. Avoid generic CRUD frameworks and unused abstractions.
- Authorization checks current session/account and resource ownership. Public clients cannot choose roles. Never expose hashes, tokens, or provider credentials.
- Transactions protect scheduling, state changes, completion/invoicing, settlement and refresh rotation. Scheduling cannot overlap for the same technician. Apply price snapshots and immutable invoices.
- Payment is successful only after server-side provider validation; protect idempotency, duplicate callbacks, uncertain gateway outcomes, and late events. External network calls stay outside retryable transactions.
- PostgreSQL is authoritative for access, availability and payments. Cache only public catalog data; handle Redis outage by falling back to DB.
- Verify security, concurrency and money invariants with meaningful integration tests. Match documented API examples to actual behavior. Use the lockfile, migrations, safe seeds, CI and early deployment.

## Delivery

At least 20 meaningful documented domain APIs and 20 meaningful backend commits are required. Our plan defines 38 APIs. Submit backend repository, live API, complete API documentation, dedicated demo admin credentials and 5–10 minute walkthrough. Do not fabricate commits, deploy without an applicable request, or invent Assignment 7 requirements.
