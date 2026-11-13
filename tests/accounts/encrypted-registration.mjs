import { EncryptedVault } from '../../apps/web/src/accounts/encryption.ts';
const accountName = 'deployment_test';
const encrypted = await EncryptedVault.create(accountName, 'temporary-test-password-123');
console.log(JSON.stringify({ accountName, displayName: 'Deployment Test', password: encrypted.password, credentialVersion: 1, vault: encrypted.envelope, recoveryProof: encrypted.recoveryProof }));
encrypted.vault.destroy();
