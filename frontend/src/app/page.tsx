"use client";

/** Entry point: sends each visitor to the right place based on auth state. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
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
    router.replace(user.role === "brand" ? "/brand" : "/creator");
  }, [loading, user, router]);

  return (
    <main id="main-content" className="container gate">
      <Spinner />
    </main>
  );
}
