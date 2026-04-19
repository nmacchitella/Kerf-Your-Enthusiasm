from __future__ import annotations
import math
from typing import Any, Dict, List

import cadquery as cq
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.TopAbs import TopAbs_IN, TopAbs_ON, TopAbs_REVERSED
from OCP.GeomAbs import (
    GeomAbs_Line, GeomAbs_Circle,
    GeomAbs_BSplineCurve, GeomAbs_BezierCurve, GeomAbs_Plane,
)
from OCP.BRepTools import BRepTools
from OCP.gp import gp_Pnt, gp_Ax2, gp_Dir


def project_face_to_2d(solid_cq_shape: cq.Shape, face_index: int, debug: bool = False) -> Dict[str, Any]:
    """
    Project ALL faces coplanar with the selected face to their shared UV plane.

    "Coplanar" means: same normal direction (parallel or anti-parallel, within
    0.01°) AND same plane offset along that normal (within 0.01 mm).

    This ensures that clicking any face on a shared surface — e.g. a small
    circular face sitting flush with the main rectangular top face — always
    produces the complete DXF profile regardless of which face the user clicked.

    Edges are deduplicated by OCC hash so shared boundary curves (e.g. a circle
    that is simultaneously an inner-hole loop of the big face AND the outer loop
    of the small circle face) appear exactly once.

    Faces are processed in descending area order so the largest face's labels
    take precedence: its outer wire → PROFILE, its inner wires → HOLES.
    All subsequent (smaller) faces' outer wires are also tagged HOLES because
    they represent features/pockets/bosses inside the main profile.

    Returns dict:
    {
      "plane_origin": [x, y, z],
      "plane_normal": [x, y, z],
      "plane_x_axis": [x, y, z],
      "edges": [ {edge dicts...} ]
    }
    """
    all_faces = solid_cq_shape.Faces()
    if face_index < 0 or face_index >= len(all_faces):
        raise IndexError(f"Face index {face_index} out of range (have {len(all_faces)})")

    cq_face = all_faces[face_index]
    occ_face = cq_face.wrapped

    # --- Establish the reference plane from the selected face ---
    adaptor_surf = BRepAdaptor_Surface(occ_face)
    if adaptor_surf.GetType() != GeomAbs_Plane:
        raise ValueError(f"Face {face_index} is not planar")

    plane = adaptor_surf.Plane()
    origin = plane.Location()
    x_axis = plane.XAxis().Direction()
    y_axis = plane.YAxis().Direction()
    normal = plane.Axis().Direction()

    def to_uv(pnt: gp_Pnt) -> list[float]:
        dx = pnt.X() - origin.X()
        dy = pnt.Y() - origin.Y()
        dz = pnt.Z() - origin.Z()
        u = dx * x_axis.X() + dy * x_axis.Y() + dz * x_axis.Z()
        v = dx * y_axis.X() + dy * y_axis.Y() + dz * y_axis.Z()
        return [u, v]

    # --- Collect every face that lies on the same plane ---
    coplanar: List[cq.Face] = []
    for cq_f in all_faces:
        fa = BRepAdaptor_Surface(cq_f.wrapped)
        if fa.GetType() != GeomAbs_Plane:
            continue
        fp = fa.Plane()
        fn = fp.Axis().Direction()
        fo = fp.Location()
        # Normals must be parallel (same or opposite direction)
        if abs(fn.Dot(normal)) < 0.9999:
            continue
        # Must lie on the same plane: distance from this face's origin to
        # the reference plane must be near zero
        offset = abs(
            (fo.X() - origin.X()) * normal.X() +
            (fo.Y() - origin.Y()) * normal.Y() +
            (fo.Z() - origin.Z()) * normal.Z()
        )
        if offset > 0.01:  # 0.01 mm tolerance
            continue
        coplanar.append(cq_f)

    # Sort coplanar faces by area descending so the largest face's outer wire
    # wins the PROFILE label when edges are deduplicated by hash.
    try:
        coplanar.sort(key=lambda f: f.Area(), reverse=True)
    except Exception:
        pass  # fall back to arbitrary order if Area() fails

    edges_out = []
    seen_midpoints: set = set()
    is_first_face = True  # tracks the largest (first) face on this plane

    for cq_f in coplanar:
        outer_wire = BRepTools.OuterWire_s(cq_f.wrapped)
        for wire in cq_f.Wires():
            is_outer = wire.wrapped.IsSame(outer_wire)
            # Only the LARGEST face's outer wire is the profile boundary.
            # Every other face's outer wire is a feature (hole/pocket/boss).
            if is_outer and is_first_face:
                layer = "PROFILE"
            else:
                layer = "HOLES"
            for edge in wire.Edges():
                # Deduplicate by 3D midpoint — two coincident edges share
                # the same midpoint regardless of OCP version.
                adaptor_mid = BRepAdaptor_Curve(edge.wrapped)
                t_mid = (adaptor_mid.FirstParameter() + adaptor_mid.LastParameter()) / 2
                pt_mid = adaptor_mid.Value(t_mid)
                mid_key = (round(pt_mid.X(), 4), round(pt_mid.Y(), 4), round(pt_mid.Z(), 4))
                if mid_key in seen_midpoints:
                    continue
                seen_midpoints.add(mid_key)
                e = _convert_edge(edge.wrapped, to_uv, normal, debug)
                if e:
                    e["layer"] = layer
                    edges_out.append(e)
        is_first_face = False

    return {
        "plane_origin": [origin.X(), origin.Y(), origin.Z()],
        "plane_normal": [normal.X(), normal.Y(), normal.Z()],
        "plane_x_axis": [x_axis.X(), x_axis.Y(), x_axis.Z()],
        "edges": edges_out,
    }


def _convert_edge(occ_edge, to_uv, plane_normal, debug=False) -> dict | None:
    """
    Convert a single OCC edge to a 2D DXF-ready edge dict.
    Handles:
    - LINE
    - CIRCLE / ARC
    - BSPLINE / BEZIER → polyline or straight-line detection
    """

    curve_adaptor = BRepAdaptor_Curve(occ_edge)
    curve_type = curve_adaptor.GetType()
    first = curve_adaptor.FirstParameter()
    last = curve_adaptor.LastParameter()
    is_reversed = occ_edge.Orientation() == TopAbs_REVERSED

    if abs(last - first) < 1e-10:
        return None

    if debug:
        print("EDGE DEBUG:", curve_type, "first/last:", first, last, "reversed:", is_reversed)

    # --- LINE ---
    if curve_type == GeomAbs_Line:
        p1 = curve_adaptor.Value(last if is_reversed else first)
        p2 = curve_adaptor.Value(first if is_reversed else last)
        start = to_uv(p1)
        end = to_uv(p2)
        if abs(end[0] - start[0]) < 1e-8 and abs(end[1] - start[1]) < 1e-8:
            return None
        return {"type": "line", "start": start, "end": end}

    # --- CIRCLE / ARC ---
    elif curve_type == GeomAbs_Circle:
        circ = curve_adaptor.Circle()
        center_3d = circ.Location()
        radius = circ.Radius()
        center_2d = to_uv(center_3d)

        is_full = abs(last - first - 2 * math.pi) < 1e-6

        p_start_geo = curve_adaptor.Value(first)
        p_end_geo = curve_adaptor.Value(last)
        p_start, p_end = (p_end_geo, p_start_geo) if is_reversed else (p_start_geo, p_end_geo)
        s2d = to_uv(p_start)
        e2d = to_uv(p_end)

        start_angle = math.degrees(math.atan2(s2d[1] - center_2d[1], s2d[0] - center_2d[0]))
        end_angle = math.degrees(math.atan2(e2d[1] - center_2d[1], e2d[0] - center_2d[0]))

        curve_ccw = circ.Axis().Direction().Dot(plane_normal) > 0
        edge_ccw = curve_ccw != is_reversed
        if not edge_ccw and not is_full:
            start_angle, end_angle = end_angle, start_angle

        return {
            "type": "arc",
            "center": center_2d,
            "radius": radius,
            "start_angle": start_angle,
            "end_angle": end_angle,
            "is_full_circle": is_full,
            "start": s2d,
            "end": e2d,
        }

    # --- BSPLINE / BEZIER fallback ---
    elif curve_type in (GeomAbs_BSplineCurve, GeomAbs_BezierCurve):
        # Check if actually a straight line disguised as spline
        p_start = curve_adaptor.Value(first)
        p_end = curve_adaptor.Value(last)
        mid = curve_adaptor.Value((first + last) / 2)

        s = to_uv(p_start)
        e = to_uv(p_end)
        m = to_uv(mid)

        dx = e[0] - s[0]
        dy = e[1] - s[1]

        if abs(dx) > 1e-8 or abs(dy) > 1e-8:
            t = ((m[0] - s[0]) * dx + (m[1] - s[1]) * dy) / (dx*dx + dy*dy)
            proj_x = s[0] + t * dx
            proj_y = s[1] + t * dy
            if abs(proj_x - m[0]) < 1e-6 and abs(proj_y - m[1]) < 1e-6:
                return {"type": "line", "start": s, "end": e}

        # Otherwise, tessellate to polyline
        n_pts = 48
        pts = []
        for i in range(n_pts + 1):
            t = (first + (last - first) * i / n_pts) if not is_reversed else \
                (last - (last - first) * i / n_pts)
            p = curve_adaptor.Value(t)
            pts.append(to_uv(p))

        deduped = [pts[0]]
        for pt in pts[1:]:
            prev = deduped[-1]
            if abs(pt[0] - prev[0]) > 1e-8 or abs(pt[1] - prev[1]) > 1e-8:
                deduped.append(pt)
        if len(deduped) < 2:
            return None
        return {"type": "polyline", "points": deduped}

    else:
        # Unknown curve → tessellate
        n_pts = 48
        pts = []
        for i in range(n_pts + 1):
            t = first + (last - first) * i / n_pts
            p = curve_adaptor.Value(t)
            pts.append(to_uv(p))
        deduped = [pts[0]]
        for pt in pts[1:]:
            prev = deduped[-1]
            if abs(pt[0] - prev[0]) > 1e-8 or abs(pt[1] - prev[1]) > 1e-8:
                deduped.append(pt)
        if len(deduped) < 2:
            return None
        return {"type": "polyline", "points": deduped}


def _round_uv(pt: list[float], digits: int = 4) -> tuple[float, float]:
    return (round(pt[0], digits), round(pt[1], digits))


def _edge_projection_key(edge: dict) -> tuple:
    """Return an orientation-stable key for projected 2D edge geometry."""
    etype = edge["type"]

    if etype == "line":
        start = _round_uv(edge["start"])
        end = _round_uv(edge["end"])
        return ("line", start, end) if start <= end else ("line", end, start)

    if etype == "arc":
        center = _round_uv(edge["center"])
        radius = round(edge["radius"], 4)
        if edge.get("is_full_circle"):
            return ("circle", center, radius)

        start = _round_uv(edge["start"])
        end = _round_uv(edge["end"])
        sweep = round((edge["end_angle"] - edge["start_angle"]) % 360.0, 4)
        ends = (start, end) if start <= end else (end, start)
        return ("arc", center, radius, ends, sweep)

    pts = [_round_uv(pt) for pt in edge["points"]]
    rev = list(reversed(pts))
    canonical = tuple(pts if pts <= rev else rev)
    return ("polyline", canonical)


def _edge_endpoint_keys(edge: dict) -> list[tuple[float, float]]:
    """Return endpoint keys used to connect boundary edges into loops/components."""
    etype = edge["type"]

    if etype == "line":
        return [_round_uv(edge["start"]), _round_uv(edge["end"])]

    if etype == "arc":
        if edge.get("is_full_circle"):
            return []
        return [_round_uv(edge["start"]), _round_uv(edge["end"])]

    pts = edge.get("points", [])
    if not pts:
        return []

    start = _round_uv(pts[0])
    end = _round_uv(pts[-1])
    if start == end:
        return []
    return [start, end]


def _edge_bbox(edge: dict) -> tuple[float, float, float, float]:
    """Return (min_u, min_v, max_u, max_v) for a single projected edge."""
    etype = edge["type"]

    if etype == "line":
        u0, v0 = edge["start"]
        u1, v1 = edge["end"]
        return (min(u0, u1), min(v0, v1), max(u0, u1), max(v0, v1))

    if etype == "arc":
        cx, cy = edge["center"]
        r = edge["radius"]
        if edge.get("is_full_circle"):
            return (cx - r, cy - r, cx + r, cy + r)
        pts = [edge["start"], edge["end"]]
        start = edge["start_angle"] % 360
        end = edge["end_angle"] % 360
        for angle, du, dv in ((0, r, 0), (90, 0, r), (180, -r, 0), (270, 0, -r)):
            if _angle_in_arc(angle, start, end):
                pts.append([cx + du, cy + dv])
        us = [pt[0] for pt in pts]
        vs = [pt[1] for pt in pts]
        return (min(us), min(vs), max(us), max(vs))

    pts = edge.get("points", [])
    if not pts:
        return (0.0, 0.0, 0.0, 0.0)
    us = [pt[0] for pt in pts]
    vs = [pt[1] for pt in pts]
    return (min(us), min(vs), max(us), max(vs))


def _edges_bbox(edges: List[dict]) -> tuple[float, float, float, float]:
    if not edges:
        return (0.0, 0.0, 0.0, 0.0)

    min_u = float("inf")
    min_v = float("inf")
    max_u = float("-inf")
    max_v = float("-inf")

    for edge in edges:
        e_min_u, e_min_v, e_max_u, e_max_v = _edge_bbox(edge)
        min_u = min(min_u, e_min_u)
        min_v = min(min_v, e_min_v)
        max_u = max(max_u, e_max_u)
        max_v = max(max_v, e_max_v)

    return (min_u, min_v, max_u, max_v)


def _connected_components(edges: List[dict]) -> List[List[dict]]:
    """Group projected boundary edges into connected loops/components."""
    if not edges:
        return []

    endpoint_to_indices: dict[tuple[float, float], set[int]] = {}
    endpoints_by_index: list[list[tuple[float, float]]] = []

    for idx, edge in enumerate(edges):
        endpoints = _edge_endpoint_keys(edge)
        endpoints_by_index.append(endpoints)
        for endpoint in set(endpoints):
            endpoint_to_indices.setdefault(endpoint, set()).add(idx)

    visited: set[int] = set()
    components: List[List[dict]] = []

    for start_idx in range(len(edges)):
        if start_idx in visited:
            continue

        stack = [start_idx]
        component: List[dict] = []

        while stack:
            idx = stack.pop()
            if idx in visited:
                continue

            visited.add(idx)
            component.append(edges[idx])

            for endpoint in endpoints_by_index[idx]:
                for neighbor_idx in endpoint_to_indices.get(endpoint, ()):
                    if neighbor_idx not in visited:
                        stack.append(neighbor_idx)

        components.append(component)

    return components


def _reverse_projected_edge(edge: dict) -> dict:
    reversed_edge = dict(edge)

    if edge["type"] == "line":
        reversed_edge["start"] = edge["end"]
        reversed_edge["end"] = edge["start"]
        return reversed_edge

    if edge["type"] == "arc":
        reversed_edge["start"] = edge["end"]
        reversed_edge["end"] = edge["start"]
        reversed_edge["start_angle"] = edge["end_angle"]
        reversed_edge["end_angle"] = edge["start_angle"]
        return reversed_edge

    reversed_edge["points"] = list(reversed(edge.get("points", [])))
    return reversed_edge


def _split_line_edges_at_vertices(edges: List[dict], tol: float = 0.01) -> List[dict]:
    """
    Split line edges anywhere another boundary vertex lies on top of them.

    This normalizes long silhouette segments against shorter coincident steps so
    duplicate profile edges can be deduplicated cleanly.
    """
    if not edges:
        return []

    line_vertices = {
        _round_uv(edge["start"], 6)
        for edge in edges
        if edge.get("type") == "line"
    }
    line_vertices.update(
        _round_uv(edge["end"], 6)
        for edge in edges
        if edge.get("type") == "line"
    )

    out: List[dict] = []
    seen: set[tuple] = set()

    for edge in edges:
        if edge.get("type") != "line":
            key = _edge_projection_key(edge)
            if key not in seen:
                seen.add(key)
                out.append(edge)
            continue

        start = edge["start"]
        end = edge["end"]
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq < 1e-12:
            continue
        seg_len = math.sqrt(seg_len_sq)
        endpoint_tol_t = min(0.49, tol / max(seg_len, tol))

        points_on_segment: list[tuple[float, float, float]] = [(0.0, start[0], start[1]), (1.0, end[0], end[1])]
        for pt in line_vertices:
            px, py = pt
            cross = abs((px - start[0]) * dy - (py - start[1]) * dx)
            if cross > tol * max(1.0, math.sqrt(seg_len_sq)):
                continue

            t = ((px - start[0]) * dx + (py - start[1]) * dy) / seg_len_sq
            if t <= endpoint_tol_t or t >= 1.0 - endpoint_tol_t:
                continue

            closest_x = start[0] + t * dx
            closest_y = start[1] + t * dy
            if math.hypot(px - closest_x, py - closest_y) > tol:
                continue

            points_on_segment.append((t, px, py))

        points_on_segment.sort(key=lambda item: item[0])
        for (_, x0, y0), (_, x1, y1) in zip(points_on_segment, points_on_segment[1:]):
            if math.hypot(x1 - x0, y1 - y0) <= tol:
                continue
            segment = {"type": "line", "start": [x0, y0], "end": [x1, y1]}
            key = _edge_projection_key(segment)
            if key in seen:
                continue
            seen.add(key)
            out.append(segment)

    return out


def _line_is_covered_by_segments(line_edge: dict, segments: List[dict], tol: float = 0.01) -> bool:
    if line_edge.get("type") != "line":
        return False

    start = line_edge["start"]
    end = line_edge["end"]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < 1e-12:
        return False

    def _point_distance_sq(px: float, py: float, t: float) -> float:
        qx = start[0] + t * dx
        qy = start[1] + t * dy
        return (px - qx) ** 2 + (py - qy) ** 2

    intervals: list[tuple[float, float]] = []
    for segment in segments:
        if segment.get("type") != "line":
            continue

        pts = [segment["start"], segment["end"]]
        projections: list[float] = []
        valid = True
        for px, py in pts:
            t = ((px - start[0]) * dx + (py - start[1]) * dy) / seg_len_sq
            if _point_distance_sq(px, py, t) > tol * tol:
                valid = False
                break
            projections.append(t)

        if not valid:
            continue

        t0, t1 = sorted(projections)
        if t1 < 0.0 - tol or t0 > 1.0 + tol:
            continue

        intervals.append((max(0.0, t0), min(1.0, t1)))

    if not intervals:
        return False

    intervals.sort()
    merged_start, merged_end = intervals[0]
    for start_t, end_t in intervals[1:]:
        if start_t <= merged_end + tol:
            merged_end = max(merged_end, end_t)
        else:
            return False

    return merged_start <= tol and merged_end >= 1.0 - tol


def _filter_closed_hole_components(edges: List[dict]) -> List[dict]:
    """
    Keep only closed HOLES components.

    Open red chains are usually selected-face artifacts, not true cutouts.
    """
    hole_entries = [(idx, edge) for idx, edge in enumerate(edges) if edge.get("layer") == "HOLES"]
    if not hole_entries:
        return edges

    hole_edges = [edge for _, edge in hole_entries]
    hole_index_by_id = {id(edge): idx for idx, edge in hole_entries}
    keep_indices: set[int] = set()

    for component in _connected_components(hole_edges):
        endpoint_counts: dict[tuple[float, float], int] = {}
        for edge in component:
            for endpoint in _edge_endpoint_keys(edge):
                endpoint_counts[endpoint] = endpoint_counts.get(endpoint, 0) + 1

        is_closed = not endpoint_counts or all(count == 2 for count in endpoint_counts.values())
        if not is_closed:
            continue

        for edge in component:
            keep_indices.add(hole_index_by_id[id(edge)])

    out = []
    for idx, edge in enumerate(edges):
        if edge.get("layer") != "HOLES" or idx in keep_indices:
            out.append(edge)
    return out


def _closed_line_component_to_polyline(component: List[dict], layer: str | None) -> dict | None:
    """Convert a simple closed line loop into a single polyline edge."""
    if not component or any(edge.get("type") != "line" for edge in component):
        return None

    edge_ids = {id(edge): idx for idx, edge in enumerate(component)}
    adjacency: dict[tuple[float, float], list[tuple[int, tuple[float, float]]]] = {}

    for edge in component:
        start = _round_uv(edge["start"])
        end = _round_uv(edge["end"])
        if start == end:
            return None

        idx = edge_ids[id(edge)]
        adjacency.setdefault(start, []).append((idx, end))
        adjacency.setdefault(end, []).append((idx, start))

    if len(adjacency) < 3 or any(len(neighbors) != 2 for neighbors in adjacency.values()):
        return None

    start_point = min(adjacency)
    current = start_point
    previous_point: tuple[float, float] | None = None
    used_edges: set[int] = set()
    points: list[list[float]] = [[start_point[0], start_point[1]]]

    for _ in range(len(component)):
        candidates = sorted(adjacency[current], key=lambda item: item[1])
        next_edge_idx = None
        next_point = None

        for edge_idx, neighbor in candidates:
            if edge_idx in used_edges:
                continue
            if previous_point is not None and neighbor == previous_point and len(candidates) > 1:
                continue
            next_edge_idx = edge_idx
            next_point = neighbor
            break

        if next_edge_idx is None or next_point is None:
            return None

        used_edges.add(next_edge_idx)
        points.append([next_point[0], next_point[1]])
        previous_point, current = current, next_point

    if len(used_edges) != len(component) or current != start_point:
        return None

    if points[0] != points[-1]:
        points.append(points[0])

    return {"type": "polyline", "points": points, "layer": layer}


def collapse_closed_line_loops(edges: List[dict]) -> List[dict]:
    """
    Collapse simple closed line loops into polyline edges.

    This keeps the semantic layers intact while giving preview/DXF consumers a
    single closed vector for rectangular profiles and pockets.
    """
    if not edges:
        return []

    merged_entries: list[tuple[int, dict]] = []
    consumed_indices: set[int] = set()
    grouped: dict[str | None, list[tuple[int, dict]]] = {}

    for idx, edge in enumerate(edges):
        if edge.get("type") != "line":
            continue
        grouped.setdefault(edge.get("layer"), []).append((idx, edge))

    for layer, indexed_edges in grouped.items():
        component_edges = [edge for _, edge in indexed_edges]
        if not component_edges:
            continue

        component_index_lookup = {id(edge): idx for idx, edge in indexed_edges}
        for component in _connected_components(component_edges):
            polyline = _closed_line_component_to_polyline(component, layer)
            if polyline is None:
                continue

            original_indices = [component_index_lookup[id(edge)] for edge in component]
            consumed_indices.update(original_indices)
            merged_entries.append((min(original_indices), polyline))

    out: list[tuple[int, dict]] = []
    for idx, edge in enumerate(edges):
        if idx in consumed_indices:
            continue
        out.append((idx, edge))

    out.extend(merged_entries)
    out.sort(key=lambda item: item[0])
    return [edge for _, edge in out]


def _edge_midpoint_and_tangent(edge: dict) -> tuple[list[float], list[float]] | None:
    if edge["type"] == "line":
        start = edge["start"]
        end = edge["end"]
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        if math.hypot(dx, dy) < 1e-8:
            return None
        return ([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], [dx, dy])

    if edge["type"] == "arc":
        if edge.get("is_full_circle"):
            return None
        sweep = (edge["end_angle"] - edge["start_angle"]) % 360.0
        if math.isclose(sweep, 0.0, abs_tol=1e-6):
            sweep = 360.0
        mid_angle = math.radians(edge["start_angle"] + sweep / 2.0)
        return (
            [
                edge["center"][0] + edge["radius"] * math.cos(mid_angle),
                edge["center"][1] + edge["radius"] * math.sin(mid_angle),
            ],
            [-math.sin(mid_angle), math.cos(mid_angle)],
        )

    pts = edge.get("points", [])
    if len(pts) < 2:
        return None

    segment_lengths: list[tuple[float, int]] = []
    total_length = 0.0
    for idx in range(len(pts) - 1):
        dx = pts[idx + 1][0] - pts[idx][0]
        dy = pts[idx + 1][1] - pts[idx][1]
        seg_len = math.hypot(dx, dy)
        if seg_len > 1e-8:
            segment_lengths.append((seg_len, idx))
            total_length += seg_len

    if not segment_lengths:
        return None

    midpoint_target = total_length / 2.0
    travelled = 0.0
    chosen_idx = segment_lengths[0][1]
    for seg_len, idx in segment_lengths:
        if travelled + seg_len >= midpoint_target:
            chosen_idx = idx
            break
        travelled += seg_len

    start = pts[chosen_idx]
    end = pts[chosen_idx + 1]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if math.hypot(dx, dy) < 1e-8:
        return None

    return ([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], [dx, dy])


def _point_on_parallel_face_plane(
    origin: gp_Pnt,
    normal,
    x_axis,
    y_axis,
    signed_depth: float,
    uv: list[float],
) -> gp_Pnt:
    return gp_Pnt(
        origin.X() + signed_depth * normal.X() + uv[0] * x_axis.X() + uv[1] * y_axis.X(),
        origin.Y() + signed_depth * normal.Y() + uv[0] * x_axis.Y() + uv[1] * y_axis.Y(),
        origin.Z() + signed_depth * normal.Z() + uv[0] * x_axis.Z() + uv[1] * y_axis.Z(),
    )


def _union_contains_projected_uv(
    face_regions: List[tuple],
    origin: gp_Pnt,
    normal,
    x_axis,
    y_axis,
    uv: list[float],
    tol: float = 1e-5,
) -> bool:
    for cq_face, signed_depth in face_regions:
        point = _point_on_parallel_face_plane(origin, normal, x_axis, y_axis, signed_depth, uv)
        state = BRepClass_FaceClassifier(cq_face.wrapped, point, tol).State()
        if state in (TopAbs_IN, TopAbs_ON):
            return True
    return False


def _outer_profile_edges_from_face_union(
    candidate_edges: List[dict],
    face_regions: List[tuple],
    origin: gp_Pnt,
    normal,
    x_axis,
    y_axis,
) -> List[dict]:
    """
    Identify the true outer projection boundary of all parallel face regions.

    This treats each parallel face as filled material in the selected 2D plane,
    then keeps only edges that have material on exactly one side. That lets the
    outside silhouette survive even when multiple depth planes project the same
    edge, while still canceling internal pocket-step walls.
    """
    if not candidate_edges or not face_regions:
        return []

    boundary_edges: List[dict] = []

    for candidate in candidate_edges:
        sample = _edge_midpoint_and_tangent(candidate)
        if sample is None:
            continue

        midpoint, tangent = sample
        tangent_len = math.hypot(tangent[0], tangent[1])
        if tangent_len < 1e-8:
            continue

        scales = [1.0, 0.25, 0.05]
        base_offset = min(0.05, 0.25 * tangent_len)
        if base_offset < 0.005:
            base_offset = 0.005

        left_inside = None
        right_inside = None

        for scale in scales:
            offset = base_offset * scale
            left = [
                midpoint[0] - tangent[1] / tangent_len * offset,
                midpoint[1] + tangent[0] / tangent_len * offset,
            ]
            right = [
                midpoint[0] + tangent[1] / tangent_len * offset,
                midpoint[1] - tangent[0] / tangent_len * offset,
            ]

            left_inside = _union_contains_projected_uv(
                face_regions, origin, normal, x_axis, y_axis, left
            )
            right_inside = _union_contains_projected_uv(
                face_regions, origin, normal, x_axis, y_axis, right
            )
            if left_inside != right_inside:
                break

        if left_inside is None or right_inside is None or left_inside == right_inside:
            continue

        edge = candidate if left_inside else _reverse_projected_edge(candidate)
        boundary_edges.append(edge)

    if not boundary_edges:
        return []

    best_component: List[dict] = []
    best_score = (-1, -1.0, -1)
    global_bbox = _edges_bbox(boundary_edges)
    tol = 0.01

    for component in _connected_components(boundary_edges):
        min_u, min_v, max_u, max_v = _edges_bbox(component)
        touches = sum([
            math.isclose(min_u, global_bbox[0], abs_tol=tol),
            math.isclose(min_v, global_bbox[1], abs_tol=tol),
            math.isclose(max_u, global_bbox[2], abs_tol=tol),
            math.isclose(max_v, global_bbox[3], abs_tol=tol),
        ])
        bbox_area = max(0.0, max_u - min_u) * max(0.0, max_v - min_v)
        score = (touches, bbox_area, len(component))
        if score > best_score:
            best_component = component
            best_score = score

    return best_component


def _filter_selected_side_depth_edges(raw_edges: List[dict], profile_keys: set[tuple]) -> List[dict]:
    """
    Keep only depth features that are reachable from openings on the selected face.

    This filters out reverse-side rabbets/pockets when the user has already
    chosen the machining face, while still allowing deeper nested pocket steps
    to chain through shallower included pocket floors.
    """
    if not raw_edges:
        return []

    kept = [
        edge for edge in raw_edges
        if math.isclose(edge["_depth"], 0.0, abs_tol=0.01)
    ]
    profile_edges = [
        edge for edge in raw_edges
        if edge["_profile_key"] in profile_keys
    ]
    profile_bbox = _edges_bbox(profile_edges or kept)

    def _is_outer_profile_edge(edge: dict) -> bool:
        min_u, min_v, max_u, max_v = _edge_bbox(edge)
        return (
            (math.isclose(min_u, max_u, abs_tol=0.01) and (
                math.isclose(min_u, profile_bbox[0], abs_tol=0.01) or
                math.isclose(min_u, profile_bbox[2], abs_tol=0.01)
            )) or
            (math.isclose(min_v, max_v, abs_tol=0.01) and (
                math.isclose(min_v, profile_bbox[1], abs_tol=0.01) or
                math.isclose(min_v, profile_bbox[3], abs_tol=0.01)
            ))
        )

    accessible_keys = {
        edge["_profile_key"]
        for edge in kept
        if (
            edge.get("layer") == "HOLES"
            and edge["_profile_key"] not in profile_keys
            and not _is_outer_profile_edge(edge)
        )
    }

    components_by_depth: dict[float, dict[int, List[dict]]] = {}
    for edge in raw_edges:
        if math.isclose(edge["_depth"], 0.0, abs_tol=0.01):
            continue
        components = components_by_depth.setdefault(edge["_depth"], {})
        components.setdefault(edge["_component_id"], []).append(edge)

    for depth in sorted(components_by_depth.keys()):
        pending = list(components_by_depth[depth].values())
        progressed = True

        while pending and progressed:
            progressed = False
            remaining: list[List[dict]] = []

            for component_edges in pending:
                if any(edge["_profile_key"] in accessible_keys for edge in component_edges):
                    kept.extend(component_edges)
                    accessible_keys.update(edge["_profile_key"] for edge in component_edges)
                    progressed = True
                else:
                    remaining.append(component_edges)

            pending = remaining

    return kept


def _outer_profile_keys(edges: List[dict]) -> set[tuple]:
    """
    Identify the projected outer profile component.

    The true outer contour is the connected boundary component that reaches the
    global projected extents of the visible machining-side geometry. Shared
    pocket-step boundaries disappear because they are present twice in 2D: once
    on the shallower face and once on the deeper pocket floor.
    """
    if not edges:
        return set()

    counts: dict[tuple, int] = {}
    for edge in edges:
        key = edge["_profile_key"]
        counts[key] = counts.get(key, 0) + 1

    boundary_edges = [edge for edge in edges if counts.get(edge["_profile_key"], 0) == 1]
    if not boundary_edges:
        return set()

    global_bbox = _edges_bbox(boundary_edges)
    tol = 0.01
    best_component: List[dict] = []
    best_score = (-1, -1.0, -1)

    for component in _connected_components(boundary_edges):
        min_u, min_v, max_u, max_v = _edges_bbox(component)
        touches = sum([
            math.isclose(min_u, global_bbox[0], abs_tol=tol),
            math.isclose(min_v, global_bbox[1], abs_tol=tol),
            math.isclose(max_u, global_bbox[2], abs_tol=tol),
            math.isclose(max_v, global_bbox[3], abs_tol=tol),
        ])
        bbox_area = max(0.0, max_u - min_u) * max(0.0, max_v - min_v)
        score = (touches, bbox_area, len(component))
        if score > best_score:
            best_component = component
            best_score = score

    return {edge["_profile_key"] for edge in best_component}


def _angle_in_arc(angle: float, start: float, end: float) -> bool:
    angle = angle % 360
    start = start % 360
    end = end % 360
    if start <= end:
        return start <= angle <= end
    return angle >= start or angle <= end


def _face_wire_stats(cq_face) -> tuple[int, int]:
    """Return (inner_wire_count, total_wire_count) for a planar face."""
    outer_wire = BRepTools.OuterWire_s(cq_face.wrapped)
    inner_wires = 0
    total_wires = 0

    for wire in cq_face.Wires():
        total_wires += 1
        if not wire.wrapped.IsSame(outer_wire):
            inner_wires += 1

    return inner_wires, total_wires


def _depth_group_priority(faces: List) -> tuple[int, int, int, float]:
    """
    Rank candidate outer planes for machining-face selection.

    Prefer the plane that looks most like the user-facing machining side:
      1. more inner wires (pocket openings / through-holes),
      2. more coplanar faces,
      3. more total wires,
      4. smaller total face area on that plane (material has been removed there).
    """
    inner_wire_count = 0
    total_wire_count = 0
    total_face_area = 0.0

    for cq_f in faces:
        inner_wires, total_wires = _face_wire_stats(cq_f)
        inner_wire_count += inner_wires
        total_wire_count += total_wires
        try:
            total_face_area += cq_f.Area()
        except Exception:
            pass

    return (inner_wire_count, len(faces), total_wire_count, -total_face_area)


def _choose_reference_depth(depth_groups: Dict[float, List]) -> float:
    """
    Pick which parallel outer plane should be treated as depth=0.

    If the selected face was actually the back face, this flips the reference to
    the opposite outer plane so pocket depths are measured from the machining
    surface rather than from the remaining stock under the pocket.
    """
    depths = sorted(depth_groups.keys())
    if not depths:
        return 0.0
    if len(depths) == 1:
        return depths[0]

    candidate_depths = [depths[0], depths[-1]]
    best_depth = candidate_depths[0]
    best_score = _depth_group_priority(depth_groups[best_depth])

    for depth in candidate_depths[1:]:
        score = _depth_group_priority(depth_groups[depth])
        if score > best_score:
            best_depth = depth
            best_score = score
        elif score == best_score and math.isclose(depth, 0.0, abs_tol=1e-3):
            # On ties, preserve the user's selected outer face if it is already a
            # reasonable machining surface.
            best_depth = depth

    return best_depth


def project_body_orthographic(
    solid_cq_shape: cq.Shape,
    face_index: int,
    *,
    reference_mode: str = "auto",
    debug: bool = False,
) -> Dict[str, Any]:
    """
    Project all faces parallel to the selected face onto a shared UV plane,
    grouped by depth level from the machining surface:

      - Depth 0: PROFILE (outer boundary) + HOLES (true cutouts/openings)
      - Intermediate deeper levels: DEPTH_<mm> layers for pocket floors / steps

    The opposite outside face of the part is intentionally excluded from DEPTH
    layers, because that is stock thickness, not a pocket depth.

    reference_mode:
      - "auto": keep the legacy heuristic that can reinterpret the opposite
        outer face as the machining side for depth calculations.
      - "selected": treat the user-selected face's plane as authoritative.

    No HLR — HLR is for drawing silhouettes, not CNC profiles.
    """
    if reference_mode not in {"auto", "selected"}:
        raise ValueError(f"Unsupported reference_mode: {reference_mode}")

    all_faces = solid_cq_shape.Faces()
    if face_index < 0 or face_index >= len(all_faces):
        raise IndexError(f"Face index {face_index} out of range (have {len(all_faces)})")

    selected_face = all_faces[face_index]
    selected_adaptor = BRepAdaptor_Surface(selected_face.wrapped)
    if selected_adaptor.GetType() != GeomAbs_Plane:
        raise ValueError(f"Face {face_index} is not planar")

    selected_plane = selected_adaptor.Plane()
    selected_origin = selected_plane.Location()
    selected_normal = selected_plane.Axis().Direction()

    # First pass: group by signed depth relative to the clicked face so we can
    # decide whether the selected side is the machining face or the back face.
    signed_depth_groups: Dict[float, List] = {}
    for cq_f in all_faces:
        fa = BRepAdaptor_Surface(cq_f.wrapped)
        if fa.GetType() != GeomAbs_Plane:
            continue
        fp = fa.Plane()
        fn = fp.Axis().Direction()
        fo = fp.Location()
        if abs(fn.Dot(selected_normal)) < 0.9999:
            continue
        depth = round(
            (fo.X() - selected_origin.X()) * selected_normal.X() +
            (fo.Y() - selected_origin.Y()) * selected_normal.Y() +
            (fo.Z() - selected_origin.Z()) * selected_normal.Z(),
            3
        )
        signed_depth_groups.setdefault(depth, []).append(cq_f)

    reference_depth = 0.0 if reference_mode == "selected" else _choose_reference_depth(signed_depth_groups)
    reference_faces = signed_depth_groups.get(reference_depth, [selected_face])
    try:
        reference_face = max(reference_faces, key=lambda f: f.Area())
    except Exception:
        reference_face = reference_faces[0]

    reference_adaptor = BRepAdaptor_Surface(reference_face.wrapped)
    reference_plane = reference_adaptor.Plane()
    origin = reference_plane.Location()
    x_axis = reference_plane.XAxis().Direction()
    y_axis = reference_plane.YAxis().Direction()
    normal = reference_plane.Axis().Direction()

    def to_uv(pnt: gp_Pnt) -> list[float]:
        dx = pnt.X() - origin.X()
        dy = pnt.Y() - origin.Y()
        dz = pnt.Z() - origin.Z()
        u = dx * x_axis.X() + dy * x_axis.Y() + dz * x_axis.Z()
        v = dx * y_axis.X() + dy * y_axis.Y() + dz * y_axis.Z()
        return [u, v]

    # ── Group all parallel faces by absolute depth from the chosen machining
    #    face. Because the reference is an outer plane, all real pocket floors
    #    are intermediate depths and the farthest plane is the back face.
    depth_groups: Dict[float, List] = {}
    parallel_face_regions: List[tuple] = []
    profile_candidate_edges: dict[tuple, dict] = {}
    for cq_f in all_faces:
        fa = BRepAdaptor_Surface(cq_f.wrapped)
        if fa.GetType() != GeomAbs_Plane:
            continue
        fp = fa.Plane()
        fn = fp.Axis().Direction()
        fo = fp.Location()
        if abs(fn.Dot(normal)) < 0.9999:
            continue
        signed_depth = round(
            (fo.X() - origin.X()) * normal.X() +
            (fo.Y() - origin.Y()) * normal.Y() +
            (fo.Z() - origin.Z()) * normal.Z(),
            6
        )
        depth = round(abs(signed_depth), 3)
        depth_groups.setdefault(depth, []).append(cq_f)
        parallel_face_regions.append((cq_f, signed_depth))

        for wire in cq_f.Wires():
            for edge in wire.Edges():
                projected = _convert_edge(edge.wrapped, to_uv, normal, debug)
                if projected and not (projected["type"] == "arc" and projected.get("is_full_circle")):
                    profile_candidate_edges.setdefault(_edge_projection_key(projected), projected)

    if debug:
        for d, fs in sorted(depth_groups.items()):
            print(f"  depth {d:+.3f} mm: {len(fs)} face(s)")

    profile_boundary = _outer_profile_edges_from_face_union(
        list(profile_candidate_edges.values()),
        parallel_face_regions,
        origin,
        normal,
        x_axis,
        y_axis,
    )
    profile_boundary = _split_line_edges_at_vertices(profile_boundary)
    profile_keys = {_edge_projection_key(edge) for edge in profile_boundary}

    # ── Process each depth level ───────────────────────────────────────────
    raw_edges = []
    seen_midpoints: set = set()
    nonzero_depths = [depth for depth in depth_groups.keys() if depth > 0.01]
    back_face_depth = max(nonzero_depths) if nonzero_depths else None
    component_id = 0

    for depth in sorted(depth_groups.keys()):
        if back_face_depth is not None and math.isclose(depth, back_face_depth, abs_tol=0.01):
            # The farthest parallel plane is the opposite outside skin of the
            # part. Keep it out of DEPTH layers so only real pocket floors / step
            # levels remain.
            continue

        faces_at_depth = depth_groups[depth]

        try:
            faces_at_depth.sort(key=lambda f: f.Area(), reverse=True)
        except Exception:
            pass

        for cq_f in faces_at_depth:
            outer_wire = BRepTools.OuterWire_s(cq_f.wrapped)
            for wire in cq_f.Wires():
                layer = "HOLES" if depth == 0.0 else f"DEPTH_{abs(depth):.3f}mm"
                component_id += 1

                for edge in wire.Edges():
                    # Deduplicate by 3D midpoint
                    try:
                        ac = BRepAdaptor_Curve(edge.wrapped)
                        t_mid = (ac.FirstParameter() + ac.LastParameter()) / 2
                        pt = ac.Value(t_mid)
                        key = (round(pt.X(), 3), round(pt.Y(), 3), round(pt.Z(), 3))
                        if key in seen_midpoints:
                            continue
                        seen_midpoints.add(key)
                    except Exception:
                        pass

                    e = _convert_edge(edge.wrapped, to_uv, normal, debug)
                    if e:
                        raw_edges.append({
                            **e,
                            "layer": layer,
                            "_depth": depth,
                            "_component_id": component_id,
                            "_profile_key": _edge_projection_key(e),
                        })

    if reference_mode == "selected":
        raw_edges = _filter_selected_side_depth_edges(raw_edges, profile_keys)

    # Pocket openings on the machining face duplicate the same boundary that is
    # already exported on the deeper DEPTH_* layer. Keep only the depth-layer
    # version so previews and VCarve imports see pockets as pockets, not as
    # extra red hole/cutout geometry.
    depth_keys = {
        edge["_profile_key"]
        for edge in raw_edges
        if isinstance(edge.get("layer"), str) and edge["layer"].startswith("DEPTH_")
    }
    profile_line_segments = [edge for edge in profile_boundary if edge.get("type") == "line"]
    edges_out = []

    for edge in raw_edges:
        if (
            edge["layer"] == "HOLES"
            and math.isclose(edge["_depth"], 0.0, abs_tol=0.01)
            and (
                edge["_profile_key"] in depth_keys
                or edge["_profile_key"] in profile_keys
                or _line_is_covered_by_segments(edge, profile_line_segments)
            )
        ):
            continue

        clean_edge = {k: v for k, v in edge.items() if not k.startswith("_")}
        edges_out.append(clean_edge)

    profile_present: set[tuple] = set()
    for edge in profile_boundary:
        key = _edge_projection_key(edge)
        if key in profile_present:
            continue
        profile_present.add(key)
        edges_out.append({**edge, "layer": "PROFILE"})

    edges_out = _filter_closed_hole_components(edges_out)

    return {
        "plane_origin": [origin.X(), origin.Y(), origin.Z()],
        "plane_normal": [normal.X(), normal.Y(), normal.Z()],
        "plane_x_axis": [x_axis.X(), x_axis.Y(), x_axis.Z()],
        "edges": edges_out,
    }
