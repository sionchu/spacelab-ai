import { PlaySafeClient } from "@/components/playsafe/playsafe-client";

export const dynamic = "force-dynamic";

export default function PlaySafePage() {
  const vworldApiKey = process.env.VITE_VWORLD_API_KEY?.trim() || "";
  return <PlaySafeClient vworldApiKey={vworldApiKey} />;
}
