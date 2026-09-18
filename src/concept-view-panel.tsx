import { useEffect, useMemo, useState } from "react";
import {
  buildConceptViewRequest,
  type ConceptProjectType,
  type ConceptViewRequest,
  type ConceptVisualStyle,
} from "./concept-view";
import {
  conceptViewProviderStatus,
  requestConceptView,
  type ConceptViewResult,
} from "./concept-view-provider";
import type { Scenario, Site, Viewpoint } from "./types";
import { captureVWorldSnapshot, getCurrentCameraState } from "./vworld";

const projectOptions: Array<{ value: ConceptProjectType; label: string }> = [
  { value: "house", label: "Detached house" },
  { value: "rural-house", label: "Rural house" },
  { value: "warehouse", label: "Warehouse / logistics" },
  { value: "office", label: "Office building" },
  { value: "public-facility", label: "Public facility" },
  { value: "other", label: "Other facility" },
];

const styleOptions: Array<{ value: ConceptVisualStyle; label: string }> = [
  { value: "neutral-concept", label: "Neutral concept" },
  { value: "contemporary", label: "Contemporary" },
  { value: "rural-contemporary", label: "Rural contemporary" },
  { value: "industrial", label: "Industrial" },
  { value: "minimal", label: "Minimal" },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function downloadJson(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), filename);
}

function resultImageSource(result?: ConceptViewResult) {
  if (!result) return undefined;
  if (result.imageUrl) return result.imageUrl;
  if (result.imageBase64) return `data:${result.mimeType || "image/png"};base64,${result.imageBase64}`;
  return undefined;
}

export function ConceptViewPanel({
  site,
  scenario,
  viewpoint,
  endpoint,
}: {
  site: Site;
  scenario: Scenario;
  viewpoint?: Viewpoint;
  endpoint?: string;
}) {
  const provider = useMemo(() => conceptViewProviderStatus(endpoint), [endpoint]);
  const [projectType, setProjectType] = useState<ConceptProjectType>("other");
  const [visualStyle, setVisualStyle] = useState<ConceptVisualStyle>("neutral-concept");
  const [request, setRequest] = useState<ConceptViewRequest>();
  const [referenceImage, setReferenceImage] = useState<Blob>();
  const [referenceUrl, setReferenceUrl] = useState<string>();
  const [result, setResult] = useState<ConceptViewResult>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    setRequest(undefined);
    setReferenceImage(undefined);
    setResult(undefined);
    setMessage(undefined);
  }, [site.id, scenario.id, scenario.mass, viewpoint]);

  useEffect(() => {
    if (!referenceImage) {
      setReferenceUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(referenceImage);
    setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [referenceImage]);

  async function prepare() {
    setBusy(true);
    setMessage(undefined);
    try {
      const snapshot = await captureVWorldSnapshot();
      const next = buildConceptViewRequest({
        site,
        scenario,
        projectType,
        visualStyle,
        viewpoint,
        camera: getCurrentCameraState(),
      });
      setReferenceImage(snapshot);
      setRequest(next);
      setResult(undefined);
      setMessage(snapshot
        ? "Current VWorld view captured with the concept brief."
        : "Concept brief prepared. VWorld canvas capture was unavailable in this runtime.");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!provider.available) {
      setMessage("Configure VITE_CONCEPT_VIEW_ENDPOINT to enable in-app image generation.");
      return;
    }

    const prepared = request ?? buildConceptViewRequest({
      site,
      scenario,
      projectType,
      visualStyle,
      viewpoint,
      camera: getCurrentCameraState(),
    });
    setRequest(prepared);
    setBusy(true);
    setMessage(undefined);
    try {
      const generated = await requestConceptView(provider.endpoint, prepared, referenceImage);
      setResult(generated);
      setMessage("Concept image generated from the prepared SpaceLab context.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const imageSource = resultImageSource(result);

  return <section className="inspector-section concept-view-section">
    <div className="section-heading">
      <span>CONCEPT VIEW</span>
      <b>{provider.available ? "ENDPOINT READY" : "BRIEF MODE"}</b>
    </div>
    <p className="concept-note">Turn the current mass and VWorld camera into a concept-rendering request without changing analysis geometry.</p>

    <div className="concept-fields">
      <label>
        <span>Project type</span>
        <select value={projectType} onChange={(event) => setProjectType(event.target.value as ConceptProjectType)}>
          {projectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>
        <span>Visual direction</span>
        <select value={visualStyle} onChange={(event) => setVisualStyle(event.target.value as ConceptVisualStyle)}>
          {styleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>

    <div className="concept-actions">
      <button className="quiet-button" disabled={busy} onClick={() => void prepare()}>{busy ? "Preparing…" : "Prepare context"}</button>
      <button className="quiet-button" disabled={busy || !provider.available} onClick={() => void generate()}>Generate image</button>
    </div>

    {referenceUrl && <div className="concept-preview">
      <img src={referenceUrl} alt="Captured VWorld concept reference" />
      <span>VWorld context reference</span>
    </div>}

    {imageSource && <div className="concept-preview generated">
      <img src={imageSource} alt="Generated architectural concept" />
      <span>{result?.provider ? `Generated · ${result.provider}` : "Generated concept"}</span>
    </div>}

    {request && <details className="concept-brief">
      <summary>Concept brief</summary>
      <p>{request.prompt}</p>
    </details>}

    {request && <div className="concept-actions secondary">
      <button className="quiet-button" onClick={() => downloadJson(request, `spacelab-${scenario.id.toLowerCase()}-concept.json`)}>Download brief</button>
      {referenceImage && <button className="quiet-button" onClick={() => downloadBlob(referenceImage, `spacelab-${scenario.id.toLowerCase()}-context.png`)}>Download context</button>}
    </div>}

    {message && <small className="concept-message">{message}</small>}
    {!provider.available && <small className="boundary">*Static Sites keeps provider credentials out of the browser. Configure a server-side Concept View endpoint to enable image generation.</small>}
  </section>;
}
