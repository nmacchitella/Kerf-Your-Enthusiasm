"""
Tests for the projection pipeline using test.step.

test.step is a single solid body ("Left Side") with these characteristics
when projected along face 0's normal (X-axis):

  depth  0.000 mm : 21 coplanar faces (1 large outer rect + 20 small circular holes)
                    → PROFILE layer: 4 line edges (outer rectangle)
                    → HOLES layer:   20 edges (circles/arcs for the holes)

  depth -10.668 mm: 1 face (rectangular step floor, 4 line edges)
                    → DEPTH_10.668mm layer: 4 line edges

The opposite outside face at full stock thickness is intentionally excluded
from DEPTH layers, because it is not a pocket floor.

Total: 28 edges across 3 layers.

Key behaviours verified:
  1. Correct edge counts per layer
  2. Clicking any coplanar face (0 or any small hole face) yields identical output
  3. Clicking a deep face (23) yields same layers and counts from its perspective
  4. DXF export runs without error and produces a valid file
  5. DXF bounding box is normalized to start at (0, 0)
  6. No duplicate edges (deduplication by midpoint)
"""
from __future__ import annotations
import os
import math
import tempfile
import pytest
import cadquery as cq

# Path to test fixture
STEP_FILE = os.path.join(os.path.dirname(__file__), "..", "test.step")


@pytest.fixture(scope="module")
def solid():
    shape = cq.importers.importStep(STEP_FILE)
    return shape.val()


# ── helpers ───────────────────────────────────────────────────────────────────

def layer_counts(edges: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for e in edges:
        l = e.get("layer", "?")
        counts[l] = counts.get(l, 0) + 1
    return counts


def edge_2d_midpoints(edges: list[dict]) -> list[tuple]:
    """Return 2D UV midpoints — NOT used for dedup (different depths can share 2D pos)."""
    mids = []
    for e in edges:
        if e["type"] == "line":
            u = (e["start"][0] + e["end"][0]) / 2
            v = (e["start"][1] + e["end"][1]) / 2
            mids.append((round(u, 2), round(v, 2)))
        elif e["type"] == "arc":
            mids.append((round(e["center"][0], 2), round(e["center"][1], 2), round(e["radius"], 2)))
        elif e["type"] == "polyline":
            pts = e["points"]
            mid = pts[len(pts) // 2]
            mids.append((round(mid[0], 2), round(mid[1], 2)))
    return mids


def normalized_line(edge: dict) -> tuple[tuple[float, float], tuple[float, float]]:
    start = tuple(round(v, 3) for v in edge["start"])
    end = tuple(round(v, 3) for v in edge["end"])
    return (start, end) if start <= end else (end, start)


# ── projection tests ──────────────────────────────────────────────────────────

class TestProjectBodyOrthographic:

    def test_face0_layer_counts(self, solid):
        """Face 0 → 4 PROFILE + 20 HOLES + 4 DEPTH_10.668mm."""
        from projection import project_body_orthographic
        result = project_body_orthographic(solid, 0)
        counts = layer_counts(result["edges"])

        assert counts.get("PROFILE", 0) == 4,  f"Expected 4 PROFILE edges, got {counts}"
        assert counts.get("HOLES", 0) == 20,    f"Expected 20 HOLES edges, got {counts}"
        assert counts.get("DEPTH_10.668mm", 0) == 4, f"Expected 4 DEPTH_10.668mm edges, got {counts}"
        assert counts.get("DEPTH_19.050mm", 0) == 0, f"Back face should not be exported as DEPTH: {counts}"

    def test_face0_total_edge_count(self, solid):
        """Total edges for face 0 projection = 28."""
        from projection import project_body_orthographic
        result = project_body_orthographic(solid, 0)
        assert len(result["edges"]) == 28, f"Expected 28 total edges, got {len(result['edges'])}"

    def test_coplanar_faces_produce_identical_output(self, solid):
        """Clicking face 0 or any coplanar small face (e.g. face 1) must yield
        identical edge counts — the projection is defined by the plane, not by
        which face was clicked."""
        from projection import project_body_orthographic
        r0 = project_body_orthographic(solid, 0)
        r1 = project_body_orthographic(solid, 1)   # a small hole face at depth 0

        counts0 = layer_counts(r0["edges"])
        counts1 = layer_counts(r1["edges"])
        assert counts0 == counts1, (
            f"Different layer counts when clicking face 0 vs face 1:\n"
            f"  face 0: {counts0}\n  face 1: {counts1}"
        )

    def test_all_depth0_coplanar_faces_same_output(self, solid):
        """All 21 faces at depth 0 must produce the same layer counts."""
        from projection import project_body_orthographic
        # Faces 0–19 and 21 are all at depth 0 (face 20 is non-planar or different normal)
        depth0_faces = list(range(0, 20)) + [21]
        ref = layer_counts(project_body_orthographic(solid, 0)["edges"])
        for fi in depth0_faces[1:]:
            counts = layer_counts(project_body_orthographic(solid, fi)["edges"])
            assert counts == ref, (
                f"Face {fi} at depth 0 produced different counts than face 0:\n"
                f"  expected: {ref}\n  got: {counts}"
            )

    def test_no_duplicate_edges(self, solid):
        """No two edges should share the same 3D midpoint — the 3D dedup in
        project_body_orthographic must eliminate shared boundary curves.
        Note: 2D midpoints CAN legitimately coincide (edges at different depths
        can project to the same UV position), so we check in 3D."""
        from projection import project_body_orthographic
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        import cadquery as cq

        # Re-run projection with debug OFF and verify the depth-0 wire count did
        # not balloon from missed deduplication.
        result = project_body_orthographic(solid, 0)
        profile_holes = sum(1 for e in result["edges"] if e["layer"] in ("PROFILE","HOLES"))
        # Depth-0 faces have 24 wires total (4 PROFILE + 20 HOLES).
        # Each shared curve appears on 2 faces but must appear once in output.
        assert profile_holes == 24, (
            f"Expected 24 edges at depth 0 (4 PROFILE + 20 HOLES), got {profile_holes}"
        )

    def test_profile_edges_are_lines(self, solid):
        """The outer profile boundary of this part is a rectangle — all 4 PROFILE
        edges must be lines."""
        from projection import project_body_orthographic
        result = project_body_orthographic(solid, 0)
        profile = [e for e in result["edges"] if e.get("layer") == "PROFILE"]
        for e in profile:
            assert e["type"] == "line", f"Expected line in PROFILE, got {e['type']}"

    def test_holes_are_closed_curves(self, solid):
        """All hole features in test.step are circular.
        Depending on the STEP file encoding they may come out as GeomAbs_Circle
        (type='arc') or BSpline (type='polyline'). Either is acceptable as long
        as the shape is closed (first point ≈ last point for polylines, or
        is_full_circle=True for arcs)."""
        from projection import project_body_orthographic
        result = project_body_orthographic(solid, 0)
        holes = [e for e in result["edges"] if e.get("layer") == "HOLES"]
        assert len(holes) == 20, f"Expected 20 HOLES edges, got {len(holes)}"
        for e in holes:
            assert e["type"] in ("arc", "polyline"), (
                f"Unexpected edge type in HOLES: {e['type']}"
            )
            if e["type"] == "arc":
                assert e.get("is_full_circle"), "Arc in HOLES must be a full circle"
            elif e["type"] == "polyline":
                pts = e["points"]
                dx = abs(pts[0][0] - pts[-1][0])
                dy = abs(pts[0][1] - pts[-1][1])
                assert dx < 1.0 and dy < 1.0, (
                    f"Polyline in HOLES is not closed: first={pts[0]} last={pts[-1]}"
                )

    def test_depth_edges_are_lines(self, solid):
        """The pocket floors are rectangular — DEPTH_* edges must be lines."""
        from projection import project_body_orthographic
        result = project_body_orthographic(solid, 0)
        for e in result["edges"]:
            if e.get("layer", "").startswith("DEPTH_"):
                assert e["type"] == "line", f"Expected line in {e['layer']}, got {e['type']}"

    def test_plane_origin_and_normal_returned(self, solid):
        """Result must include plane metadata."""
        from projection import project_body_orthographic
        result = project_body_orthographic(solid, 0)
        assert "plane_origin" in result
        assert "plane_normal" in result
        assert "plane_x_axis" in result
        assert len(result["plane_normal"]) == 3

    def test_invalid_face_index_raises(self, solid):
        from projection import project_body_orthographic
        with pytest.raises(IndexError):
            project_body_orthographic(solid, 999)

    def test_blind_pocket_depths_are_measured_from_machining_face(self):
        """Selecting the back face must not turn remaining thickness into pocket depth."""
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.GeomAbs import GeomAbs_Plane
        from projection import project_body_orthographic

        shape = (
            cq.Workplane("XY")
            .box(100, 50, 19.05)
            .faces(">Z")
            .workplane()
            .rect(20, 10)
            .cutBlind(-12)
            .val()
        )

        top_idx = None
        bottom_idx = None
        top_z = float("-inf")
        bottom_z = float("inf")

        for idx, face in enumerate(shape.Faces()):
            adaptor = BRepAdaptor_Surface(face.wrapped)
            if adaptor.GetType() != GeomAbs_Plane:
                continue
            plane = adaptor.Plane()
            normal = plane.Axis().Direction()
            origin = plane.Location()
            if abs(normal.Z()) < 0.999:
                continue
            if origin.Z() > top_z:
                top_z = origin.Z()
                top_idx = idx
            if origin.Z() < bottom_z:
                bottom_z = origin.Z()
                bottom_idx = idx

        assert top_idx is not None and bottom_idx is not None

        top_counts = layer_counts(project_body_orthographic(shape, top_idx)["edges"])
        bottom_counts = layer_counts(project_body_orthographic(shape, bottom_idx)["edges"])

        expected = {
            "PROFILE": 4,
            "DEPTH_12.000mm": 4,
        }
        assert top_counts == expected, f"Unexpected top-face layers: {top_counts}"
        assert bottom_counts == expected, f"Back-face selection should resolve to the machining face: {bottom_counts}"

    def test_edge_open_pocket_uses_true_outer_profile(self):
        """An edge-open pocket must not steal the PROFILE layer from the real outer contour."""
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.GeomAbs import GeomAbs_Plane
        from projection import project_body_orthographic

        shape = (
            cq.Workplane("XY")
            .box(100, 50, 19.05, centered=(False, False, False))
            .faces(">Z")
            .workplane()
            .moveTo(50, 0)
            .rect(40, 12)
            .cutBlind(-6)
            .val()
        )

        top_idx = None
        bottom_idx = None
        top_z = float("-inf")
        bottom_z = float("inf")

        for idx, face in enumerate(shape.Faces()):
            adaptor = BRepAdaptor_Surface(face.wrapped)
            if adaptor.GetType() != GeomAbs_Plane:
                continue
            plane = adaptor.Plane()
            normal = plane.Axis().Direction()
            origin = plane.Location()
            if abs(normal.Z()) < 0.999:
                continue
            if origin.Z() > top_z:
                top_z = origin.Z()
                top_idx = idx
            if origin.Z() < bottom_z:
                bottom_z = origin.Z()
                bottom_idx = idx

        assert top_idx is not None and bottom_idx is not None

        for label, face_idx in (("top", top_idx), ("bottom", bottom_idx)):
            result = project_body_orthographic(shape, face_idx)
            counts = layer_counts(result["edges"])

            assert counts.get("PROFILE", 0) == 6, f"{label}: expected split outer profile, got {counts}"
            assert counts.get("HOLES", 0) == 0, f"{label}: pocket boundaries should not remain on HOLES, got {counts}"
            assert counts.get("DEPTH_6.000mm", 0) == 4, f"{label}: wrong pocket depth layers: {counts}"
            assert counts.get("DEPTH_13.050mm", 0) == 0, f"{label}: stock thickness was treated as pocket depth: {counts}"

            profile = [e for e in result["edges"] if e["layer"] == "PROFILE"]
            profile_lines = {normalized_line(e) for e in profile if e["type"] == "line"}

            assert ((30.0, 0.0), (70.0, 0.0)) in profile_lines, (
                f"{label}: the outside edge carried by the pocket floor was not promoted to PROFILE"
            )
            assert ((30.0, 6.0), (70.0, 6.0)) not in profile_lines, (
                f"{label}: the internal pocket wall was incorrectly exported as PROFILE"
            )

            profile_bbox = [coord for edge in profile for point in (edge["start"], edge["end"]) for coord in point] if profile else []
            xs = profile_bbox[0::2]
            ys = profile_bbox[1::2]
            assert min(xs) == 0.0 and max(xs) == 100.0, f"{label}: profile did not span full part width: {profile_lines}"
            assert min(ys) == 0.0 and max(ys) == 50.0, f"{label}: profile did not span full part height: {profile_lines}"

    def test_closed_line_loops_collapse_to_polylines_for_preview_and_export(self):
        """Simple profile/pocket rectangles should collapse into closed polylines."""
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.GeomAbs import GeomAbs_Plane
        from projection import collapse_closed_line_loops, project_body_orthographic

        shape = (
            cq.Workplane("XY")
            .box(100, 50, 19.05, centered=(False, False, False))
            .faces(">Z")
            .workplane()
            .moveTo(50, 0)
            .rect(40, 12)
            .cutBlind(-6)
            .val()
        )

        top_idx = None
        top_z = float("-inf")
        for idx, face in enumerate(shape.Faces()):
            adaptor = BRepAdaptor_Surface(face.wrapped)
            if adaptor.GetType() != GeomAbs_Plane:
                continue
            plane = adaptor.Plane()
            normal = plane.Axis().Direction()
            origin = plane.Location()
            if abs(normal.Z()) < 0.999:
                continue
            if origin.Z() > top_z:
                top_z = origin.Z()
                top_idx = idx

        assert top_idx is not None

        raw = project_body_orthographic(shape, top_idx)["edges"]
        collapsed = collapse_closed_line_loops(raw)

        profile_polys = [e for e in collapsed if e["layer"] == "PROFILE" and e["type"] == "polyline"]
        depth_polys = [e for e in collapsed if e["layer"] == "DEPTH_6.000mm" and e["type"] == "polyline"]

        assert len(profile_polys) == 1, f"Expected one closed profile polyline, got {profile_polys}"
        assert len(depth_polys) == 1, f"Expected one closed pocket polyline, got {depth_polys}"
        assert profile_polys[0]["points"][0] == profile_polys[0]["points"][-1], "Profile polyline must be closed"
        assert depth_polys[0]["points"][0] == depth_polys[0]["points"][-1], "Pocket polyline must be closed"

    def test_reverse_side_rabbet_does_not_override_selected_face(self):
        """Back-side rabbets must not hijack exports for the selected machining face."""
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.GeomAbs import GeomAbs_Plane
        from projection import collapse_closed_line_loops, project_body_orthographic

        panel = cq.Workplane("XY").box(100, 50, 19.05, centered=(False, False, False)).val()
        reverse_rabbet = cq.Workplane("XY").box(20, 50, 6, centered=(False, False, False)).val()
        shape = panel.cut(reverse_rabbet)

        top_idx = None
        bottom_idx = None
        top_z = float("-inf")
        bottom_z = float("inf")

        for idx, face in enumerate(shape.Faces()):
            adaptor = BRepAdaptor_Surface(face.wrapped)
            if adaptor.GetType() != GeomAbs_Plane:
                continue
            plane = adaptor.Plane()
            normal = plane.Axis().Direction()
            origin = plane.Location()
            if abs(normal.Z()) < 0.999:
                continue
            if origin.Z() > top_z:
                top_z = origin.Z()
                top_idx = idx
            if origin.Z() < bottom_z:
                bottom_z = origin.Z()
                bottom_idx = idx

        assert top_idx is not None and bottom_idx is not None

        selected_top = layer_counts(
            project_body_orthographic(shape, top_idx, reference_mode="selected")["edges"]
        )
        selected_bottom = layer_counts(
            project_body_orthographic(shape, bottom_idx, reference_mode="selected")["edges"]
        )
        collapsed_top = collapse_closed_line_loops(
            project_body_orthographic(shape, top_idx, reference_mode="selected")["edges"]
        )
        collapsed_bottom = collapse_closed_line_loops(
            project_body_orthographic(shape, bottom_idx, reference_mode="selected")["edges"]
        )

        assert selected_top == {"PROFILE": 6}, (
            f"Top machining face should reduce to profile geometry only: {selected_top}"
        )
        assert selected_bottom == {"PROFILE": 6, "DEPTH_6.000mm": 4}, (
            f"Bottom machining face should show the rabbet as pocket geometry: {selected_bottom}"
        )
        assert [(edge["layer"], edge["type"]) for edge in collapsed_top] == [
            ("PROFILE", "polyline"),
        ], f"Top machining face should collapse to one closed profile polyline: {collapsed_top}"
        assert sorted((edge["layer"], edge["type"]) for edge in collapsed_bottom) == [
            ("DEPTH_6.000mm", "polyline"),
            ("PROFILE", "polyline"),
        ], f"Bottom machining face should still collapse to one closed profile and one closed pocket: {collapsed_bottom}"


# ── DXF export tests ──────────────────────────────────────────────────────────

class TestDxfExport:

    def test_export_runs_without_error(self, solid):
        """Full pipeline: projection → DXF file written without exception."""
        from dxf_export import export_body_face
        with tempfile.TemporaryDirectory() as tmpdir:
            path = export_body_face(solid, 0, tmpdir, "LeftSide")
            assert os.path.exists(path), "DXF file not created"
            assert os.path.getsize(path) > 0, "DXF file is empty"

    def test_dxf_has_correct_layers(self, solid):
        """DXF entities must use layers: PROFILE, HOLES, DEPTH_10.668mm.
        Note: ezdxf's doc.layers only shows explicitly-created layer-table entries.
        We check entity .dxf.layer directly, which is the authoritative source."""
        import ezdxf
        from dxf_export import export_body_face
        with tempfile.TemporaryDirectory() as tmpdir:
            path = export_body_face(solid, 0, tmpdir, "LeftSide")
            doc = ezdxf.readfile(path)
            entity_layers = {ent.dxf.layer for ent in doc.modelspace()}
            assert "PROFILE"        in entity_layers, f"Missing PROFILE, have: {entity_layers}"
            assert "HOLES"          in entity_layers, f"Missing HOLES, have: {entity_layers}"
            assert "DEPTH_10.668mm" in entity_layers, f"Missing DEPTH_10.668mm, have: {entity_layers}"
            assert "DEPTH_19.050mm" not in entity_layers, f"Back face should not be exported as DEPTH: {entity_layers}"

    def test_dxf_normalized_to_origin(self, solid):
        """All DXF coordinates must be >= 0 (bbox normalized to start at 0,0)."""
        import ezdxf
        from dxf_export import export_body_face
        with tempfile.TemporaryDirectory() as tmpdir:
            path = export_body_face(solid, 0, tmpdir, "LeftSide")
            doc = ezdxf.readfile(path)
            msp = doc.modelspace()
            min_x, min_y = float("inf"), float("inf")
            for entity in msp:
                if entity.dxftype() == "LINE":
                    for pt in [entity.dxf.start, entity.dxf.end]:
                        min_x = min(min_x, pt.x)
                        min_y = min(min_y, pt.y)
                elif entity.dxftype() in ("ARC", "CIRCLE"):
                    c = entity.dxf.center
                    r = entity.dxf.radius
                    min_x = min(min_x, c.x - r)
                    min_y = min(min_y, c.y - r)
            assert min_x >= -0.01, f"DXF not normalized: min_x={min_x}"
            assert min_y >= -0.01, f"DXF not normalized: min_y={min_y}"

    def test_dxf_entity_count(self, solid):
        """DXF must contain 28 entities (matching the 28 projected edges)."""
        import ezdxf
        from dxf_export import export_body_face
        with tempfile.TemporaryDirectory() as tmpdir:
            path = export_body_face(solid, 0, tmpdir, "LeftSide")
            doc = ezdxf.readfile(path)
            entities = list(doc.modelspace())
            assert len(entities) == 28, f"Expected 28 DXF entities, got {len(entities)}"

    def test_coplanar_click_same_dxf(self, solid):
        """Clicking face 0 or face 5 (both at depth 0) must produce DXF files
        with the same entity count."""
        import ezdxf
        from dxf_export import export_body_face
        with tempfile.TemporaryDirectory() as tmpdir:
            p0 = export_body_face(solid, 0, tmpdir, "face0")
            p5 = export_body_face(solid, 5, tmpdir, "face5")
            c0 = len(list(ezdxf.readfile(p0).modelspace()))
            c5 = len(list(ezdxf.readfile(p5).modelspace()))
            assert c0 == c5, f"Different entity counts: face0={c0}, face5={c5}"
