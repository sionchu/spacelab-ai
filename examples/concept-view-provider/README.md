# Concept View provider

Small server-side adapter for SpaceLab Concept View.

It keeps `OPENAI_API_KEY` out of the browser and exposes:

- `GET /health`
- `POST /concept-view`

## Environment

```bash
OPENAI_API_KEY=...
ALLOWED_ORIGIN=https://your-spacelab-host.example
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_SIZE=1536x1024
OPENAI_IMAGE_QUALITY=medium
```

Run with Node 20+:

```bash
node examples/concept-view-provider/server.mjs
```

Then set the frontend build variable:

```bash
VITE_CONCEPT_VIEW_ENDPOINT=https://your-provider.example/concept-view
```

The provider accepts the current VWorld canvas capture when available and uses an image edit request. If capture is unavailable it falls back to text-to-image generation from the same SpaceLab scenario brief.

Do not put `OPENAI_API_KEY` in any `VITE_*` variable.
