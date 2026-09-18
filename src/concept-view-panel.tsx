import { useEffect, useMemo, useState } from "react";
import {
  buildConceptViewRequest,
  suggestConceptProjectType,
  type ConceptProjectType,
  type ConceptVisualStyle,
  type ConceptViewRequest,
} from "./concept-view";
import {
  conceptResultSource,
  conceptViewProviderStatus,
  requestConceptView,
  type ConceptViewResult,
} from "./concept-view-provider";
import type { Scenario, Site, Viewpoint } from "./types";
import { captureVWorldSnapshot, getCurrentCameraState } from "./vworld";

const projectOptions: Array<{ value: ConceptProjectType; label: string }> = [
  { value: "house", label: "주택" },
  { value: "retail", label: "저층 상가" },
  { value: "office", label: "업무시설" },
  { value: "factory", label: "공장동" },
  { value: "warehouse", label: "창고동" },
  { value: "farm", label: "농가 시설" },
  { value: "other", label: "기타 시설" },
];

const styleOptions: Array<{ value: ConceptVisualStyle; label: string }> = [
  { value: "neutral", label: "중립적 컨셉" },
  { value: "contemporary", label: "현대적" },
  { value: "industrial", label: "산업형" },
  { value: "minimal", label: "미니멀" },
];

export function ConceptViewPanel({
  site,
  scenario,
  viewpoint,
  endpoint,
  onClose,
}: {
  site: Site;
  scenario: Scenario;
  viewpoint?: Viewpoint;
  endpoint?: string;
  onClose: () => void;
}) {
  const provider = useMemo(() => conceptViewProviderStatus(endpoint), [endpoint]);
  const suggestedType = useMemo(
    () => suggestConceptProjectType(scenario.name, scenario.intent),
    [scenario.intent, scenario.name],
  );
  const [projectType, setProjectType] = useState<ConceptProjectType>(suggestedType);
  const [visualStyle, setVisualStyle] = useState<ConceptVisualStyle>("neutral");
  const [request, setRequest] = useState<ConceptViewRequest>();
  const [referenceImage, setReferenceImage] = useState<Blob>();
  const [referenceUrl, setReferenceUrl] = useState<string>();
  const [result, setResult] = useState<ConceptViewResult>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    setProjectType(suggestedType);
    setRequest(undefined);
    setReferenceImage(undefined);
    setResult(undefined);
    setMessage(undefined);
  }, [scenario.id, scenario.mass, site.id, suggestedType, viewpoint]);

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
        ? "현재 3D 화면과 건물 정보를 준비했습니다."
        : "건물 정보는 준비됐지만 현재 환경에서는 3D 화면 캡처를 가져오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!provider.available) {
      setMessage("이미지 생성 서버 연결이 필요합니다.");
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
      setMessage("현재 배치와 카메라를 기준으로 컨셉 이미지를 생성했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const imageSource = conceptResultSource(result);

  return <section className="concept-sheet" aria-label="컨셉 이미지">
    <div className="concept-sheet-handle" aria-hidden="true"></div>
    <header className="concept-sheet-head">
      <div>
        <span>컨셉 보기</span>
        <strong>{scenario.id}안 · {scenario.name}</strong>
      </div>
      <button aria-label="컨셉 보기 닫기" onClick={onClose}>×</button>
    </header>

    <p className="concept-note">
      현재 건물의 위치·크기·방향과 3D 카메라는 유지하고 외관 표현만 컨셉 수준으로 바꿉니다.
    </p>

    <div className="concept-fields">
      <label>
        <span>건물 종류</span>
        <select value={projectType} onChange={(event) => setProjectType(event.target.value as ConceptProjectType)}>
          {projectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>
        <span>표현 스타일</span>
        <select value={visualStyle} onChange={(event) => setVisualStyle(event.target.value as ConceptVisualStyle)}>
          {styleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>

    <div className="concept-actions">
      <button disabled={busy} onClick={() => void prepare()}>{busy ? "준비 중…" : "현재 화면 준비"}</button>
      <button className="primary" disabled={busy || !provider.available} onClick={() => void generate()}>
        {busy ? "처리 중…" : "컨셉 이미지 생성"}
      </button>
    </div>

    {referenceUrl && <div className="concept-preview">
      <img src={referenceUrl} alt="현재 VWorld 3D 화면" />
      <span>현재 3D 화면</span>
    </div>}

    {imageSource && <div className="concept-preview generated">
      <img src={imageSource} alt="생성된 건축 컨셉 이미지" />
      <span>{result?.provider ? `생성 결과 · ${result.provider}` : "생성 결과"}</span>
    </div>}

    <div className={`concept-provider-status ${provider.available ? "ready" : ""}`}>
      <span>{provider.available ? "이미지 생성 연결됨" : "이미지 생성 서버 연결 전"}</span>
      <small>{provider.available ? "서버에서 API 키를 보관합니다." : "현재는 3D 화면과 컨셉 요청 준비까지만 사용할 수 있습니다."}</small>
    </div>

    {message && <div className="concept-message">{message}</div>}

    {request && <details className="concept-brief">
      <summary>생성 요청 내용 보기</summary>
      <p>{request.prompt}</p>
    </details>}
  </section>;
}
