#!/usr/bin/env python3
"""Generate a visualization for Runpod turnaround benchmarks."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List

import matplotlib.pyplot as plt
from matplotlib.lines import Line2D


def load_data(summary_path: Path) -> dict:
  with summary_path.open("r", encoding="utf-8") as handle:
    return json.load(handle)


def build_scatter_plot(summary: dict, output_path: Path) -> None:
  results: List[dict] = summary.get("results", [])
  aggregates: List[dict] = summary.get("aggregates", [])
  cohort_order: List[str] = summary.get("cohortOrder") or []
  images_per_cohort = summary.get("imagesPerCohort") or 1

  cohort_labels: Dict[str, str] = {
      entry["cohortKey"]: entry["cohortLabel"] for entry in aggregates if entry.get("cohortLabel")
  }
  positions: Dict[str, int] = {key: idx for idx, key in enumerate(cohort_order)}

  colors = {"Input": "#0ea5e9", "Output": "#22c55e"}

  fig, ax = plt.subplots(figsize=(14, 6))

  for record in results:
    total_ms = record.get("totalMs")
    if total_ms is None:
      continue
    cohort_key = record.get("cohortKey")
    kind = record.get("kind", "Input")
    idx = positions.get(cohort_key)
    if idx is None:
      continue
    image_index = record.get("imageIndex", 0)
    jitter = (image_index - (images_per_cohort - 1) / 2) * 0.12
    ax.scatter(
        idx + jitter,
        total_ms / 1000,
        color=colors.get(kind, "#64748b"),
        s=60,
        edgecolors="white",
        linewidths=0.5,
        alpha=0.9,
    )

  for entry in aggregates:
    avg_ms = entry.get("avg_total_ms")
    if avg_ms is None:
      continue
    idx = positions.get(entry.get("cohortKey"))
    if idx is None:
      continue
    kind = entry.get("kind", "Input")
    ax.hlines(
        avg_ms / 1000,
        idx - 0.25,
        idx + 0.25,
        colors=colors.get(kind, "#1f2937"),
        linewidth=2.0,
      )

  xticks = [positions[key] for key in cohort_order if key in positions]
  labels = [cohort_labels.get(key, key) for key in cohort_order if key in cohort_labels or key in positions]
  ax.set_xticks(xticks, labels, rotation=20, ha="right")
  ax.set_ylabel("Total turnaround (seconds)")
  ax.set_title(
      f"RunPod turnaround by cohort ({summary.get('endpointId', 'unknown endpoint')})",
      loc="left",
      fontsize=13,
  )
  ax.grid(axis="y", linestyle="--", alpha=0.25)

  legend_handles = [
      Line2D([0], [0], marker="o", color="white", markerfacecolor=colors["Input"], label="Input cohorts", markersize=8),
      Line2D([0], [0], marker="o", color="white", markerfacecolor=colors["Output"], label="Output cohorts", markersize=8),
      Line2D([0], [0], color="#0f172a", linewidth=2, label="Cohort average"),
  ]
  ax.legend(handles=legend_handles, loc="upper left")

  footer = f"Prompt: {summary.get('prompt', 'n/a')[:90]}..."
  ax.text(0.01, -0.18, footer, transform=ax.transAxes, fontsize=9, color="#475569")

  fig.tight_layout()
  output_path.parent.mkdir(parents=True, exist_ok=True)
  fig.savefig(output_path, dpi=150, bbox_inches="tight")
  plt.close(fig)


def main() -> None:
  if len(sys.argv) < 2:
    print("Usage: python scripts/plot_perf.py <summary.json> [output.png]")
    raise SystemExit(1)

  summary_path = Path(sys.argv[1]).expanduser().resolve()
  if not summary_path.exists():
    print(f"Summary file not found: {summary_path}")
    raise SystemExit(1)

  if len(sys.argv) >= 3:
    output_path = Path(sys.argv[2]).expanduser().resolve()
  else:
    output_path = summary_path.with_name("turnaround.png")

  summary = load_data(summary_path)
  build_scatter_plot(summary, output_path)
  print(f"Saved visualization to {output_path}")


if __name__ == "__main__":
  main()

