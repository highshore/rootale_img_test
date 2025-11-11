# Use a RunPod base image with PyTorch/CUDA
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

# Set up environment
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git \
    wget \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Clone ComfyUI
WORKDIR /
RUN git clone https://github.com/comfyanonymous/ComfyUI.git

WORKDIR /ComfyUI
RUN mkdir -p custom_nodes && \
    git clone --depth 1 --branch v1.0.2 https://github.com/nunchaku-tech/ComfyUI-nunchaku.git custom_nodes/ComfyUI-nunchaku && \
    git clone --depth 1 https://github.com/ussoewwin/ComfyUI-QwenImageLoraLoader.git custom_nodes/ComfyUI-QwenImageLoraLoader

# Install ComfyUI dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch==2.5.1 torchvision==0.20.1+cu118 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu118 && \
    pip install --no-cache-dir -r requirements.txt

# Install runtime dependencies (RunPod SDK, Nunchaku DiT loader, LoRA loader)
COPY ./requirements.txt /tmp/runtime-requirements.txt
RUN pip install --no-cache-dir -r /tmp/runtime-requirements.txt && \
    pip install --no-cache-dir \
        accelerate==1.10.0 \
        diffusers==0.35.2 \
        facexlib==0.3.0 \
        onnxruntime==1.19.2 \
        opencv-python==4.12.0.88 \
        peft==0.17.1 \
        timm==1.0.22 && \
    pip install --no-cache-dir --no-deps git+https://github.com/nunchaku-tech/ComfyUI-nunchaku.git@v1.0.2 && \
    pip install --no-cache-dir https://github.com/nunchaku-tech/nunchaku/releases/download/v1.0.0/nunchaku-1.0.0+torch2.5-cp310-cp310-linux_x86_64.whl

RUN cd custom_nodes/ComfyUI-nunchaku && python scripts/update_versions.py

# --- No custom nodes needed for this simple test ---

# Copy your API workflow and handler script
COPY ./nunchaku-qwen-image-edit-2509-workflow.json /ComfyUI/nunchaku-qwen-image-edit-2509-workflow.json
COPY ./handler.py /handler.py

# ADD THIS NEW LINE
COPY ./extra_model_paths.yaml /ComfyUI/extra_model_paths.yaml

# Set the entrypoint for the RunPod server
CMD ["python3", "-u", "/handler.py"]