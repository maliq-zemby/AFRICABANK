# Security Specification — OgoouéPay FinTech Firestore Rules

## 1. Data Invariants
1. **Identity Integrity**: A user document `/users/{userId}` can only be created by the verified authenticated user (`request.auth.uid == userId`), with `role == 'user'` (unless bootstrapped admin email with verified token), `isBanned == false`, and `age >= 18 && acceptedTerms == true`.
2. **Privilege Escalation Guard**: A regular user can NEVER modify `role`, `isBanned`, or `banReason` on their own or anyone else's `/users/{userId}` document.
3. **PII Isolation**: `/users/{userId}` contains sensitive PII (`email`, `age`, `cardCvv`, `balance`) and can ONLY be read (`get`/`list`) by `isOwner(userId)` or `isAdmin()`.
4. **Admin Wallet Integrity**: `/admin_stats/wallet` can ONLY be read or debited (`totalWithdrawnByAdmin` / decreasing `commissionBalance`) by `isAdmin()`. Regular signed-in users can ONLY positively increment `commissionBalance` and `totalCommissionsEarned` by matching positive amounts alongside a transaction.
5. **P2P Transfer Safety**: A sender crediting `/users/{recipientId}` during an internal card transfer can ONLY strictly increase `balance` (`incoming().balance > existing().balance`) and update `updatedAt == request.time`, with no read access to the recipient's PII.
6. **Conversation & Message Isolation (Master Gate)**: `/conversations/{convId}/messages/{msgId}` checks `get(/databases/.../conversations/$(convId)).data.participantIds` so only the two participants or `isAdmin()` can read or send messages.
7. **Notification Isolation**: `/notifications/{notifId}` can ONLY be read (`get`/`list`) by `resource.data.userId == request.auth.uid` or `isAdmin()`, and only `read` boolean can be toggled by the owner.
8. **Loan State Locking**: A `/loans/{loanId}` starts as `'pending'` and once `'approved'` or `'rejected'`, non-admins cannot alter it, and users cannot self-approve loans.
9. **Temporal & Path Integrity**: All IDs match `^[a-zA-Z0-9_\\-]+$` (<= 128 chars) and timestamps match `request.time`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Self-Role Escalation**: User creates `/users/{uid}` with `role: "admin"`. -> `PERMISSION_DENIED`.
2. **Self-Unban Attack**: Banned user updates `/users/{uid}` with `isBanned: false, banReason: ""`. -> `PERMISSION_DENIED`.
3. **Underage Onboarding**: User creates `/users/{uid}` with `age: 16`. -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: User updates `/users/{uid}` adding `ghostField: true`. -> `PERMISSION_DENIED`.
5. **Admin Email Spoof (Unverified)**: Attacker with `email: "maliqzemby@gmail.com"` and `email_verified: false` tries to read `/admin_stats/wallet`. -> `PERMISSION_DENIED`.
6. **PII Blanket Read**: User A attempts `get(/users/userB)` or `list(/users)`. -> `PERMISSION_DENIED`.
7. **Admin Wallet Drain**: Regular user updates `/admin_stats/wallet` with `commissionBalance: 0`. -> `PERMISSION_DENIED`.
8. **P2P Balance Drain**: User A updates `/users/userB` decreasing `balance` by 50,000 FCFA. -> `PERMISSION_DENIED`.
9. **Self-Loan Approval**: User creates `/loans/l1` with `status: "approved"` or updates `status` from `"pending"` to `"approved"`. -> `PERMISSION_DENIED`.
10. **Cross-User Notification Read**: User A queries `/notifications` without `userId == userA.uid`. -> `PERMISSION_DENIED`.
11. **Eavesdrop Private Chat**: User C tries to read `/conversations/convAB/messages/m1` where `participantIds` is `[userA, userB]`. -> `PERMISSION_DENIED`.
12. **ID Poisoning**: User tries to write `/transactions/<200-char-junk-$#%>` or future `createdAt` timestamp. -> `PERMISSION_DENIED`.
