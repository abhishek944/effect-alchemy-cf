import AuthPage from "@/components/auth-page";
import { adminHomeHref, publicSignUpHref } from "@/lib/admin-home";

type Props = { notice?: string | null };

/**
 * The admin portal signs in through the public auth page, so an operator sees the
 * same UI as the main website. It is sign-in only: without a mode switch the page
 * renders no account-creation control and hides Clerk's sign-up prompt, while public
 * sign-up stays on the main site. This portal owns its origin root, so home and
 * sign-up links leave for the main UI. The server decides whether the account is an
 * administrator, so this page never describes how a role is granted.
 */
export default function AdminLogin({ notice }: Props) {
  return (
    <AuthPage
      mode="sign-in"
      checking={false}
      sessionError={null}
      notice={notice ?? null}
      homeHref={adminHomeHref}
      signInHref="/"
      signUpHref={publicSignUpHref}
    />
  );
}
