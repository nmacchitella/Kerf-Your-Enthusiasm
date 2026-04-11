"""
Tessellate STEP solid bodies into per-face triangle meshes for Three.js visualization.
Face indices match those in step_loader._enumerate_faces (both use cq_shape.Faces() order).
"""
from __future__ import annotations

from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopLoc import TopLoc_Location


def tessellate_body(cq_shape, linear_deflection: float = 0.3) -> list[dict]:
    """
    Tessellate all faces of a CadQuery shape.

    Returns a list of face mesh dicts:
      { face_index: int, vertices: [x,y,z,...] (flat), indices: [i,j,k,...] (flat, 0-based) }

    Face indices correspond to the enumeration order of cq_shape.Faces(), which is
    the same order used by step_loader._enumerate_faces.
    """
    # Tessellate the whole solid in one shot (much faster than face-by-face)
    BRepMesh_IncrementalMesh(cq_shape.wrapped, linear_deflection, False, 0.5, True).Perform()

    face_meshes = []

    for face_idx, cq_face in enumerate(cq_shape.Faces()):
        occ_face = cq_face.wrapped
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(occ_face, loc)

        if tri is None or tri.NbTriangles() == 0:
            continue

        # Extract vertices — apply location transform to get world coordinates
        verts: list[float] = []
        if loc.IsIdentity():
            for i in range(1, tri.NbNodes() + 1):
                pt = tri.Node(i)
                verts.extend([pt.X(), pt.Y(), pt.Z()])
        else:
            trsf = loc.Transformation()
            for i in range(1, tri.NbNodes() + 1):
                pt = tri.Node(i).Transformed(trsf)
                verts.extend([pt.X(), pt.Y(), pt.Z()])

        # Extract triangles as 0-based indices
        # Use DoubleSide in Three.js so winding order doesn't matter for display,
        # but we still flip reversed faces so computeVertexNormals() points outward.
        try:
            from OCP.TopAbs import TopAbs_Orientation
            is_reversed = occ_face.Orientation() == TopAbs_Orientation.TopAbs_REVERSED
        except Exception:
            is_reversed = False

        indices: list[int] = []
        for i in range(1, tri.NbTriangles() + 1):
            t = tri.Triangle(i)
            n1, n2, n3 = t.Get()
            if is_reversed:
                indices.extend([n1 - 1, n3 - 1, n2 - 1])
            else:
                indices.extend([n1 - 1, n2 - 1, n3 - 1])

        face_meshes.append({
            "face_index": face_idx,
            "vertices": verts,
            "indices": indices,
        })

    return face_meshes
