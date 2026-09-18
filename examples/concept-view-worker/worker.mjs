const DEFAULT_MODEL = "gpt-image-2.5-sunburst";
const DEFAULT_SIZE = "1536x864";
const DEFAULT_QUALITY = "medium";

function corsHeaders(origin, allowedOrigin) {
  const allow = allowedOrigin && allowedOrigin !== "*" ? allowedOrigin : origin || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }
    if (!env.OPENAI_API_KEY) {
      return json({ error: "OPENAI_API_KEY is not configured" }, 500, cors);
    }
    if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== "*" && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }

    const incoming = await request.formData();
    const prompt = String(incoming.get("prompt") || "").trim();
    const metadata = String(incoming.get("metadata") || "").trim();
    const referenceImage = incoming.get("referenceImage");

    if (!prompt) return json({ error: "prompt is required" }, 400, cors);
    if (prompt.length > 32000) return json({ error: "prompt is too long" }, 400, cors);

    let openaiResponse;
    const model = env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL;
    const size = env.OPENAI_IMAGE_SIZE || DEFAULT_SIZE;
    const quality = env.OPENAI_IMAGE_QUALITY || DEFAULT_QUALITY;

    if (referenceImage instanceof File && referenceImage.size > 0) {
      const form = new FormData();
      form.set("model", model);
      form.append("image[]", referenceImage, referenceImage.name || "spacelab-context.png");
      form.set("prompt", prompt);
      form.set("size", size);
      form.set("quality", quality);
      form.set("output_format", "png");

      openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: form,
      });
    } else {
      openaiResponse = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          size,
          quality,
          output_format: "png",
        }),
      });
    }

    if (!openaiResponse.ok) {
      const detail = await openaiResponse.text();
      return json({
        error: "Image provider request failed",
        status: openaiResponse.status,
        detail: detail.slice(0, 800),
      }, 502, cors);
    }

    const payload = await openaiResponse.json();
    const imageBase64 = payload?.data?.[0]?.b64_json;
    if (!imageBase64) {
      return json({ error: "Image provider returned no image" }, 502, cors);
    }

    let conceptMetadata;
    try {
      conceptMetadata = metadata ? JSON.parse(metadata) : undefined;
    } catch {
      conceptMetadata = undefined;
    }

    return json({
      imageBase64,
      mimeType: "image/png",
      provider: model,
      request: conceptMetadata ? {
        version: conceptMetadata.version,
        scenarioId: conceptMetadata.scenario?.id,
        createdAt: conceptMetadata.createdAt,
      } : undefined,
    }, 200, cors);
  },
};
