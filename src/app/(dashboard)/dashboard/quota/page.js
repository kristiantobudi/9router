import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";
import NotificationSettings from "./components/NotificationSettings";
import LimitEventsCard from "./components/LimitEventsCard";

export default function QuotaPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<CardSkeleton />}>
        <ProviderLimits />
      </Suspense>
      <LimitEventsCard />
      <NotificationSettings />
    </div>
  );
}
