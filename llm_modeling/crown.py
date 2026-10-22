"""A 3D model written entirely as code by an LLM (Claude) - no 3D AI service.

Builds a low-poly Roblox-style crown accessory from primitives, colors it,
exports crown.glb, and renders crown_preview.png. This is the "text -> code ->
mesh" route: it works for hard-surface, symmetric, primitive-friendly objects.

    python llm_modeling/crown.py
"""
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

OUT = Path(__file__).parent
GOLD = [212, 175, 55, 255]
RUBY = [200, 20, 50, 255]
SAPPHIRE = [30, 80, 200, 255]
ROBLOX_ACCESSORY_TRI_LIMIT = 4000


def colored(mesh, rgba):
    mesh.visual.vertex_colors = np.tile(rgba, (len(mesh.vertices), 1))
    return mesh


def band(radius=1.0, height=0.45, thickness=0.12, sections=24):
    ring = trimesh.creation.annulus(r_min=radius - thickness, r_max=radius, height=height, sections=sections)
    ring.apply_translation([0, 0, height / 2])
    return colored(ring, GOLD)


def spike(angle, radius=0.94, base_z=0.45, height=0.55):
    cone = trimesh.creation.cone(radius=0.17, height=height, sections=4)
    cone.apply_translation([radius * math.cos(angle), radius * math.sin(angle), base_z])
    return colored(cone, GOLD)


def gem(angle, z, rgba, radius=1.0, size=0.09):
    g = trimesh.creation.icosphere(subdivisions=1, radius=size)
    g.apply_translation([radius * math.cos(angle), radius * math.sin(angle), z])
    return colored(g, rgba)


def build_crown(points=8):
    parts = [band()]
    for i in range(points):
        a = 2 * math.pi * i / points
        parts.append(spike(a))
        parts.append(gem(a + math.pi / points, 0.22, RUBY if i % 2 else SAPPHIRE))
        # pearl on each spike tip
        tip = trimesh.creation.icosphere(subdivisions=1, radius=0.06)
        tip.apply_translation([0.94 * math.cos(a), 0.94 * math.sin(a), 1.0])
        parts.append(colored(tip, [245, 245, 235, 255]))
    return trimesh.util.concatenate(parts)


def render_preview(mesh, path):
    fig = plt.figure(figsize=(6, 5))
    ax = fig.add_subplot(111, projection="3d")
    tris = mesh.vertices[mesh.faces]
    face_rgb = mesh.visual.face_colors[:, :3] / 255.0
    shade = 0.55 + 0.45 * np.clip(mesh.face_normals @ np.array([0.4, -0.5, 0.75]), 0, 1)
    ax.add_collection3d(Poly3DCollection(tris, facecolors=face_rgb * shade[:, None], edgecolor="none"))
    lo, hi = mesh.bounds
    c, r = (lo + hi) / 2, (hi - lo).max() / 2
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(c[2] - r, c[2] + r)
    ax.view_init(elev=22, azim=-60)
    ax.set_axis_off()
    fig.savefig(path, dpi=120, bbox_inches="tight")


if __name__ == "__main__":
    crown = build_crown()
    tris = len(crown.faces)
    crown.export(OUT / "crown.glb")
    render_preview(crown, OUT / "crown_preview.png")
    print(f"crown.glb: {tris} triangles (Roblox accessory limit {ROBLOX_ACCESSORY_TRI_LIMIT}): "
          f"{'OK' if tris <= ROBLOX_ACCESSORY_TRI_LIMIT else 'TOO MANY'}")
