import { Effect, Schema } from "effect";
import { Auth } from "./auth.ts";

const StoredUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.optional(Schema.Literals(["user", "admin"])),
  emailVerified: Schema.Boolean,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});

const details = (value: unknown) => {
  const user = Schema.decodeUnknownSync(StoredUser)(value);
  return {
    ...user,
    role: user.role ?? "user",
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
};

export const findUserByEmail = (email: string) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const instance = yield* auth.auth;
    return yield* Effect.tryPromise(async () => {
      const context = await instance.$context;
      const result = await context.internalAdapter.findUserByEmail(email.toLowerCase());
      return result ? details(result.user) : null;
    });
  });

export const setUserRole = (id: string, role: "user" | "admin") =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const instance = yield* auth.auth;
    return yield* Effect.tryPromise(async () => {
      const context = await instance.$context;
      if (!(await context.internalAdapter.findUserById(id))) return false;
      await context.internalAdapter.updateUser(id, { role });
      return true;
    });
  });
