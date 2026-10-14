"use client";

/**
 * Signed-in chrome shared by both dashboards: a brand header with the current
 * user's name, a role badge and a logout button, then the page content.
 */

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  function handleLogout(): void {
    logout();
    router.replace("/login");
  }

  return (
    <>
      <header className="app-header">
        <div className="container app-header-inner">
          <span className="app-brand">Meme&apos;d</span>
          {user !== null && (
            <div className="row">
              <span className="muted">{user.name}</span>
              <span className={`badge ${user.role === "brand" ? "badge-green" : "badge-yellow"}`}>
                {user.role === "brand" ? "Brand" : "Creator"}
              </span>
              <button type="button" className="secondary" onClick={handleLogout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="container">{children}</main>
    </>
  );
}
