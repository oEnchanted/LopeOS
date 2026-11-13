/** Seed only isolated test browser contexts so legacy desktop tests start after setup. */
export async function seedSession(page) {
  await page.addInitScript(() => {
    const key = 'lope.accounts.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, accounts: [{
      id: 'desktop-test-user', accountName: 'desktoptester', displayName: 'Desktop Tester', role: 'admin',
      avatarDataUrl: null, passwordHint: '', password: null,
      createdAt: '2026-11-13T00:00:00.000Z', lastLoginAt: '2026-11-13T00:00:00.000Z',
    }] }));
    const accounts = JSON.parse(localStorage.getItem(key)).accounts;
    if (!sessionStorage.getItem('lope.account.session.v1') && accounts[0]) {
      sessionStorage.setItem('lope.account.session.v1', accounts[0].id);
    }
  });
}
