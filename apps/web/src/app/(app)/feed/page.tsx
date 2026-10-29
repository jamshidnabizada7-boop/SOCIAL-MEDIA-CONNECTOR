"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FEED_VIEWS, type FeedView } from "@aria/shared-types";
import { FeedExperience } from "@/components/feed/feed-experience";
function FeedRoute() {
  const params = useSearchParams();
  const view = params.get("view");
  return (
    <FeedExperience
      initialView={
        FEED_VIEWS.includes(view as FeedView) ? (view as FeedView) : "for_you"
      }
    />
  );
}
export default function FeedPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8" role="status">
          Loading feed…
        </div>
      }
    >
      <FeedRoute />
    </Suspense>
  );
}
