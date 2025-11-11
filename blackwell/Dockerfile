# Use a RunPod base image with CUDA 12.8 (compatible with RTX 5090 runtime) and Torch 2.8
FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2204

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    TORCH_CUDA_ARCH_LIST="8.0;8.6;9.0;12.0" \
    COMFYUI_ROOT=/opt/ComfyUI

# System dependencies required by OpenCV/InsightFace
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Fetch ComfyUI and required custom nodes
WORKDIR /opt
RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "${COMFYUI_ROOT}"

WORKDIR ${COMFYUI_ROOT}
RUN mkdir -p custom_nodes && \
    git clone --depth 1 --branch v1.0.2 https://github.com/nunchaku-tech/ComfyUI-nunchaku.git custom_nodes/ComfyUI-nunchaku && \
    git clone --depth 1 https://github.com/ussoewwin/ComfyUI-QwenImageLoraLoader.git custom_nodes/ComfyUI-QwenImageLoraLoader

# Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir \
      torch==2.9.0+cu128 \
      torchvision==0.24.0+cu128 \
      torchaudio==2.9.0+cu128 \
      --index-url https://download.pytorch.org/whl/cu128
COPY ./requirements.txt /tmp/runtime-requirements.txt
RUN pip install --no-cache-dir -r /tmp/runtime-requirements.txt
RUN python3 -m pip install --no-cache-dir runpod==1.7.13
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir \
        torchsde==0.2.6 \
        diffusers==0.35.2 \
        opencv-python==4.10.0.84 \
        gitpython==3.1.43 \
        accelerate==1.11.0 \
        peft==0.17.1 \
        toml==0.10.2 \
        insightface==0.7.3

# Install the Torch 2.9-compatible Nunchaku core wheel
RUN pip install --no-cache-dir \
      https://github.com/nunchaku-tech/nunchaku/releases/download/v1.0.2/nunchaku-1.0.2+torch2.9-cp312-cp312-linux_x86_64.whl

# Sync node metadata with upstream registry
RUN python custom_nodes/ComfyUI-nunchaku/scripts/update_versions.py

# Prepare runtime directories
RUN mkdir -p input output serverless workflows

# Copy workflow, handler, and extra paths
COPY ./nunchaku-qwen-image-edit-2509-workflow.json ${COMFYUI_ROOT}/workflows/nunchaku-qwen-image-edit-2509-workflow.json
COPY ./extra_model_paths.yaml ${COMFYUI_ROOT}/extra_model_paths.yaml
COPY ./handler.py /handler.py

# Ensure python3/pip3 resolve to the Python 3.12 runtime we install packages into
RUN ln -sf /usr/local/bin/python /usr/bin/python3 && \
    ln -sf /usr/local/bin/pip /usr/bin/pip3

ENV CUDA_MODULE_LOADING=LAZY \
    PYTHONPATH=${COMFYUI_ROOT}/app:${COMFYUI_ROOT}:${PYTHONPATH:-} \
    COMFYUI_EXTRA_MODEL_PATHS=${COMFYUI_ROOT}/extra_model_paths.yaml \
    COMFYUI_INPUT_PATH=${COMFYUI_ROOT}/input \
    COMFYUI_OUTPUT_PATH=${COMFYUI_ROOT}/output

CMD ["python", "-u", "/handler.py"]