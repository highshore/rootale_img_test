# Qwen Image Edit Runpod Notes

## Current Status
- ComfyUI workflow `nunchaku-qwen-image-edit-2509-workflow.json` is patched at runtime by `handler.py`.
- All model assets live on the mounted Runpod volume (`/workspace`).
- `extra_model_paths.yaml` now exposes the volume paths (including `diffusion_models`) so loaders can see the weights.
- `nunchaku_versions.json` is generated via `python scripts/update_versions.py` inside the virtualenv.

## Pod Bring-Up (Verified Sequence)
```bash
cd /workspace
git clone https://github.com/<your-org>/rootale_img_test.git
python3 -m venv rootale_img_test/.venv
source rootale_img_test/.venv/bin/activate

git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
pip install --no-cache-dir -r requirements.txt

pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cu118
pip install --no-cache-dir torchvision==0.20.1+cu118 --index-url https://download.pytorch.org/whl/cu118
pip install --no-cache-dir torchaudio==2.5.1
pip install --no-cache-dir --no-binary insightface insightface==0.7.3
pip install --no-cache-dir --no-deps git+https://github.com/nunchaku-tech/ComfyUI-nunchaku.git@v1.0.2
pip install --no-cache-dir runpod==1.7.13
```

Clone custom nodes directly:
```bash
git clone https://github.com/ussoewwin/ComfyUI-QwenImageLoraLoader.git \
    /workspace/ComfyUI/custom_nodes/ComfyUI-QwenImageLoraLoader
```

Generate Nunchaku manifest:
```bash
cd /workspace/ComfyUI/custom_nodes/ComfyUI-nunchaku
source /workspace/rootale_img_test/.venv/bin/activate
python scripts/update_versions.py
deactivate
```

## Model Assets (Run on the Pod)
```bash
mkdir -p /workspace/checkpoints /workspace/loras /workspace/vae /ComfyUI/input /ComfyUI/output

cd /workspace/checkpoints
wget -O svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors \
  https://huggingface.co/nunchaku-tech/nunchaku-qwen-image-edit-2509/resolve/main/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors
wget -O qwen_2.5_vl_7b_fp8_scaled.1.safetensors \
  https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors

cd /workspace/loras
wget -O Qwen-Anime-V1.safetensors \
  https://huggingface.co/prithivMLmods/Qwen-Image-Anime-LoRA/resolve/main/qwen-anime.safetensors

cd /workspace/vae
wget -O qwen_image_vae.1.safetensors \
  https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors
```

## ComfyUI Path Override
`/workspace/ComfyUI/extra_model_paths.yaml`:
```yaml
runpod_workspace:
  base_path: /workspace
  diffusion_models: checkpoints
  checkpoints: checkpoints
  clip: checkpoints
  text_encoders: checkpoints
  vae: vae
  loras: loras
```

Before launching ComfyUI in any shell:
```bash
source /workspace/rootale_img_test/.venv/bin/activate
export COMFYUI_EXTRA_MODEL_PATHS=/workspace/ComfyUI/extra_model_paths.yaml
```

Optional verification:
```bash
python - <<'PY'
import sys
sys.path.append("/workspace/ComfyUI")
from utils import extra_config
import folder_paths
extra_config.load_extra_path_config("/workspace/ComfyUI/extra_model_paths.yaml")
for key in ("diffusion_models", "clip", "text_encoders", "vae", "loras"):
    files = folder_paths.get_filename_list(key)
    print(f"{key}: {len(files)}")
    for name in files:
        print("  ", name)
PY
```

Launch ComfyUI:
```bash
python main.py --listen 0.0.0.0 --port 18188
```

## Docker Build
Once the host environment is happy:
```bash
cd /workspace/rootale_img_test
docker build -t qwen-image-serverless:latest .
```

Push to registry (GHCR/ECR/etc.) before wiring into Runpod serverless.

## Known Issue: RTX 5090 / sm_120
- PyTorch 2.5.1+cu118 does not ship kernels for the RTX 5090 (sm_120).  
- Any node that relies on CUDA kernels compiled for the VAE (e.g. `TextEncodeQwenImageEditPlus`) will throw `CUDA error: no kernel image is available...`.

### Workarounds
1. **Use a supported GPU** (e.g. RTX 4090, A100, H100) until PyTorch publishes wheels with `sm_120` support.
2. **Or install a nightly / custom PyTorch build** that includes sm_120 kernels, then rebuild/install the matching `nunchaku` wheel. This currently requires manual compilation and isn’t recommended for production yet.
3. **Temporary fallback:** run VAE encode/decode on CPU by editing the workflow (set the VAE device inputs to `cpu`). This avoids the unsupported kernel but increases latency significantly.

We should switch back to a GPU with official support (or wait for an updated PyTorch release) before finalizing the serverless image.

