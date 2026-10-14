"use client";

/**
 * Signed-in chrome shared by both dashboards: a slim top bar with the text
 * wordmark, the current user's name, a role badge and a logout button, then the
 * page content inside the wide, centred container.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  function handleLogout(): void {
    logout();
    router.replace("/login");
  }

  const home = user === null ? "/" : user.role === "brand" ? "/brand" : "/creator";

  return (
    <>
      <header className="app-header">
        <div className="container app-header-inner">
          <Link href={home} className="app-brand">
            Meme&apos;d
          </Link>
          {user !== null && (
            <div className="app-user">
              <span className="app-user-name">{user.name}</span>
              <span className={`badge ${user.role === "brand" ? "badge-accent" : "badge-gray"}`}>
                {user.role === "brand" ? "Brand" : "Creator"}
              </span>
              <button type="button" className="secondary" onClick={handleLogout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <main id="main-content" className="container app-main">
        {children}
      </main>
    </>
  );
}
