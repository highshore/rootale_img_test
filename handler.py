import base64
import copy
import os
import sys
import time
import uuid
from pathlib import Path

import runpod

sys.path.append("/ComfyUI")

import comfy  # noqa: E402
from server import PromptServer, load_workflow  # noqa: E402

os.environ["COMFYUI_INPUT_PATH"] = "/ComfyUI/input"
os.environ["COMFYUI_OUTPUT_PATH"] = "/ComfyUI/output"

WORKFLOW_NAME = "nunchaku-qwen-image-edit-2509-workflow.json"
COMFY_INPUT = Path(os.environ["COMFYUI_INPUT_PATH"])
COMFY_OUTPUT = Path(os.environ["COMFYUI_OUTPUT_PATH"])

server = None
workflow_template = None

DEFAULTS = {
    "model_name": "svdq-int4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors",
    "lora_name": "Qwen-Anime-V1.safetensors",
    "lora_strength": 1.0,
    "clip_name": "qwen_2.5_vl_7b_fp8_scaled.1.safetensors",
    "clip_type": "qwen_image",
    "clip_device": "default",
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
    "cpu_offload": "enable",
    "num_blocks_on_gpu": 20,
    "use_pin_memory": "disable",
    "filename_prefix": "ComfyUI",
    "image_name": "ComfyUI_00189_.png",
}


def ensure_comfy_ready():
    global server, workflow_template
    if server is None:
        instance = PromptServer()
        template = load_workflow(WORKFLOW_NAME)
        instance.load_workflow(template)
        server = instance
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
    image_data = job_input.get("image_base64")
    image_name = job_input.get("image_name", DEFAULTS["image_name"])
    created = False
    if image_data:
        try:
            content = base64.b64decode(image_data)
        except Exception as exc:
            raise ValueError(f"Invalid image_base64 payload: {exc}") from exc
        image_name = f"{uuid.uuid4().hex}.png"
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
    server.prompt_queue.put((prompt_id, workflow))

    timeout = float(job_input.get("timeout", 120))
    start = time.time()

    try:
        while time.time() - start < timeout:
            output = server.outputs.get(prompt_id)
            if output and output_node_id in output:
                images = output[output_node_id].get("images", [])
                if images:
                    image_info = images[0]
                    filename = image_info["filename"]
                    subfolder = image_info.get("subfolder", "")
                    output_path = COMFY_OUTPUT / subfolder / filename if subfolder else COMFY_OUTPUT / filename
                    with open(output_path, "rb") as created:
                        encoded = base64.b64encode(created.read()).decode("utf-8")
                    os.remove(output_path)
                    server.outputs.pop(prompt_id, None)
                    if cleanup_path and cleanup_path.exists():
                        cleanup_path.unlink()
                    return {"image_base64": encoded}
            time.sleep(0.1)
        return {"error": "Timed out waiting for workflow output"}
    except Exception as exc:
        return {"error": f"An error occurred: {exc}"}
    finally:
        if cleanup_path and cleanup_path.exists():
            cleanup_path.unlink()
        server.outputs.pop(prompt_id, None)


runpod.serverless.start({"handler": handler})
