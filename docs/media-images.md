# Profile and service images

FieldOps stores optional profile and catalog photos as owned media references. Existing accounts/services retain `null` images until an authorized user adds one. The frontend displays initials or an explicit fallback for missing and unavailable photos.

## Configuration and rollout

Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` together in the backend's ignored environment file or hosting secret store. Leaving all three blank disables uploads with `503`; partial configuration fails startup. The key must have upload/create permission in the matching product environment. A valid key without that permission still receives a provider rejection.

Use Settings → API Keys → the key's options → Assign Roles to configure access. Available roles depend on the account's permissions system. Prefer a suitable upload-capable role or restricted folder access where available. A Master Admin key also grants broad administrative access and must stay server-only. See [official role assignment](https://cloudinary.com/documentation/dam_admin_role_management) and [legacy key roles](https://production.cloudinary.com/documentation/assets_onboarding_permissions_tutorial).

Apply committed additive migrations and deploy the backend before enabling frontend controls. No existing accounts or financial records are reset. Set the frontend's `IMAGE_CLOUD_NAME` to the same **public cloud name**; it needs no API key or secret. The image optimizer accepts only that cloud's versioned `fieldops` namespace and rejects redirects.

## Upload, then attach

`POST /api/v1/media/images` requires current Bearer authentication and a multipart body containing exactly:

| Field     | Value                                                            |
| --------- | ---------------------------------------------------------------- |
| `file`    | One JPEG, PNG or WebP file, at most 3 MiB                        |
| `purpose` | `AVATAR` for CUSTOMER/TECHNICIAN/ADMIN; `SERVICE` for ADMIN only |

The endpoint permits ten attempts per minute per IP. File size, actual bytes, declared type and raster signatures are checked before provider access. SVG, remote URLs, caller-selected owners and additional fields are rejected. The provider must decode the file and return the exact expected immutable asset.

Successful responses follow the existing envelope: `{ success: true, message: "Image uploaded successfully", data: { id, url } }`. The URL is a versioned Cloudinary WebP delivery URL under `fieldops/{purpose}/{owner}/{uuid}`.

Uploading alone does not change a profile or catalog entry. Apply the returned URL through:

- `PATCH /users/me`: optional `avatarUrl` alongside existing name/phone fields.
- `POST /services` or `PATCH /services/:id`: optional `imageUrl` alongside catalog fields.

Only a recorded upload owned by the current actor with the matching purpose can be attached. Another user's URL, an unrecorded URL or a profile upload used as a catalog photo is rejected. Omit the image field to preserve its value; send `null` to remove the reference. Catalog responses expose `imageUrl`; safe account/profile and administrator user projections expose `avatarUrl`.

## Security and consistency

The server sends bounded local bytes to a fixed HTTPS Cloudinary endpoint with server-only Basic authentication. Uploads have a twenty-second timeout, no redirects and no automatic retries. Each uses a fresh public ID, refuses overwrites, produces WebP and limits either dimension to 1600px. Response validation checks the configured cloud, asset ID, version, type, format and dimensions.

Provider calls stay outside database transactions. Current account/session/role checks run before upload and again before committing the owned-media record and `IMAGE_UPLOADED` audit. Profile/catalog attachment and its existing audit commit together. Audit metadata records purpose or changed field names, never credentials or raw provider responses. Catalog cache keys use a new namespace to avoid older projections without images. Private media responses use `Cache-Control: no-store`.

The frontend upload proxy checks the exact browser origin, authenticates the server session, bounds the actual multipart stream and forwards the Bearer token only from the server. Upload UI uses shadcn controls, local preview and progress. Save and sheet dismissal are disabled during upload; an unconfirmed upload leaves the saved image unchanged. Removing an image requires saving the form.

## Storage lifecycle and verification limits

These photos have public delivery URLs and are unsuitable for confidential attachments. Original filenames are not stored. An abandoned form or a database failure after provider success can leave an unreferenced asset. Replacing/removing a reference does not automatically delete the old Cloudinary asset; no background cleanup job is implemented. Reconcile references before deleting unreferenced assets, and scope disposable test cleanup to exact test asset IDs.

Boundary tests cover provider response validation and safe failures. PostgreSQL/Nest integration tests cover ownership, role/purpose restrictions, attachment/removal, auditing and malformed uploads while replacing the external provider transport. These do not establish Cloudinary permissions or hosted upload success; verify real uploads separately after configuration and deployment.

On October 10, 2026, the local checkpoint passed 157 unit tests, 484 PostgreSQL/Redis integration tests and the compiled HTTP workflow. Separately, real Cloudinary uploads succeeded after the configured key received upload access. The frontend verified avatar upload/save/reload/removal for all three roles, and administrator service upload/create/public-detail/mobile delivery against isolated databases.

### Coordinated hosted release — October 10, 2026

| Application | Released revision                          | Evidence                                                                                                                |
| ----------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Backend     | `35ed3df4abed29001ff4ae15f17a4c7b323e566a` | [CI](https://github.com/rafiferdos/fieldops-api/actions/runs/38050362076), Render `dep-db52jvqd0e5s73dvtuvg`, Live      |
| Frontend    | `ee0f4dd541faa8ea09a3f8b993a77b0ae3155c29` | [CI](https://github.com/rafiferdos/fieldops/actions/runs/38050365588), Vercel `dpl_5gyHKBxWvsJpwbLnMzfJEy2xLkNc`, Ready |

Backend credentials were saved in Render; only the public cloud name was added to Vercel Production. Backend release logs confirm the additive migration applied successfully before startup, and `/api/v1/health/ready` returned database `up`. The frontend released afterward from its exact CI-passed Git revision. No database reset or paid hosting change occurred.

Executed hosted checks used a newly registered disposable CUSTOMER and one explicitly disposable service created by an existing administrator. Real provider service upload/create/public catalog/detail reads passed. CUSTOMER service-upload attempts returned `403`; attaching the administrator's catalog upload as the customer's avatar returned `400`. The existing administrator profile was not edited.

On the canonical HTTPS frontend, the disposable customer uploaded a photo through the authenticated multipart proxy, saved it, reloaded it and removed/saved/reloaded it successfully. Profile, catalog and detail photos loaded through the real Next.js optimizer. Mobile detail at 390px loaded without horizontal overflow. Completed browser checks reported no runtime, hydration or console warning/error entries; desktop/mobile screenshots were inspected. These focused checks do not claim a repeated full payment/OAuth regression or real mobile hardware validation.

After verification, the service's image reference was cleared and the service soft-deleted; public detail returned `404`. The customer retained no avatar, was suspended and its sessions revoked. Both exact test Cloudinary assets were deleted, and the temporary administrator test session was logged out. Audit/media records retain the normal verification history. Existing customer work and payment records were unchanged. No bulk hosted demonstration seed was run. Sanitized screenshots are kept outside public Git in the frontend workspace's `delivery/media-images/` folder. Documentation-only commits after these revisions do not alter deployed application code.

For realistic demonstration data, use a repeatable, explicitly scoped seed process and actual domain operations. Preserve existing records and ownership, identify demonstration accounts, and never fabricate gateway settlement, customer activity or production usage claims. Bulk hosted demonstration seeding is separate from image support.
