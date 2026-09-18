import type { ConceptViewRequest } from "./concept-view";

export type ConceptViewResult = {
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
  provider?: string;
};

export type ConceptViewProviderStatus =
  | { available: false; reason: "endpoint-not-configured" }
  | { available: true; endpoint: string };

export function conceptViewProviderStatus(endpoint?: string): ConceptViewProviderStatus {
  const normalized = endpoint?.trim();
  return normalized
    ? { available: true, endpoint: normalized }
    : { available: false, reason: "endpoint-not-configured" };
}

export async function requestConceptView(
  endpoint: string,
  request: ConceptViewRequest,
  referenceImage?: Blob,
): Promise<ConceptViewResult> {
  const form = new FormData();
  form.set("metadata", JSON.stringify(request));
  form.set("prompt", request.prompt);
  if (referenceImage) form.set("referenceImage", referenceImage, "spacelab-context.png");

  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
    credentials: "omit",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`컨셉 이미지 생성 요청 실패 (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }

  const result = await response.json() as ConceptViewResult;
  if (!result.imageUrl && !result.imageBase64) {
    throw new Error("이미지 생성 결과가 없습니다.");
  }
  return result;
}

export function conceptResultSource(result?: ConceptViewResult) {
  if (!result) return undefined;
  if (result.imageUrl) return result.imageUrl;
  if (result.imageBase64) return `data:${result.mimeType || "image/png"};base64,${result.imageBase64}`;
  return undefined;
}
