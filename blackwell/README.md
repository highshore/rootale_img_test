# CUDA 12.4 / SM 120 Variant (RunPod 5090 Template)

This README documents **exactly** what we ran—commands, file edits, and RunPod steps—to get the Qwen/Nunchaku ComfyUI workflow stable on the Blackwell/5090 template and on serverless workers. Use it as a reproducible playbook, not a loose checklist.

---

## 0. Reference Environment
- **RunPod template:** ComfyUI – 5090 Blackwell (CUDA 12.4, PyTorch 2.9.0 Tenstorrent build, Python 3.12, RTX 5090 a.k.a. SM 120).
- **Local build host:** macOS (Darwin 25.1.0) with Docker Desktop 27.x + buildx.
- **Repo root on local machine:** `/Users/nespresso/Desktop/rootale_img_test`.
- **Key files in this folder:** `Dockerfile`, `handler.py`, `extra_model_paths.yaml`, `nunchaku-qwen-image-edit-2509-workflow.json`.

---

## 1. Interactive Pod Playbook (Commands We Ran)
1. **Launch the RunPod template** and keep the default workspace layout (`/workspace/runpod-slim`).
2. **Install ComfyUI dependencies with the system Python** (no venv needed for the template):
   ```bash
   cd /workspace/runpod-slim/ComfyUI
   /usr/bin/python3 -m pip install --upgrade pip
   /usr/bin/python3 -m pip install -r requirements.txt
   ```
   (If you insist on isolation, create `/workspace/runpod-slim/.venv` and rerun the same installs inside it.)
3. **Install workflow extras required by custom nodes:**
   ```bash
   /usr/bin/python3 -m pip install \
     torchsde==0.2.6 \
     diffusers==0.35.2 \
     opencv-python==4.10.0.84 \
     gitpython==3.1.43
   # Optional audio tooling
   /usr/bin/python3 -m pip install torchaudio==2.9.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128
   ```
4. **Install the Nunchaku core wheel built for Torch 2.9:**
   ```bash
   /usr/bin/python3 -m pip install \
     https://github.com/nunchaku-tech/nunchaku/releases/download/v1.0.2/nunchaku-1.0.2+torch2.9-cp312-cp312-linux_x86_64.whl
   ```
5. **Pull in the custom nodes we rely on:**
   ```bash
   cd /workspace/runpod-slim/ComfyUI/custom_nodes
   git clone --depth 1 --branch v1.0.2 https://github.com/nunchaku-tech/ComfyUI-nunchaku.git
   git clone --depth 1 https://github.com/ussoewwin/ComfyUI-QwenImageLoraLoader.git
   /usr/bin/python3 ComfyUI-nunchaku/scripts/update_versions.py
   ```
6. **Clone this repo inside the pod:**
   ```bash
   cd /workspace
   git clone https://github.com/highshore/rootale_img_test.git
   ```
7. **Copy the SM 120 assets into the template ComfyUI checkout:**
   ```bash
   cd /workspace
   REPO_ROOT=/workspace/rootale_img_test
   COMFY_ROOT=/workspace/runpod-slim/ComfyUI

   mkdir -p "${COMFY_ROOT}/serverless" "${COMFY_ROOT}/workflows"
   cp "${REPO_ROOT}/blackwell/handler.py" "${COMFY_ROOT}/serverless/handler.py"
   cp "${REPO_ROOT}/blackwell/nunchaku-qwen-image-edit-2509-workflow.json" "${COMFY_ROOT}/workflows/"
   cp "${REPO_ROOT}/blackwell/extra_model_paths.yaml" "${COMFY_ROOT}/extra_model_paths.yaml"
   ```
8. **Double-check that the workflow contains _two_ `LoadImage` nodes (character + background).**  
   The new serverless handler always hydrates both `load_image` and `background_load_image`, so the JSON we bake into the Docker image has to expose two plain `LoadImage` nodes. From `blackwell/` run:
   ```bash
   jq 'to_entries[] | select(.value.class_type=="LoadImage") | {id:.key, inputs:.value.inputs.image}' \
     nunchaku-qwen-image-edit-2509-workflow.json
   ```
   You should see two entries (e.g. `78` with the keyed hero plate and `118` with the background plate). If only one row prints, re-export the workflow from ComfyUI after wiring in the second loader, otherwise the serverless worker will boot-loop with “Missing nodes in workflow: background_load_image”.
9. **Download the FP4 / FP8 / VAE / LoRA weights expected by the workflow:**
   ```bash
   mkdir -p /workspace/data/checkpoints/clip /workspace/data/{loras,vae}

   wget -O /workspace/data/checkpoints/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors \
     https://huggingface.co/nunchaku-tech/nunchaku-qwen-image-edit-2509/resolve/main/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors

   wget -O /workspace/data/checkpoints/clip/qwen_2.5_vl_7b_fp8_scaled.1.safetensors \
     https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors

   wget -O /workspace/data/vae/qwen_image_vae.1.safetensors \
     https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors

   wget -O /workspace/data/loras/Qwen-Anime-V1.safetensors \
     https://huggingface.co/prithivMLmods/Qwen-Image-Anime-LoRA/resolve/main/qwen-anime.safetensors
   ```
   - Keep the text encoder under `checkpoints/clip/`.
   - Point `extra_model_paths.yaml` at `/workspace/data` if you store the assets there.

+ SETTING UP SSH TUNNEL FROM LOCAL
   1. **Generate an SSH key (if you don’t already have one dedicated to Runpod):**
      ```bash
      ssh-keygen -t ed25519 -f ~/.ssh/runpod_ed25519 -N ""
      cat /Users/nespresso/.ssh/runpod_ed25519.pub
      ```
   2. **Upload the public key on the pod** (open the Runpod Web Terminal or any existing SSH session into the pod). Replace the placeholder with the contents of `~/.ssh/runpod_ed25519.pub`:
      ```bash
      mkdir -p ~/.ssh
      chmod 700 ~/.ssh
      cat <<'EOF' >> ~/.ssh/authorized_keys
      ssh-ed25519 AAAA...your-public-key... runpod
      EOF
      chmod 600 ~/.ssh/authorized_keys
      ```
   3. **Create the tunnel from your laptop** (forward local 18188 to pod 18188):
      ```bash
      ssh -i ~/.ssh/runpod_ed25519 \
         -L 18188:127.0.0.1:18188 \
         root@<direct-ip> -p <direct-port>
      ```
      - Replace `<direct-ip>`/`<direct-port>` with the values shown under **SSH over exposed TCP** in the Runpod UI (e.g. `38.80.152.72` and `30458`).
   4. Visit `http://localhost:18188` in your browser.

10. **Manual ComfyUI smoke test (same env the handler uses):**
   ```bash
   cd /workspace/runpod-slim/ComfyUI
   export COMFYUI_EXTRA_MODEL_PATHS=/workspace/runpod-slim/ComfyUI/extra_model_paths.yaml
   export TORCH_CUDA_ARCH_LIST="8.0;8.6;9.0;12.0"
   /usr/bin/python3 main.py --listen 0.0.0.0 --port 18188
   ```
   Optional handler dry-run:
   ```bash
   cd /workspace/rootale_img_test/blackwell
   /usr/bin/python3 handler.py
   ```
11. **Confirm the GPU + CUDA toolchain:**
    ```bash
    python -c "import torch; print(torch.__version__, torch.cuda.get_device_capability())"
    ```
    Expect `2.9.0 (12, 0)` on a healthy RTX 5090 pod.

---

## 2. Model Storage (Interactive vs. Serverless)
- **Interactive pods:** we keep checkpoints under `/workspace/data/...`.
- **Serverless workers:** RunPod mounts volumes at `/runpod-volume` (verified via `python -c "import os; print(os.listdir('/runpod-volume'))"`).
- `blackwell/extra_model_paths.yaml` ships two profiles:
  - `runpod_workspace` (default inside the container) points at `/runpod-volume` and maps:
  - `diffusion_models` / `checkpoints` → `checkpoints`
  - `clip` → `checkpoints/clip`
  - `vae` → `vae`
  - `loras` → `loras`
-  `interactive_workspace` points at `/workspace/data` so you can reproduce the same layout on an interactive pod without editing the file.
-  Export `COMFYUI_EXTRA_MODEL_PATHS=/workspace/runpod-slim/ComfyUI/extra_model_paths.yaml` plus `COMFYUI_EXTRA_MODEL_PATHS_PROFILE=interactive_workspace` before launching ComfyUI locally; omit the profile export on serverless so the handler sticks with `runpod_workspace`.
- If you override the mount point in RunPod, edit the YAML before rebuilding.

```yaml
# blackwell/extra_model_paths.yaml
runpod_workspace:
  base_path: /runpod-volume
  diffusion_models: checkpoints
  checkpoints: checkpoints
  clip: checkpoints/clip
  text_encoders: checkpoints
  vae: vae
  loras: loras

interactive_workspace:
  base_path: /workspace/data
  diffusion_models: checkpoints
  checkpoints: checkpoints
  clip: checkpoints/clip
  text_encoders: checkpoints
  vae: vae
  loras: loras
```

### 2.1 RunPod Storage (S3-compatible) Uploads
We now talk directly to RunPod’s storage buckets via the S3 API so we can ship full-resolution reference images and outputs without base64 bloat.

1. **Add the credentials to your Serverless Release** (no AWS account needed):
   ```
   RUNPOD_STORAGE_ENDPOINT=https://storage.runpod.io
   RUNPOD_STORAGE_BUCKET=<your-bucket-name>
   RUNPOD_STORAGE_ACCESS_KEY=<rp_access_key>
   RUNPOD_STORAGE_SECRET_KEY=<rp_secret_key>
   # Optional tweaks
   RUNPOD_STORAGE_PUBLIC_BASE_URL=https://storage.runpod.io/public/<bucket>   # only if bucket is public
   RUNPOD_STORAGE_OUTPUT_PREFIX=outputs
   RUNPOD_STORAGE_UPLOAD_OUTPUTS=1        # set to 0 to skip uploads
   RUNPOD_INCLUDE_OUTPUT_BASE64=1         # set to 0 to omit base64 in responses
   ```
2. **Rebuild + redeploy** (`requirements.txt` now ships `boto3`, so no Dockerfile edits are needed).
3. **New handler inputs/outputs:**
   - Send `image_object_key` (preferred) and the worker will download the object from storage before running the workflow.
   - `image_url` still works for presigned HTTPS links; base64 remains a fallback.
   - Responses now include `image_object_key` (and `image_url` when `RUNPOD_STORAGE_PUBLIC_BASE_URL` is set) so the caller can fetch the PNG directly instead of decoding base64.
4. **Front-end work:** generate presigned upload URLs (server-side) and pass the resulting object key in the RunPod payload; store/download outputs through the same bucket.

### 2.2 Bootstrapping a fresh `/runpod-volume`
Use the exact commands below any time you deploy to a brand-new serverless release or network volume. They mirror the layout baked into `extra_model_paths.yaml`.

```bash
# 1. Sanity-check the mount RunPod gave this worker
python - <<'PY'
import os
print("runpod-volume contents:", os.listdir('/runpod-volume'))
PY

# 2. Create the directory skeleton expected by the YAML
SERVERLESS_VOLUME=/runpod-volume
mkdir -p \
  "${SERVERLESS_VOLUME}/checkpoints/clip" \
  "${SERVERLESS_VOLUME}/vae" \
  "${SERVERLESS_VOLUME}/loras"

# 3. Download / copy the required weights into place
wget -O "${SERVERLESS_VOLUME}/checkpoints/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors" \
  https://huggingface.co/nunchaku-tech/nunchaku-qwen-image-edit-2509/resolve/main/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors

wget -O "${SERVERLESS_VOLUME}/checkpoints/clip/qwen_2.5_vl_7b_fp8_scaled.1.safetensors" \
  https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors

wget -O "${SERVERLESS_VOLUME}/vae/qwen_image_vae.1.safetensors" \
  https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors

wget -O "${SERVERLESS_VOLUME}/loras/Qwen-Anime-V1.safetensors" \
  https://huggingface.co/prithivMLmods/Qwen-Image-Anime-LoRA/resolve/main/qwen-anime.safetensors

# 4. (Optional) List the folders to confirm everything landed correctly
find "${SERVERLESS_VOLUME}" -maxdepth 2 -type f
```

If you already have the weights in an S3 bucket, replace the `wget` lines with your `aws s3 cp` (or equivalent) commands as long as the destination paths stay the same.

---

## 3. Serverless Image Build + Push (Exact Local Commands)
From the repo root on macOS we ran:
```bash
cd /Users/nespresso/Desktop/rootale_img_test

docker build --platform=linux/amd64 --progress=plain \
  -t ghcr.io/highshore/qwen-blackwell:latest \
  -f blackwell/Dockerfile blackwell

docker push ghcr.io/highshore/qwen-blackwell:latest

docker inspect --format='{{index .RepoDigests 0}}' \
  ghcr.io/highshore/qwen-blackwell:latest
# → ghcr.io/highshore/qwen-blackwell@sha256:e5e70a68b51684c231630eb1d69bce4c981dc0949566cc600042ebab7d65b87b
```
Deployment steps:
1. Paste the new digest into your RunPod **Serverless Release**.
2. Click **Redeploy** so idle workers pull the image.
3. Watch the RunPod worker log—RunPod prints the digest as soon as the container starts.
4. Queue a test job after the worker reports "Started." and "Jobs in queue: 1".

---

## 4. Handler Behavior (Why This Build Works)
- **CUDA gate:** `wait_for_cuda()` loops on `torch.cuda.is_available()` + `torch.cuda.current_device()` (up to 120s) so we never hit the "CUDA driver initialization failed" race again.
- **ComfyUI boot:** `_start_comfy_background_server()` calls ComfyUI’s `start_comfyui()` inside a dedicated daemon thread, preventing the "event loop already running" crash.
- **Module pinning:** `_load_comfy_utils()` force-loads `/opt/ComfyUI/app` and `/opt/ComfyUI/utils`, clears any impostor `utils` modules from `sys.modules`, and explicitly imports `utils.install_util` before the server touches it.
- **Prompt flow:** `handler()` copies the base workflow, injects request params, enqueues work via `server.prompt_queue.put`, then polls `prompt_queue.get_history()` until outputs arrive.
- **Base64 handling:** `prepare_image()` accepts bytes via `image_base64` **or** `image_name`. If `image_name` decodes as base64 (like the 1×1 PNG we used), it is auto-written to `/opt/ComfyUI/input` before the workflow runs.
- **Model paths:** `extra_model_paths.yaml` is copied into `/opt/ComfyUI/extra_model_paths.yaml` inside the image so CLI runs and serverless workers share the same lookup table.
- **Error surfacing:** If ComfyUI reports an error, we unwrap `history[prompt_id]["status"]["messages"]` and bubble the joined string back through RunPod.

---

## 5. Sample RunPod Payload (Used During Validation)
```json
{
  "input": {
    "image_name": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAn0B9lqQ+wAAAABJRU5ErkJggg==",
    "model_name": "svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors",
    "lora_name": "Qwen-Anime-V1.safetensors",
    "clip_name": "clip/qwen_2.5_vl_7b_fp8_scaled.1.safetensors",
    "vae_name": "qwen_image_vae.1.safetensors",
    "seed": 659968189596312,
    "steps": 2,
    "cfg": 1.0,
    "sampler_name": "euler",
    "scheduler": "simple",
    "denoise": 1.0,
    "shift": 3.0,
    "width": 1024,
    "height": 1024,
    "batch_size": 1,
    "cpu_offload": "disable",
    "num_blocks_on_gpu": 40,
    "use_pin_memory": "enable",
    "prompt": "aki_anime, masterpiece, ultra-detailed, cinematic wide shot, low-angle side view of a young man ...",
    "negative_prompt": "",
    "timeout": 180
  }
}
```
- Supplying the base64 PNG in `image_name` exercises the auto-write path; no file upload is required.

---

## 6. Debugging Commands (Executed Inside Failing Workers)
To prove where the volume mounted and what ComfyUI path existed we ran:
```bash
python -c "import os; print(os.listdir('/'))"
python -c "import os; print(os.listdir('/runpod-volume'))"
python -c "import os; print(os.listdir('/workspace'))"
ls /opt/ComfyUI
```
Use the same probes if you suspect RunPod changed the mount target or if `/workspace` looks empty.

---

## 7. Common Failure Modes + Fixes
| Symptom | Root cause | Resolution we shipped |
| --- | --- | --- |
| `ModuleNotFoundError: No module named 'utils.install_util'; 'utils' is not a package` | Another package slipped a flat `utils.py` onto `sys.path` before ComfyUI booted. | `_force_load_package()` + `_load_comfy_utils()` purge impostors and register `/opt/ComfyUI/utils` explicitly. |
| `RuntimeError: CUDA driver initialization failed` | RunPod sometimes attaches the GPU after Python starts. | `wait_for_cuda()` loop + `CUDA_MODULE_LOADING=LAZY` env var inside the Dockerfile. |
| `PromptServer.__init__()` missing `loop` | Upstream API change. | Use ComfyUI’s `start_comfyui()` inside a dedicated thread and reuse its loop. |
| `Cannot run the event loop while another loop is running` | We initially launched Comfy on the same loop RunPod already used. | Keep Comfy on its own background event loop. |
| `Image ... not found in /opt/ComfyUI/input` | Base64 payload was sent in `image_name`. | Auto-detect base64 strings and write them to the input directory before submitting the workflow. |
| `Model ... not found` while logs referenced `/workspace/...` | Serverless mounted the network volume at `/runpod-volume`. | Updated `extra_model_paths.yaml` to point at `/runpod-volume` and documented how to verify the mount. |
| `Workflow preparation failed: Missing nodes in workflow: background_load_image` | The baked workflow only had a single `LoadImage` node. | Re-export `nunchaku-qwen-image-edit-2509-workflow.json` after adding a second `LoadImage` for the background reference (see Section 1, step 8) before rebuilding the image. |
| Worker exits immediately with exit code 1 before any ComfyUI logs | A bad indent in `prepare_image` caused Python to raise `IndentationError` when decoding inline images. | Ensure the `elif isinstance(image_name, str):` branch wraps the `try/except` block (fixed in `sha256:0116156…`). Run `python -m py_compile handler.py` prior to building to catch regressions early. |

Other reminders:
- Rebuild custom nodes that ship CUDA extensions against PyTorch 2.9.
- Redeploy your RunPod release after every push; idle workers keep running old digests until you do.

---

## 8. Release Checklist (Local + RunPod)
1. Edit `handler.py`, `Dockerfile`, or `extra_model_paths.yaml`.
2. Re-run the local build/push sequence:
   ```bash
   cd /Users/nespresso/Desktop/rootale_img_test
   docker build --platform=linux/amd64 --progress=plain \
     -t ghcr.io/highshore/qwen-blackwell:latest \
     -f blackwell/Dockerfile blackwell
   docker push ghcr.io/highshore/qwen-blackwell:latest
   docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/highshore/qwen-blackwell:latest
   ```
3. Paste the new digest into the RunPod Serverless release and redeploy.
4. Queue the sample payload above; confirm logs show CUDA readiness, prompt queue submission, and successful history polling.
5. Once you see `Finished.` with an `image_base64` payload in the response, the build is good to go.

Following the sections above recreates the exact pipeline we used to stabilize ComfyUI on the RunPod Blackwell/5090 template for both interactive pods and serverless workers.

---

## 9. AWS Global Accelerator Front-End (KR → EU-RO)

When your GPU must remain in RunPod’s EU-RO region but your users sit in Korea/Japan, the fastest way to reduce end-to-end latency is to pull traffic onto AWS’s backbone as early as possible and forward it over a long-lived connection to the RunPod API. We measured ~7 s → ~3.5 s RTT improvements with the exact steps below.

### 9.1 Architecture overview

```
Korean user
   ↓ (HTTP)
AWS Global Accelerator (KR edge)
   ↓ (AWS backbone, TCP keep-alive)
EC2 t3.small in eu-central-1 (Frankfurt)
   ↓ (nginx proxy with TLS SNI)
Cloudflare FRA → RunPod api.runpod.ai (EU-RO serverless worker)
```

All application requests continue to use the existing RunPod JSON schema; the accelerator + proxy simply shortens the network path and keeps a pool of warm TLS connections alive.

### 9.2 Bring up the EU proxy host

1. **Launch EC2 (Ubuntu 24.04, eu-central-1):**
   - Instance type: `t3.small`.
   - Security group inbound: allow SSH (22) from your IP, HTTP (80) from 0.0.0.0/0 (ALB/GA will hit this).
   - Assign a public IP for debugging (can be dropped later).
2. **Install nginx:**
   ```bash
   sudo apt update
   sudo apt install -y nginx
   ```
3. **Create `/etc/nginx/sites-available/runpod_proxy`:**
   ```nginx
   upstream runpod_upstream {
       server api.runpod.ai:443;
       keepalive 32;
   }

   server {
       listen 80 default_server;
       server_name _;

       # Health probe for ALB/GA
       location = /health {
           return 200 'OK';
           add_header Content-Type text/plain;
       }

       location / {
           proxy_http_version 1.1;
           proxy_set_header Connection "";
           proxy_ssl_server_name on;
           proxy_ssl_name api.runpod.ai;
           proxy_set_header Host api.runpod.ai;
           proxy_set_header Authorization "Bearer <YOUR_RUNPOD_API_KEY>";
           proxy_set_header Content-Type "application/json";
           proxy_pass https://runpod_upstream$request_uri;
       }
   }
   ```
4. **Enable the site and reload nginx:**
   ```bash
   sudo ln -sf /etc/nginx/sites-available/runpod_proxy /etc/nginx/sites-enabled/runpod_proxy
   sudo nginx -t
   sudo systemctl reload nginx
   ```
5. **Smoke test from the EC2 VM:**
   ```bash
   curl -i http://localhost/health
   curl -i http://localhost/v2/<endpointId>/run -d '{"input":{"prompt":"hello"}}' -H 'Content-Type: application/json'
   ```
   - Do **not** send an `Authorization` header here; nginx injects it.

### 9.3 Attach Global Accelerator

1. Go to **AWS → Global Accelerator → Create accelerator**.
2. Listener: protocol `TCP`, port `80`.
3. Endpoint group: region `eu-central-1`.
4. Endpoint: choose the EC2 instance created above.
5. Wait for the accelerator to show `Healthy`. You will receive:
   - Two static Anycast IPs.
   - A DNS name, e.g. `a2ccc7a37a37df10c.awsglobalaccelerator.com`.

### 9.4 Client-facing endpoint rules

* **Use HTTP only**: `http://a2ccc7a37a37df10c.awsglobalaccelerator.com`.
* **The only valid RunPod path** is `/v2/<endpointId>/run`.
* `/health` returns the EC2 proxy health (used by GA/ALB).
* All other paths return `404` (forwarded to RunPod, which exposes no root routes).
* **No Authorization header from clients**; nginx already sets it. Sending your own header can cause Cloudflare/RunPod to reject the request as malformed.
* JSON payload is identical to the standard RunPod serverless schema. Example:
  ```bash
  curl -v -X POST \
    http://a2ccc7a37a37df10c.awsglobalaccelerator.com/v2/ul5kke5ddlrzhi/run \
    -H "Content-Type: application/json" \
    -d '{"input":{"prompt":"via GA","width":768,"height":768,...}}'
  ```

### 9.5 Direct vs accelerator benchmark

Create a `curl-format.txt` helper:
```bash
cat > curl-format.txt <<'EOF'
time_namelookup:  %{time_namelookup}\n
time_connect:     %{time_connect}\n
time_appconnect:  %{time_appconnect}\n
time_starttransfer:%{time_starttransfer}\n
time_total:       %{time_total}\n
EOF
```

Run both paths:
```bash
# Accelerator (HTTP)
curl -w "@curl-format.txt" -o /dev/null -s \
  -X POST http://a2ccc7a37a37df10c.awsglobalaccelerator.com/v2/ul5kke5ddlrzhi/run \
  -H "Content-Type: application/json" \
  -d '{"input":{"prompt":"via GA"}}'

# Direct RunPod (HTTPS)
curl -w "@curl-format.txt" -o /dev/null -s \
  -X POST https://api.runpod.ai/v2/ul5kke5ddlrzhi/run \
  -H "Authorization: Bearer <YOUR_RUNPOD_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"input":{"prompt":"direct"}}'
```

Expected results (Korea → EU-RO):

| Path | RTT | Notes |
| --- | --- | --- |
| Accelerator | ~3.0–3.5 s | AWS edge + backbone + keep-alive |
| Direct RunPod | ~6.0–7.0 s | Public internet + fresh TLS |

### 9.6 Operational notes

- Keep at least one RunPod worker warm (min workers = 1, long idle timeout) to avoid serverless cold starts; otherwise GA still helps but you’ll pay initialization cost.
- Restrict the EC2 security group once GA is live (allow HTTP only from the GA health-check CIDRs or via an ALB in front if you prefer).
- If you need HTTPS between clients and GA, terminate TLS at a Network/ALB or add an ACM certificate + HTTPS listener on GA, then forward decrypted HTTP to nginx.
- The proxy inserts the RunPod API key; rotate it by editing the nginx config and reloading.

With this setup your Korean users enter AWS in Seoul/Tokyo, ride the private backbone to Frankfurt, hit nginx (which keeps an always-on TLS pool to `api.runpod.ai`), and avoid the repeated handshakes and packet loss that previously doubled the turnaround time.
