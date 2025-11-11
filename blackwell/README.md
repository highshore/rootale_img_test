# CUDA 12.4 / SM 120 Variant (RunPod 5090 Template)

This folder documents how to pair our workflow with RunPod’s **ComfyUI – 5090 Blackwell** template. The template already bundles Python 3.11, Tenofas’s PyTorch 2.9.0 build, CUDA 12.4, and Blackwell-ready drivers, so most of the manual setup from the CUDA 11.8 guide is unnecessary. [Template reference ➜](https://console.runpod.io/hub/template/comfyui-5090-blackwell?id=2lv7ev3wfp)

## Quick Start (Interactive Pod)
1. **Launch the template pod.** Choose the “ComfyUI – 5090 Blackwell” template when provisioning your RunPod instance. The template mounts everything under `/workspace/runpod-slim` (ComfyUI lives in `/workspace/runpod-slim/ComfyUI`).
2. **Use the provided Python.** Recent template builds expose Tenofas Python 3.12 system-wide at `/usr/bin/python3`; you can run all commands directly with it.  
   _Optional:_ If you prefer isolation, create a local virtualenv before installing extras:
   ```bash
   python3 -m venv /workspace/runpod-slim/.venv
   source /workspace/runpod-slim/.venv/bin/activate
   pip install --upgrade pip
   pip install -r /workspace/runpod-slim/ComfyUI/requirements.txt
   ```
3. **Clone this repo into the pod.**
   ```bash
   cd /workspace
   git clone https://github.com/highshore/rootale_img_test.git
   ```
4. **Copy the SM 120 assets into ComfyUI.** Run these commands from the pod (inside or outside a virtualenv):
   ```bash
   cd /workspace
   REPO_ROOT=/workspace/rootale_img_test  # adjust if you cloned elsewhere (e.g. /workspace/runpod-slim/rootale_img_test)
   COMFY_ROOT=/workspace/runpod-slim/ComfyUI

   mkdir -p "${COMFY_ROOT}/serverless" "${COMFY_ROOT}/workflows"
   cp "${REPO_ROOT}/blackwell/handler.py" "${COMFY_ROOT}/serverless/handler.py"
   cp "${REPO_ROOT}/blackwell/nunchaku-qwen-image-edit-2509-workflow.json" "${COMFY_ROOT}/workflows/"
   cp "${REPO_ROOT}/blackwell/extra_model_paths.yaml" "${COMFY_ROOT}/extra_model_paths.yaml"
   ```
   Update `extra_model_paths.yaml` if your checkpoints live outside `/workspace/runpod-slim`.
5. **Add model weights.** Populate the template’s shared storage (`/workspace/data`) or adjust the YAML paths:
   ```bash
   mkdir -p /workspace/data/{checkpoints,loras,vae}
   # Example: copy or download weights
   # cp /path/to/svdq-int4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors /workspace/data/checkpoints/
   # wget -O /workspace/data/loras/Qwen-Anime-V1.safetensors <LoRA_URL>
   ```
6. **Start ComfyUI or the serverless handler.** Use the template’s helper script or launch manually:
   ```bash
   # Interactive UI (uses template defaults)
   /workspace/runpod-slim/start.sh

   # Or manual launch
   cd /workspace/runpod-slim/ComfyUI
   python main.py --listen 0.0.0.0 --port 18188

   # Serverless handler dry run (optional)
   cd /workspace/rootale_img_test/blackwell
   python handler.py  # requires COMFYUI paths to exist
   ```

## Running ComfyUI on the Template
- Prefer the helper scripts bundled with the template (`start.sh`, `update.sh`, etc.) in `/workspace/runpod-slim` so the right environment variables (`TORCH_CUDA_ARCH_LIST`, `COMFYUI_EXTRA_MODEL_PATHS`, `PYTORCH_CUDA_ALLOC_CONF`) stay aligned with the Tenofas stack.
- If you need to launch manually, ensure you export the same environment values before invoking `python main.py`.
- Verify the GPU capability with:
  ```bash
  python -c "import torch; print(torch.__version__, torch.cuda.get_device_capability())"
  ```
  A healthy 5090 pod should report `2.9.0` and `(12, 0)`.

## Integrating the Serverless Handler
- To experiment locally inside the template pod, run the handler in-process with RunPod’s CLI or via `python handler.py` using whichever environment you chose (system Python or a local venv).
- For production serverless deployments, keep using the Dockerfile in this directory. It mirrors the template’s Python 3.11 / CUDA 12.4 / PyTorch 2.9.0 stack so workers match your validation environment.

## Additional Tips
- Reinstall third-party custom nodes that ship CUDA extensions so they rebuild against PyTorch 2.9.0 and SM 120.
- Monitor GPU memory: the template sets generous defaults but you can still enable `cpu_offload` via `handler.py` inputs if needed.
- If you maintain both the baseline and Blackwell variants, document deltas in the repo root `README.md` so teammates know which instructions to follow.

Production pods should match the template driver/runtime combo you validated against to avoid kernel mismatch regressions.*** End Patch

