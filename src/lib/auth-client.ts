'use client';

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  // Use empty string to default to current origin (works in all environments)
  baseURL: '',
});

export const { signIn, signOut, useSession } = authClient;
