import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";

import { ApiError } from "../lib/api";
import {
  NAME_RULE_MESSAGE,
  hasDisallowedNameChars,
  sanitizeNameInput,
  validateName,
} from "../lib/nameValidation";
import {
  forgotPassword,
  login,
  resendSignupOtp,
  resetPassword,
  signup,
  verifySignupOtp,
  type AuthResponse,
} from "../services/authService";
import { useAppStore } from "../store/appStore";

type View = "signIn" | "signUp" | "verify" | "forgot" | "reset";
type StatusKind = "info" | "ok" | "error";

// Matches MIN_PASSWORD_LENGTH in backend/routers/auth.py.
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OTP_PATTERN = /^\d{6}$/;

const COPY: Record<View, { title: string; subtitle: (email: string) => string }> = {
  signIn: {
    title: "Welcome back",
    subtitle: () => "Sign in to continue managing field and route operations.",
  },
  signUp: {
    title: "Create account",
    subtitle: () =>
      "New accounts start with standard access. A Logistics Officer can grant more.",
  },
  verify: {
    title: "Check your email",
    subtitle: (email) =>
      `We sent a 6-digit code to ${email}. It expires in 10 minutes.`,
  },
  forgot: {
    title: "Reset your password",
    subtitle: () => "Enter your account email and we'll send a reset code.",
  },
  reset: {
    title: "Choose a new password",
    subtitle: (email) =>
      `Enter the code we sent to ${email}, then set a new password.`,
  },
};

function LoginPage() {
  const { signIn } = useAppStore();

  const [view, setView] = useState<View>("signIn");
  const [name, setName] = useState("");
  const [nameHint, setNameHint] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ kind: StatusKind; text: string }>({
    kind: "info",
    text: "",
  });

  const fail = (text: string) => setStatus({ kind: "error", text });

  const go = (next: View) => {
    setView(next);
    setPassword("");
    setCode("");
    setShowPassword(false);
    setNameHint("");
    setStatus({ kind: "info", text: "" });
  };

  // Keeps digits, symbols and the like out of the name field, including when
  // they arrive by paste. The hint tells the user why a character vanished.
  const handleNameChange = (raw: string) => {
    setName(sanitizeNameInput(raw));
    setNameHint(hasDisallowedNameChars(raw) ? NAME_RULE_MESSAGE : "");
  };

  // App.tsx redirects away from /login as soon as signIn() marks us
  // authenticated, so there is no explicit navigate() here.
  const finish = (auth: AuthResponse) => signIn(auth.access_token, auth.user);

  const run = async (task: () => Promise<void>) => {
    setLoading(true);
    try {
      await task();
    } catch (error) {
      fail(
        error instanceof ApiError
          ? error.message
          : "Can't reach the server. Check that the backend is running.",
      );
    } finally {
      setLoading(false);
    }
  };

  const normalizedEmail = email.trim().toLowerCase();

  const submitSignIn = () => {
    if (!normalizedEmail || !password) {
      fail("Enter your email and password.");
      return;
    }

    return run(async () => {
      try {
        finish(await login(normalizedEmail, password));
      } catch (error) {
        // 403 means the password was right but the email was never verified.
        if (error instanceof ApiError && error.status === 403) {
          setView("verify");
          setPassword("");
          setStatus({
            kind: "info",
            text: "Your email isn't verified yet. Enter the code we sent, or request a new one.",
          });
          return;
        }
        throw error;
      }
    });
  };

  const submitSignUp = () => {
    const nameError = validateName(name);
    if (nameError) {
      setNameHint(nameError);
      fail(nameError);
      return;
    }
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      fail("Enter a valid email address.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    return run(async () => {
      const result = await signup({
        name: name.trim(),
        email: normalizedEmail,
        password,
      });
      setView("verify");
      setPassword("");
      setStatus({ kind: "ok", text: result.message });
    });
  };

  const submitVerify = () => {
    if (!OTP_PATTERN.test(code)) {
      fail("Enter the 6-digit code from your email.");
      return;
    }

    return run(async () => {
      finish(await verifySignupOtp(normalizedEmail, code));
    });
  };

  const resendVerification = () =>
    run(async () => {
      const result = await resendSignupOtp(normalizedEmail);
      setCode("");
      setStatus({ kind: "ok", text: result.message });
    });

  const submitForgot = () => {
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      fail("Enter a valid email address.");
      return;
    }

    return run(async () => {
      const result = await forgotPassword(normalizedEmail);
      setView("reset");
      setStatus({ kind: "ok", text: result.message });
    });
  };

  const resendReset = () =>
    run(async () => {
      const result = await forgotPassword(normalizedEmail);
      setCode("");
      setStatus({ kind: "ok", text: result.message });
    });

  const submitReset = () => {
    if (!OTP_PATTERN.test(code)) {
      fail("Enter the 6-digit code from your email.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    return run(async () => {
      finish(await resetPassword(normalizedEmail, code, password));
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;

    const handlers: Record<View, () => Promise<void> | void> = {
      signIn: submitSignIn,
      signUp: submitSignUp,
      verify: submitVerify,
      forgot: submitForgot,
      reset: submitReset,
    };
    void handlers[view]();
  };

  const copy = COPY[view];
  const showsModeToggle = view === "signIn" || view === "signUp";
  const asksForPassword = view === "signIn" || view === "signUp" || view === "reset";
  const asksForCode = view === "verify" || view === "reset";
  const asksForEmail = view === "signIn" || view === "signUp" || view === "forgot";

  const submitLabel: Record<View, [idle: string, busy: string]> = {
    signIn: ["Sign in", "Signing in..."],
    signUp: ["Create account", "Creating account..."],
    verify: ["Verify email", "Verifying..."],
    forgot: ["Send reset code", "Sending code..."],
    reset: ["Reset password", "Resetting..."],
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand-wrap">
          <div className="auth-logo-mark">N</div>
        </div>

        <div className="auth-panel">
          {showsModeToggle && (
            <div className="auth-mode-toggle">
              <button
                type="button"
                className={view === "signIn" ? "active" : ""}
                onClick={() => go("signIn")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={view === "signUp" ? "active" : ""}
                onClick={() => go("signUp")}
              >
                Sign up
              </button>
            </div>
          )}

          <div className="auth-copy">
            <h2>{copy.title}</h2>
            <p>{copy.subtitle(normalizedEmail)}</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {view === "signUp" && (
              <label className="auth-field">
                <span>Full name</span>
                <input
                  value={name}
                  onChange={(event) => handleNameChange(event.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  maxLength={120}
                  aria-invalid={nameHint ? true : undefined}
                  aria-describedby={nameHint ? "name-hint" : undefined}
                />
                {nameHint && (
                  <small id="name-hint" className="auth-field-hint" role="alert">
                    {nameHint}
                  </small>
                )}
              </label>
            )}

            {asksForEmail && (
              <label className="auth-field">
                <span>Email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@email.com"
                  autoComplete="email"
                  autoFocus
                />
              </label>
            )}

            {asksForCode && (
              <label className="auth-field">
                <span>6-digit code</span>
                <input
                  className="otp"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                />
              </label>
            )}

            {asksForPassword && (
              <label className="auth-field">
                <span>{view === "reset" ? "New password" : "Password"}</span>
                <div className="password-wrap">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={
                      view === "signIn"
                        ? "Enter your password"
                        : `At least ${MIN_PASSWORD_LENGTH} characters`
                    }
                    autoComplete={view === "signIn" ? "current-password" : "new-password"}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            )}

            {view === "signIn" && (
              <button
                type="button"
                className="auth-link-button"
                onClick={() => go("forgot")}
              >
                Forgot password?
              </button>
            )}

            <button type="submit" className="primary-btn full-width" disabled={loading}>
              <ArrowRight size={16} />
              {loading ? submitLabel[view][1] : submitLabel[view][0]}
            </button>

            <div
              className={`auth-status ${status.kind}`}
              role={status.kind === "error" ? "alert" : "status"}
            >
              {status.text}
            </div>

            {(view === "verify" || view === "reset") && (
              <div className="auth-links">
                <button
                  type="button"
                  className="auth-link-button center"
                  onClick={view === "verify" ? resendVerification : resendReset}
                  disabled={loading}
                >
                  Send a new code
                </button>
                <button
                  type="button"
                  className="auth-link-button center"
                  onClick={() => go("signIn")}
                >
                  Back to sign in
                </button>
              </div>
            )}

            {view === "forgot" && (
              <div className="auth-links">
                <button
                  type="button"
                  className="auth-link-button center"
                  onClick={() => go("signIn")}
                >
                  Back to sign in
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
