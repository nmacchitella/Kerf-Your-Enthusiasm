"""
Convert 2D projected edge data (from projection.py) into a clean ezdxf DXF file.
Produces R2010 DXF with LINE, ARC, CIRCLE, LWPOLYLINE entities.
Coordinates are normalized so the part bounding box starts at (0, 0).
"""
from __future__ import annotations

import re
from pathlib import Path
import ezdxf
from ezdxf import appsettings, zoom
from ezdxf.math import Vec2

from vcarve_layers import map_layer_name, normalize_layer_style


def edges_to_dxf(
    edge_data: dict,
    output_path: str,
    body_name: str,
    *,
    layer_style: str = "default",
) -> None:
    """
    Write a DXF file from the projection result, normalized to origin (0, 0).
    """
    layer_style = normalize_layer_style(layer_style)
    edges = edge_data["edges"]
    if not edges:
        raise ValueError("No edges to export — face may have no wire boundary")

    # ── Compute bounding box ────────────────────────────────────────────
    min_u, min_v = _compute_bbox_min(edges)

    # ── DXF setup ──────────────────────────────────────────────────────
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4      # mm
    doc.header["$MEASUREMENT"] = 1   # metric

    msp = doc.modelspace()
    # Keep semantic layers in the output so downstream CAM tools can target
    # profiles, holes, and depth features independently.

    # ── Normalization helper ───────────────────────────────────────────
    def norm(pt: list[float]) -> Vec2:
        return Vec2(pt[0] - min_u, pt[1] - min_v)

    # ── Edge export loop ───────────────────────────────────────────────
    for i, edge in enumerate(edges):
        etype = edge["type"]
        edge_layer = edge.get("layer", "PROFILE")
        # Use the layer name directly so each depth gets its own DXF layer.
        # PROFILE = outer boundary (color 7, white/black)
        # HOLES   = coplanar cutouts (color 1, red)
        # DEPTH_X.XXXmm = features at depth X (color 5, blue)
        layer = map_layer_name(edge_layer, layer_style=layer_style)
        if edge_layer == "HOLES":
            color = 1
        elif edge_layer.startswith("DEPTH_"):
            color = 5
        else:
            color = 7

        if etype == "line":
            msp.add_line(
                start=norm(edge["start"]),
                end=norm(edge["end"]),
                dxfattribs={"layer": layer, "color": color},
            )

        elif etype == "arc":
            center = norm(edge["center"])
            radius = edge["radius"]

            if edge.get("is_full_circle"):
                msp.add_circle(
                    center=center,
                    radius=radius,
                    dxfattribs={"layer": layer, "color": color},
                )
            else:
                msp.add_arc(
                    center=center,
                    radius=radius,
                    start_angle=edge["start_angle"],
                    end_angle=edge["end_angle"],
                    dxfattribs={"layer": layer, "color": color},
                )

        elif etype == "polyline":
            raw_pts = edge["points"]
            pts = [norm(p) for p in raw_pts]

            # ── Ensure closure ───────────────────────────────────────────
            if len(pts) >= 2:
                if (
                    abs(pts[0].x - pts[-1].x) < 1e-6 and
                    abs(pts[0].y - pts[-1].y) < 1e-6
                ):
                    pts[-1] = pts[0]

                msp.add_lwpolyline(
                    pts,
                    format="xy",
                    close=True,
                    dxfattribs={"layer": layer, "color": color},
                )

    # Update header extents and viewport so CAD viewers open centered on the part.
    extents = appsettings.update_extents(doc)
    if extents.has_data:
        zoom.center(msp, extents.center, extents.size)

    # ── Save DXF ───────────────────────────────────────────────────────
    doc.saveas(output_path)


def _compute_bbox(edges: list[dict]) -> tuple[float, float, float, float]:
    """Return (min_u, min_v, max_u, max_v) of all coordinates in the edge list."""
    import math
    all_u: list[float] = []
    all_v: list[float] = []

    def add(pt: list[float]):
        all_u.append(pt[0])
        all_v.append(pt[1])

    for edge in edges:
        etype = edge["type"]

        if etype == "line":
            add(edge["start"])
            add(edge["end"])

        elif etype == "arc":
            cx, cy = edge["center"]
            r = edge["radius"]
            if edge.get("is_full_circle"):
                all_u.extend([cx - r, cx + r])
                all_v.extend([cy - r, cy + r])
            else:
                add(edge["start"])
                add(edge["end"])
                a0 = edge["start_angle"] % 360
                a1 = edge["end_angle"] % 360
                for angle, du, dv in [(0, r, 0), (90, 0, r), (180, -r, 0), (270, 0, -r)]:
                    if _angle_in_arc(angle, a0, a1):
                        all_u.append(cx + du)
                        all_v.append(cy + dv)

        elif etype == "polyline":
            for pt in edge["points"]:
                add(pt)

    if not all_u:
        return 0.0, 0.0, 0.0, 0.0

    return min(all_u), min(all_v), max(all_u), max(all_v)


def _compute_bbox_min(edges: list[dict]) -> tuple[float, float]:
    """Return the (min_u, min_v) of all coordinates in the edge list."""
    min_u, min_v, _, _ = _compute_bbox(edges)
    return min_u, min_v


def _angle_in_arc(angle: float, start: float, end: float) -> bool:
    """Return True if *angle* is swept by the CCW arc from *start* to *end* (degrees)."""
    angle = angle % 360
    start = start % 360
    end = end % 360
    if start <= end:
        return start <= angle <= end
    return angle >= start or angle <= end


def export_body_face(
    solid_cq_shape,
    face_index: int,
    output_dir: str,
    body_name: str,
    *,
    layer_style: str = "default",
) -> str:
    """
    Full pipeline: project face → orient portrait → normalize → write DXF.
    Returns the path to the written DXF file.
    """
    from projection import collapse_closed_line_loops, project_body_orthographic
    from sheet_export import _orient_face_portrait

    edge_data = project_body_orthographic(
        solid_cq_shape,
        face_index,
        reference_mode="selected",
    )

    # Orient portrait (U ≤ V) so the part's shorter dimension is always along X —
    # matching the orientation the sheet export and canvas use.
    edges = edge_data.get("edges", [])
    if edges:
        edges = _orient_face_portrait(edges)
        edges = collapse_closed_line_loops(edges)
        edge_data = {**edge_data, "edges": edges}

    safe_name = _safe_filename(body_name)
    out_path = str(Path(output_dir) / f"{safe_name}.dxf")

    edges_to_dxf(edge_data, out_path, body_name, layer_style=layer_style)

    return out_path


def _safe_filename(name: str) -> str:
    safe = re.sub(r'[\\/*?:"<>|]', "_", name)
    safe = safe.strip(". ")
    return safe or "export"
