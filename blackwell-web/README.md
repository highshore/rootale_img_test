# Blackwell Comfy Client

A lightweight Next.js + Tailwind dashboard that speaks to the Blackwell Runpod endpoint (`ul5kke5ddlrzhi`). It follows a clean Y Combinator-inspired aesthetic (minus the signature orange) and lets you launch image jobs without leaving the browser.

## Tech Stack
- Next.js App Router (TypeScript)
- Tailwind CSS (with the new `@tailwindcss/postcss` pipeline)
- Heroicons for UI glyphs

## Prerequisites
1. Node.js 18 or newer
2. A Runpod API key with access to the Blackwell worker image

## Getting Started
1. Install dependencies (already done if you used `create-next-app` but safe to rerun):
   ```bash
   npm install
   ```
2. Create a `.env.local` file and add your Runpod key:
   ```bash
   echo "RUNPOD_API_KEY=your_runpod_api_key" >> .env.local
   ```
3. Launch the development server:
   ```bash
   npm run dev
   ```
4. Visit [http://localhost:3000](http://localhost:3000) to open the control panel.

## Usage
- Fill in the prompt and optional fields (negative prompt, steps, CFG, dimensions, seed).
- Submit the form to create a job through the `/api/runpod` proxy route.
- The right-hand card surfaces key metadata (job id, status, timing data). The raw JSON payload is shown below for quick debugging or integrations.
- The UI polls Runpod automatically and renders the decoded preview as soon as the job finishes.

The client never exposes your API key—requests are proxied through a Next.js Route Handler that reads `RUNPOD_API_KEY` from server-side environment variables.

## Production
Deploy like any other Next.js project (Vercel, Netlify, Docker, etc.). Remember to set `RUNPOD_API_KEY` as a secret in your hosting platform so the proxy can authenticate requests.
