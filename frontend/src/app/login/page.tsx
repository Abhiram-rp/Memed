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

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [details, setDetails] = useState<ApiErrorDetail[]>([]);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  // Already signed in: go straight to the right dashboard.
  useEffect(() => {
    if (!loading && user !== null) {
      router.replace(dashboardFor(user.role));
    }
  }, [loading, user, router]);

  function validate(): boolean {
    const errors: { email?: string; password?: string } = {};
    if (email.trim() === "") {
      errors.email = "Email is required.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (password === "") {
      errors.password = "Password is required.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setDetails([]);

    if (!validate()) {
      return;
    }

    setSubmitting(true);
    try {
      const signedIn = await login(email.trim(), password);
      router.replace(dashboardFor(signedIn.role));
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
    return <Spinner label="Checking your session…" />;
  }

  return (
    <main>
      <h1>Log in</h1>

      <form className="card" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fieldErrors.email !== undefined && <p className="error">{fieldErrors.email}</p>}
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {fieldErrors.password !== undefined && <p className="error">{fieldErrors.password}</p>}
        </div>

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

        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Log in"}
        </button>
      </form>

      <p className="muted">
        No account yet? <Link href="/signup">Sign up</Link>
      </p>
    </main>
  );
}
