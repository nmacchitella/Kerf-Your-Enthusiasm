/**
 * Local dev bypass — returns a hardcoded session so no login is needed.
 * The user row is seeded in db/index.ts on startup.
 */
export const DEV_USER_ID = 'dev-local';

export function getDevSession() {
  return {
    user: {
      id: DEV_USER_ID,
      name: 'Dev',
      email: 'dev@localhost',
    },
  };
}
