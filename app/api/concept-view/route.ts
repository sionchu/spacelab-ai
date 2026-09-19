import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gpt-image-2.5-sunburst";
const DEFAULT_SIZE = "1536x1024";
const DEFAULT_QUALITY = "medium";
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

function imageConfig() {
  return {
    model: process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
    size: process.env.OPENAI_IMAGE_SIZE?.trim() || DEFAULT_SIZE,
    quality: process.env.OPENAI_IMAGE_QUALITY?.trim() || DEFAULT_QUALITY,
  };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }

  try {
    const incoming = await request.formData();
    const prompt = String(incoming.get("prompt") || "").trim();
    const metadata = String(incoming.get("metadata") || "").trim();
    const referenceImage = incoming.get("referenceImage");

    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    if (prompt.length > 32_000) return NextResponse.json({ error: "prompt is too long" }, { status: 400 });
    if (referenceImage instanceof File && referenceImage.size > MAX_REFERENCE_BYTES) {
      return NextResponse.json({ error: "reference image is too large" }, { status: 413 });
    }

    const { model, size, quality } = imageConfig();
    let providerResponse: Response;

    if (referenceImage instanceof File && referenceImage.size > 0) {
      const form = new FormData();
      form.set("model", model);
      form.append("image[]", referenceImage, referenceImage.name || "spacelab-map.png");
      form.set("prompt", prompt);
      form.set("size", size);
      form.set("quality", quality);
      form.set("output_format", "png");

      providerResponse = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } else {
      providerResponse = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          size,
          quality,
          output_format: "png",
        }),
        signal: AbortSignal.timeout(120_000),
      });
    }

    if (!providerResponse.ok) {
      const detail = await providerResponse.text().catch(() => "");
      return NextResponse.json({
        error: "Image provider request failed",
        status: providerResponse.status,
        detail: detail.slice(0, 600),
      }, { status: 502 });
    }

    const payload = await providerResponse.json();
    const imageBase64 = payload?.data?.[0]?.b64_json;
    const imageUrl = payload?.data?.[0]?.url;
    if (!imageBase64 && !imageUrl) {
      return NextResponse.json({ error: "Image provider returned no image" }, { status: 502 });
    }

    let conceptMetadata: any;
    try {
      conceptMetadata = metadata ? JSON.parse(metadata) : undefined;
    } catch {
      conceptMetadata = undefined;
    }

    return NextResponse.json({
      imageBase64,
      imageUrl,
      mimeType: imageBase64 ? "image/png" : undefined,
      provider: model,
      request: conceptMetadata ? {
        version: conceptMetadata.version,
        scenarioId: conceptMetadata.scenario?.id,
        createdAt: conceptMetadata.createdAt,
      } : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
