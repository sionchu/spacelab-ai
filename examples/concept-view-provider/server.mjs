import http from "node:http";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 8080);
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const SIZE = process.env.OPENAI_IMAGE_SIZE || "1536x1024";
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || "medium";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";

function cors(origin) {
  const allow = ALLOWED_ORIGIN && ALLOWED_ORIGIN !== "*" ? ALLOWED_ORIGIN : origin || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

async function asWebRequest(req) {
  const origin = req.headers.host || "localhost";
  const init = {
    method: req.method,
    headers: req.headers,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(`http://${origin}${req.url || "/"}`, init);
}

async function handle(req, res) {
  const origin = String(req.headers.origin || "");
  const headers = cors(origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, provider: MODEL }, headers);
    return;
  }

  if (req.method !== "POST" || req.url !== "/concept-view") {
    sendJson(res, 404, { error: "Not found" }, headers);
    return;
  }

  if (ALLOWED_ORIGIN && ALLOWED_ORIGIN !== "*" && origin !== ALLOWED_ORIGIN) {
    sendJson(res, 403, { error: "Origin not allowed" }, headers);
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 500, { error: "OPENAI_API_KEY is not configured" }, headers);
    return;
  }

  const webRequest = await asWebRequest(req);
  const incoming = await webRequest.formData();
  const prompt = String(incoming.get("prompt") || "").trim();
  const metadata = String(incoming.get("metadata") || "").trim();
  const referenceImage = incoming.get("referenceImage");

  if (!prompt) {
    sendJson(res, 400, { error: "prompt is required" }, headers);
    return;
  }
  if (prompt.length > 32_000) {
    sendJson(res, 400, { error: "prompt is too long" }, headers);
    return;
  }

  let openaiResponse;
  if (referenceImage instanceof File && referenceImage.size > 0) {
    const form = new FormData();
    form.set("model", MODEL);
    form.set("image", referenceImage, referenceImage.name || "spacelab-context.png");
    form.set("prompt", prompt);
    form.set("size", SIZE);
    form.set("quality", QUALITY);
    form.set("output_format", "png");

    openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  } else {
    openaiResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        size: SIZE,
        quality: QUALITY,
        output_format: "png",
      }),
    });
  }

  if (!openaiResponse.ok) {
    const detail = await openaiResponse.text().catch(() => "");
    sendJson(res, 502, {
      error: "Image provider request failed",
      status: openaiResponse.status,
      detail: detail.slice(0, 600),
    }, headers);
    return;
  }

  const payload = await openaiResponse.json();
  const imageBase64 = payload?.data?.[0]?.b64_json;
  const imageUrl = payload?.data?.[0]?.url;
  if (!imageBase64 && !imageUrl) {
    sendJson(res, 502, { error: "Image provider returned no image" }, headers);
    return;
  }

  let conceptMetadata;
  try {
    conceptMetadata = metadata ? JSON.parse(metadata) : undefined;
  } catch {
    conceptMetadata = undefined;
  }

  sendJson(res, 200, {
    imageBase64,
    imageUrl,
    mimeType: imageBase64 ? "image/png" : undefined,
    provider: MODEL,
    request: conceptMetadata ? {
      version: conceptMetadata.version,
      scenarioId: conceptMetadata.scenario?.id,
      createdAt: conceptMetadata.createdAt,
    } : undefined,
  }, headers);
}

http.createServer((req, res) => {
  void handle(req, res).catch((error) => {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
}).listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`Concept View provider listening on ${PORT}\n`);
});
