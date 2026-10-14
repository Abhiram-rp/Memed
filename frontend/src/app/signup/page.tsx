"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import type { ApiErrorDetail, Role } from "@/types/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dashboardFor(role: Role): string {
  return role === "brand" ? "/brand" : "/creator";
}

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
}

export default function SignupPage() {
  const { user, loading, signup } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // No default: the user must choose a role explicitly (D17 — it is permanent).
  const [role, setRole] = useState<Role | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [details, setDetails] = useState<ApiErrorDetail[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Already signed in: go straight to the right dashboard.
  useEffect(() => {
    if (!loading && user !== null) {
      router.replace(dashboardFor(user.role));
    }
  }, [loading, user, router]);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (name.trim() === "") {
      errors.name = "Name is required.";
    }
    if (email.trim() === "") {
      errors.email = "Email is required.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }
    if (role === "") {
      errors.role = "Choose Brand or Creator.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setDetails([]);

    if (!validate() || role === "") {
      return;
    }

    setSubmitting(true);
    try {
      const created = await signup({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      });
      router.replace(dashboardFor(created.role));
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        if (error.code === "VALIDATION_ERROR" && error.details !== undefined) {
          setDetails(error.details);
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main id="main-content" className="auth-page">
        <Spinner label="Checking your session…" />
      </main>
    );
  }

  return (
    <main id="main-content" className="auth-page">
      <div className="auth-panel">
        <div className="auth-head">
          <span className="auth-wordmark">Meme&apos;d</span>
          <p className="auth-tagline">Turn views into payouts.</p>
        </div>

        <form className="card auth-card" onSubmit={handleSubmit} noValidate>
          <h1 className="auth-title">Create your account</h1>

          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={fieldErrors.name !== undefined}
              aria-describedby={fieldErrors.name !== undefined ? "name-error" : undefined}
            />
            {fieldErrors.name !== undefined && (
              <p className="error" id="name-error">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={fieldErrors.email !== undefined}
              aria-describedby={fieldErrors.email !== undefined ? "email-error" : undefined}
            />
            {fieldErrors.email !== undefined && (
              <p className="error" id="email-error">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldErrors.password !== undefined}
              aria-describedby={
                fieldErrors.password !== undefined ? "password-hint password-error" : "password-hint"
              }
            />
            <p className="hint" id="password-hint">
              at least 8 characters
            </p>
            {fieldErrors.password !== undefined && (
              <p className="error" id="password-error">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <fieldset
            className="role-fieldset"
            aria-describedby={fieldErrors.role !== undefined ? "role-error" : undefined}
          >
            <legend>I am a…</legend>
            <div className="role-grid">
              <label className={`role-card ${role === "brand" ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="role"
                  value="brand"
                  className="visually-hidden"
                  checked={role === "brand"}
                  onChange={() => setRole("brand")}
                />
                <span className="role-card-title">Brand</span>
                <span className="role-card-desc">
                  Run campaigns and pay creators for the views they earn.
                </span>
              </label>

              <label className={`role-card ${role === "creator" ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="role"
                  value="creator"
                  className="visually-hidden"
                  checked={role === "creator"}
                  onChange={() => setRole("creator")}
                />
                <span className="role-card-title">Creator</span>
                <span className="role-card-desc">
                  Post content, grow views, get paid per milestone.
                </span>
              </label>
            </div>
            {fieldErrors.role !== undefined && (
              <p className="error" id="role-error">
                {fieldErrors.role}
              </p>
            )}
          </fieldset>

          {formError !== null && (
            <div className="error" role="alert">
              <p>{formError}</p>
              {details.length > 0 && (
                <ul>
                  {details.map((detail) => (
                    <li key={`${detail.path}:${detail.message}`}>
                      {detail.path}: {detail.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? "Creating account..." : "Sign up"}
          </button>
        </form>

        <p className="auth-switch muted">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </div>
    </main>
  );
}
