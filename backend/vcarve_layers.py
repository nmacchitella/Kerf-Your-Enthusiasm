from __future__ import annotations

import re

DEFAULT_LAYER_STYLE = "default"
VCARVE_LAYER_STYLE = "vcarve"

_DEPTH_LAYER_RE = re.compile(r"^DEPTH_([0-9]+(?:\.[0-9]+)?)mm$")


def normalize_layer_style(layer_style: str | None) -> str:
    if layer_style is None:
        return DEFAULT_LAYER_STYLE

    normalized = layer_style.strip().lower()
    if not normalized:
        return DEFAULT_LAYER_STYLE
    if normalized not in {DEFAULT_LAYER_STYLE, VCARVE_LAYER_STYLE}:
        raise ValueError(f"Unsupported layer style: {layer_style}")
    return normalized


def map_layer_name(layer_name: str | None, *, layer_style: str = DEFAULT_LAYER_STYLE) -> str:
    normalized_style = normalize_layer_style(layer_style)
    base_layer = layer_name or "PROFILE"
    if normalized_style == DEFAULT_LAYER_STYLE:
        return base_layer

    if base_layer == "PROFILE":
        return "OUTSIDE_PROFILE"
    if base_layer == "HOLES":
        return "INTERIOR_OPENINGS"
    if base_layer == "SHEET_BOUNDARY":
        return "SHEET_BOUNDARY"
    if base_layer == "LABELS":
        return "LABELS"

    match = _DEPTH_LAYER_RE.match(base_layer)
    if match:
        return f"POCKET_{_format_depth_token(float(match.group(1)))}"

    return _sanitize_layer_name(base_layer)


def _format_depth_token(depth_mm: float) -> str:
    text = f"{depth_mm:.3f}".rstrip("0").rstrip(".")
    return f"{text.replace('.', 'P')}MM"


def _sanitize_layer_name(layer_name: str) -> str:
    sanitized = re.sub(r"[^A-Z0-9_]+", "_", layer_name.upper()).strip("_")
    return sanitized or "LAYER"
