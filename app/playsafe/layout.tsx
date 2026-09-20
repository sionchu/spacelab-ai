import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function PlaySafeLayout({ children }: { children: ReactNode }) {
  const apiKey = process.env.VITE_VWORLD_API_KEY?.trim();
  const src = apiKey
    ? "https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=" + encodeURIComponent(apiKey)
    : undefined;

  return (
    <>
      {src && <script type="text/javascript" src={src} data-playsafe-vworld="true" />}
      {children}
    </>
  );
}
