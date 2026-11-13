# ADR 0001: Concurrency Strategy for Appointment Slot Booking

## Status

Accepted

## Context

In a clinic appointment booking system, appointment slots are finite, shared resources. When multiple patients attempt to book the exact same slot simultaneously (e.g., peak booking windows or popular specialists), concurrent HTTP requests execute overlapping database operations.

In Phase 3, we observed that a naive check-then-act strategy (`SELECT` active booking $\to$ `INSERT` booking) allowed **42 out of 50 concurrent requests** to successfully book the single slot, resulting in severe data corruption.

To guarantee zero double-bookings under high concurrency, we evaluated three production-grade concurrency control strategies:

1. **Constraint-Based**: PostgreSQL Partial Unique Index
2. **Pessimistic Locking**: `SELECT ... FOR UPDATE` within an interactive transaction
3. **Optimistic Locking**: Compare-And-Swap (CAS) using a `version` column on `Slot`

---

## Measured Benchmark Results (50 Concurrent Requests for 1 Slot)

We benchmarked all three strategies using `Promise.allSettled` with 50 simultaneous authenticated patient requests against a real PostgreSQL instance:

| Strategy                          | Correctness                | 201 Created (Success) | 409 Conflict (Handled) | 500 Errors | Total Execution Time |
| :-------------------------------- | :------------------------- | :-------------------- | :--------------------- | :--------- | :------------------- |
| **B: Partial Unique Index**       | **YES (1 active booking)** | 1                     | 49                     | 0          | **379 ms**           |
| **C: Pessimistic (`FOR UPDATE`)** | **YES (1 active booking)** | 1                     | 49                     | 0          | **304 ms**           |
| **D: Optimistic (`version` CAS)** | **YES (1 active booking)** | 1                     | 49                     | 0          | **256 ms**           |

---

## Options Considered

### Option 1: Partial Unique Index (Constraint-Based)

- **Mechanism**: `CREATE UNIQUE INDEX "unique_active_booking_per_slot" ON "Booking"("slotId") WHERE status IN ('PENDING', 'CONFIRMED');`
- **Important Note**: This partial unique index lives **only in the migration SQL** because Prisma's `schema.prisma` modeling language cannot express partial unique indexes with conditional `WHERE` clauses. Anyone reading `schema.prisma` alone would not see this protection.
- **Pros**:
  - Enforced by the PostgreSQL storage engine itself; cannot be bypassed by buggy application code, uncoordinated microservices, or direct database scripts.
  - Completely non-blocking for read traffic.
  - Allows cancelled and expired bookings to remain in the database for auditing without blocking slot re-use.
- **Cons**:
  - Requires raw SQL inside migration files (not natively defined in standard Prisma DSL).
  - Loses requests throw constraint violations (`23505` / Prisma `P2002`) which the application must catch and translate to HTTP 409.

### Option 2: Pessimistic Locking (`SELECT ... FOR UPDATE`)

- **Mechanism**: Acquire an exclusive row-level lock on the `Slot` record within an interactive Prisma transaction (`prisma.$transaction`).
- **Pros**:
  - Prevents concurrent modifications before any `INSERT` occurs.
  - Essential when coordinating multi-row updates across different tables where a single unique index cannot capture the invariant (e.g., atomically swapping slots during a reschedule).
- **Cons**:
  - Holds database row locks open for the entire duration of the transaction, tying up database connection pool workers.
  - Prone to deadlocks if multiple resources are locked in inconsistent orders.

### Option 3: Optimistic Locking (`version` Column)

- **Mechanism**: Increment a `version` integer column on `Slot` using `UPDATE "Slot" SET version = version + 1 WHERE id = slotId AND version = V`.
- **Pros**:
  - Does not hold row locks while preparing data.
  - Fastest execution time under low-to-moderate contention.
- **Cons**:
  - High-contention environments waste database CPU cycles on transactions destined to abort.
  - Requires explicit retry loops if the caller expects automatic retries.

---

## Decision

1. **Primary Safety Net (Single Slot Booking)**:
   We adopt **Option 1 (Partial Unique Index)** as the system's foundational, non-negotiable safety net. Regardless of which application-level strategy or future microservice attempts to write to the `Booking` table, PostgreSQL physically forbids more than one active booking per slot.

2. **Multi-Resource Workflows (Reschedule Flow)**:
   For complex multi-resource operations such as **rescheduling** (moving a booking from Slot X to Slot Y atomically), we adopt **Option 2 (Pessimistic Locking)** with **Strict Global Lock Ordering**:
   ```javascript
   const [firstSlotId, secondSlotId] = [oldSlotId, newSlotId].sort();
   await tx.$queryRaw`SELECT * FROM "Slot" WHERE id = ${firstSlotId} FOR UPDATE`;
   await tx.$queryRaw`SELECT * FROM "Slot" WHERE id = ${secondSlotId} FOR UPDATE`;
   ```
   Sorting slot IDs lexicographically before acquiring locks eliminates circular wait conditions, guaranteeing zero deadlocks (`40P01`) even when two users concurrently attempt to swap the exact same slots.

---

## Consequences

- **Positive**:
  - Absolute guarantee against double-booking under any load or network condition.
  - Zero 500 errors on concurrent conflicts (clean 409 responses).
  - Safe slot re-booking when appointments are cancelled.
  - Reschedule operations are 100% atomic: if the target slot is occupied, the source appointment remains intact without data corruption.
- **Negative**:
  - Developers must be disciplined about sorting entity IDs when locking multiple resources to prevent deadlocks.
  - The service layer must explicitly translate Prisma `P2002` error codes into user-friendly HTTP 409 responses.
