# Backend verification record

Verified on October 7–8, 2026, using Chrome Apidog Web, Testing Env and Cloud Proxy. This records executed checks, not a claim that every possible edge case is covered. The canonical collection has illustrative responses; the separate live sample collection contains sanitized actual captures with their provenance.

## Environment and scope

- Live base URL: `https://fieldops-api-xu3s.onrender.com/api/v1`.
- Hosted source during the original workflow: `c01891b`; Render Free and Neon PostgreSQL, SSLCommerz sandbox. Redis is not configured on the hosted service; public catalog reads fall back to PostgreSQL.
- Dedicated customer, technician and administrator fixtures were used. Real Google sign-in was tested with explicit authorization; its application session was logged out and rejected afterward.
- Credentials, provider validation IDs and tokens are confined to ignored local files and Apidog Local Values. They are deliberately absent from this report and the collection.
- Administration build `de6d649` was subsequently deployed to Render. Its logs confirmed all 15 migrations applied and the service Live. [GitHub CI run 37732046335](https://github.com/rafiferdos/fieldops-api/actions/runs/37732046335) completed successfully.

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
| Administration reads | Hosted user list, compact audit search and overview each returned `200` through Apidog. An otherwise valid `from` without `to` returned `400`; default overview was restored and returned `200`. |
| Administration access | After explicit approval, direct live API checks restored the disposable CUSTOMER to ACTIVE (`200`), verified fresh login/profile (`200`), and confirmed an identical update preserves the session. Suspension returned `200`, rejected old access and password login (`401`), and reactivation returned `200` without reviving old access/refresh (`401`). Fresh login/profile succeeded (`200`); the account was left ACTIVE. Customer overview access returned `403`; invalid status `400`. |

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

- All four administration routes are deployed and checked. The final 20 account lifecycle/readiness checks used direct HTTP against the live API, reducing browser use; their captures are labeled accordingly. The dedicated account is ACTIVE. [Final documentation CI](https://github.com/rafiferdos/fieldops-api/actions/runs/37733402331) also passed.
- Actual scenarios were imported into a separate Apidog module. The backup contains 92 captured actual responses and 17 prepared requests. PENDING v2, ASSIGNED v2, IN_PROGRESS v3 and an UNPAID invoice were re-read successfully through Apidog. The saved PAID invoice response was reviewed in documentation Preview. See [the fixture guide](live-fixtures.md); historical examples do not reset state.
- Supply the dedicated demo administrator credentials privately with the submission and record the required real 5–10 minute walkthrough.
- Confirm sandbox payment acceptance with the course if needed; a successful sandbox integration does not establish grading policy.

Render Free cold starts, dependency advisories and the Prisma/pg query-queue deprecation remain documented in the README. Production proxy trust, distributed rate limiting, live payment credentials and a production frontend origin require review before a broader launch.
