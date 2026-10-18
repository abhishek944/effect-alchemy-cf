import { Context, Schema } from "effect";

export const Role = Schema.Literals(["user", "admin"]);
export const AdminIdentity = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Role,
});
export const AdminUserDetails = Schema.Struct({
  ...AdminIdentity.fields,
  emailVerified: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export const EmailSearch = Schema.Struct({
  email: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMaxLength(254),
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  ),
});
export class CurrentAdmin extends Context.Service<CurrentAdmin, typeof AdminIdentity.Type>()(
  "starter/CurrentAdmin",
) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  {},
  { httpApiStatus: 403 },
) {}
export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  {},
  { httpApiStatus: 404 },
) {}
