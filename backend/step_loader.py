"""
STEP file loading: extract solid bodies with names preserved from the XCAF tree.
Uses OCP (cadquery-ocp) directly for XDE/XCAF name reading; CadQuery for shapes.
"""
from __future__ import annotations

import cadquery as cq

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.GeomAbs import GeomAbs_Plane
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.StepShape import StepShape_ManifoldSolidBrep
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.TopAbs import TopAbs_ShapeEnum
from OCP.XCAFDoc import XCAFDoc_DocumentTool


def load_bodies(step_path: str) -> list[dict]:
    doc = TDocStd_Document(TCollection_ExtendedString("MDTV-CAF"))
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    status = reader.ReadFile(step_path)
    if status != IFSelect_RetDone:
        raise ValueError(f"Failed to read STEP file (status={status}): {step_path}")
    reader.Transfer(doc)

    # Build a bbox→name map from MANIFOLD_SOLID_BREP entities in the STEP file.
    # These carry the real body names that XCAF doesn't propagate to anonymous instances.
    brep_name_map = _build_brep_name_map(reader)

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)

    bodies: list[dict] = []
    counter = [0]

    for i in range(1, free_labels.Size() + 1):
        label = free_labels.Value(i)
        _collect_bodies(label, shape_tool, bodies, counter, parent_path=[], brep_name_map=brep_name_map)

    return bodies


def _build_brep_name_map(reader: STEPCAFControl_Reader) -> dict[tuple, str]:
    """
    Build a bounding-box → name map for every named MANIFOLD_SOLID_BREP in the file.
    Used to recover real body names for anonymous XCAF instances (names like '=>[…]').

    The XCAF reader and its underlying basic reader share the same session, so
    the shapes produced by reader.Reader().OneShape() are the same C++ objects
    used inside the XCAF tree — their bounding boxes match exactly.
    """
    step_reader = reader.Reader()
    step_reader.TransferRoots()
    compound = step_reader.OneShape()
    if compound.IsNull():
        return {}

    model = step_reader.Model()
    solids = cq.Shape(compound).Solids()

    # Collect ordered MANIFOLD_SOLID_BREP names (same order as solids in compound)
    brep_names: list[str] = []
    for i in range(1, model.NbEntities() + 1):
        ent = model.Value(i)
        if isinstance(ent, StepShape_ManifoldSolidBrep):
            raw = ent.Name().ToCString() if ent.Name() else ""
            brep_names.append(raw)

    result: dict[tuple, str] = {}
    for solid, name in zip(solids, brep_names):
        if not name or name.startswith("=>") or name.startswith("["):
            continue
        key = _bbox_key(solid.wrapped)
        if key:
            result[key] = name  # last writer wins; duplicates are same-name identical parts

    return result


def _collect_bodies(
    label,
    shape_tool,
    bodies: list,
    counter: list,
    parent_path: list[str],
    brep_name_map: dict,
) -> None:
    name = _read_label_name(label)
    occ_shape = shape_tool.GetShape_s(label)
    if occ_shape.IsNull():
        return

    # If this is a reference (instance), follow it to its definition
    if shape_tool.IsReference_s(label):
        ref = TDF_Label()
        if shape_tool.GetReferredShape_s(label, ref):
            ref_name = _read_label_name(ref)
            # Prefer the instance's own name; fall back to the definition's name
            instance_name = name or ref_name or f"Body_{counter[0]}"

            if shape_tool.IsAssembly_s(ref):
                new_path = parent_path + [instance_name]
                sub_labels = TDF_LabelSequence()
                shape_tool.GetComponents_s(ref, sub_labels, False)
                for k in range(1, sub_labels.Size() + 1):
                    _collect_bodies(sub_labels.Value(k), shape_tool, bodies, counter, new_path, brep_name_map)
            else:
                _collect_solid(ref, occ_shape, instance_name, shape_tool, bodies, counter, parent_path, brep_name_map)
        return

    shape_type = occ_shape.ShapeType()

    if shape_type == TopAbs_ShapeEnum.TopAbs_SOLID:
        _collect_solid(label, occ_shape, name or f"Body_{counter[0]}", shape_tool, bodies, counter, parent_path, brep_name_map)
        return

    if shape_type == TopAbs_ShapeEnum.TopAbs_COMPOUND:
        # Strip the top-level wrapper (Shapr3D exports a single root compound named
        # "root" or the project name) — don't add it as a folder level.
        is_wrapper = len(parent_path) == 0 and (
            not name or name.lower() == "root"
        )
        new_path = parent_path if is_wrapper else (parent_path + [name] if name else parent_path)

        sub_labels = TDF_LabelSequence()
        shape_tool.GetComponents_s(label, sub_labels, False)
        if sub_labels.Size() > 0:
            for k in range(1, sub_labels.Size() + 1):
                _collect_bodies(sub_labels.Value(k), shape_tool, bodies, counter, new_path, brep_name_map)
            return

        # No XCAF sub-labels — extract solids directly
        cq_compound = cq.Shape(occ_shape)
        solids = cq_compound.Solids()
        for j, solid in enumerate(solids):
            solid_name = _brep_name_for(solid.wrapped, brep_name_map) or (
                name if len(solids) == 1 else f"{name}_{j + 1}"
            )
            _append_body(solid_name, cq.Shape(solid.wrapped), bodies, counter, parent_path)


def _collect_solid(label, occ_shape, name: str, shape_tool, bodies, counter, parent_path, brep_name_map):
    """Resolve a solid label to a cq.Shape and append it."""
    cq_shape = cq.Shape(occ_shape)
    solids = cq_shape.Solids()
    if solids:
        for j, solid in enumerate(solids):
            real_name = _brep_name_for(solid.wrapped, brep_name_map)
            solid_name = real_name or (name if len(solids) == 1 else f"{name}_{j + 1}")
            _append_body(solid_name, solid, bodies, counter, parent_path)
    # If no solids (sketch plane, face, wire) — skip silently


def _brep_name_for(occ_solid, brep_name_map: dict) -> str | None:
    """Look up the MANIFOLD_SOLID_BREP name for a solid via its bounding box."""
    key = _bbox_key(occ_solid)
    return brep_name_map.get(key) if key else None


def _bbox_key(occ_solid) -> tuple | None:
    """Bounding box rounded to 0.1 mm — stable key for shape identity."""
    box = Bnd_Box()
    BRepBndLib.Add_s(occ_solid, box)
    if box.IsVoid():
        return None
    return tuple(round(x, 1) for x in box.Get())


def _append_body(name: str, cq_shape: cq.Shape, bodies: list, counter: list, folder_path: list[str]):
    faces = _enumerate_faces(cq_shape)
    bodies.append({
        "index": counter[0],
        "name": name,
        "folder_path": list(folder_path),
        "shape": cq_shape,
        "faces": faces,
        "bbox_mm": _body_bbox_mm(cq_shape),
    })
    counter[0] += 1


def _read_label_name(label) -> str:
    """Return the TDataStd_Name for this label, or '' if absent/internal."""
    name_attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), name_attr):
        raw = name_attr.Get().ToExtString().strip()
        # Filter out OCC-internal label-path names like '=>[0:1:1:14]'
        if raw and not raw.startswith("=>") and not raw.startswith("["):
            return raw
    return ""


def _enumerate_faces(cq_shape: cq.Shape) -> list[dict]:
    faces = []
    for idx, face in enumerate(cq_shape.Faces()):
        adaptor = BRepAdaptor_Surface(face.wrapped)
        is_planar = adaptor.GetType() == GeomAbs_Plane

        normal = None
        if is_planar:
            plane = adaptor.Plane()
            d = plane.Axis().Direction()
            normal = [d.X(), d.Y(), d.Z()]

        centroid = _face_centroid(face.wrapped)
        area = face.Area()
        faces.append({
            "index": idx,
            "is_planar": is_planar,
            "normal": normal,
            "centroid": centroid,
            "area": area,
        })

    # Mark the largest planar face as is_top_face
    planar = [(i, f) for i, f in enumerate(faces) if f["is_planar"]]
    if planar:
        best = max(planar, key=lambda x: x[1]["area"])
        faces[best[0]]["is_top_face"] = True

    return faces


def _body_bbox_mm(cq_shape: cq.Shape) -> list[float] | None:
    """Return [dim1, dim2, dim3] bounding box in mm, sorted largest first."""
    box = Bnd_Box()
    BRepBndLib.Add_s(cq_shape.wrapped, box)
    if box.IsVoid():
        return None
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    dims = sorted([xmax - xmin, ymax - ymin, zmax - zmin], reverse=True)
    return [round(d, 6) for d in dims]


def _face_centroid(occ_face) -> list[float]:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(occ_face, props)
    c = props.CentreOfMass()
    return [c.X(), c.Y(), c.Z()]
