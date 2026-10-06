import { Context, Schema } from "effect";

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

export class CurrentUser extends Context.Service<CurrentUser, typeof User.Type>()(
  "starter/CurrentUser",
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}

export class AuthenticationUnavailable extends Schema.TaggedError<AuthenticationUnavailable>()(
  "AuthenticationUnavailable",
  {},
  { httpApiStatus: 503 },
) {}
