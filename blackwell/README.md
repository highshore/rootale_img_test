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
   # /usr/bin/python3 -m pip install torchaudio==2.9.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128
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
8. **Download the FP4 / FP8 / VAE / LoRA weights expected by the workflow:**
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

9. **Manual ComfyUI smoke test (same env the handler uses):**
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
10. **Confirm the GPU + CUDA toolchain:**
    ```bash
    python -c "import torch; print(torch.__version__, torch.cuda.get_device_capability())"
    ```
    Expect `2.9.0 (12, 0)` on a healthy RTX 5090 pod.

---

## 2. Model Storage (Interactive vs. Serverless)
- **Interactive pods:** we keep checkpoints under `/workspace/data/...`.
- **Serverless workers:** RunPod mounts volumes at `/runpod-volume` (verified via `python -c "import os; print(os.listdir('/runpod-volume'))"`).
- `blackwell/extra_model_paths.yaml` is already configured with `base_path: /runpod-volume` and maps:
  - `diffusion_models` / `checkpoints` → `checkpoints`
  - `clip` → `checkpoints/clip`
  - `vae` → `vae`
  - `loras` → `loras`
- If you override the mount point in RunPod, edit the YAML before rebuilding.

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
# → ghcr.io/highshore/qwen-blackwell@sha256:... (use this digest in RunPod)
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
