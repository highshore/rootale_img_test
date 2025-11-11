# CUDA 12.4 / SM 120 Variant (RunPod 5090 Template)

This folder documents how to pair our workflow with RunPod’s **ComfyUI – 5090 Blackwell** template. The template already bundles Python 3.11, Tenofas’s PyTorch 2.9.0 build, CUDA 12.4, and Blackwell-ready drivers, so most of the manual setup from the CUDA 11.8 guide is unnecessary. [Template reference ➜](https://console.runpod.io/hub/template/comfyui-5090-blackwell?id=2lv7ev3wfp)

## Quick Start (Interactive Pod)
1. **Launch the template pod.** Choose the “ComfyUI – 5090 Blackwell” template when provisioning your RunPod instance. The template mounts everything under `/workspace/runpod-slim` (ComfyUI lives in `/workspace/runpod-slim/ComfyUI`).
2. **Install ComfyUI dependencies with the system Python.** The template ships a lean Tenofas Python 3.12. Install the base requirements once per pod:
   ```bash
   cd /workspace/runpod-slim/ComfyUI
   /usr/bin/python3 -m pip install --upgrade pip
   /usr/bin/python3 -m pip install -r requirements.txt
   ```
   _Optional:_ If you prefer isolation, create and use a virtualenv before running the commands above:
   ```bash
   python3 -m venv /workspace/runpod-slim/.venv
   source /workspace/runpod-slim/.venv/bin/activate
   pip install --upgrade pip
   pip install -r /workspace/runpod-slim/ComfyUI/requirements.txt
   ```
3. **Install workflow extras (torchsde, diffusers, OpenCV, GitPython).** These satisfy custom samplers and ComfyUI Manager expectations:
   ```bash
   /usr/bin/python3 -m pip install \
     torchsde==0.2.6 \
     diffusers==0.35.2 \
     opencv-python==4.10.0.84 \
     gitpython==3.1.43
   # Optional (audio nodes):
   # /usr/bin/python3 -m pip install torchaudio==2.9.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128
   ```
4. **Install the Nunchaku core wheel.** This registers the `nunchaku` Python package required by the custom nodes. Use the Torch 2.9 build (v1.0.2 or newer) so the compiled extensions match the template:
   ```bash
   /usr/bin/python3 -m pip install \
     https://github.com/nunchaku-tech/nunchaku/releases/download/v1.0.2/nunchaku-1.0.2+torch2.9-cp312-cp312-linux_x86_64.whl
   ```
   > If a newer Torch 2.9+ build ships, swap the URL above for the matching wheel.
5. **Install Nunchaku + Qwen custom nodes.**
   ```bash
   cd /workspace/runpod-slim/ComfyUI/custom_nodes
   git clone --depth 1 --branch v1.0.2 https://github.com/nunchaku-tech/ComfyUI-nunchaku.git
   git clone --depth 1 https://github.com/ussoewwin/ComfyUI-QwenImageLoraLoader.git
   /usr/bin/python3 /workspace/runpod-slim/ComfyUI/custom_nodes/ComfyUI-nunchaku/scripts/update_versions.py
   ```
6. **Clone this repo into the pod.**
   ```bash
   cd /workspace
   git clone https://github.com/highshore/rootale_img_test.git
   ```
7. **Copy the SM 120 assets into ComfyUI.** Run these commands from the pod (inside or outside a virtualenv):
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
8. **Add model weights.** Populate the template’s shared storage (`/workspace/data`) or adjust the YAML paths. Blackwell/5090 GPUs require the FP4 checkpoint—older INT4 bundles will refuse to load.
   ```bash
   mkdir -p /workspace/data/checkpoints/clip /workspace/data/{loras,vae}
   # Required files (links as of 2025‑11‑11)
   wget -O /workspace/data/checkpoints/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors \
     https://huggingface.co/nunchaku-tech/nunchaku-qwen-image-edit-2509/resolve/main/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors
   wget -O /workspace/data/checkpoints/clip/qwen_2.5_vl_7b_fp8_scaled.1.safetensors \
     https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors
   wget -O /workspace/data/vae/qwen_image_vae.1.safetensors \
     https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors
   wget -O /workspace/data/loras/Qwen-Anime-V1.safetensors \
     https://huggingface.co/prithivMLmods/Qwen-Image-Anime-LoRA/resolve/main/qwen-anime.safetensors
   ```
   Place the text encoder under a `clip/` subdirectory so CLIP loaders and the DiT loader surface distinct options.
   Update `/workspace/runpod-slim/ComfyUI/extra_model_paths.yaml` to point at these folders (see the template provided in this directory which maps `clip` → `checkpoints/clip`).
9. **Start ComfyUI or the serverless handler.** Launch manually (many template builds do not ship `start.sh`):
   ```bash
   cd /workspace/runpod-slim/ComfyUI
   export COMFYUI_EXTRA_MODEL_PATHS=/workspace/runpod-slim/ComfyUI/extra_model_paths.yaml
   export TORCH_CUDA_ARCH_LIST="8.0;8.6;9.0;12.0"
   /usr/bin/python3 main.py --listen 0.0.0.0 --port 18188

   # Serverless handler dry run (optional)
   cd /workspace/rootale_img_test/blackwell
   /usr/bin/python3 handler.py  # requires COMFYUI paths to exist
   ```

## Running ComfyUI on the Template
- Some template revisions ship helper scripts (`start.sh`, `update.sh`, etc.) under `/workspace/runpod-slim`. Use them if present; otherwise follow step 8 to launch manually with the correct environment variables.
- When launching manually, always export `COMFYUI_EXTRA_MODEL_PATHS` (and optionally `TORCH_CUDA_ARCH_LIST`) before invoking `python main.py`.
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
- If you see `Cannot execute because a node is missing the class_type property`, make sure step 4 completed—the Nunchaku/Qwen custom nodes must be present under `custom_nodes/`.
- Monitor GPU memory: the template sets generous defaults but you can still enable `cpu_offload` via `handler.py` inputs if needed.
- ComfyUI Manager needs the `toml` package; install it with `/usr/bin/python3 -m pip install toml` if you keep that node enabled.
- PuLID nodes from Nunchaku are optional; skip their warnings unless you need them, or install `insightface` when you do.
- If you maintain both the baseline and Blackwell variants, document deltas in the repo root `README.md` so teammates know which instructions to follow.

## Troubleshooting Notes
- **Prompt fails with “Value not in list … svdq-int4 …”** → select the FP4 checkpoint (`svdq-fp4_r128-…`) inside `NunchakuQwenImageDiTLoader`.
- **“Please use fp4 quantization for Blackwell GPUs.”** → replace any INT4 checkpoints with the FP4 build and reopen the workflow so it rebinds.
- **`'NoneType' object has no attribute 'get'` in `NunchakuQwenImageDiTLoader`.** → the node is pointing at the text encoder; pick the FP4 DiT checkpoint instead.
- **ComfyUI Manager startup warnings about `pip`/`uv` or `toml`.** → install `toml`; pip/uv warnings are cosmetic if you’re not using package operations.

Production pods should match the template driver/runtime combo you validated against to avoid kernel mismatch regressions.*** End Patch

