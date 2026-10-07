# FieldOps backend

Read AGENTS.md before architectural changes. The reviewed plan is https://app.notion.com/p/3f14ab5df14481b9bdccd1349fd83a18 and its child blueprint defines the domain/API rules. Assignment requirements and explicit user instructions take priority. Check current official docs for version-sensitive behavior.

Use Node 24 LTS, strict TypeScript, NestJS with the Express adapter, ESM, PostgreSQL and Prisma 7. Preserve CLI-generated tooling and package-lock.json. Exactly three roles: CUSTOMER, TECHNICIAN, ADMIN; dispatch and finance belong to ADMIN.

Organize by Nest feature modules. Controllers adapt HTTP, injectable services enforce policy, and PrismaService owns the DB client. Use Guards, Zod Pipes, Exception Filters and Interceptors for shared concerns. Do not copy the earlier plain Express snippets into Nest.

Check ownership plus roles; validate body, params and query. Use /api/v1 with consistent success/error JSON. Keep .env/secrets private. Protect scheduling, invoicing, refresh rotation and payment settlement with constraints/transactions. External network calls stay outside retryable DB transactions. Verify payments with the provider; handle duplicate/late events safely.

Reuse small typed helpers; avoid generic CRUD frameworks and speculative abstractions. Install dependencies when their feature needs them. Run applicable generate/typecheck/lint/tests/build checks; report only checks actually run. The user writes domain code; make only requested changes. Explain in Bengali with English technical terms. Mark meaningful working checkpoints as `+ commit`. Codex is authorized to commit each completed, verified mini-feature separately with concise messages. Keep checkpoints buildable; do not create empty or cosmetic-only commits to inflate counts. Do not push unless asked.
