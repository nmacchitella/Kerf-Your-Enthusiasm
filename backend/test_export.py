"""
End-to-end export tests.  Run with: .venv/bin/python3 test_export.py
"""
import sys
import tempfile

import cadquery as cq
import ezdxf

from step_loader import load_bodies
from projection import project_face_to_2d
from dxf_export import export_body_face
from OCP.BRepTools import BRepTools

PASS = "✓"
FAIL = "✗"
failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failures
    if cond:
        print(f"  {PASS} {name}")
    else:
        print(f"  {FAIL} {name}" + (f": {detail}" if detail else ""))
        failures += 1


# ── Test 1: Simple box ──────────────────────────────────────────────────────

print("\n[1] Simple box (100×80×50) — all faces are rectangular")
box = cq.Workplane().box(100, 80, 50).val()
for face_idx in range(len(box.Faces())):
    result = project_face_to_2d(box, face_idx)
    profile = [e for e in result["edges"] if e["layer"] == "PROFILE"]
    check(
        f"face {face_idx}: PROFILE = 4 lines",
        len(profile) == 4 and all(e["type"] == "line" for e in profile),
        str([e["type"] for e in profile]),
    )


# ── Test 2: Box with cylindrical through-hole ───────────────────────────────

print("\n[2] Box + through-hole (100×100×20, Ø20) — top/bottom have circle in HOLES")
box_hole = (
    cq.Workplane()
    .box(100, 100, 20)
    .faces(">Z")
    .workplane()
    .hole(20)
    .val()
)

for i in range(len(box_hole.Faces())):
    try:
        result = project_face_to_2d(box_hole, i)
    except ValueError:
        continue  # non-planar (cylinder wall), skip

    n = result["plane_normal"]
    profile = [e for e in result["edges"] if e["layer"] == "PROFILE"]
    holes = [e for e in result["edges"] if e["layer"] == "HOLES"]

    if abs(n[2]) > 0.9:
        check(
            f"face {i} (top/bottom): PROFILE = 4 lines",
            len(profile) == 4 and all(e["type"] == "line" for e in profile),
        )
        check(f"face {i} (top/bottom): circular edge in HOLES", len(holes) > 0)
    else:
        check(f"face {i} (side): no HOLES", len(holes) == 0)


# ── Test 3: Wire ordering ────────────────────────────────────────────────────

print("\n[3] Wire ordering — outer boundary is always on PROFILE layer")
for shape, label in [(box, "plain box"), (box_hole, "box+hole")]:
    for i in range(len(shape.Faces())):
        try:
            result = project_face_to_2d(shape, i)
        except ValueError:
            continue
        profile = [e for e in result["edges"] if e["layer"] == "PROFILE"]
        check(f"{label} face {i}: PROFILE is non-empty", len(profile) > 0)


# ── Test 4: DXF entity types ─────────────────────────────────────────────────

print("\n[4] DXF output — correct entity types written to file")
with tempfile.TemporaryDirectory() as tmp:
    # Find the largest planar face (top face) for the plain box
    box_top_i = next(
        i for i in range(len(box.Faces()))
        if abs(project_face_to_2d(box, i)["plane_normal"][2]) > 0.9
    )
    dxf_path = export_body_face(box, box_top_i, tmp, "box_top")
    msp1 = ezdxf.readfile(dxf_path).modelspace()
    lines1 = [e for e in msp1 if e.dxftype() == "LINE"]
    check("box top face: 4 LINE entities (PROFILE only)", len(lines1) == 4, str(len(lines1)))

    top_i = next(
        i for i in range(len(box_hole.Faces()))
        if not isinstance(
            (lambda: project_face_to_2d(box_hole, i) if True else None)(), type(None)
        )
        if abs(project_face_to_2d(box_hole, i)["plane_normal"][2]) > 0.9
    )
    msp2 = ezdxf.readfile(export_body_face(box_hole, top_i, tmp, "hole_top")).modelspace()
    lines2 = [e for e in msp2 if e.dxftype() == "LINE"]
    circ2 = [e for e in msp2 if e.dxftype() in ("CIRCLE", "ARC", "LWPOLYLINE")]
    check("box+hole top: 4 LINE entities", len(lines2) == 4, str(len(lines2)))
    check("box+hole top: circular entity in HOLES", len(circ2) > 0)


# ── Test 5: Actual STEP file ─────────────────────────────────────────────────

print("\n[5] test.step — face 0 is the large flat face with 20 circular pockets")
bodies = load_bodies("/Users/nicolamacchitella/Documents/Project-iT!/test.step")
shape_real = bodies[0]["shape"]
result_real = project_face_to_2d(shape_real, 0)
profile_real = [e for e in result_real["edges"] if e["layer"] == "PROFILE"]
holes_real = [e for e in result_real["edges"] if e["layer"] == "HOLES"]

check(
    "PROFILE = 4 lines (outer rectangle)",
    len(profile_real) == 4 and all(e["type"] == "line" for e in profile_real),
)
check("HOLES = 20 circular entries", len(holes_real) == 20, str(len(holes_real)))

with tempfile.TemporaryDirectory() as tmp:
    msp3 = ezdxf.readfile(
        export_body_face(shape_real, 0, tmp, "dresser_face")
    ).modelspace()
    lines3 = [e for e in msp3 if e.dxftype() == "LINE"]
    circ3 = [e for e in msp3 if e.dxftype() in ("CIRCLE", "ARC", "LWPOLYLINE")]
    check("DXF: 4 LINE entities (outer rect)", len(lines3) == 4, str(len(lines3)))
    check("DXF: circular entities (holes)", len(circ3) > 0, str(len(circ3)))


# ── Test 6: Centroid matching ────────────────────────────────────────────────

print("\n[6] Centroid matching — backend finds correct face from 3D centroid")
from main import _match_face_by_centroid  # noqa: E402

faces_meta = [
    {"index": i, "is_planar": True, "centroid": bodies[0]["faces"][i]["centroid"]}
    for i in range(len(bodies[0]["faces"]))
]
for target_idx in [0, 5, 10, 20]:
    true_c = faces_meta[target_idx]["centroid"]
    perturbed = [c + 0.5 for c in true_c]  # simulate 0.5 mm tessellation noise
    matched = _match_face_by_centroid(faces_meta, perturbed)
    check(
        f"face {target_idx}: centroid match survives 0.5mm noise",
        matched == target_idx,
        f"got {matched}",
    )


# ── Summary ──────────────────────────────────────────────────────────────────

print()
print("=" * 45)
print("  ALL TESTS PASSED" if failures == 0 else f"  {failures} FAILURE(S)")
print("=" * 45)
sys.exit(0 if failures == 0 else 1)
