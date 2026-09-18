# Concept View server example

This folder contains a provider endpoint example for SpaceLab Concept View.

The main SpaceLab Site is a static Vite deployment. Provider credentials must **not** be placed in the browser bundle. Deploy this worker (or implement the same HTTP contract on Railway, Cloudflare, Vercel Functions, etc.) and set its public URL as:

```env
VITE_CONCEPT_VIEW_ENDPOINT=https://your-endpoint.example.com/
```

## Required server secrets

- `OPENAI_API_KEY`
- `ALLOWED_ORIGIN` — set this to the exact SpaceLab production origin.

Optional:

- `OPENAI_IMAGE_MODEL` — defaults to `gpt-image-2.5-sunburst`
- `OPENAI_IMAGE_SIZE` — defaults to `1536x864`
- `OPENAI_IMAGE_QUALITY` — defaults to `medium`

## Request contract

SpaceLab sends `multipart/form-data`:

- `metadata` — JSON ConceptViewRequest
- `prompt` — generated architectural concept prompt
- `referenceImage` — optional PNG of the current VWorld scene

When a reference image is supplied, the worker calls the image-edit endpoint so the current VWorld composition can be used as visual context. Without a captured image, it falls back to text-to-image generation.

## Response contract

```json
{
  "imageBase64": "<base64 PNG>",
  "mimeType": "image/png",
  "provider": "gpt-image-2.5-sunburst"
}
```

## Security / product boundary

- Never expose `OPENAI_API_KEY` to SpaceLab browser code.
- Restrict CORS to the exact Site origin.
- Treat Concept View as presentation output only.
- Do not feed generated imagery back into canonical geometry, solar, planning, or View Impact calculations.
- Image generation incurs provider cost. Keep the endpoint disabled until intentionally deployed.
