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

## Environment variables
Add these to `.env.local` for local runs and to Vercel/Netlify for production:

```env
# Required for the Next.js API route → RunPod proxy hop
RUNPOD_API_KEY=your_runpod_api_key
RUNPOD_ENDPOINT_ID=ul5kke5ddlrzhi

# Our AWS Accelerator front door (no trailing slash, HTTP only)
RUNPOD_PROXY_BASE_URL=http://a2ccc7a37a37df10c.awsglobalaccelerator.com

# Optional but recommended to keep client + server in sync
RUNPOD_OUTPUT_WIDTH=1664
RUNPOD_OUTPUT_HEIGHT=928
RUNPOD_ACCELERATOR_MAX_IMAGE_BYTES=700000
```

The `/api/runpod` route always reads these values from the server-side env so credentials never leak to the browser.

## Usage
- Use the tabs at the top of the form to swap between **Character**, **Background**, and **Character + Background** flows. Each mode injects its own prompt scaffolding automatically.
- Pick a resolution from the dropdown (square 1328×1328 or cinematic 1664×928). The current selection is reflected in the header and stamped into the metadata we send to RunPod.
- Character mode exposes granular dropdowns (hair style/color, eye color, expression, pose, lighting, style) plus free-form wardrobe/prop inputs so you can build a rigid recipe without retyping boilerplate. Background mode mirrors this with environment, palette, focal element, time of day, atmosphere, and style selectors.
- Fill in the mode-specific fields. The combo flow expects both a character brief and an environment brief; the other modes only need their respective sections.
- Every dropdown includes a **None** entry. Picking it removes that attribute from the final prompt, so you can stay as lean or as descriptive as you like.
- Upload references per slot. Character mode accepts optional hero plates, Background mode accepts optional layout/color boards, and Combo mode requires **both** references. If you skip a reference in Character/Background mode, the client injects a tiny pseudo image so the RunPod workflow still receives a valid `image_name`. Disabling “Preserve original resolution” auto-downscales and compresses each reference to ≈320 KB, which keeps the payload under the accelerator’s 700 KB ceiling.
- Submit the form to enqueue a job through the `/api/runpod` proxy route. Every request travels through the AWS Global Accelerator HTTP endpoint, so keep uploads ≤8 MB or disable “Preserve original resolution” to avoid 413s.
- The right-hand column mirrors the live preview, key timings, and the raw JSON payload for quick debugging or downstream integrations. Polling stops automatically once RunPod reports success or failure.
- `/api/runpod` now assembles the actual `prompt`/`negative_prompt` on the server. The browser only sends structured form data plus references, keeping the authoring recipe private.
- Need a deeper contract reference? Visit [`/docs`](./docs) (Image Gen API Documentation) for the full Korean-language guide that lists every env var, payload field, and the exact `curl` snippets we use with the accelerator.

The client never exposes your API key—requests are proxied through a Next.js Route Handler that reads `RUNPOD_API_KEY` from server-side environment variables.

## AWS Global Accelerator

Our RunPod worker now sits behind an AWS Global Accelerator + EC2 nginx proxy. The accelerator only accepts **HTTP on port 80** and injects the `Authorization` header for us. To mirror the production setup locally:

```env
# Point the proxy at the accelerator endpoint (HTTP only, no trailing slash)
RUNPOD_PROXY_BASE_URL=http://a2ccc7a37a37df10c.awsglobalaccelerator.com

# Optional: override the RunPod endpoint id (defaults to ul5kke5ddlrzhi)
RUNPOD_ENDPOINT_ID=ul5kke5ddlrzhi
```

When these variables are present, `/api/runpod`:

1. Posts to the accelerator without an auth header, satisfying nginx/Cloudflare.
2. Surfaces the accelerator transport in the response payload so the metadata pane can show it.

## Production
Deploy like any other Next.js project (Vercel, Netlify, Docker, etc.). Remember to set `RUNPOD_API_KEY` and the accelerator variables as secrets in your hosting platform so the proxy can authenticate requests.
