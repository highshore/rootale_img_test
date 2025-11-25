'use client';

import { useMemo, useState } from "react";
import { PLACEHOLDER_API_KEY, PLACEHOLDER_ENDPOINT_ID, PLACEHOLDER_PROXY_URL } from "./placeholders";

function CredentialInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2 text-sm text-slate-300">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 font-mono text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
        spellCheck={false}
      />
    </label>
  );
}

function CredentialCodeBlock({
  title,
  code,
  copyEnabled,
}: {
  title: string;
  code: string;
  copyEnabled: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!copyEnabled) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-400">{title}</p>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!copyEnabled}
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition ${
            copyEnabled
              ? "border border-slate-600 text-slate-200 hover:border-indigo-400 hover:text-white"
              : "border border-slate-800 text-slate-600"
          }`}
        >
          {copyEnabled ? (copied ? "Copied!" : "Copy") : "Fill values"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-slate-900/80 p-4 text-sm leading-relaxed text-slate-100">{code}</pre>
    </div>
  );
}

export default function CredentialPlayground() {
  const [apiKey, setApiKey] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");

  const trimmedProxy = proxyUrl.trim().replace(/\/$/, "");
  const sanitizedProxy = trimmedProxy || PLACEHOLDER_PROXY_URL;
  const sanitizedEndpoint = endpointId.trim() || PLACEHOLDER_ENDPOINT_ID;
  const sanitizedApiKey = apiKey.trim() || PLACEHOLDER_API_KEY;

  const curlSample = useMemo(
    () =>
      `curl -X POST \\
  "${sanitizedProxy}/v2/${sanitizedEndpoint}/run" \\
  -H "Authorization: Bearer ${sanitizedApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": {
      "mode": "combo",
      "character": { ... },
      "background": { ... },
      "imageBase64": "<character-base64>",
      "backgroundImageBase64": "<background-base64>"
    }
  }'`,
    [sanitizedApiKey, sanitizedEndpoint, sanitizedProxy],
  );

  const readyToCopy = Boolean(apiKey.trim() && endpointId.trim() && proxyUrl.trim());

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">직접 AWS Accelerator 호출 (CI/디버깅)</p>
      <p className="text-sm text-slate-300">
        샘플 `curl` 요청에 주입할 값을 아래에 직접 입력하세요. 이 데이터는 브라우저 메모리에만 머무르며 서버로 전송되지 않습니다.
      </p>
      <div className="grid gap-3">
        <CredentialInput
          label="RUNPOD_API_KEY"
          value={apiKey}
          placeholder={PLACEHOLDER_API_KEY}
          onChange={setApiKey}
        />
        <CredentialInput
          label="RUNPOD_ENDPOINT_ID"
          value={endpointId}
          placeholder={PLACEHOLDER_ENDPOINT_ID}
          onChange={setEndpointId}
        />
        <CredentialInput
          label="RUNPOD_PROXY_BASE_URL"
          value={proxyUrl}
          placeholder={PLACEHOLDER_PROXY_URL}
          onChange={setProxyUrl}
        />
      </div>
      <CredentialCodeBlock title="샘플 curl 호출" code={curlSample} copyEnabled={readyToCopy} />
      <p className="text-xs text-slate-500">
        {readyToCopy ? "위 값이 버튼에 반영되었습니다." : "세 필드를 모두 채워야 복사 버튼이 활성화됩니다."}
      </p>
    </div>
  );
}

