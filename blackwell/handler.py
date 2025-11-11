import asyncio
import base64
import copy
import json
import os
import sys
import time
import uuid
import importlib.util
from importlib import import_module
from pathlib import Path
from typing import Optional, Tuple
import threading

import runpod

COMFY_ROOT = os.path.abspath(os.environ.get("COMFYUI_ROOT", "/opt/ComfyUI"))
for path in (f"{COMFY_ROOT}/app", COMFY_ROOT):
    if path not in sys.path:
        sys.path.insert(0, path)

if "utils" in sys.modules and not getattr(sys.modules["utils"], "__path__", None):
    del sys.modules["utils"]

os.environ.setdefault("COMFYUI_INPUT_PATH", f"{COMFY_ROOT}/input")
os.environ.setdefault("COMFYUI_OUTPUT_PATH", f"{COMFY_ROOT}/output")

WORKFLOW_NAME = "nunchaku-qwen-image-edit-2509-workflow.json"
COMFY_INPUT = Path(os.environ["COMFYUI_INPUT_PATH"])
COMFY_OUTPUT = Path(os.environ["COMFYUI_OUTPUT_PATH"])

PromptServer = None  # type: ignore
comfy = None  # type: ignore
server = None
server_event_loop = None
server_start_future = None
server_thread = None
server_boot_error: Optional[BaseException] = None
server_ready_event = threading.Event()
workflow_template = None

DEFAULTS = {
    "model_name": "svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors",
    "lora_name": "Qwen-Anime-V1.safetensors",
    "lora_strength": 1.0,
    "clip_name": "clip/qwen_2.5_vl_7b_fp8_scaled.1.safetensors",
    "clip_type": "qwen_image",
    "clip_device": "cuda",
    "vae_name": "qwen_image_vae.1.safetensors",
    "prompt": "aki_anime, masterpiece, ultra-detailed, cinematic wide shot, "
    "low-angle side view of a young man (image1) sprinting through the school courtyard, "
    "jacket fluttering behind him, dynamic motion blur, strong afternoon sunlight casting long shadows, "
    "wind and petals surrounding him, determined expression, "
    "a medium-size empty white speech bubble with black outline floating upper-right, "
    "film-grain texture, warm golden light, outdoor red-brick school background, open sky.",
    "negative_prompt": "",
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
    "filename_prefix": "ComfyUI",
    "image_name": "ComfyUI_00189_.png",
}


def wait_for_cuda(timeout: float = 120.0, poll: float = 2.0) -> None:
    """Block until CUDA is ready (RunPod can take ~30s to expose the device)."""
    import torch

    deadline = time.time() + timeout
    last_exc: Optional[Exception] = None
    while time.time() < deadline:
        try:
            if torch.cuda.is_available():
                torch.cuda.current_device()
                return
            last_exc = RuntimeError("torch.cuda.is_available returned False")
        except Exception as exc:  # torch sometimes raises while driver warms up
            last_exc = exc
        time.sleep(poll)
    raise RuntimeError("Timed out waiting for CUDA device") from last_exc


def _start_comfy_background_server() -> None:
    global server_thread, server_event_loop, server_start_future, server, server_boot_error  # type: ignore

    if server_thread is not None and server_thread.is_alive():
        return

    server_ready_event.clear()
    server_boot_error = None

    def runner() -> None:
        global server_event_loop, server_start_future, server, server_boot_error  # type: ignore
        try:
            from main import start_comfyui  # noqa: E402

            event_loop, prompt_server, start_all = start_comfyui()
            server_event_loop = event_loop
            server_start_future = start_all
            server = prompt_server
            server_ready_event.set()

            asyncio.set_event_loop(event_loop)
            event_loop.run_until_complete(start_all())
        except BaseException as exc:  # pragma: no cover - server bootstrap failure
            server_boot_error = exc
            server_ready_event.set()

    server_thread = threading.Thread(target=runner, name="ComfyUI-Server", daemon=True)
    server_thread.start()


def load_workflow_template(filename: str):
    workflow_path = Path(COMFY_ROOT) / "workflows" / filename
    if not workflow_path.exists():
        raise FileNotFoundError(f"Workflow file not found at {workflow_path}")
    with workflow_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _force_load_package(name: str, package_dir: Path) -> None:
    """Load a ComfyUI package from disk and register it in sys.modules."""
    init_path = package_dir / "__init__.py"
    if not init_path.exists():
        raise FileNotFoundError(f"ComfyUI package missing at {init_path}")

    spec = importlib.util.spec_from_file_location(
        name,
        init_path,
        submodule_search_locations=[str(package_dir)],
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load ComfyUI package '{name}' from {package_dir}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)


def _load_comfy_utils() -> None:
    app_dir = Path(COMFY_ROOT) / "app"
    utils_dir = Path(COMFY_ROOT) / "utils"

    for key in ("utils.install_util", "utils", "app.utils", "app"):
        sys.modules.pop(key, None)

    _force_load_package("app", app_dir)
    _force_load_package("utils", utils_dir)
    import_module("utils.install_util")


def ensure_comfy_ready() -> None:
    global server, workflow_template, PromptServer, comfy, server_event_loop, server_start_future, server_thread, server_boot_error  # type: ignore

    if server is not None:
        return

    if comfy is None or PromptServer is None:
        wait_for_cuda()
        if "utils" in sys.modules and not getattr(sys.modules["utils"], "__path__", None):
            del sys.modules["utils"]
        _load_comfy_utils()
        import comfy as comfy_mod  # noqa: E402
        from server import PromptServer as PromptServerCls  # noqa: E402

        comfy = comfy_mod  # type: ignore
        PromptServer = PromptServerCls  # type: ignore

    if server is None:
        _start_comfy_background_server()
        server_ready_event.wait(timeout=120)
        if server_boot_error is not None:
            raise RuntimeError("Failed to start ComfyUI server") from server_boot_error
        if server is None:
            raise RuntimeError("ComfyUI server failed to initialize")

    template = load_workflow_template(WORKFLOW_NAME)
    workflow_template = template
def find_nodes(workflow):
    nodes = {}
    for node_id, node in workflow.items():
        node_type = node["class_type"]
        if node_type == "NunchakuQwenImageDiTLoader":
            nodes["model_loader"] = node_id
        elif node_type == "NunchakuQwenImageLoraLoader":
            nodes["lora_loader"] = node_id
        elif node_type == "CLIPLoader":
            nodes["clip_loader"] = node_id
        elif node_type == "VAELoader":
            nodes["vae_loader"] = node_id
        elif node_type == "EmptySD3LatentImage":
            nodes["latent"] = node_id
        elif node_type == "KSampler":
            nodes["sampler"] = node_id
        elif node_type == "ModelSamplingAuraFlow":
            nodes["sampling_wrapper"] = node_id
        elif node_type == "SaveImage":
            nodes["save_image"] = node_id
        elif node_type == "LoadImage":
            nodes["load_image"] = node_id
        elif node_type == "TextEncodeQwenImageEditPlus":
            prompt_value = node["inputs"].get("prompt", "")
            key = "positive" if prompt_value.strip() else "negative"
            nodes[key] = node_id
    required = [
        "model_loader",
        "lora_loader",
        "clip_loader",
        "vae_loader",
        "latent",
        "sampler",
        "sampling_wrapper",
        "save_image",
        "load_image",
        "positive",
        "negative",
    ]
    missing = [item for item in required if item not in nodes]
    if missing:
        raise RuntimeError(f"Missing nodes in workflow: {', '.join(missing)}")
    return nodes


def prepare_image(job_input):
    def decode_payload(payload: str) -> bytes:
        try:
            return base64.b64decode(payload, validate=True)
        except Exception as exc:
            raise ValueError(f"Invalid base64 payload: {exc}") from exc

    image_data = job_input.get("image_base64")
    image_name = job_input.get("image_name", DEFAULTS["image_name"])
    created = False

    if not image_data and isinstance(image_name, str):
        try:
            maybe_bytes = decode_payload(image_name)
        except ValueError:
            maybe_bytes = None
        if maybe_bytes is not None:
            image_data = maybe_bytes
            image_name = f"{uuid.uuid4().hex}.png"

    if image_data:
        if isinstance(image_data, str):
            content = decode_payload(image_data)
        else:
            content = image_data
        target_path = COMFY_INPUT / image_name
        with open(target_path, "wb") as handle:
            handle.write(content)
        created = True
    else:
        target_path = COMFY_INPUT / image_name
        if not target_path.exists():
            raise FileNotFoundError(f"Image {image_name} not found in {COMFY_INPUT}")
    return image_name, target_path if created else None


def build_prompt(job_input):
    ensure_comfy_ready()
    workflow = copy.deepcopy(workflow_template)
    nodes = find_nodes(workflow)
    image_name, cleanup_path = prepare_image(job_input)

    def set_input(name, key, value):
        workflow[nodes[name]]["inputs"][key] = value

    set_input("model_loader", "model_name", job_input.get("model_name", DEFAULTS["model_name"]))
    set_input("model_loader", "cpu_offload", job_input.get("cpu_offload", DEFAULTS["cpu_offload"]))
    set_input(
        "model_loader",
        "num_blocks_on_gpu",
        int(job_input.get("num_blocks_on_gpu", DEFAULTS["num_blocks_on_gpu"])),
    )
    set_input("model_loader", "use_pin_memory", job_input.get("use_pin_memory", DEFAULTS["use_pin_memory"]))

    set_input("lora_loader", "lora_name", job_input.get("lora_name", DEFAULTS["lora_name"]))
    set_input(
        "lora_loader",
        "lora_strength",
        float(job_input.get("lora_strength", DEFAULTS["lora_strength"])),
    )

    set_input("clip_loader", "clip_name", job_input.get("clip_name", DEFAULTS["clip_name"]))
    set_input("clip_loader", "type", job_input.get("clip_type", DEFAULTS["clip_type"]))
    set_input("clip_loader", "device", job_input.get("clip_device", DEFAULTS["clip_device"]))

    set_input("vae_loader", "vae_name", job_input.get("vae_name", DEFAULTS["vae_name"]))
    set_input("load_image", "image", image_name)

    set_input("positive", "prompt", job_input.get("prompt", DEFAULTS["prompt"]))
    set_input("negative", "prompt", job_input.get("negative_prompt", DEFAULTS["negative_prompt"]))

    set_input("latent", "width", int(job_input.get("width", DEFAULTS["width"])))
    set_input("latent", "height", int(job_input.get("height", DEFAULTS["height"])))
    set_input("latent", "batch_size", int(job_input.get("batch_size", DEFAULTS["batch_size"])))

    set_input("sampling_wrapper", "shift", float(job_input.get("shift", DEFAULTS["shift"])))

    sampler_inputs = workflow[nodes["sampler"]]["inputs"]
    sampler_inputs["seed"] = int(job_input.get("seed", DEFAULTS["seed"]))
    sampler_inputs["steps"] = int(job_input.get("steps", DEFAULTS["steps"]))
    sampler_inputs["cfg"] = float(job_input.get("cfg", DEFAULTS["cfg"]))
    sampler_inputs["sampler_name"] = job_input.get("sampler_name", DEFAULTS["sampler_name"])
    sampler_inputs["scheduler"] = job_input.get("scheduler", DEFAULTS["scheduler"])
    sampler_inputs["denoise"] = float(job_input.get("denoise", DEFAULTS["denoise"]))

    set_input("save_image", "filename_prefix", job_input.get("filename_prefix", DEFAULTS["filename_prefix"]))

    return workflow, nodes["save_image"], cleanup_path


def handler(job):
    ensure_comfy_ready()
    job_input = job.get("input", {})
    cleanup_path = None
    try:
        workflow, output_node_id, cleanup_path = build_prompt(job_input)
    except Exception as exc:
        return {"error": f"Failed to build workflow: {exc}"}

    prompt_id = str(uuid.uuid4())
    queue_item = (
        time.time(),
        prompt_id,
        workflow,
        {},
        [output_node_id],
        {},
    )
    server.prompt_queue.put(queue_item)

    timeout = float(job_input.get("timeout", 120))
    start = time.time()

    try:
        while time.time() - start < timeout:
            history = server.prompt_queue.get_history(prompt_id=prompt_id)
            record = history.get(prompt_id)
            if record:
                status = record.get("status") or {}
                outputs = record.get("outputs") or {}
                if output_node_id in outputs:
                    images = outputs[output_node_id].get("images", [])
                    if images:
                        image_info = images[0]
                        filename = image_info["filename"]
                        subfolder = image_info.get("subfolder", "")
                        output_path = (
                            COMFY_OUTPUT / subfolder / filename if subfolder else COMFY_OUTPUT / filename
                        )
                        with open(output_path, "rb") as created:
                            encoded = base64.b64encode(created.read()).decode("utf-8")
                        os.remove(output_path)
                        server.prompt_queue.delete_history_item(prompt_id)
                        if cleanup_path and cleanup_path.exists():
                            cleanup_path.unlink()
                        return {"image_base64": encoded}
                if status and not status.get("completed", True):
                    messages = status.get("messages") or []

                    def format_status(entry):
                        if isinstance(entry, str):
                            return entry
                        if isinstance(entry, tuple) and len(entry) == 2:
                            event, payload = entry
                            detail = ""
                            if isinstance(payload, dict):
                                detail = payload.get("exception_message") or payload.get("message") or ""
                                if not detail and "details" in payload:
                                    detail = payload["details"]
                            detail = f": {detail}" if detail else ""
                            return f"{event}{detail}"
                        return str(entry)

                    formatted = [format_status(entry) for entry in messages]
                    message_text = "; ".join(filter(None, formatted)) or status.get("status_str", "error")
                    server.prompt_queue.delete_history_item(prompt_id)
                    return {"error": f"Workflow failed: {message_text}"}
            time.sleep(0.1)
        return {"error": "Timed out waiting for workflow output"}
    except Exception as exc:
        return {"error": f"An error occurred: {exc}"}
    finally:
        if cleanup_path and cleanup_path.exists():
            cleanup_path.unlink()


runpod.serverless.start({"handler": handler})
