# The EventSmith NG — Backend Scaffold

This is the real database schema and starting backend logic behind the
clickable prototype, built from the Platform Blueprint and every refinement
agreed during our planning conversation. It's meant to be dropped into (or
grown into) a Next.js project — it isn't runnable as-is in a sandboxed
environment since it needs a real Postgres database and outbound network
access for OTP emails.

## What's here

```
prisma/
  schema.prisma   — the full data model (Section 3 of the blueprint, plus
                     every refinement: split-fulfilment vendors, competing
                     vendor options, versioned vendor contacts, the two-river
                     financial model, phase-anchored scheduling, junior/senior
                     planner tiers)
  seed.ts         — creates all 10 event types, but only populates the
                     Wedding template with real content (phases, tasks,
                     vendor priority tiers, budget categories) — matching the
                     confirmed Phase 1 scope: the template *mechanism* is
                     generic, only Wedding has content behind it so far

src/lib/
  db.ts           — Prisma client singleton
  otp.ts          — OTP generation, hashing (HMAC, never plaintext), expiry,
                     single-use enforcement, attempt limiting
  session.ts      — session issuing/resolving, correctly scoped so a client
                     session can only ever see the one event it's tied to
  email.ts        — OTP delivery via Resend (chosen for its permanent free
                     tier — see blueprint Section 8/9)
  rateLimit.ts     — basic per-email rate limiting on code requests

src/app/api/
  auth/request-code/route.ts   — validates + sends OTP, never confirms/denies
                                   whether an email is authorised
  auth/verify-code/route.ts    — verifies OTP, issues a scoped session cookie
  events/route.ts               — GET lists every event (used by the admin
                                   prototype's Events screen and Team &
                                   Client Access event picker); POST creates
                                   an event and clones a template's
                                   phases/tasks/budget categories onto it
  budget/select-vendor-option/route.ts — the competing-options budget logic:
                                   mark one vendor Selected, reject the rest,
                                   update the committed amount, auto-create
                                   the Vendor record if needed
  funds/allocate/route.ts       — records one incoming payment split across
                                   multiple budget line items/vendors
  vendors/[vendorId]/payments/route.ts — records a vendor payment and keeps
                                   the linked budget line item's amountPaid
                                   in sync automatically
  admin/team/route.ts            — super-admin-only: add/list/deactivate
                                   team (AdminUser) accounts
  admin/client-emails/route.ts   — super-admin-only: authorise/list/revoke
                                   client emails on an event

src/lib/authz.ts  — requireSuperAdmin / assertNotProtected — the one gate
                     that says only theeventsmithng@gmail.com can add team
                     members or authorise clients (see below)
```

## What's here now (added this pass)

- `src/lib/scheduling.ts` — **the anchor computation engine.** Takes an
  event's real Planning Start Date and (earliest) Event Component date, and
  resolves every phase's actual calendar dates: `FORWARD_FROM_START` phases
  shift with however much runway the event actually has, `BACKWARD_FROM_EVENT_DATE`
  phases (the vendor meeting) stay pinned at their fixed offset regardless of
  runway, and `PHASE_COMPLETION` phases (Coordination) only get a date once
  the phase they depend on has actually crossed its completion threshold —
  now using each task's real `completedAt` rather than approximating with
  "now" (see the `Task.completedAt` schema field and
  `tasks/[taskId]/route.ts` below).
- `src/lib/checklistProgress.ts` — the confirmed phase-weighted progress
  calculation (earlier phases count for more), returning both an overall
  percentage and a per-phase breakdown. Weight curve is simple and legible
  on purpose — easy to retune once you're using it and have a feel for
  whether it's right.
- `vendors/[vendorId]/payments/route.ts` — records a payment and propagates
  it to every `BudgetLineItem` that vendor is committed on (via a selected
  option or a split-fulfilment allocation), so `amountPaid` never has to be
  entered twice.
- `tasks/[taskId]/route.ts` — updates a task's status and correctly sets/
  clears `completedAt`, then triggers a schedule recompute if the change
  could affect a `PHASE_COMPLETION`-anchored phase downstream.
- `src/lib/storage.ts` + `documents/upload-url`, `documents`, and
  `documents/[documentId]/versions` routes — the full document upload flow:
  the browser requests a presigned URL, uploads the file straight to
  storage (S3 or Cloudflare R2 — set `S3_ENDPOINT` for R2), then confirms
  the upload to create a `Document`/`DocumentVersion` record. Adding a new
  version (the moodboard revision flow) flips the previous version's
  `isCurrent` off rather than overwriting or deleting it.
- **Super admin role** — `PlannerTier` now has a third value, `SUPER_ADMIN`,
  sitting above `SENIOR`/`JUNIOR`. Exactly one account holds it:
  `theeventsmithng@gmail.com`, seeded permanently in `prisma/seed.ts` with
  `isProtected: true`. That one account:
  - always has access — the seed re-asserts `tier: SUPER_ADMIN`,
    `isActive: true`, `isProtected: true` every time it runs, so it can
    never be locked out by anything that happens later in the app;
  - is the *only* account that can add a team member or authorise a client
    email — enforced in `src/lib/authz.ts` (`requireSuperAdmin`) and the two
    new routes below, not just by UI convention.

  New files:
  - `src/lib/authz.ts` — `requireSuperAdmin(session)` throws unless the
    resolved session belongs to the `SUPER_ADMIN` tier; `assertNotProtected`
    stops any update/deactivate/delete from ever touching the protected row,
    regardless of who's asking.
  - `src/app/api/admin/team/route.ts` — `GET` lists all team accounts,
    `POST` adds a new one (`tier` must be `SENIOR` or `JUNIOR` — you can't
    create a second super admin through this route), `PATCH` deactivates or
    re-tiers an existing one. All three require a super admin session.
  - `src/app/api/admin/client-emails/route.ts` — `GET` lists the emails
    authorised on an event, `POST` authorises a new one (writes an
    `ActivityLogEntry` too), `DELETE` revokes one. All require a super admin
    session.

  Nothing changed in `auth/request-code` or `auth/verify-code` — once an
  email exists as an `AdminUser` or `AuthorisedClientEmail` row (added
  through the routes above), the existing OTP flow already finds it and
  sends the code, same as before. The super admin logs in exactly the same
  way as everyone else: request a code at `theeventsmithng@gmail.com`,
  enter it, land on `/admin`.

## What's deliberately not here yet

This is a scaffold, not a finished backend. Missing on purpose, to keep this
pass focused:
- Full CRUD for every model (this scaffold shows the *interesting* logic —
  vendor selection, fund splitting, template cloning, scheduling, weighted
  progress, document versioning — not boilerplate list/get/update/delete
  routes, which are mechanical once the schema is settled)
- Email notifications (payment reminders, deadline reminders — Phase 3)
- The one-way Google Sheets budget sync (Section 9 — also Phase 3)

## Running this for real

1. `npm install`
2. Copy `.env.example` to `.env` and fill in a real `DATABASE_URL` (e.g. a
   free Supabase or Neon Postgres instance), an `OTP_HASH_SECRET`
   (`openssl rand -hex 32`), and a `RESEND_API_KEY` (free tier is enough).
3. `npx prisma migrate dev --name init` — creates all tables from
   `schema.prisma`.
4. `npm run prisma:seed` — populates event types + the Wedding template.
5. Drop the `src/lib` and `src/app/api` folders into a Next.js 14 app
   (App Router) at matching paths.
6. `npm run dev`.

## Design decisions worth knowing about when you read the schema

- **`BudgetLineItem.fulfilmentMode`** is the single most important field in
  the whole schema — it's what lets one line item be `SINGLE`,
  `COMPETING_OPTIONS` (Decor: one wins), or `SPLIT_FULFILMENT` (Caterer
  1/2/3: several run concurrently, portions sum to the total).
- **`VendorContact` is separate from `Vendor`** — the business is stable,
  the person there can change, so contact history is never overwritten.
- **`PlanningFeePayment` has no foreign key to `IncomingClientFund` or
  `BudgetLineItem`** — enforced structurally, not just by convention, so
  planning fees and event funds can never accidentally get mixed in a query.
- **`EventTemplate` → `Event` is a one-time clone, not a live reference** —
  `TemplatePhase`/`TemplateTask`/`TemplateBudgetCategory` get copied into
  `PlanningPhase`/`Task`/`BudgetCategory` at creation time, so editing the
  template later never silently changes an event already in progress.
- **`TemplateVendorCategory.priorityTier`** encodes the risk-based booking
  logic from Section 6 (impact-if-wrong + scarcity risk) as a simple integer
  tier per event type — manually set per event type rather than computed,
  since you're the one who knows the actual risk for a category you haven't
  templated yet (e.g. corporate/conference).

## How the admin prototype connects to this

The clickable prototype (`TheEventSmithNG_Admin_Prototype.html`) now has a
real fetch layer built in (`tesApi` in its `<script>`), not just demo data.
It tries the real endpoints first — login, Events, Team, Client Access —
and only falls back to its built-in demo data when nothing answers, which
is what happens today since the prototype is still a standalone file with
no server of its own. A small badge in its sidebar ("Live data" vs "Demo
data") shows which mode is actually in effect, honestly, rather than
pretending one or the other.

To make it live: drop the prototype's HTML into this Next.js app (as a page
or served as a static file) so it's served from the same origin as these
API routes, run `npm install` + the Postgres/env setup in "Running this for
real" above, and open it. No code changes needed in the prototype itself —
it already calls relative paths like `/api/auth/request-code`.

Not yet wired to live data: the "Create New Event" flow (it needs a real
`eventTypeId`, which means a `GET /api/event-types` route that doesn't
exist yet) and anything inside an individual event's workspace (Budget,
Vendor Payments, Itinerary, etc.) — those still run on the prototype's
demo data regardless of mode. Login, the Events list, Team, and Client
Access are fully wired.
