import Link from "next/link";
import type { ComponentProps, ComponentType } from "react";
import { Suspense } from "react";
import { Noto_Sans_KR } from "next/font/google";
import {
  ArrowsRightLeftIcon,
  ClipboardDocumentListIcon,
  CloudArrowUpIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  KeyIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import CredentialPlayground from "./CredentialPlayground";
import DocsGuard from "./DocsGuard";
import { PLACEHOLDER_API_KEY, PLACEHOLDER_ENDPOINT_ID, PLACEHOLDER_PROXY_URL } from "./placeholders";

const notoSans = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

type IconComponent = ComponentType<ComponentProps<"svg">>;

const ENV_VARS = [
  {
    key: "RUNPOD_API_KEY",
    required: true,
    defaultValue: PLACEHOLDER_API_KEY,
    description:
      "서버에서 `/api/runpod` 요청을 RunPod에 인증할 때 사용하는 secret key입니다. 브라우저나 클라이언트 코드에 노출하지 마세요.",
  },
  {
    key: "RUNPOD_ENDPOINT_ID",
    required: true,
    defaultValue: PLACEHOLDER_ENDPOINT_ID,
    description: "Qwen/Nunchaku 워크플로가 실행 중인 서버리스 엔드포인트 ID입니다. 릴리스를 복제한 경우에만 변경하세요.",
  },
  {
    key: "RUNPOD_PROXY_BASE_URL",
    required: true,
    defaultValue: PLACEHOLDER_PROXY_URL,
    description:
      "RunPod API 앞단에 위치한 AWS Global Accelerator 호스트입니다. 모든 트래픽이 이 주소를 거쳐 이동합니다.",
  },
  {
    key: "RUNPOD_OUTPUT_WIDTH / RUNPOD_OUTPUT_HEIGHT",
    required: false,
    defaultValue: "1664 / 928",
    description: "클라이언트가 `width` 또는 `height`를 생략했을 때 사용할 기본 해상도입니다. 허용된 프리셋으로 자동 보정됩니다.",
  },
  {
    key: "RUNPOD_ACCELERATOR_MAX_IMAGE_BYTES",
    required: false,
    defaultValue: "700000",
    description:
      "두 개의 인라인 레퍼런스를 합산했을 때 허용되는 최대 바이트 수입니다. 초과하면 RunPod로 전달되기 전에 차단됩니다.",
  },
];

const REQUEST_FIELDS = [
  {
    name: "mode",
    required: true,
    values: "`character` | `background` | `combo`",
    description:
      "어떤 형태의 프롬프트를 만들지 지정합니다. `combo`는 반드시 두 레퍼런스를 요구합니다.",
  },
  {
    name: "width / height",
    required: false,
    defaultValue: "1664 × 928",
    description: "드롭다운에서 선택한 프리셋(`1328×1328` / `1664×928`). 다른 값은 서버에서 가장 가까운 프리셋으로 보정됩니다.",
  },
  {
    name: "steps",
    required: false,
    defaultValue: "2",
    description: "라이트닝 워크플로 특성상 2 스텝으로 유지하는 것이 가장 안정적입니다.",
  },
  {
    name: "cfg",
    required: false,
    defaultValue: "1",
    description: "낮은 CFG가 레퍼런스 충실도를 높여주기 때문에 기본 1을 권장합니다.",
  },
  {
    name: "seed",
    required: false,
    defaultValue: "제출 시 무작위",
    description: "문자열을 정수로 파싱하며 비워 두면 서버에서 무작위 64비트 값을 생성합니다.",
  },
  {
    name: "prompt",
    required: false,
    description: "직접 프롬프트를 쓰고 싶을 때 사용합니다. 비워 두면 서버가 아래 form 객체를 읽어 자동으로 조합합니다.",
  },
  {
    name: "negativePrompt",
    required: false,
    defaultValue: "모드별 기본 네거티브",
    description: "비워 두면 서버가 모드 기본 네거티브 + 폼의 `negative` 필드를 합칩니다.",
  },
  {
    name: "character",
    required: "mode = character 일 때",
    description:
      "구조화된 캐릭터 입력 객체입니다. 필드: `concept`, `hairStyle`, `hairColor`, `eyeColor`, `expression`, `wardrobe`, `props`, `pose`, `lighting`, `style`, `negative`, `seed`. 모든 드롭다운에는 `'None'` 옵션이 있으며, 해당 값을 보내면 프롬프트에서 자동으로 제외됩니다.",
  },
  {
    name: "background",
    required: "mode = background 일 때",
    description:
      "환경용 입력 객체. 필드: `location`, `environmentType`, `palette`, `focalElement`, `timeOfDay`, `atmosphere`, `style`, `negative`, `seed`. `'None'` 값을 보내면 해당 구간을 프롬프트에서 제거합니다.",
  },
  {
    name: "combo",
    required: "mode = combo 일 때",
    description:
      "콤보 모드 입력. 필드: `characterDescription`, `backgroundDescription`, `interaction`, `negative`, `seed`. 콤보 모드는 여전히 두 레퍼런스를 모두 요구합니다.",
  },
  {
    name: "metadata",
    required: false,
    description: "분석/로깅용 자유형 객체. 예: `resolution`, `style`, `palette`, `interaction` 등.",
  },
  {
    name: "imageBase64",
    required: true,
    description:
      "주 레퍼런스 슬롯(캐릭터 플레이트). 캐릭터/콤보 모드에서는 필수이며, 배경 모드에서는 1×1 더미가 자동 삽입됩니다.",
  },
  {
    name: "backgroundImageBase64",
    required: true,
    description:
      "보조 레퍼런스 슬롯(배경 플레이트). 배경/콤보 모드에서 필수이며, 캐릭터 모드에서는 1×1 더미가 채워집니다.",
  },
  {
    name: "imageObjectKey / backgroundImageObjectKey",
    required: false,
    description:
      "RunPod Storage에 업로드한 객체 키. 인라인 base64 대신 전송하면 대용량 레퍼런스도 허용됩니다.",
  },
];

const RESPONSE_FIELDS = [
  {
    name: "id / status / delayTime / executionTime",
    description: "RunPod AWS Accelerator에서 전달한 잡 메타데이터(지연, 실행 시간 등)를 그대로 반환합니다.",
  },
  {
    name: "image_base64",
    description:
      "생성된 PNG를 base64로 인코딩한 값입니다. `RUNPOD_INCLUDE_OUTPUT_BASE64=1` 이거나 업로드가 실패했을 때 포함됩니다.",
  },
  {
    name: "image_object_key / image_url",
    description:
      "RunPod Storage 업로드가 활성화된 경우에만 제공됩니다. 공개 URL을 받으려면 `RUNPOD_STORAGE_PUBLIC_BASE_URL`이 필요합니다.",
  },
  {
    name: "transport",
    description: "사용된 전송 경로(`accelerator`)를 반영합니다. 네트워크 다중 홉 디버깅에 유용합니다.",
  },
];

const SAMPLE_FRONTEND_REQUEST = `await fetch("/api/runpod", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    mode: "character",
    prompt: "cinematic hero frame...",
    negativePrompt: "duplicate limbs, lowres",
    width: 1664,
    height: 928,
    steps: 2,
    cfg: 1,
    seed: Date.now(),
    imageBase64: "<compressed character reference>",
    backgroundImageBase64: "<compressed background reference>"
  }),
});`;

const SAMPLE_CHARACTER_PAYLOAD = `POST /api/runpod
Content-Type: application/json

{
  "mode": "character",
  "width": 1664,
  "height": 928,
  "character": {
    "concept": "young engineer adjusting her visor",
    "hairStyle": "Short",
    "hairColor": "Dark brown",
    "eyeColor": "Hazel",
    "expression": "Focused",
    "wardrobe": "utility jacket, tool belt, layered fabrics",
    "props": "floating wrench, drone companion",
    "pose": "Three-quarter turn",
    "lighting": "Golden hour",
    "style": "Anime cel shading",
    "negative": ""
  },
  "imageBase64": "iVBORw0K...trimmed",
  "backgroundImageBase64": "iVBORw0K...trimmed",
  "metadata": { "resolution": "1664×928" }
}`;

const SAMPLE_BACKGROUND_PAYLOAD = `POST /api/runpod
Content-Type: application/json

{
  "mode": "background",
  "width": 1328,
  "height": 1328,
  "background": {
    "location": "rooftop workshop overlooking neon city",
    "environmentType": "City rooftop",
    "palette": "Neon accents",
    "focalElement": "Antenna array",
    "timeOfDay": "Blue hour",
    "atmosphere": "Light fog",
    "style": "Matte painting",
    "negative": "no characters, no signage"
  },
  "imageBase64": "iVBORw0K...trimmed",
  "backgroundImageBase64": "iVBORw0K...trimmed",
  "metadata": { "resolution": "1328×1328" }
}`;

const SAMPLE_COMBO_PAYLOAD = `POST /api/runpod
Content-Type: application/json

{
  "mode": "combo",
  "width": 1664,
  "height": 928,
  "combo": {
    "characterDescription": "heroine leaping across the rooftop",
    "backgroundDescription": "neon skyline with turbines and catwalks",
    "interaction": "character lands on the catwalk railing",
    "negative": "no duplicate limbs"
  },
  "imageBase64": "iVBORw0K...character-trimmed",
  "backgroundImageBase64": "iVBORw0K...background-trimmed",
  "metadata": {
    "resolution": "1664×928",
    "interaction": "railing landing"
  }
}`;

function Section({ title, description, icon: Icon, children }: { title: string; description?: string; icon: IconComponent; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg shadow-black/40">
      <div className="mb-4 flex items-center gap-3 text-slate-200">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="text-sm text-slate-400">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function KeyValueTable({
  rows,
  valueLabel = "설명",
}: {
  rows: {
    key?: string;
    name?: string;
    required?: boolean | string;
    defaultValue?: string;
    values?: string;
    description: string;
  }[];
  valueLabel?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <div className="grid grid-cols-12 bg-slate-900/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <div className="col-span-4">항목</div>
        <div className="col-span-2 text-center">필수 여부</div>
        <div className="col-span-6">{valueLabel}</div>
      </div>
      <dl className="divide-y divide-slate-800">
        {rows.map((row) => (
          <div key={row.key ?? row.name} className="grid grid-cols-12 gap-4 px-4 py-4 text-sm">
            <dt className="col-span-4 break-all font-mono text-slate-100">{row.key ?? row.name}</dt>
            <dd className="col-span-2 text-center">
              {(() => {
                const isConditional = typeof row.required === "string";
                const isHardRequired = row.required === true || isConditional;
                const label =
                  typeof row.required === "string" ? row.required : row.required ? "필수" : "선택";
                return (
                  <span
                    className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs ${
                      isHardRequired ? "bg-rose-500/10 text-rose-300" : "bg-slate-700/50 text-slate-300"
                    }`}
                  >
                    {label}
                  </span>
                );
              })()}
              {row.defaultValue ? (
                <div className="mt-1 text-[11px] text-slate-400">기본값: {row.defaultValue}</div>
              ) : null}
              {row.values ? (
                <div className="mt-1 text-[11px] text-indigo-300">{row.values}</div>
              ) : null}
            </dd>
            <dd className="col-span-6 text-slate-200 break-words">{row.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{title}</p>
      <pre className="overflow-x-auto rounded-xl bg-slate-900/80 p-4 text-sm leading-relaxed text-slate-100">{code}</pre>
    </div>
  );
}

export const metadata = {
  title: "Image Gen API Documentation | Blackwell Console",
};

function DocsContent() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16 break-words">
        <header className="space-y-6 rounded-3xl border border-slate-900 bg-gradient-to-br from-slate-900/80 via-slate-900/40 to-indigo-900/20 p-10 shadow-2xl shadow-black/40">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-indigo-300">블랙웰 API</p>
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold md:text-4xl">Image Gen API Documentation</h1>
              <p className="mt-3 max-w-2xl text-lg text-slate-300">
                AWS Accelerator를 경유하는 `/api/runpod` 경로를 사용하기 위해 필요한 환경 변수, 요청 스키마, 페이로드 제한, 샘플 호출을 한곳에 정리했습니다. 모든 프롬프트 조합은 서버에서 수행되므로 클라이언트에는 구조화된 입력만 노출됩니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-200 transition hover:border-indigo-400 hover:text-white"
              >
                Return to Console
              </Link>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <InformationCircleIcon className="h-4 w-4" aria-hidden />
                클라이언트 요청은 RunPod API 키에 직접 접근하지 않습니다.
              </div>
            </div>
          </div>
        </header>

        <Section
          title="환경 변수 및 전송 경로"
          description="AWS Accelerator 호출 전에 반드시 준비해야 하는 설정입니다."
          icon={KeyIcon}
        >
          <KeyValueTable rows={ENV_VARS} />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              { label: "대시보드 엔드포인트", value: "POST /api/runpod", detail: "Next.js 라우트" },
              {
                label: "AWS Accelerator Endpoint",
                value: "POST ${RUNPOD_PROXY_BASE_URL}/v2/${RUNPOD_ENDPOINT_ID}/run",
                detail: "AWS Global Accelerator direct call",
              },
              {
                label: "상태 폴링",
                value: "GET ${RUNPOD_PROXY_BASE_URL}/v2/${RUNPOD_ENDPOINT_ID}/status/{jobId}",
                detail: "대시보드 내부에서 사용",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">{item.label}</p>
                <p className="mt-1 break-all font-mono text-sm text-indigo-200">{item.value}</p>
                <p className="text-xs text-slate-400">{item.detail}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="요청 스키마"
          description="`/api/runpod`가 RunPod로 전달하기 전에 허용하는 필드와 제약입니다."
          icon={DocumentTextIcon}
        >
          <KeyValueTable rows={REQUEST_FIELDS} valueLabel="설명" />
          <p className="mt-3 text-sm text-slate-400">
            각 드롭다운에는 <code>None</code> 값이 포함되어 있으며 해당 값을 선택하면 서버가 해당 속성을 프롬프트에서 자동으로 제외합니다.
          </p>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
            <p className="mb-2 font-semibold text-slate-100">해상도 가드레일</p>
            <p>
              API 라우트는 클라이언트가 유지하는 프리셋 맵을 그대로 강제합니다. `1328×1328` 또는 `1664×928` 밖의 값은 모델 추론 시간을 안정적으로 유지하기 위해 기본값으로 보정됩니다.
            </p>
          </div>
        </Section>

        <Section
          title="모드별 API 예시"
          description="각 모드에서 전송되는 JSON 구조를 그대로 보여주는 요청 샘플입니다."
          icon={InformationCircleIcon}
        >
          <div className="grid gap-6 md:grid-cols-3">
            <CodeBlock title="Character 모드" code={SAMPLE_CHARACTER_PAYLOAD} />
            <CodeBlock title="Background 모드" code={SAMPLE_BACKGROUND_PAYLOAD} />
            <CodeBlock title="Combo 모드" code={SAMPLE_COMBO_PAYLOAD} />
          </div>
          <p className="mt-3 text-sm text-slate-400">
            위 예시의 base64 값은 가독성을 위해 잘라냈습니다. 실제 요청에서는 클라이언트가 압축한 전체 문자열(≈320KB 이하)을 포함해야 하며, 콤보 모드에서는 두 레퍼런스 모두 실제 이미지를 제공해야 합니다.
          </p>
        </Section>

        <Section
          title="레퍼런스 전략"
          description="AWS Accelerator 페이로드 한도를 넘지 않도록 다루는 방법입니다."
          icon={CloudArrowUpIcon}
        >
          <div className="space-y-4 text-sm text-slate-300">
            <p>
              UI는 캔버스 재렌더링을 통해 각 레퍼런스를 <strong>320 KB</strong> 이하로 압축합니다. 전송 직전에 두 슬롯의 용량을 합산해
              `RUNPOD_ACCELERATOR_MAX_IMAGE_BYTES`(기본 약 700 KB)를 초과하면 제출을 차단하여 AWS Global Accelerator의
              `413 Payload Too Large` 오류를 방지합니다.
            </p>
            <p>
              특정 모드에서 슬롯이 필수가 아니더라도(예: 캐릭터 없이 배경 모드) ComfyUI 워크플로가 항상 두 장의 이미지를 받도록 1×1 플레이스홀더 픽셀을 주입합니다:
            </p>
            <pre className="overflow-x-auto rounded-xl bg-slate-900/70 p-4 font-mono text-xs text-slate-200">
              {`const PSEUDO_REFERENCE_BASE64 =
"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAn0B9lqQ+wAAAABJRU5ErkJggg==";`}
            </pre>
            <p>
              콤보 모드는 실제 업로드 두 장이 필수입니다. 캐릭터/배경 모드는 “원본 해상도 유지”를 켜고 직접 이미지를 제공하지 않는 이상 남는
              슬롯에 자동으로 더미 픽셀이 들어갑니다.
            </p>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-center gap-2 text-amber-300">
                <ExclamationTriangleIcon className="h-5 w-5" aria-hidden />
                <span className="text-sm font-semibold">8MB 브라우저 제한</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">
                입력 컴포넌트는 8MB를 넘는 파일을 압축 전에 즉시 거부해 브라우저가 멈추는 것을 방지합니다. 대용량 EXR/TIFF는 서버에서
                미리 리사이즈하고 RunPod Storage 객체 키로 전달하는 방식을 권장합니다.
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="응답 형태"
          description="워커가 반환하는 페이로드를 이해하세요."
          icon={ShieldCheckIcon}
        >
          <KeyValueTable rows={RESPONSE_FIELDS} valueLabel="의미" />
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
            <p>
              대시보드는 출력 노드에서 이미지가 생성될 때까지 <code>/status/{'{'}jobId{'}'}</code>를 폴링합니다. 워커가 RunPod Storage로 업로드하면
              <code>image_object_key</code>와 필요 시 <code>image_url</code>을 받게 되며, 그렇지 않으면 즉시 미리볼 수 있는
              <code>image_base64</code> 문자열을 반환합니다.
            </p>
          </div>
        </Section>

        <Section
          title="엔드투엔드 예시"
          description="보안된 환경 어디에서나 재현 가능한 참조 호출입니다."
          icon={ClipboardDocumentListIcon}
        >
          <div className="grid gap-6 md:grid-cols-2">
            <CodeBlock title="대시보드 → Next.js 라우트" code={SAMPLE_FRONTEND_REQUEST} />
            <CredentialPlayground />
          </div>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
            <p>
              직접 `curl`을 호출하면 Next.js를 완전히 우회하므로 문제가 워커인지 프록시인지 즉시 구분할 수 있어 RunPod 릴리스를 디버깅할 때 매우 유용합니다.
              API 키는 주기적으로 교체하고 AWS Accelerator URL은 내부에서만 공유하세요. 두 값이 모두 유출되면 GPU 크레딧이 소모될 수 있습니다.
            </p>
          </div>
        </Section>

        <Section
          title="운영 체크리스트"
          description="워커나 대시보드를 배포하기 전 따라야 할 절차입니다."
          icon={ArrowsRightLeftIcon}
        >
          <ol className="list-decimal space-y-3 pl-6 text-sm text-slate-300">
            <li>`blackwell/handler.py`를 수정한 뒤 `docker build … && docker push …`로 컨테이너를 다시 빌드합니다.</li>
            <li>새 다이제스트를 RunPod 서버리스 릴리스에 붙여 넣고 <span className="font-semibold">Redeploy</span>를 눌러 워커를 교체합니다.</li>
            <li>대시보드에서 스모크 테스트를 실행하고 `/docs` 페이지가 다른 엔지니어에게도 정상적으로 노출되는지 확인합니다.</li>
            <li>Slack 등 협업 채널에 릴리스/다이제스트 정보를 공유해 온콜 인수인계에 활용합니다.</li>
          </ol>
        </Section>

        <footer className="mb-8 text-center text-xs text-slate-500">
          추가 통합 지원이 필요하면 Job ID와 직렬화된 페이로드를 함께 적어 #blackwell-platform 채널에 남겨 주세요.
        </footer>
      </main>
  );
}

export default function DocsPage() {
  return (
    <div className={`${notoSans.className} min-h-screen bg-slate-950 text-slate-100`}>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-300">로딩 중...</div>}>
        <DocsGuard>
          <DocsContent />
        </DocsGuard>
      </Suspense>
    </div>
  );
}

