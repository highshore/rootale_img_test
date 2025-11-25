'use client';

import { ReactNode, useState } from "react";

const PM_NAME = "전상윤";
const PROJECT_NAME = "rootale";

export default function DocsGuard({ children }: { children: ReactNode }) {
  const [pmAnswer, setPmAnswer] = useState("");
  const [projectAnswer, setProjectAnswer] = useState("");

  const pmValid = pmAnswer.trim().toLowerCase() === PM_NAME;
  const projectValid = projectAnswer.trim().toLowerCase() === PROJECT_NAME;
  const unlocked = pmValid && projectValid;

  return (
    <div className="min-h-screen">
      {!unlocked ? (
        <div className="flex min-h-screen items-center justify-center px-6 py-16">
          <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-900 bg-slate-900/80 p-8 text-slate-100 shadow-2xl shadow-black/40">
            <h2 className="text-center text-2xl font-semibold text-indigo-200">접근 인증</h2>
            <p className="text-center text-sm text-slate-400">
              두 가지 질문에 모두 정확히 답하면 문서가 열립니다.
            </p>
            <div className="space-y-4">
              <label className="space-y-2 text-sm text-slate-300">
                <span>이 프로젝트의 PM의 이름은?</span>
                <input
                  value={pmAnswer}
                  onChange={(event) => setPmAnswer(event.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
                  placeholder="예: jiho"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-300">
                <span>이 프로젝트의 이름을 영어 소문자로 쓰면?</span>
                <input
                  value={projectAnswer}
                  onChange={(event) => setProjectAnswer(event.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
                  placeholder="예: blackwell"
                />
              </label>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
              <p className="font-semibold text-slate-100">힌트</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                <li>- PM 이름과 프로젝트 이름 모두 소문자 입력</li>
                <li>- 오타 없이 입력해야 문서가 열립니다</li>
              </ul>
            </div>
            <p className="text-center text-sm text-slate-400">
              {pmValid ? "PM 이름 ✔️" : "PM 이름 ❌"} · {projectValid ? "프로젝트 이름 ✔️" : "프로젝트 이름 ❌"}
            </p>
          </div>
        </div>
      ) : null}
      {unlocked ? children : null}
    </div>
  );
}

