# Qwen Image Edit Layout

## Directory Map
- `non_blackwell/` – original RunPod build pinned to CUDA 11.8 and the cu118 PyTorch wheels. Use this when deploying to Ampere/Ada-class GPUs that do not require SM 120 kernels.
- `blackwell/` – CUDA 12.4 track aligned with the 5090 Blackwell template (Python 3.11, Tenofas PyTorch 2.9.0, SM 120 kernels).

Each folder is a self-contained project snapshot (Dockerfile, handler, workflow JSON, dependency pins, and README). Clone the repo once, then work inside the variant that matches your target GPU.

## Getting Started
1. Pick the variant directory that matches your hardware target.
2. Follow the README inside that folder for build, deployment, and asset setup steps.
3. Keep variants isolated; changes in one directory will not affect the other until you intentionally sync them.

## Notes
- Both variants expect model assets on `/workspace` when deployed to RunPod.
- The non-Blackwell README still documents all prior bring-up steps verbatim.
- The Blackwell variant assumes the RunPod template’s Python 3.11 / PyTorch 2.9.0 stack and its helper scripts.

Feel free to add additional variant folders (e.g. CPU-only) by copying the baseline and documenting the differences in the new folder’s README.*** End Patch

