# Live Apidog fixtures

Captured on October 8, 2026 against `https://fieldops-api-xu3s.onrender.com/api/v1`.

Use the **Default module**, folders **01–11**, **Testing Env**, and **Cloud Proxy** for normal testing. Its [canonical collection](fieldops.postman_collection.json) now includes main inputs, named manual cases and the 92 sanitized actual captures. [The full walkthrough](backend-walkthrough.md) lists the real IDs and all route inputs. Apidog groups matching methods/paths into endpoints with multiple debug cases; scenario and route counts differ. The earlier **FieldOps — Actual scenarios** module and [sample collection](fieldops-live-samples.postman_collection.json), with 17 prepared requests, remain optional historical backups.

## Start testing

1. Log in with each dedicated role. Store credentials and the returned role token only in **Local Values**. Customer uses `access_token`, administrator `admin_access_token`, technician `technician_access_token`. Access tokens expire after 15 minutes; log in again after expiration. Shared Values must remain blank.
2. Choose a canonical endpoint in folders 01–11. Set its ID from your fresh workflow or the walkthrough's prepared fixtures, then GET its current state/version before changing it. Local environment IDs override the sample defaults.
3. Send one mutation at a time. After success, copy the returned version into the next request. Verify the selected tab, HTTP method, path, role and body before pressing Send. Do not run the whole collection automatically.
4. **ACTUAL** examples contain historical success/error responses; **MANUAL** cases contain documented expectations. Open Preview or choose the named debug case. Captures do not reset database state; old mutations can correctly return a conflict when repeated.

## Prepared fixtures

| Fixture | Initial verified state | Next useful test |
| --- | --- | --- |
| Editable request | PENDING, version 2 | Edit, then approve using the new version |
| Independent approved request | APPROVED, version 2 | Assign the qualified technician in the provided future window |
| Progress work order | ASSIGNED, version 2 | Reschedule or advance to EN_ROUTE; update version afterward |
| Completion work order | IN_PROGRESS, version 3 | Complete once and inspect the frozen invoice |
| Existing unpaid invoice | UNPAID, BDT 1,500.00 | Create a sandbox checkout with `sample_idempotency_key` |
| Original settled invoice/payment | PAID / SUCCEEDED, BDT 1,500.00 | Read state; recover checkout with the original key |
| Original paid work with feedback | COMPLETED, feedback present | Repeat feedback and expect 409 |
| Disposable access-test account | Separate CUSTOMER fixture | Inspect current status before suspension/reactivation; never use the demo administrator |

Scheduling timestamps were prepared 14–22 days after capture. Replace them with future non-overlapping windows when they become stale. The assignment and rescheduling examples use separate dates to avoid the existing work. Availability is still authoritative at send time.

## Payment and error examples

Actual captures cover invalid/missing authentication, forbidden role access, malformed inputs, deleted resources, stale versions, changed completion/checkout replays, duplicate feedback and incomplete reporting windows. These are representative checks, not every possible error combination.

Only SSLCommerz sandbox is configured. Complete its test flow and then GET the payment and invoice; a browser redirect alone never establishes settlement. Retry uncertain checkouts with the same key and body. Do not replace a pending key just because a request timed out. Provider transaction/validation facts stay in Local Values; never invent callback values.

Passwords, tokens, Google identity and checkout session URLs are absent or redacted in published captures. Generated code in Apidog can resolve Local Values: inspect it before sharing screenshots or exporting a populated environment. Submit administrator credentials privately.
