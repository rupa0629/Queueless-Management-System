# Queueless Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict PII Isolation**: Citizen phone numbers, emails, and saved token passes reside exclusively under `/users/{userId}/private/profile` and `/users/{userId}/tokens/{tokenId}`. No blanket `isSignedIn()` reads or public list queries are permitted.
2. **Identity Integrity**: Every document created under `/users/{userId}/...` MUST have `uid == request.auth.uid == userId` and `request.auth.token.email_verified == true`.
3. **Immutable Ownership & Identifiers**: `uid`, `tokenId`, `tokenCode`, `serviceCode`, `pin`, and `createdAt` are immutable after creation.
4. **Temporal Integrity**: `createdAt` and `updatedAt` MUST equal `request.time`.
5. **Terminal State Locking**: Once a `SavedTokenPass` reaches `COMPLETED`, `GRACE_EXPIRED`, `CANCELLED_NO_ANSWER`, or `CANCELLED_BY_USER`, non-admin updates are strictly blocked.
6. **Zero Privilege Escalation**: `/admins/{userId}` forbids all client writes; admin status is derived strictly from `/admins/$(request.auth.uid)` or verified runtime supervisor email (`rupasritupakula570@gmail.com`).

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Profile Read**: Unauthenticated `GET /users/u1/private/profile`.
2. **Cross-User Profile Read**: Signed-in `u2` attempting `GET /users/u1/private/profile`.
3. **Unverified Email Write**: Signed-in `u1` with `email_verified: false` attempting `CREATE /users/u1/private/profile`.
4. **Identity Spoofing**: Signed-in `u2` attempting `CREATE /users/u2/tokens/tok-1` with `uid: "u1"`.
5. **Shadow / Ghost Field Injection**: Signed-in `u1` creating `/users/u1/private/profile` with extra field `role: "SUPERVISOR"`.
6. **ID Poisoning (Oversized / Invalid Path ID)**: Signed-in `u1` attempting `CREATE /users/u1/tokens/invalid$id!with@spaces`.
7. **Resource Exhaustion (Oversized String)**: Signed-in `u1` writing `displayName` of 500 characters (`> 100`).
8. **Client-Spoofed Timestamp**: Signed-in `u1` writing `updatedAt` != `request.time`.
9. **Immutable Field Mutation**: Signed-in `u1` updating `tokenCode` or `pin` on an existing `SavedTokenPass`.
10. **Terminal State Resurrection**: Signed-in `u1` updating a `COMPLETED` or `CANCELLED_BY_USER` token back to `WAITING`.
11. **Admin Registry Escalation**: Signed-in `u1` attempting `CREATE /admins/u1`.
12. **Blanket Collection Scraping**: Signed-in `u2` attempting `LIST /users/u1/tokens` without ownership matching `userId == request.auth.uid`.
