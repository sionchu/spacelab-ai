"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageIcon, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildConceptViewRequest,
  suggestConceptProjectType,
  type ConceptCameraState,
  type ConceptProjectType,
  type ConceptVisualStyle,
  type ConceptViewRequest,
} from "@/src/concept-view";
import type { Scenario, Site, Viewpoint } from "@/src/types";

type ConceptResult = {
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
  provider?: string;
};

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

function resultSource(result?: ConceptResult) {
  if (!result) return undefined;
  if (result.imageUrl) return result.imageUrl;
  if (result.imageBase64) return `data:${result.mimeType || "image/png"};base64,${result.imageBase64}`;
  return undefined;
}

export function ConceptViewPanel({
  site,
  scenario,
  viewpoint,
  captureMap,
  onClose,
}: {
  site: Site;
  scenario: Scenario;
  viewpoint?: Viewpoint;
  captureMap: () => Promise<{ image?: Blob; camera?: ConceptCameraState }>;
  onClose: () => void;
}) {
  const suggestedType = useMemo(
    () => suggestConceptProjectType(scenario.name, scenario.intent),
    [scenario.intent, scenario.name],
  );
  const [projectType, setProjectType] = useState<ConceptProjectType>(suggestedType);
  const [visualStyle, setVisualStyle] = useState<ConceptVisualStyle>("neutral");
  const [preparedRequest, setPreparedRequest] = useState<ConceptViewRequest>();
  const [referenceImage, setReferenceImage] = useState<Blob>();
  const [referenceUrl, setReferenceUrl] = useState<string>();
  const [result, setResult] = useState<ConceptResult>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    setProjectType(suggestedType);
    setPreparedRequest(undefined);
    setReferenceImage(undefined);
    setResult(undefined);
    setMessage(undefined);
  }, [scenario.id, site.id, suggestedType]);

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
      const context = await captureMap();
      const next = buildConceptViewRequest({
        site,
        scenario,
        projectType,
        visualStyle,
        viewpoint,
        camera: context.camera,
      });
      setPreparedRequest(next);
      setReferenceImage(context.image);
      setResult(undefined);
      setMessage(context.image
        ? "현재 MapLibre 화면과 설계 정보를 준비했습니다."
        : "설계 정보는 준비됐지만 현재 환경에서 지도 화면 캡처를 가져오지 못했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setMessage(undefined);
    try {
      let request = preparedRequest;
      let image = referenceImage;
      if (!request) {
        const context = await captureMap();
        image = context.image;
        request = buildConceptViewRequest({
          site,
          scenario,
          projectType,
          visualStyle,
          viewpoint,
          camera: context.camera,
        });
        setPreparedRequest(request);
        setReferenceImage(image);
      }

      const form = new FormData();
      form.set("metadata", JSON.stringify(request));
      form.set("prompt", request.prompt);
      if (image) form.set("referenceImage", image, "spacelab-map.png");

      const response = await fetch("/api/concept-view", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail ? `${payload.error}: ${payload.detail}` : payload?.error || "컨셉 이미지 생성 실패");
      }

      setResult(payload as ConceptResult);
      setMessage("현재 배치와 지도 시점을 기준으로 컨셉 이미지를 생성했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const imageSource = resultSource(result);

  return (
    <section className="absolute bottom-[136px] right-2 top-[66px] z-30 flex w-[min(430px,calc(100%-16px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111922]/98 shadow-2xl md:bottom-4 md:right-4 md:top-[70px]">
      <header className="flex items-start justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div>
          <div className="text-[10px] font-bold text-[var(--primary)]">컨셉 보기</div>
          <div className="mt-1 text-sm font-bold">{scenario.id} · {scenario.name}</div>
        </div>
        <button aria-label="컨셉 보기 닫기" className="rounded-lg p-1.5 text-[#8e9aa5] hover:bg-white/5 hover:text-white" onClick={onClose}>
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="m-0 text-[11px] leading-5 text-[#8d99a5]">
          현재 건물 위치·크기·방향과 지도 시점을 유지하고 단순 매스의 외관만 초기 건축 컨셉으로 변환합니다.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[10px] text-[#8f9ca7]">
            건물 종류
            <select value={projectType} onChange={(event) => setProjectType(event.target.value as ConceptProjectType)} className="rounded-lg border border-white/8 bg-[#0e151b] px-2 py-2 text-white outline-none">
              {projectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[10px] text-[#8f9ca7]">
            표현 스타일
            <select value={visualStyle} onChange={(event) => setVisualStyle(event.target.value as ConceptVisualStyle)} className="rounded-lg border border-white/8 bg-[#0e151b] px-2 py-2 text-white outline-none">
              {styleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void prepare()}>
            <RefreshCw className="size-3.5" /> {busy ? "준비 중…" : "현재 화면 준비"}
          </Button>
          <Button disabled={busy} onClick={() => void generate()}>
            <ImageIcon className="size-3.5" /> {busy ? "처리 중…" : "컨셉 이미지 생성"}
          </Button>
        </div>

        {referenceUrl && (
          <div className="mt-4 overflow-hidden rounded-xl border border-white/8 bg-[#0b1116]">
            <img src={referenceUrl} alt="현재 SpaceLab 지도 화면" className="block aspect-[3/2] w-full object-cover" />
            <div className="px-3 py-2 text-[9px] text-[#788691]">생성 기준 · 현재 MapLibre 화면</div>
          </div>
        )}

        {imageSource && (
          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--primary)]/25 bg-[#0b1116]">
            <img src={imageSource} alt="생성된 건축 컨셉 이미지" className="block aspect-[3/2] w-full object-cover" />
            <div className="flex items-center justify-between px-3 py-2 text-[9px] text-[#91a0ab]">
              <span>생성 결과 · presentation only</span>
              <span>{result?.provider || "image model"}</span>
            </div>
          </div>
        )}

        {message && <div className="mt-3 rounded-xl border border-white/8 bg-[#0e151b] p-3 text-[10px] leading-4 text-[#a5b0b9]">{message}</div>}

        {preparedRequest && (
          <details className="mt-3 rounded-xl border border-white/8 bg-[#0e151b] p-3 text-[10px] text-[#8f9ba6]">
            <summary className="cursor-pointer font-semibold text-white">생성 요청 내용 보기</summary>
            <p className="mb-0 mt-2 leading-5">{preparedRequest.prompt}</p>
          </details>
        )}

        <div className="mt-4 text-[9px] leading-4 text-[#6f7d88]">
          생성 이미지는 시각화 결과일 뿐이며 부지·건물·일조·조망 분석 상태에는 반영되지 않습니다. 이미지 생성 API 사용량은 서버 설정에 따라 과금될 수 있습니다.
        </div>
      </div>
    </section>
  );
}
