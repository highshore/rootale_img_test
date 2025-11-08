# Qwen Image Runpod Endpoint

This workspace packages the `nunchaku-qwen-image-edit-2509-workflow.json` graph for a Runpod serverless endpoint. The ComfyUI server runs headlessly and `handler.py` patches inputs at runtime.

## Prerequisites

- Linux box with NVIDIA GPU (24 GB VRAM recommended).
- Python 3.10–3.13 (ComfyUI-Nunchaku does **not** support 3.14 yet).
- Docker 24+ if you plan to build the container locally.

## Local Python Setup

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip

# PyTorch ≥ 2.5 is required before installing Nunchaku wheels.
pip install torch==2.5.1 torchvision==0.16.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu118

# Worker runtime dependencies
pip install -r requirements.txt

# Install the Nunchaku backend wheel that matches your torch/python build
pip install https://github.com/nunchaku-tech/nunchaku/releases/download/v0.3.1/nunchaku-0.3.1+torch2.5-cp310-cp310-linux_x86_64.whl

# Install the ComfyUI custom nodes
pip install comfyui-nunchaku==1.0.2
pip install git+https://github.com/ussoewwin/ComfyUI-QwenImageLoraLoader.git
```

> Nunchaku wheels are only published for Linux + NVIDIA GPUs. Use a Linux GPU host (Runpod pod, EC2, etc.) for dependency installation.

## Runpod Pod Bring-Up

1. Launch an RTX 5090 (or similar) template with the `runpod/ai-api:comfy-ui` image.
2. Mount your persistent volume at `/workspace` for model assets (`checkpoints`, `loras`, `vae`).
3. SSH or use WebTerminal, then execute:

```bash
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
pip install --no-cache-dir -r requirements.txt
```

4. Copy this repository into the pod and run:

```bash
pip install --no-cache-dir torch==2.5.1 torchvision==0.16.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu118
pip install --no-cache-dir -r /workspace/rootale_img_test/requirements.txt
pip install --no-cache-dir https://github.com/nunchaku-tech/nunchaku/releases/download/v0.3.1/nunchaku-0.3.1+torch2.5-cp310-cp310-linux_x86_64.whl
pip install --no-cache-dir comfyui-nunchaku==1.0.2
pip install --no-cache-dir git+https://github.com/ussoewwin/ComfyUI-QwenImageLoraLoader.git
```

5. Place models under `/workspace`:

```bash
mkdir -p /workspace/checkpoints /workspace/loras /workspace/vae /ComfyUI/input /ComfyUI/output
```

Copy your assets into the matching folders (`/workspace/checkpoints/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors`, `/workspace/vae/qwen_image_vae.1.safetensors`, `/workspace/loras/Qwen-Anime-V1.safetensors`, etc.).

## Docker Build (Serverless)

```bash
docker build -t qwen-image-serverless:latest .
```

The Dockerfile:

- Starts from `runpod/pytorch:2.1.0`.
- Installs ComfyUI and the frozen workflow.
- Adds Nunchaku loaders and the Runpod worker SDK.
- Starts the Runpod server (`python -m runpod.server`) which invokes `handler.py`.

## Handler Contract

Send a `POST` payload (Runpod-compatible JSON):

```json
{
  "input": {
    "prompt": "aki_anime, cinematic...",
    "negative_prompt": "",
    "image_base64": "<PNG bytes>",
    "seed": 659968189596312,
    "steps": 2,
    "cfg": 1.0,
    "model_name": "svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors",
    "vae_name": "qwen_image_vae.1.safetensors",
    "clip_name": "qwen_2.5_vl_7b_fp8_scaled.1.safetensors",
    "lora_name": "Qwen-Anime-V1.safetensors",
    "lora_strength": 1.0,
    "filename_prefix": "yc_founder"
  }
}
```

Response:

```json
{
  "image_base64": "..."  // PNG image
}
```

## Model Storage

Edit `extra_model_paths.yaml` to align with your Runpod volume layout. By default it expects:

- `/workspace/checkpoints`
- `/workspace/loras`
- `/workspace/vae`

Mount those into the container when deploying the serverless endpoint.

## Deployment Checklist

- [ ] Upload image to GHCR/ECR.
- [ ] Create Runpod serverless endpoint → GPU: RTX 5090, Idle Timeout: 10 min.
- [ ] Set env vars:
  - `COMFYUI_EXTRA_MODEL_PATHS=/ComfyUI/extra_model_paths.yaml`
  - `PYTHONPATH=/ComfyUI`
- [ ] Attach shared volume containing model assets.
- [ ] Smoke test with sample payload above.
- [ ] Monitor VRAM (`nvidia-smi`) and latency; tune `shift`, `cfg`, or steps for budget.

## Troubleshooting

- **Missing custom nodes** – confirm `pip show comfyui-nunchaku ComfyUI-QwenImageLoraLoader`.
- **onnxruntime wheel not found** – verify the selected Nunchaku wheel matches your Python and torch versions.
- **Missing models** – check volume mappings and `extra_model_paths.yaml` entries.
- **High latency** – enable CPU offload (`"cpu_offload": "enable", "num_blocks_on_gpu": 1`) or provision larger VRAM.

