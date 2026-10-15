# Greenair Invoice v2.5 synchronisation staging

This branch is isolated from main and **not deployed**.

## Completed
- Added `sync-v25-staging.js` as a prototype router using the existing PostgreSQL records table.
- Session authentication required for all routes.
- Reads are paginated; writes require an expected revision and reject conflicts (HTTP 409).
- No existing invoice or customer records were modified.

## Before deployment (required)
1. Fix the change-feed cursor to use a composite (updated_at, record_key) cursor so records with identical timestamps cannot be skipped. The current endpoint is **not safe for production syncing**.
2. Add durable per-record revisions and a server-side audit trail; test concurrent writes and deletes/tombstones.
3. Implement an authenticated desktop/mobile client login mechanism, device identities, token revocation, rate limits, and CSRF protections as appropriate. Current session auth alone is not a desktop API design.
4. Review current record types, JSON payloads, invoice numbering, and offline merge rules. Allocate invoice numbers centrally.
5. Export and independently verify full backups of Windows, Android and cloud data before any import. Import should be preview/merge only, never destructive overwrite.
6. Replace or upgrade the Render free database before its scheduled expiry (2026-11-05), and configure tested, off-site point-in-time backup retention.
7. Mount router in server.js **only after testing**: `app.use('/api/sync/v25', createSyncRouter(pool))` after the session middleware. Do not mount on main yet.
8. Test with separate throwaway database and client simulators before production rollout.

## Status
Prototype source committed; no deployment, no database changes, no Windows or Android sync client yet.

## 2026-10-15 progress
- Added `sync-v25-events.js` (commit 543d106): immutable sequence-based change feed, paginated snapshot, authenticated endpoints, transaction-scoped advisory lock and optimistic conflict detection.
- This module is deliberately **not mounted** in the running server. No production data modified.
- Important: Existing web routes write directly to `records`, so they do not yet append to `sync_events`. Add a database trigger or migrate all writers before clients can rely on the change feed.
- Initial snapshot needs a consistent watermark and pagination protocol to prevent missed concurrent updates.
- Record deletion, invoice number allocation, idempotent retries, device login, Android integration and Windows integration remain unimplemented.
- Existing Render free PostgreSQL instance is set to expire 2026-11-05. Do not switch business invoicing to it until persistence and tested off-site backups are secured.
