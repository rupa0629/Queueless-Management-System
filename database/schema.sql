-- Queueless: Smart Virtual Queue & Waiting-Time Management System
-- PostgreSQL / Supabase-Compatible Production Schema & Seed Data
-- Note: Uses transactional locking (SELECT ... FOR UPDATE) for atomic token issuance and deferral re-slotting.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. STAFF USERS (Role-Based Access Control)
-- ============================================================================
CREATE TABLE IF NOT EXISTS staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_code VARCHAR(32) NOT NULL UNIQUE,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('COUNTER_STAFF', 'SUPERVISOR')),
  assigned_service_code VARCHAR(16) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_users_role ON staff_users (role);
CREATE INDEX IF NOT EXISTS idx_staff_users_service ON staff_users (assigned_service_code);

-- ============================================================================
-- 2. SERVICES (Unified Calculation Engine Source of Truth)
-- ============================================================================
CREATE TABLE IF NOT EXISTS services (
  code VARCHAR(16) PRIMARY KEY CHECK (code IN ('HOPD', 'BANK', 'PASS', 'LIB')),
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  avg_service_minutes INTEGER NOT NULL CHECK (avg_service_minutes BETWEEN 1 AND 120),
  token_sequence INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. COUNTERS (Counters 1-9 Mapped to Services)
-- ============================================================================
CREATE TABLE IF NOT EXISTS counters (
  id VARCHAR(32) PRIMARY KEY,
  counter_number INTEGER NOT NULL UNIQUE,
  service_code VARCHAR(16) NOT NULL REFERENCES services(code) ON DELETE CASCADE,
  label VARCHAR(80) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'BUSY_COMPLEX', 'PAUSED')),
  assigned_staff_id UUID NULL REFERENCES staff_users(id) ON DELETE SET NULL,
  current_token_id UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_counters_service_status ON counters (service_code, status);

-- ============================================================================
-- 4. QUEUE TOKENS (Full Lifecycle State Machine & 5-Min / 30-Min Timers)
-- ============================================================================
CREATE TABLE IF NOT EXISTS queue_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_code VARCHAR(24) NOT NULL UNIQUE,
  service_code VARCHAR(16) NOT NULL REFERENCES services(code) ON DELETE CASCADE,
  verification_pin CHAR(4) NOT NULL CHECK (verification_pin ~ '^[0-9]{4}$'),
  citizen_uid VARCHAR(128) NULL,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(32) NULL,
  email VARCHAR(160) NULL,
  priority_category VARCHAR(48) NOT NULL DEFAULT 'Standard',
  priority_weight INTEGER NOT NULL DEFAULT 0,
  service_detail VARCHAR(120) NOT NULL,
  assisted_by_name VARCHAR(120) NULL,
  is_walk_in BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'WAITING' CHECK (
    status IN (
      'WAITING',
      'CALLED',
      'IN_SERVICE',
      'COMPLETED',
      'DEFERRED_30M',
      'GRACE_EXPIRED',
      'SKIPPED_TIMEOUT',
      'CANCELLED_NO_ANSWER',
      'CANCELLED_BY_USER'
    )
  ),
  assigned_counter_id VARCHAR(32) NULL REFERENCES counters(id) ON DELETE SET NULL,
  queue_order DOUBLE PRECISION NOT NULL,
  deferral_count INTEGER NOT NULL DEFAULT 0 CHECK (deferral_count BETWEEN 0 AND 1),
  grace_expires_at TIMESTAMPTZ NULL,
  requeue_after TIMESTAMPTZ NULL,
  target_ready_time TIMESTAMPTZ NULL,
  called_at TIMESTAMPTZ NULL,
  service_started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  pii_anonymized_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_tokens_service_status_order
  ON queue_tokens (service_code, status, queue_order ASC);
CREATE INDEX IF NOT EXISTS idx_queue_tokens_grace_expires
  ON queue_tokens (status, grace_expires_at)
  WHERE status = 'CALLED';
CREATE INDEX IF NOT EXISTS idx_queue_tokens_requeue_after
  ON queue_tokens (status, requeue_after)
  WHERE status = 'DEFERRED_30M';
CREATE INDEX IF NOT EXISTS idx_queue_tokens_phone
  ON queue_tokens (phone);
CREATE INDEX IF NOT EXISTS idx_queue_tokens_pii_retention
  ON queue_tokens (completed_at, pii_anonymized_at)
  WHERE pii_anonymized_at IS NULL;

-- ============================================================================
-- 5. CALL LOGS (Staff Call Verification & Outcome Audit)
-- ============================================================================
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES queue_tokens(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  outcome VARCHAR(32) NOT NULL CHECK (
    outcome IN ('ANSWERED_COMING', 'ANSWERED_DEFER_30M', 'NO_ANSWER_CANCEL')
  ),
  notes VARCHAR(240) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_token_id ON call_logs (token_id, created_at DESC);

-- ============================================================================
-- 6. EMERGENCY ALERTS (Strictly Isolated From Regular Queue Tickets)
-- ============================================================================
CREATE TABLE IF NOT EXISTS emergency_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_code VARCHAR(16) NOT NULL DEFAULT 'HOPD' REFERENCES services(code),
  location VARCHAR(160) NOT NULL,
  description VARCHAR(400) NOT NULL,
  reporter_name VARCHAR(120) NULL,
  contact_phone VARCHAR(32) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')),
  resolved_by UUID NULL REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_emergency_alerts_status ON emergency_alerts (status, created_at DESC);

-- ============================================================================
-- 7. SERVICE METRICS LOG (Throughput, Wait Accuracy & Worker Transitions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_metrics_log (
  id BIGSERIAL PRIMARY KEY,
  service_code VARCHAR(16) NOT NULL REFERENCES services(code) ON DELETE CASCADE,
  event_type VARCHAR(48) NOT NULL,
  token_id UUID NULL REFERENCES queue_tokens(id) ON DELETE SET NULL,
  counter_id VARCHAR(32) NULL REFERENCES counters(id) ON DELETE SET NULL,
  wait_seconds INTEGER NULL,
  service_seconds INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_metrics_service_time
  ON service_metrics_log (service_code, created_at DESC);

-- ============================================================================
-- ATOMIC TOKEN CREATION FUNCTION (SERIALIZED VIA FOR UPDATE ROW LOCK)
-- ============================================================================
CREATE OR REPLACE FUNCTION issue_queue_token_atomic(
  p_service_code VARCHAR,
  p_full_name VARCHAR,
  p_phone VARCHAR,
  p_email VARCHAR,
  p_priority_category VARCHAR,
  p_priority_weight INTEGER,
  p_service_detail VARCHAR,
  p_is_walk_in BOOLEAN DEFAULT FALSE,
  p_assisted_by VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  token_id UUID,
  token_code VARCHAR,
  verification_pin CHAR(4),
  queue_order DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_seq INTEGER;
  v_token_code VARCHAR(24);
  v_pin CHAR(4);
  v_max_order DOUBLE PRECISION;
  v_new_order DOUBLE PRECISION;
  v_id UUID;
BEGIN
  SELECT token_sequence + 1
    INTO v_next_seq
    FROM services
   WHERE code = p_service_code
   FOR UPDATE;

  UPDATE services
     SET token_sequence = v_next_seq,
         updated_at = NOW()
   WHERE code = p_service_code;

  SELECT COALESCE(MAX(qt.queue_order), 0)
    INTO v_max_order
    FROM queue_tokens qt
   WHERE qt.service_code = p_service_code
     AND qt.status IN ('WAITING', 'CALLED', 'IN_SERVICE');

  v_new_order := v_max_order + 1000 - (p_priority_weight * 250);
  v_token_code := p_service_code || '-' || v_next_seq::TEXT;
  v_pin := LPAD((FLOOR(RANDOM() * 9000) + 1000)::INT::TEXT, 4, '0');

  INSERT INTO queue_tokens (
    token_code, service_code, verification_pin, full_name, phone, email,
    priority_category, priority_weight, service_detail, is_walk_in,
    assisted_by_name, status, queue_order
  ) VALUES (
    v_token_code, p_service_code, v_pin, p_full_name, p_phone, p_email,
    p_priority_category, p_priority_weight, p_service_detail, p_is_walk_in,
    p_assisted_by, 'WAITING', v_new_order
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_token_code, v_pin, v_new_order;
END;
$$;

-- ============================================================================
-- 24-HOUR PII RETENTION CLEANUP FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION purge_expired_queue_pii()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE queue_tokens
     SET full_name = 'Anonymized Visitor',
         phone = NULL,
         email = NULL,
         assisted_by_name = NULL,
         service_detail = CASE WHEN service_code = 'HOPD' THEN '[Redacted Clinical Reason]' ELSE service_detail END,
         pii_anonymized_at = NOW(),
         updated_at = NOW()
   WHERE pii_anonymized_at IS NULL
     AND status IN ('COMPLETED', 'GRACE_EXPIRED', 'SKIPPED_TIMEOUT', 'CANCELLED_NO_ANSWER', 'CANCELLED_BY_USER')
     AND COALESCE(completed_at, updated_at) < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- ============================================================================
-- SEED DATA (Services, Counters 1-9, Demo Staff Accounts)
-- ============================================================================
INSERT INTO services (code, name, description, avg_service_minutes, token_sequence)
VALUES
  ('HOPD', 'Hospital OPD', 'Outpatient consultations, vitals checkup, lab report review, and prescription renewals.', 8, 108),
  ('BANK', 'Bank Counter', 'Cash deposits, demand drafts, KYC verification updates, and retail loan inquiries.', 6, 206),
  ('PASS', 'Passport Office', 'Fresh verification, passport renewals, biometric capture, and document scrutiny.', 10, 305),
  ('LIB',  'Library Desk', 'Zero-friction book check-outs, returns, memberships, and digital archive access.', 3, 404)
ON CONFLICT (code) DO NOTHING;

INSERT INTO counters (id, counter_number, service_code, label, status)
VALUES
  ('ctr-1', 1, 'HOPD', 'Counter 1 · General OPD', 'OPEN'),
  ('ctr-2', 2, 'HOPD', 'Counter 2 · Vitals & Follow-up', 'OPEN'),
  ('ctr-3', 3, 'HOPD', 'Counter 3 · Senior Priority OPD', 'OPEN'),
  ('ctr-4', 4, 'BANK', 'Counter 4 · Cash & Teller', 'OPEN'),
  ('ctr-5', 5, 'BANK', 'Counter 5 · KYC & Cheques', 'OPEN'),
  ('ctr-6', 6, 'BANK', 'Counter 6 · Loan & Senior Desk', 'OPEN'),
  ('ctr-7', 7, 'PASS', 'Counter 7 · Biometrics & Verification', 'OPEN'),
  ('ctr-8', 8, 'PASS', 'Counter 8 · Tatkaal & Scrutiny', 'OPEN'),
  ('ctr-9', 9, 'LIB',  'Counter 9 · Express Library Desk', 'OPEN')
ON CONFLICT (id) DO NOTHING;

-- Demo Staff Seed (Replace password hashes in production; demo login password: "QueueStaff#2026")
INSERT INTO staff_users (staff_code, email, password_hash, full_name, role, assigned_service_code)
VALUES
  ('STAFF-HOPD-1', 'opd.staff@queueless.org',    'DEMO_SCRYPT_HASH_PLACEHOLDER', 'Dr. Meera Nair',       'COUNTER_STAFF', 'HOPD'),
  ('STAFF-BANK-1', 'bank.staff@queueless.org',   'DEMO_SCRYPT_HASH_PLACEHOLDER', 'Rohan Deshmukh',       'COUNTER_STAFF', 'BANK'),
  ('STAFF-PASS-1', 'pass.staff@queueless.org',   'DEMO_SCRYPT_HASH_PLACEHOLDER', 'Ananya Kulkarni',      'COUNTER_STAFF', 'PASS'),
  ('STAFF-LIB-1',  'lib.staff@queueless.org',    'DEMO_SCRYPT_HASH_PLACEHOLDER', 'Vikram Sethi',         'COUNTER_STAFF', 'LIB'),
  ('SUPV-ADMIN-1', 'supervisor@queueless.org',   'DEMO_SCRYPT_HASH_PLACEHOLDER', 'Arjun Mehta (Supv)',   'SUPERVISOR',    NULL)
ON CONFLICT (staff_code) DO NOTHING;
