from __future__ import annotations
import math
from typing import Any, Dict, List

import cadquery as cq
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.TopAbs import TopAbs_REVERSED
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


def project_body_orthographic(
    solid_cq_shape: cq.Shape,
    face_index: int,
    debug: bool = False,
) -> Dict[str, Any]:
    """
    Project ALL faces parallel to the selected face onto a shared UV plane,
    grouped by depth level. This gives the complete geometry for CNC:

      - Depth 0 (the selected plane): PROFILE (outer boundary) + HOLES (cutouts)
      - Each deeper level: DEPTH_<mm> layer, so VCarve Pro can assign cut depths

    No HLR — HLR is for drawing silhouettes, not CNC profiles.
    """
    all_faces = solid_cq_shape.Faces()
    if face_index < 0 or face_index >= len(all_faces):
        raise IndexError(f"Face index {face_index} out of range (have {len(all_faces)})")

    cq_face = all_faces[face_index]
    occ_face = cq_face.wrapped

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

    # ── Group all parallel faces by depth offset along the normal ──────────
    # depth_groups: depth_mm → [cq.Face, ...]  (sorted deepest-last)
    depth_groups: Dict[float, List] = {}
    for cq_f in all_faces:
        fa = BRepAdaptor_Surface(cq_f.wrapped)
        if fa.GetType() != GeomAbs_Plane:
            continue
        fp = fa.Plane()
        fn = fp.Axis().Direction()
        fo = fp.Location()
        if abs(fn.Dot(normal)) < 0.9999:
            continue
        depth = round(
            (fo.X() - origin.X()) * normal.X() +
            (fo.Y() - origin.Y()) * normal.Y() +
            (fo.Z() - origin.Z()) * normal.Z(),
            3
        )
        depth_groups.setdefault(depth, []).append(cq_f)

    if debug:
        for d, fs in sorted(depth_groups.items()):
            print(f"  depth {d:+.3f} mm: {len(fs)} face(s)")

    # ── Process each depth level ───────────────────────────────────────────
    edges_out = []
    seen_midpoints: set = set()

    for depth in sorted(depth_groups.keys()):
        faces_at_depth = depth_groups[depth]

        # Sort by area descending so the largest face's outer wire = PROFILE
        try:
            faces_at_depth.sort(key=lambda f: f.Area(), reverse=True)
        except Exception:
            pass

        is_first_face = True
        for cq_f in faces_at_depth:
            outer_wire = BRepTools.OuterWire_s(cq_f.wrapped)
            for wire in cq_f.Wires():
                is_outer = wire.wrapped.IsSame(outer_wire)

                if depth == 0.0:
                    # Reference plane: largest outer wire = PROFILE, rest = HOLES
                    layer = "PROFILE" if (is_outer and is_first_face) else "HOLES"
                else:
                    # Other depth levels: use a depth-labelled layer so
                    # VCarve Pro can assign cut depths by layer
                    layer = f"DEPTH_{abs(depth):.3f}mm"

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
                        e["layer"] = layer
                        edges_out.append(e)
            is_first_face = False

    return {
        "plane_origin": [origin.X(), origin.Y(), origin.Z()],
        "plane_normal": [normal.X(), normal.Y(), normal.Z()],
        "plane_x_axis": [x_axis.X(), x_axis.Y(), x_axis.Z()],
        "edges": edges_out,
    }
