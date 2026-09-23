import { auth } from '../auth/auth.js';

/**
 * Public sign-up is disabled (`disableSignUp: true`), so `auth.api.signUpEmail`
 * cannot be used. This mirrors that endpoint's internal create path for admin-only creation.
 */
export async function createCredentialUser(input: {
  email: string;
  password: string;
  name: string;
}) {
  const ctx = await auth.$context;
  const email = input.email.toLowerCase();
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing?.user) {
    throw new Error('USER_ALREADY_EXISTS');
  }

  const hash = await ctx.password.hash(input.password);
  const createdUser = await ctx.internalAdapter.createUser(
    {
      email,
      name: input.name,
      emailVerified: true,
    },
    { method: 'email-password' },
  );
  if (!createdUser) {
    throw new Error('FAILED_TO_CREATE_USER');
  }

  await ctx.internalAdapter.linkAccount({
    userId: createdUser.id,
    providerId: 'credential',
    accountId: createdUser.id,
    password: hash,
  });

  return createdUser;
}
