"use client";

/**
 * Client-side route guard. Renders `children` only for a signed-in user whose
 * role matches; otherwise it redirects (unauthenticated -> /login, wrong role ->
 * that user's own dashboard).
 */

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/types/api";

function dashboardFor(role: Role): string {
  return role === "brand" ? "/brand" : "/creator";
}

export default function ProtectedRoute({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      return;
    }
    if (user === null) {
      router.replace("/login");
      return;
    }
    if (user.role !== role) {
      router.replace(dashboardFor(user.role));
    }
  }, [loading, user, role, router]);

  if (loading || user === null || user.role !== role) {
    return (
      <div id="main-content" className="container gate">
        <Spinner />
      </div>
    );
  }

  return <>{children}</>;
}
