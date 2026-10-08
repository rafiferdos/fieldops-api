# Backend verification record

Verified on October 7–8, 2026, using Chrome Apidog Web, Testing Env and Cloud Proxy. This records executed checks, not a claim that every possible edge case is covered. Saved collection responses remain illustrative.

## Environment and scope

- Live base URL: `https://fieldops-api-xu3s.onrender.com/api/v1`.
- Hosted source during the original workflow: `c01891b`; Render Free and Neon PostgreSQL, SSLCommerz sandbox. Redis is not configured on the hosted service; public catalog reads fall back to PostgreSQL.
- Dedicated customer, technician and administrator fixtures were used. Real Google sign-in was tested with explicit authorization; its application session was logged out and rejected afterward.
- Credentials, provider validation IDs and tokens are confined to ignored local files and Apidog Local Values. They are deliberately absent from this report and the collection.
- The four new administration endpoints were checked locally with real Nest guards, JWT sessions and PostgreSQL. Their hosted manual checks remain pending deployment of the new commits.

## Live manual checks

| Area | Executed result |
| --- | --- |
| Health | Liveness and database readiness both `200`; database up. |
| Registration/password login | Customer registration `201`; all three roles logged in with `200`; incorrect credentials `401`. |
| Google login | A real Google ID token returned `200` and CUSTOMER access. Forged token returned `401`. Logout returned `200`; the same session subsequently returned `401`. |
| Sessions/profile | Refresh rotation `200`; expired access `401`; own profile read/update `200`. |
| Catalog | Create `201`, list/read/update `200`; a separate disposable service was soft-deleted with `200` and became `404`. Customer creation attempt `403`. |
| Requests | Create `201`; list/read/edit/review `200`; stale version `409`. Separate pending request cancellation `200`; cancellation after work started `409`. |
| Dispatch | Replace skills and availability search `200`; approved request assignment `201`. |
| Work orders | Scoped list/details/timeline/reschedule `200`; EN_ROUTE then IN_PROGRESS transitions `200`; completion `200` with an invoice. Identical completion replay `200`; changed completion report `409`. |
| Invoice/payment | Frozen invoice read `200`; Technician invoice access `403`. Sandbox checkout creation `201`; payment read became SUCCEEDED and invoice read became PAID (`200`). |
| Checkout idempotency | Reusing the original key after settlement returned `200` with the same SUCCEEDED payment ID and `150000` BDT minor units. Changing billing while retaining that key returned `409`. |
| Provider callbacks | Real sandbox IPN settled the invoice. Repeated IPN/success and late fail/cancel callbacks returned `200`; the payment remained SUCCEEDED. Unknown transaction `404`; malformed transaction input `400`. |
| Feedback | Customer feedback for the completed, paid work returned `201`; duplicate review returned `409`. |

The sandbox payment was BDT 1,500.00, using the provider's test card flow. A read-only hosted database check found exactly one SETTLED receipt for that payment. No real funds were transferred. The browser return page was blocked by a browser extension (`ERR_BLOCKED_BY_CLIENT`); server IPN delivery and settlement succeeded independently. Browser protections were not disabled.

The merchant IPN setting was saved as:

```text
https://fieldops-api-xu3s.onrender.com/api/v1/payments/sslcommerz/ipn
```

## Local completion checks

Node 24.21.0; a separate guarded PostgreSQL test database and Redis test database; 15 additive migrations applied. Gateway integration tests replace only provider HTTP transport, and Google tests use test audiences and signing keys.

- 114 unit tests and 461 integration tests passed.
- Type checking, lint, build and the compiled native HTTP workflow passed.
- Documentation checks matched 42 request examples to all 40 implemented routes: 38 domain APIs and two health routes, including authorization, success statuses and actual validation pipes.
- Administration coverage includes safe user/audit projections, filters, reporting windows, exact paid-invoice revenue without duplicate callback counting, last-active-admin protection, assignment versus role-change races, audit rollback, session revocation, and login versus suspension races. Reactivation does not revive an old session.

## Repeatable manual procedure

1. Import `fieldops.postman_collection.json` into Apidog. Keep the live base URL and dedicated credentials in Local Values; leave Shared Values empty.
2. Log in separately for each role and refresh the matching access-token variable. Access tokens expire after 15 minutes. Do not save authentication responses as shared examples.
3. Run the documented workflow deliberately. Use future scheduling times and copy each current ID/version from its actual response. Cancellation and soft deletion need separate fixtures.
4. Use one idempotency key per checkout intent. A timeout is a reason to recover the same attempt, not create a new key. Complete only the sandbox checkout and check server payment/invoice state afterward.
5. Test access changes on a separate disposable user (`managed_user_id`), preserving the workflow customer and dedicated demo administrator. After suspension/reactivation, log in again.

## Remaining delivery checks

- Push the verified local commits, deploy them, and manually exercise the four ADMIN endpoints against the hosted build. Verify the corresponding hosted CI run.
- The new ADMIN documentation was imported into the existing Apidog module and its overview description/response contract reviewed. Actual replayable scenario samples are being added separately from illustrative templates.
- Supply the dedicated demo administrator credentials privately with the submission and record the required real 5–10 minute walkthrough.
- Confirm sandbox payment acceptance with the course if needed; a successful sandbox integration does not establish grading policy.

Render Free cold starts, dependency advisories and the Prisma/pg query-queue deprecation remain documented in the README. Production proxy trust, distributed rate limiting, live payment credentials and a production frontend origin require review before a broader launch.
