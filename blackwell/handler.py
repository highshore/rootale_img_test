import asyncio
import base64
import copy
import json
import os
import sys
import time
import uuid
import importlib.util
import re
from importlib import import_module
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import urlparse
from urllib import request as urllib_request
import threading

import runpod

try:
    import boto3
    from botocore.config import Config as BotoConfig
    from botocore.exceptions import BotoCoreError, ClientError
except Exception:  # pragma: no cover - boto3 is optional until storage enabled
    boto3 = None
    BotoConfig = None
    ClientError = BotoCoreError = Exception

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

STORAGE_ENDPOINT = os.environ.get("RUNPOD_STORAGE_ENDPOINT")
STORAGE_BUCKET = os.environ.get("RUNPOD_STORAGE_BUCKET")
STORAGE_ACCESS_KEY = os.environ.get("RUNPOD_STORAGE_ACCESS_KEY")
STORAGE_SECRET_KEY = os.environ.get("RUNPOD_STORAGE_SECRET_KEY")
def infer_region_from_endpoint(endpoint: Optional[str]) -> Optional[str]:
    if not endpoint:
        return None
    try:
        parsed = urlparse(endpoint)
        host = parsed.hostname or ""
    except ValueError:
        return None
    match = re.search(r"s3api-([^.]+)\.", host)
    if match:
        return match.group(1)
    return None


STORAGE_REGION = (
    os.environ.get("RUNPOD_STORAGE_REGION")
    or infer_region_from_endpoint(os.environ.get("RUNPOD_STORAGE_ENDPOINT"))
    or "us-east-1"
)
STORAGE_FORCE_PATH_STYLE = os.environ.get("RUNPOD_STORAGE_FORCE_PATH_STYLE", "1")
STORAGE_OUTPUT_PREFIX = os.environ.get("RUNPOD_STORAGE_OUTPUT_PREFIX", "outputs")
STORAGE_PUBLIC_BASE_URL = os.environ.get("RUNPOD_STORAGE_PUBLIC_BASE_URL", "").rstrip("/")
INCLUDE_OUTPUT_BASE64 = os.environ.get("RUNPOD_INCLUDE_OUTPUT_BASE64", "1")
UPLOAD_OUTPUTS = os.environ.get("RUNPOD_STORAGE_UPLOAD_OUTPUTS", "1")

def _strtobool(value: Optional[str], *, default: bool = True) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() not in {"0", "false", "no", "off", ""}

STORAGE_ENABLED = (
    bool(STORAGE_ENDPOINT and STORAGE_BUCKET and STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY and boto3 is not None)
)

_storage_client = None

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
    "prompt": "production-ready anime concept art of a hero mid-action, dynamic lighting, cinematic depth",
    "negative_prompt": "duplicate limbs, extra hands, cropped head, muddy textures, low detail, lowres, watermark, text artifacts",
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

CHARACTER_NEGATIVE_BASE = DEFAULTS["negative_prompt"]
BACKGROUND_NEGATIVE_BASE = (
    "figures, person, character, humanoid silhouettes, messy perspective, blown highlights, chromatic aberration"
)
COMBO_NEGATIVE_BASE = (
    "floating characters, mismatched shadows, double exposure, extra limbs, bad compositing, overexposed, motion blur"
)
NONE_TOKENS = {"", "none", "None", None}

PLACEHOLDER_PIXEL_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAn0B9lqQ+wAAAABJRU5ErkJggg=="
)


def _clean_str(value):
    if isinstance(value, str):
        return value.strip()
    return ""


def _is_active(value) -> bool:
    if not isinstance(value, str):
        return False
    return value.strip() and value.strip().lower() not in NONE_TOKENS


def _build_prompts_from_structured_forms(job_input, dims: dict[str, int]) -> Optional[dict[str, str]]:
    mode = _clean_str(job_input.get("mode"))
    if not mode:
        # No structured mode specified; fall back to legacy prompt field
        return None

    mode = mode.lower()
    if mode == "character":
        data = job_input.get("character")
        if not isinstance(data, dict):
            raise ValueError("`character` payload is required when mode is 'character'.")
        prompt = _character_prompt(data, dims)
        negative = _character_negative_prompt(data)
        return {"prompt": prompt, "negative": negative}
    if mode == "background":
        data = job_input.get("background")
        if not isinstance(data, dict):
            raise ValueError("`background` payload is required when mode is 'background'.")
        prompt = _background_prompt(data, dims)
        negative = _background_negative_prompt(data)
        return {"prompt": prompt, "negative": negative}
    if mode == "combo":
        data = job_input.get("combo")
        if not isinstance(data, dict):
            raise ValueError("`combo` payload is required when mode is 'combo'.")
        prompt = _combo_prompt(data, dims)
        negative = _combo_negative_prompt(data)
        return {"prompt": prompt, "negative": negative}
    return None


def _character_prompt(data: dict, dims: dict[str, int]) -> str:
    concept = _clean_str(data.get("concept"))
    if not concept:
        raise ValueError("character.concept is required.")
    parts = ["ultra-detailed character concept, production-ready illustration", f"concept: {concept}"]
    if _is_active(data.get("style")):
        parts.append(f"style: {data['style']}")
    if _is_active(data.get("hairStyle")) or _is_active(data.get("hairColor")):
        style = data.get("hairStyle") if _is_active(data.get("hairStyle")) else "styled"
        color = f", color {data['hairColor']}" if _is_active(data.get("hairColor")) else ""
        parts.append(f"hair: {style}{color}")
    if _is_active(data.get("eyeColor")) or _is_active(data.get("expression")):
        descriptors = []
        if _is_active(data.get("eyeColor")):
            descriptors.append(f"eyes {data['eyeColor']}")
        if _is_active(data.get("expression")):
            descriptors.append(data["expression"])
        if descriptors:
            parts.append(f"face: {', '.join(descriptors)}")
    wardrobe = _clean_str(data.get("wardrobe"))
    if wardrobe:
        parts.append(f"wardrobe: {wardrobe}")
    props = _clean_str(data.get("props"))
    if props:
        parts.append(f"props: {props}")
    if _is_active(data.get("pose")):
        parts.append(f"pose: {data['pose']}")
    if _is_active(data.get("lighting")):
        parts.append(f"lighting: {data['lighting']}")
    parts.append(f"final render {dims['width']}x{dims['height']}, cinematic depth of field")
    return ", ".join(parts)


def _character_negative_prompt(data: dict) -> str:
    extra = _clean_str(data.get("negative"))
    if extra:
        return f"{CHARACTER_NEGATIVE_BASE}, {extra}"
    return CHARACTER_NEGATIVE_BASE


def _background_prompt(data: dict, dims: dict[str, int]) -> str:
    location = _clean_str(data.get("location"))
    if not location:
        raise ValueError("background.location is required.")
    parts = ["cinematic environment matte painting", f"location: {location}"]
    if _is_active(data.get("environmentType")):
        parts.append(f"environment type: {data['environmentType']}")
    if _is_active(data.get("timeOfDay")):
        parts.append(f"time of day: {data['timeOfDay']}")
    if _is_active(data.get("palette")):
        parts.append(f"color palette: {data['palette']}")
    if _is_active(data.get("atmosphere")):
        parts.append(f"atmosphere: {data['atmosphere']}")
    if _is_active(data.get("focalElement")):
        parts.append(f"focal element: {data['focalElement']}")
    if _is_active(data.get("style")):
        parts.append(f"style: {data['style']}")
    parts.append(f"rendered at {dims['width']}x{dims['height']}, no characters")
    return ", ".join(parts)


def _background_negative_prompt(data: dict) -> str:
    extra = _clean_str(data.get("negative"))
    if extra:
        return f"{BACKGROUND_NEGATIVE_BASE}, {extra}"
    return BACKGROUND_NEGATIVE_BASE


def _combo_prompt(data: dict, dims: dict[str, int]) -> str:
    character = _clean_str(data.get("characterDescription"))
    background = _clean_str(data.get("backgroundDescription"))
    if not character or not background:
        raise ValueError("combo.characterDescription and combo.backgroundDescription are required.")
    parts = [
        "hero shot blending character and environment",
        f"character: {character}",
        f"environment: {background}",
    ]
    interaction = _clean_str(data.get("interaction"))
    if interaction:
        parts.append(f"interaction: {interaction}")
    parts.append(f"final frame {dims['width']}x{dims['height']}, matched lighting and contact shadows")
    return ", ".join(parts)


def _combo_negative_prompt(data: dict) -> str:
    extra = _clean_str(data.get("negative"))
    if extra:
        return f"{COMBO_NEGATIVE_BASE}, {extra}"
    return COMBO_NEGATIVE_BASE


def storage_available() -> bool:
    return STORAGE_ENABLED


def get_storage_client():
    global _storage_client
    if not storage_available():
        raise RuntimeError("RunPod storage is not configured.")
    if _storage_client is None:
        config_kwargs = {}
        if _strtobool(STORAGE_FORCE_PATH_STYLE, default=True):
            config_kwargs["s3"] = {"addressing_style": "path"}
        boto_config = BotoConfig(**config_kwargs) if config_kwargs else None
        _storage_client = boto3.client(  # type: ignore[attr-defined]
            "s3",
            endpoint_url=STORAGE_ENDPOINT,
            aws_access_key_id=STORAGE_ACCESS_KEY,
            aws_secret_access_key=STORAGE_SECRET_KEY,
            region_name=STORAGE_REGION,
            config=boto_config,
        )
    return _storage_client


def derive_public_url(object_key: str) -> Optional[str]:
    if not object_key or not STORAGE_PUBLIC_BASE_URL:
        return None
    base = STORAGE_PUBLIC_BASE_URL.rstrip("/")
    return f"{base}/{object_key.lstrip('/')}"


def download_storage_object(object_key: str) -> bytes:
    client = get_storage_client()
    response = client.get_object(Bucket=STORAGE_BUCKET, Key=object_key)
    return response["Body"].read()


def upload_storage_object(
    file_path: Path,
    *,
    object_key: Optional[str] = None,
    job_id: Optional[str] = None,
    content_type: str = "image/png",
) -> str:
    client = get_storage_client()
    key = object_key or f"{STORAGE_OUTPUT_PREFIX.rstrip('/')}/{job_id or uuid.uuid4().hex}/{file_path.name}"
    client.upload_file(
        str(file_path),
        STORAGE_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return key


def download_http_resource(url: str, *, timeout: float = 30.0) -> bytes:
    request = urllib_request.Request(url, method="GET")
    with urllib_request.urlopen(request, timeout=timeout) as response:
        return response.read()


class TimelineLogger:
    """Utility to emit per-request timeline markers to stdout."""

    def __init__(self, job_id: Optional[str] = None) -> None:
        self.start = time.perf_counter()
        self.job_id = job_id or ""
        self._seen: set[str] = set()

    def mark(self, label: str, *, key: Optional[str] = None, dedupe: bool = True) -> None:
        label = (label or "").strip()
        if not label:
            return
        dedupe_key = key if key is not None else label
        if dedupe and dedupe_key in self._seen:
            return
        if dedupe and dedupe_key:
            self._seen.add(dedupe_key)
        elapsed = time.perf_counter() - self.start
        prefix = f"[{elapsed:0.3f}]"
        job_tag = f" ({self.job_id})" if self.job_id else ""
        print(f"{prefix}{job_tag} {label}", flush=True)

    def mark_status_messages(self, messages) -> None:
        for entry in messages or []:
            formatted = format_status_entry(entry)
            if formatted:
                self.mark(formatted, key=f"status::{formatted}")


def format_status_entry(entry) -> str:
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
            if "load_image" not in nodes:
                nodes["load_image"] = node_id
            elif "background_load_image" not in nodes:
                nodes["background_load_image"] = node_id
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


def prepare_image(
    job_input,
    *,
    base64_key: str = "image_base64",
    object_key: str = "image_object_key",
    url_key: str = "image_url",
    name_key: str = "image_name",
    default_name: Optional[str] = None,
    fallback_base64: Optional[str] = None,
    timeline: Optional[TimelineLogger] = None,
):
    def decode_payload(payload: str) -> bytes:
        try:
            return base64.b64decode(payload, validate=True)
        except Exception as exc:
            raise ValueError(f"Invalid base64 payload: {exc}") from exc

    def log(message: str) -> None:
        if timeline:
            timeline.mark(message)

    image_name = job_input.get(name_key) or default_name or DEFAULTS["image_name"]
    image_bytes: Optional[bytes] = None
    created = False

    storage_key = job_input.get(object_key)
    if storage_key and image_bytes is None:
        if not storage_available():
            raise RuntimeError("Storage key provided but RunPod storage is not configured.")
        log(f"Downloading input image from storage ({storage_key})")
        image_bytes = download_storage_object(storage_key)
        if not job_input.get(name_key):
            image_name = Path(storage_key).name or f"{uuid.uuid4().hex}.png"

    image_url = job_input.get(url_key)
    if image_bytes is None and image_url:
        log("Downloading input image from URL")
        try:
            image_bytes = download_http_resource(image_url)
        except Exception as exc:
            raise RuntimeError(f"Failed to download image from URL: {exc}") from exc
        if not job_input.get(name_key):
            parsed = urlparse(image_url)
            candidate = Path(parsed.path).name
            if candidate:
                image_name = candidate

    image_data = job_input.get(base64_key)
    if image_bytes is None:
        if image_data:
            if isinstance(image_data, str):
                image_bytes = decode_payload(image_data)
            else:
                image_bytes = image_data
        elif isinstance(image_name, str):
            try:
                maybe_bytes = decode_payload(image_name)
            except ValueError:
                maybe_bytes = None
            if maybe_bytes is not None:
                image_bytes = maybe_bytes
                image_name = f"{uuid.uuid4().hex}.png"

    if image_bytes is None and fallback_base64:
        try:
            image_bytes = decode_payload(fallback_base64)
            if not image_name:
                image_name = f"{base64_key}-{uuid.uuid4().hex}.png"
        except Exception:
            image_bytes = None

    if image_bytes:
        if not image_name:
            image_name = f"{uuid.uuid4().hex}.png"
        target_path = COMFY_INPUT / image_name
        with open(target_path, "wb") as handle:
            handle.write(image_bytes)
        created = True
    else:
        target_path = COMFY_INPUT / image_name
        if not target_path.exists():
            raise FileNotFoundError(f"Image {image_name} not found in {COMFY_INPUT}")
    return image_name, target_path if created else None


def build_prompt(job_input, *, timeline: Optional[TimelineLogger] = None):
    ensure_comfy_ready()
    workflow = copy.deepcopy(workflow_template)
    nodes = find_nodes(workflow)
    cleanup_paths: list[Path] = []
    image_name, primary_cleanup = prepare_image(job_input, timeline=timeline)
    if primary_cleanup:
        cleanup_paths.append(primary_cleanup)

    background_default_name = job_input.get("background_image_name") or f"background_{uuid.uuid4().hex}.png"
    background_name, background_cleanup = prepare_image(
        job_input,
        base64_key="background_image_base64",
        object_key="background_image_object_key",
        url_key="background_image_url",
        name_key="background_image_name",
        default_name=background_default_name,
        fallback_base64=PLACEHOLDER_PIXEL_BASE64,
        timeline=timeline,
    )
    if background_cleanup:
        cleanup_paths.append(background_cleanup)

    def set_input(name, key, value):
        workflow[nodes[name]]["inputs"][key] = value

    width = int(job_input.get("width", DEFAULTS["width"]))
    height = int(job_input.get("height", DEFAULTS["height"]))

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
    if "load_image" in nodes:
        set_input("load_image", "image", image_name)
    if "background_load_image" in nodes:
        set_input("background_load_image", "image", background_name)

    prompt_text = _clean_str(job_input.get("prompt") or job_input.get("prompt_text"))
    negative_text = _clean_str(job_input.get("negative_prompt") or job_input.get("negativePrompt"))

    if not prompt_text:
        built = _build_prompts_from_structured_forms(job_input, {"width": width, "height": height})
        if built:
            prompt_text = built["prompt"]
            negative_text = built["negative"]
    if not prompt_text:
        prompt_text = DEFAULTS["prompt"]
    if not negative_text:
        negative_text = DEFAULTS["negative_prompt"]

    set_input("positive", "prompt", prompt_text)
    set_input("negative", "prompt", negative_text)

    set_input("latent", "width", width)
    set_input("latent", "height", height)
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

    return workflow, nodes["save_image"], cleanup_paths


def handler(job):
    job_id = None
    if isinstance(job, dict):
        for key in ("id", "job_id", "jobId", "requestId"):
            value = job.get(key)
            if value:
                job_id = str(value)
                break

    timeline = TimelineLogger(job_id=job_id)
    timeline.mark("Request received", dedupe=False)

    ensure_comfy_ready()
    timeline.mark("Comfy ready")

    job_input = job.get("input", {})
    cleanup_paths: list[Path] = []
    try:
        workflow, output_node_id, cleanup_paths = build_prompt(job_input, timeline=timeline)
        timeline.mark("Workflow prepared")
    except Exception as exc:
        timeline.mark(f"Workflow preparation failed: {exc}", dedupe=False)
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
    timeline.mark("Workflow enqueued")

    timeout = float(job_input.get("timeout", 120))
    start = time.time()
    graph_started = False

    try:
        while time.time() - start < timeout:
            history = server.prompt_queue.get_history(prompt_id=prompt_id)
            record = history.get(prompt_id)
            if record:
                if not graph_started:
                    timeline.mark("Graph execution started", dedupe=False)
                    graph_started = True
                status = record.get("status") or {}
                timeline.mark_status_messages(status.get("messages"))
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
                        timeline.mark("Sampling finished")
                        response_payload: dict[str, str] = {}
                        uploaded = False
                        if _strtobool(UPLOAD_OUTPUTS, default=True) and storage_available():
                            try:
                                timeline.mark("Uploading output to RunPod storage")
                                object_key = upload_storage_object(output_path, job_id=job_id)
                                response_payload["image_object_key"] = object_key
                                public_url = derive_public_url(object_key)
                                if public_url:
                                    response_payload["image_url"] = public_url
                                uploaded = True
                            except Exception as exc:
                                timeline.mark(f"Output upload failed: {exc}", dedupe=False)
                        include_base64 = _strtobool(INCLUDE_OUTPUT_BASE64, default=True)
                        if include_base64 or not uploaded:
                            with open(output_path, "rb") as created:
                                encoded = base64.b64encode(created.read()).decode("utf-8")
                                response_payload["image_base64"] = encoded
                        timeline.mark("Response sent", dedupe=False)
                        os.remove(output_path)
                        server.prompt_queue.delete_history_item(prompt_id)
                        for path in cleanup_paths:
                            if path and path.exists():
                                path.unlink()
                        timeline.mark("Request completed", dedupe=False)
                        return response_payload
                if status and not status.get("completed", True):
                    messages = status.get("messages") or []
                    formatted = [format_status_entry(entry) for entry in messages]
                    message_text = "; ".join(filter(None, formatted)) or status.get("status_str", "error")
                    server.prompt_queue.delete_history_item(prompt_id)
                    timeline.mark(f"Workflow failed: {message_text}", dedupe=False)
                    return {"error": f"Workflow failed: {message_text}"}
            time.sleep(0.1)
        timeline.mark("Timed out waiting for workflow output", dedupe=False)
        return {"error": "Timed out waiting for workflow output"}
    except Exception as exc:
        timeline.mark(f"An error occurred: {exc}", dedupe=False)
        return {"error": f"An error occurred: {exc}"}
    finally:
        for path in cleanup_paths:
            if path and path.exists():
                path.unlink()


runpod.serverless.start({"handler": handler})
