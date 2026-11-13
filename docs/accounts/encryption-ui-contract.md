# Encryption integration for the account page

The backend/encryption task owns `service.ts`, `encryption.ts`, and the Accounts server. The page redesign can use these public APIs:

- `register({ accountName, displayName, password }): Promise<string>` creates an encrypted account and returns its **browser-generated recovery key**. Show once, require saved acknowledgement, never persist or log it. Raw account passwords and recovery keys are not sent to the server.
- `signIn(accountName, password)` signs in and unlocks encrypted sync. A `LEGACY_ACCOUNT` error means explicitly offer migration; do not automatically retry with the raw password.
- `useCloudAccount().encryption`: `none` (legacy account or guest), `locked` (signed-in encrypted account, browser keys absent), `unlocked`.
- `unlock(password)` unlocks a signed-in encrypted account. Refreshing the page locks cloud sync; local files remain available. Show a password unlock form when `locked`.
- `upgradeEncryption(accountName, currentPassword, newPassword): Promise<{ recoveryKey: string }>` requires a new password different from the old one (at least 12 characters), explicitly authenticates the existing legacy account, encrypts existing remote data, and atomically changes credentials/manifest. Explain that the old password is sent **once** to the legacy server during migration. The NEW password is never sent; it derives the encryption wrapping key and a separate sign-in credential. A distinct new password is essential because the old server has received the old password. Subsequent sign-ins use the new password. Show returned recovery key. Existing accounts must upgrade before syncing in the new client.
- `recover(accountName, recoveryKey, newPassword): Promise<{ recoveryKey: string }>` resets password, revokes sessions, preserves encrypted file keys, rotates recovery key. Continue to sign-in after saving replacement key.
- `replaceRecoveryKey(currentPassword): Promise<{ recoveryKey: string }>` rotates recovery protection without changing encrypted files. Requires encrypted account; show result once.

Privacy copy: contents, filenames, and synced application data are encrypted in the browser before cloud upload. Server still sees account name, display name, sizes, counts and access times. Local browser data is **not** encrypted by this feature. Signing out leaves local files. A compromised browser/device or maliciously modified delivered application can access unlocked data. Keep an independent backup. This implementation has not undergone independent cryptographic review.

Limitations: 1 GB includes ciphertext overhead (28 bytes per stored item). Maximum file payload remains 64 MiB. Lose both password and recovery key, and server administrators cannot recover encrypted cloud data. Old server backups made before migration may still contain unencrypted data; migration removes live plaintext copies but cannot erase external backups.

No page redesign changes should silently send plaintext credentials for an encrypted account, resume sync while locked, store recovery keys in localStorage/IndexedDB, or describe local browser storage as encrypted.
