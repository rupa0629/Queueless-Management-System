# Queueless — Smart Virtual Queue & Waiting-Time Management System

**Queueless** is an accessible, real-time virtual queue and waiting-time management platform built for multi-domain public service desks:
- **Hospital OPD (`HOPD`)** — Counters 1–3
- **Bank Counter (`BANK`)** — Counters 4–6
- **Passport Office (`PASS`)** — Counters 7–8
- **Library Desk (`LIB`)** — Counter 9 (Zero-Friction Mode)

---

## Key Capabilities

1. **Single Unified Wait-Time Engine (`src/server/engine.ts`)**:
   - Service Cards, Join Modals, Live Token Passes, and Staff Consoles all read `estimatedWaitRange` and `peopleAhead` from the exact same calculation engine.
2. **Atomic Concurrency Control (`src/server/mutex.ts`)**:
   - Token creation, `Call Next`, `Call Token`, and `+30m Deferral` mutations execute inside serialized queue locks so concurrent requests never produce duplicate token codes or corrupt queue order.
3. **5-Minute Arrival Grace & 10-Second Background Worker (`src/server/worker.ts`)**:
   - Calling a token sets `status = 'CALLED'` with a live 5-minute countdown (`05:00`).
   - Unchecked tokens automatically transition to `GRACE_EXPIRED`, freeing the counter immediately.
   - `DEFERRED_30M` tokens automatically re-enter `WAITING` at their 30-minute target slot (`targetReadyTime`).
   - Completed/cancelled tokens undergo automated PII anonymization after 24 hours.
4. **Call Verification & Outcome Logging**:
   - Counter staff log verification calls with 3 explicit outcomes:
     - `Answered — Coming Now` (keeps active 5-minute grace window)
     - `Answered — Needs 30 Mins` (re-slots token at `+30m`, capped at 1 deferral)
     - `Did Not Lift -> Cancel & Advance` (cancels token permanently and auto-advances the counter)
5. **Accessibility, Bilingual UI & Safe Emergency SOS**:
   - Toggle **Large Text**, **High Contrast**, and **English / Hindi (`EN | हिं`)**.
   - **Emergency SOS** bypasses regular queues completely, displaying Helpline `112` + on-site triage Bay A and dispatching immediate priority alerts to Hospital OPD staff & Supervisors.

---

## Demo Staff Credentials (`/staff/login`)

All demo staff accounts share the demo password: **`QueueStaff#2026`**

| Role | Staff ID | Email | Assigned Desk |
| :--- | :--- | :--- | :--- |
| `COUNTER_STAFF` | `STAFF-HOPD-1` | `opd.staff@queueless.org` | Hospital OPD (`HOPD`, Counters 1–3) |
| `COUNTER_STAFF` | `STAFF-BANK-1` | `bank.staff@queueless.org` | Bank Counter (`BANK`, Counters 4–6) |
| `COUNTER_STAFF` | `STAFF-PASS-1` | `pass.staff@queueless.org` | Passport Office (`PASS`, Counters 7–8) |
| `COUNTER_STAFF` | `STAFF-LIB-1` | `lib.staff@queueless.org` | Library Desk (`LIB`, Counter 9) |
| `SUPERVISOR` | `SUPV-ADMIN-1` | `supervisor@queueless.org` | All Services + Emergency SOS Console |

---

## Environment Variables

Configure via `.env` (see `.env.example`):
- `PORT` (default `3000`)
- `STAFF_JWT_SECRET` (optional HS256 signing secret for staff JWT sessions; defaults to a deterministic runtime secret if unset)
- `APP_URL` (public host URL)

Firebase client configuration is stored in `firebase-applet-config.json` and security rules in `firestore.rules`.

---

## PostgreSQL / Supabase Schema

A complete Supabase-compatible PostgreSQL schema (`staff_users`, `services`, `counters`, `queue_tokens`, `call_logs`, `emergency_alerts`, `service_metrics_log`), including `SELECT ... FOR UPDATE` atomic token issuance and 24-hour PII retention functions, is provided in:
- `database/schema.sql`

---

## Local Development & Deployment

```bash
# Install dependencies
npm install

# Run full-stack Express + Vite dev server on port 3000
npm run dev

# Typecheck
npm run lint

# Build production frontend bundle
npm run build

# Start production server on port 3000
NODE_ENV=production npm start
```
