#!/usr/bin/env python3
"""Render the proposed farm-device/cloud architecture for README."""
from pathlib import Path
import os
os.environ.setdefault("MPLCONFIGDIR", "/tmp/cafp-matplotlib")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "docs" / "farm-device-cloud-design.png"
fig, ax = plt.subplots(figsize=(11, 15), dpi=150)
fig.patch.set_facecolor("#f7faf7")
ax.set_facecolor("#f7faf7")
ax.set_xlim(0, 12)
ax.set_ylim(0, 17)
ax.axis("off")

def box(cx, cy, width, height, title, subtitle="", fill="#ffffff", border="#39745a"):
    x, y = cx-width/2, cy-height/2
    ax.add_patch(FancyBboxPatch((x, y), width, height,
        boxstyle="round,pad=0.16,rounding_size=0.18",
        linewidth=1.8, edgecolor=border, facecolor=fill, zorder=3))
    ax.text(cx, cy+(0.15 if subtitle else 0), title, ha="center", va="center",
            fontsize=11, fontweight="bold", color="#173e2c", zorder=4)
    if subtitle:
        ax.text(cx, cy-0.27, subtitle, ha="center", va="center",
                fontsize=9, color="#385a4b", zorder=4)

def arrow(start, end, color="#527466", bend="arc3,rad=0", lw=1.8):
    ax.add_patch(FancyArrowPatch(start, end, arrowstyle="-|>", mutation_scale=15,
        connectionstyle=bend, color=color, linewidth=lw, zorder=2))

ax.text(0.55, 16.5, "CAFP  /  PROPOSED DEVICE + CLOUD PIPELINE",
        fontsize=18, fontweight="bold", color="#173e2c")
ax.text(0.55, 16.1, "Architecture target based on the supplied farm-device design",
        fontsize=10, color="#567165")
ax.text(0.55, 15.55, "FARM DEVICES", fontsize=12, fontweight="bold", color="#277555")
ax.axhline(11.55, xmin=.04, xmax=.96, color="#b9d3c4", linewidth=1.2)
ax.text(0.55, 11.12, "CLOUD VPS", fontsize=12, fontweight="bold", color="#277555")

box(2.5, 14.25, 3.3, 1.05, "Soil + air sensors")
box(2.5, 12.55, 3.3, 1.05, "ESP32 acquisition", "Local buffer and fallback", fill="#e7f4e9")
box(8.4, 14.25, 3.8, 1.05, "Outdoor camera", "Optional local recording")
box(8.4, 12.55, 3.8, 1.05, "5G gateway", "Secure telemetry + video", fill="#e7f4e9")
box(8.4, 10.02, 4.2, 1.1, "Ingestion", "Time alignment + quality checks", fill="#eaf2ff", border="#4b74a5")
box(4.1, 8.35, 4.1, 1.1, "SSDlite + ByteTrack", "Intrusion event features", fill="#eaf2ff", border="#4b74a5")
box(2.3, 6.25, 3.4, 1.1, "Crop context", "Permissions + schedules")
box(8.0, 6.25, 4.0, 1.15, "XGBoost models", "Intrusion risk + water risk", fill="#eaf2ff", border="#4b74a5")
box(8.0, 4.4, 4.0, 1.1, "CARUP coordination", "Select feasible action", fill="#fff1d7", border="#a9782b")
box(8.0, 2.55, 4.0, 1.1, "Alerts + event database", "Farm dashboard", fill="#e7f4e9")

arrow((2.5, 13.72), (2.5, 13.10))
arrow((8.4, 13.72), (8.4, 13.10))
arrow((4.2, 12.55), (6.47, 12.55))
arrow((8.4, 12.0), (8.4, 10.60))
arrow((6.55, 9.48), (4.85, 8.92))
arrow((8.4, 9.46), (8.05, 6.85))
arrow((4.1, 7.8), (7.15, 6.85))
arrow((4.0, 6.25), (5.9, 6.25))
arrow((8.0, 5.67), (8.0, 4.97))
arrow((8.0, 3.85), (8.0, 3.10))
arrow((10.08, 4.4), (11.2, 4.4), color="#bf7a2d")
arrow((11.2, 4.4), (11.2, 12.55), color="#bf7a2d")
arrow((11.2, 12.55), (10.34, 12.55), color="#bf7a2d")
ax.text(11.38, 8.35, "Expiring settings +\nacknowledgments", rotation=90,
        fontsize=9, ha="center", va="center", color="#87571d")
ax.text(0.55, 1.28, "EDGE FALLBACK", fontsize=10, fontweight="bold", color="#277555")
ax.text(0.55, 0.84, "Sensor thresholds only during disconnection; cloud AI is unavailable offline.",
        fontsize=10, color="#385a4b")
ax.text(0.55, 0.42, "Design target — only JSON device ingestion, MySQL records, threshold alerts and dashboard exist today.",
        fontsize=8.8, color="#6a716c")

fig.savefig(OUT, facecolor=fig.get_facecolor(), bbox_inches="tight", pad_inches=.24)
image = Image.open(OUT).convert("RGB")
image.quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(OUT, optimize=True)
print(OUT)
