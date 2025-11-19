# Qwen Image Edit Runpod Notes

## Current Status
- ComfyUI workflow `nunchaku-qwen-image-edit-2509-workflow.json` is patched at runtime by `handler.py`.
- All model assets live on the mounted Runpod volume (`/workspace`).
- `extra_model_paths.yaml` now exposes the volume paths (including `diffusion_models`) so loaders can see the weights.
- `nunchaku_versions.json` is generated via `python scripts/update_versions.py` inside the virtualenv.

## Pod Bring-Up (Verified Sequence)
```bash
cd /workspace
git clone https://github.com/highshore/rootale_img_test.git
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

# satisfy comfyui-nunchaku runtime deps (installed separately because of --no-deps above)
pip install --no-cache-dir \
  accelerate==1.10.0 \
  diffusers==0.35.2 \
  facexlib==0.3.0 \
  onnxruntime==1.19.2 \
  opencv-python==4.12.0.88 \
  peft==0.17.1 \
  timm==1.0.22
```

Clone custom nodes directly:
```bash
git clone https://github.com/ussoewwin/ComfyUI-QwenImageLoraLoader.git \
    /workspace/ComfyUI/custom_nodes/ComfyUI-QwenImageLoraLoader
```

Generate Nunchaku manifest:
```bash
# If you cloned the custom node
cd /workspace/ComfyUI/custom_nodes/ComfyUI-nunchaku
source /workspace/rootale_img_test/.venv/bin/activate
python scripts/update_versions.py
deactivate

# Or, from the pip package (no git clone needed)
source /workspace/rootale_img_test/.venv/bin/activate
python -m comfyui_nunchaku.scripts.update_versions
deactivate
```

## Model Assets (Run on the Pod)
```bash
mkdir -p /workspace/checkpoints /workspace/loras /workspace/vae /ComfyUI/input /ComfyUI/output

cd /workspace/checkpoints
wget -O svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors \
  https://huggingface.co/nunchaku-tech/nunchaku-qwen-image-edit-2509/resolve/main/svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors
wget -O svdq-int4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors \
  https://huggingface.co/nunchaku-tech/nunchaku-qwen-image-edit-2509/resolve/main/svdq-int4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors
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

Launch ComfyUI (custom port 18188 to avoid the default service):
```bash
cd /workspace/ComfyUI
python main.py --listen 0.0.0.0 --port 18188
```

## Accessing the ComfyUI Frontend
### Option 1 – Runpod HTTP Service (no tunnelling)
1. Start ComfyUI with `--port 18188`.
2. In the Runpod dashboard, add an HTTP service for port `18188` (custom port).
3. Open the generated proxied URL (e.g. `https://<pod-id>-18188.proxy.runpod.net`).

### Option 2 – SSH Tunnel from your laptop
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

> Tip: add `-f -N` to the SSH command if you want the tunnel to run in the background.

## Docker Build
Once the host environment is happy:
```bash
cd /workspace/rootale_img_test
docker build -t qwen-image-serverless:latest .
```

Push to registry (GHCR/ECR/etc.) before wiring into Runpod serverless.

## Runpod Serverless Deployment
- Publish the image (e.g. `ghcr.io/highshore/qwen-image-serverless:latest`) or attach GHCR credentials in the endpoint so Runpod can pull it.
- When mounting your Runpod network volume, map it to `/workspace`. The container expects checkpoints under `/workspace/checkpoints`, LoRAs under `/workspace/loras`, etc.
- Set an environment variable `COMFYUI_EXTRA_MODEL_PATHS=/ComfyUI/extra_model_paths.yaml`. The Docker image ships this file and it forwards ComfyUI to the mounted volume.
- After an update, wait for every worker to pick up the new release or trigger a restart from the endpoint dashboard.

## Known Issue: RTX 5090 / sm_120
- PyTorch 2.5.1+cu118 does not ship kernels for the RTX 5090 (sm_120).  
- Any node that relies on CUDA kernels compiled for the VAE (e.g. `TextEncodeQwenImageEditPlus`) will throw `CUDA error: no kernel image is available...`.

### Workaround During Validation
- For Turing/Ampere/Ada GPUs (e.g. RTX 3090/4090) select the `svdq-int4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors` checkpoint in the workflow instead of the fp4 build.
- Install the matching Nunchaku wheel for Python 3.12 + torch 2.5:
  ```bash
  pip install --no-cache-dir \
    https://huggingface.co/nunchaku-tech/nunchaku/resolve/main/nunchaku-1.0.0+torch2.5-cp312-cp312-linux_x86_64.whl
  ```
- Stub optional audio nodes (torchaudio is not supported on sm_120):
  ```bash
  cd /workspace/ComfyUI/comfy_extras
  printf 'NODE_CLASS_MAPPINGS = {}\nNODE_DISPLAY_NAME_MAPPINGS = {}\n' > nodes_audio.py
  printf 'NODE_CLASS_MAPPINGS = {}\nNODE_DISPLAY_NAME_MAPPINGS = {}\n' > nodes_audio_encoder.py
  ```
- Run the VAE encode/decode nodes on CPU (set their device inputs to `cpu`) when testing on RTX 5090. It is slower, but keeps the workflow functional until PyTorch releases sm_120-compatible wheels.

### Notes
- Run the VAE encode/decode nodes on CPU (set their device inputs to `cpu`) when testing on RTX 5090. It is slower, but keeps the workflow functional until PyTorch releases sm_120-compatible wheels.

Production builds should still target GPUs with official support, or wait for newer PyTorch releases with the necessary kernels.

