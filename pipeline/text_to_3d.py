"""Free, local text -> 3D pipeline (the same two-stage recipe the paid tools use).

    text prompt --FLUX.1-schnell--> reference image --Hunyuan3D-2--> textured GLB

Stage 1 turns the prompt into a clean product-shot image; stage 2 lifts that
image into a mesh and paints a texture onto it. Customuse, Meshy, Tripo, and
Hunyuan's own "text to 3D" all chain a text-to-image model into an image-to-3D
model like this.

Requirements (NVIDIA GPU; ~6 GB VRAM for shape only, ~16 GB with texture):
    git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2 && cd Hunyuan3D-2
    pip install -r requirements.txt && pip install -e .
    # texture stage needs two compiled extensions, see the Hunyuan3D-2 README
    pip install diffusers transformers accelerate sentencepiece

Usage:
    python pipeline/text_to_3d.py "a viking helmet with horns" --out helmet.glb
    python pipeline/text_to_3d.py "a cute dragon pet" --no-texture --faces 4000
    python pipeline/text_to_3d.py --image my_concept.png --out thing.glb

Licenses: FLUX.1-schnell is Apache-2.0. Hunyuan3D-2 is the Tencent Hunyuan 3D
Community License, which does NOT cover the EU, UK or South Korea; there, swap
stage 2 for TRELLIS.2 or TripoSG (both MIT, see README).
"""
import argparse
from pathlib import Path

import torch
from PIL import Image

# Wrappers prepend style text like this so the image model draws one isolated,
# fully visible object, which is what image-to-3D models were trained on.
PROMPT_TEMPLATE = (
    "a single {prompt}, isolated 3D game asset, centered, entire object in frame, "
    "three-quarter view, plain white background, soft even studio lighting, no shadows"
)

SHAPE_MODELS = {
    # name: (Hugging Face repo, subfolder)
    "mini-turbo": ("tencent/Hunyuan3D-2mini", "hunyuan3d-dit-v2-mini-turbo"),
    "full": ("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0"),
    "full-turbo": ("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0-turbo"),
}


def text_to_image(prompt, seed):
    from diffusers import FluxPipeline

    pipe = FluxPipeline.from_pretrained("black-forest-labs/FLUX.1-schnell", torch_dtype=torch.bfloat16)
    pipe.enable_model_cpu_offload()
    image = pipe(
        PROMPT_TEMPLATE.format(prompt=prompt),
        guidance_scale=0.0,
        num_inference_steps=4,
        max_sequence_length=256,
        generator=torch.Generator("cpu").manual_seed(seed),
    ).images[0]
    del pipe
    torch.cuda.empty_cache()
    return image


def image_to_3d(image, shape_model, faces, texture, seed):
    from hy3dgen.rembg import BackgroundRemover
    from hy3dgen.shapegen import (
        DegenerateFaceRemover,
        FaceReducer,
        FloaterRemover,
        Hunyuan3DDiTFlowMatchingPipeline,
    )

    image = BackgroundRemover()(image.convert("RGB"))

    repo, subfolder = SHAPE_MODELS[shape_model]
    shapegen = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(repo, subfolder=subfolder)
    turbo = shape_model.endswith("turbo")
    if turbo:
        shapegen.enable_flashvdm()
    mesh = shapegen(
        image=image,
        num_inference_steps=5 if turbo else 30,
        octree_resolution=380,
        generator=torch.manual_seed(seed),
    )[0]
    del shapegen
    torch.cuda.empty_cache()

    # Clean up and decimate before texturing so the texture is baked onto the final topology.
    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    mesh = FaceReducer()(mesh, max_facenum=faces)

    if texture:
        from hy3dgen.texgen import Hunyuan3DPaintPipeline

        painter = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")
        painter.enable_model_cpu_offload()
        mesh = painter(mesh, image=image)
    return mesh, image


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("prompt", nargs="?", help="what to make, e.g. 'a golden crown with rubies'")
    parser.add_argument("--image", type=Path, help="skip stage 1 and use this reference image")
    parser.add_argument("--out", type=Path, default=Path("output.glb"))
    parser.add_argument("--shape-model", choices=SHAPE_MODELS, default="mini-turbo")
    parser.add_argument("--faces", type=int, default=4000, help="target face count (Roblox accessory limit is 4000)")
    parser.add_argument("--no-texture", action="store_true", help="geometry only, ~6 GB VRAM")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    if not args.prompt and not args.image:
        parser.error("give a prompt or --image")

    if args.image:
        reference = Image.open(args.image)
    else:
        reference = text_to_image(args.prompt, args.seed)
        reference.save(args.out.with_suffix(".reference.png"))

    mesh, cutout = image_to_3d(reference, args.shape_model, args.faces, not args.no_texture, args.seed)
    cutout.save(args.out.with_suffix(".cutout.png"))
    mesh.export(args.out)
    print(f"wrote {args.out} ({len(mesh.faces)} faces)")


if __name__ == "__main__":
    main()
