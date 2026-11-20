# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default Deny**: All unspecified document paths deny reads and writes.
2. **Owner Isolation (`/users/{userId}`)**: Only a verified Firebase-authenticated user whose `request.auth.uid == userId` can read, create, update, or delete `/users/{userId}`. Collection listing (`/users`) is disabled.
3. **Immutable Ownership & Creation Time**: `uid` and `createdAt` cannot be modified on `/users/{userId}` after creation. `uid` on `/publicProfiles/{usernameLower}` cannot be modified after creation.
4. **Strict Timestamps**: `createdAt` (on create) and `updatedAt` (on create/update) must equal `request.time`.
5. **Username Integrity (`/publicProfiles/{usernameLower}`)**: Document ID must match `^[a-z0-9_-]{3,14}$` and `incoming().username.lower() == usernameLower`. Only the owning verified user (`existing().uid == request.auth.uid`) can update or release the claim. No PII (email/phone) is stored here, and collection listing is disabled.
6. **Bounded Arrays & Strings**: `savedUsers.size() <= 8`, `friends.size() <= 50`, `reqIn.size() <= 50`, `reqOut.size() <= 50`, and all usernames match `^[A-Za-z0-9_-]{3,14}$`.

## 2. Adversarial "Dirty Dozen" Rejected Payloads
1. Unauthenticated read or write to `/users/uid1` -> `PERMISSION_DENIED`.
2. Unverified email token (`email_verified: false`) writing `/users/uid1` -> `PERMISSION_DENIED`.
3. User `uid2` reading/writing `/users/uid1` -> `PERMISSION_DENIED`.
4. Query/list scan on `/users` or `/publicProfiles` -> `PERMISSION_DENIED`.
5. Shadow field injection (`{ ..., isAdmin: true }`) on `/users/uid1` -> `PERMISSION_DENIED`.
6. Identity spoofing (`{ uid: "otherUid" }`) on create or update -> `PERMISSION_DENIED`.
7. Client-forged timestamp (`createdAt` != `request.time`) -> `PERMISSION_DENIED`.
8. Oversized or non-string array injection (`friends` with 51+ entries or `[123]`) -> `PERMISSION_DENIED`.
9. Overwriting another player's `/publicProfiles/coolname` claim -> `PERMISSION_DENIED`.
10. Username mismatch (`usernameLower = "alice"`, `username = "Bob"`) -> `PERMISSION_DENIED`.
11. Resource poisoning with >128 char path ID or invalid regex chars -> `PERMISSION_DENIED`.
12. Mutating immutable `createdAt` or `uid` during update -> `PERMISSION_DENIED`.
