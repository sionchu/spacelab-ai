import { PlaySafeClient } from "@/components/playsafe/playsafe-client";

export const dynamic = "force-dynamic";

export default function PlaySafePage() {
  const vworldEnabled = Boolean(process.env.VITE_VWORLD_API_KEY?.trim());
  return <PlaySafeClient vworldEnabled={vworldEnabled} />;
}
