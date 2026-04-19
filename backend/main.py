"""
FastAPI backend for the STEP-to-DXF CNC workflow app.

Endpoints:
  POST /session/upload      Upload STEP file, parse bodies, return metadata
  GET  /session/{id}/bodies Return body + face metadata for a session
  POST /preview             Return 2D edge data JSON for SVG preview
  POST /export              Project a face and return the DXF file
  POST /export/sheet        Assemble a full-sheet DXF from optimizer placements
  DELETE /session/{id}      Clean up session files
"""
from __future__ import annotations

import re
import json
from pathlib import Path
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

import session as session_mgr
from step_loader import load_bodies
from dxf_export import export_body_face


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    session_mgr.cleanup_old_sessions()
    yield


app = FastAPI(title="STEP-to-DXF CNC Workflow", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# In-memory session cache: session_id → list of body dicts
# (shapes are not JSON-serialisable; we keep them in memory during the run)
# ---------------------------------------------------------------------------
_session_cache: dict[str, list[dict]] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _bodies_to_json(bodies: list[dict]) -> list[dict]:
    """Strip cq.Shape objects, return JSON-safe body metadata."""
    result = []
    for b in bodies:
        result.append({
            "index": b["index"],
            "name": b["name"],
            "folder_path": b.get("folder_path", []),
            "face_count": len(b["faces"]),
            "faces": b["faces"],
            "bbox_mm": b.get("bbox_mm"),
        })
    return result


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/session/upload")
async def upload_step(file: UploadFile = File(...)):
    """
    Accept a STEP file upload. Parse all solid bodies, cache them in memory.
    Returns { session_id, bodies: [{ index, name, face_count, faces: [{ index, is_planar, normal }] }] }
    """
    if not file.filename.lower().endswith((".step", ".stp")):
        raise HTTPException(status_code=400, detail="File must be a .step or .stp file")

    sid = session_mgr.create_session()
    step_path = session_mgr.session_step_path(sid)

    contents = await file.read()
    step_path.write_bytes(contents)

    try:
        bodies = load_bodies(str(step_path))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse STEP file: {e}")

    _session_cache[sid] = bodies

    return {
        "session_id": sid,
        "bodies": _bodies_to_json(bodies),
    }


@app.get("/session/{session_id}/bodies")
async def get_bodies(session_id: str):
    """Return cached body metadata for a session."""
    bodies = _session_cache.get(session_id)
    if bodies is None:
        # Try to reload from disk if server was restarted
        step_path = session_mgr.session_step_path(session_id)
        if not step_path.exists():
            raise HTTPException(status_code=404, detail="Session not found")
        bodies = load_bodies(str(step_path))
        _session_cache[session_id] = bodies

    return {"bodies": _bodies_to_json(bodies)}


@app.get("/session/{session_id}/file")
async def get_session_file(session_id: str):
    """Download the raw STEP file for a session."""
    step_path = session_mgr.session_step_path(session_id)
    if not step_path.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    filename = f"{session_id}.step"
    return FileResponse(
        path=step_path,
        media_type="application/octet-stream",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class ExportRequest(BaseModel):
    session_id: str
    body_index: int
    body_name: str
    face_index: int
    face_centroid: list[float] | None = None  # 3D centroid for reliable face matching
    layer_style: str | None = None


@app.post("/export")
async def export_dxf(req: ExportRequest):
    """
    Project the selected face of the selected body and return a DXF file.
    """
    bodies = _session_cache.get(req.session_id)
    if bodies is None:
        step_path = session_mgr.session_step_path(req.session_id)
        if not step_path.exists():
            raise HTTPException(status_code=404, detail="Session not found")
        bodies = load_bodies(str(step_path))
        _session_cache[req.session_id] = bodies

    # Find the body
    body = next((b for b in bodies if b["index"] == req.body_index), None)
    if body is None:
        raise HTTPException(status_code=404, detail=f"Body index {req.body_index} not found")

    faces = body["faces"]

    # Use centroid matching when available — avoids frontend/backend face-index ordering mismatch
    if req.face_centroid is not None:
        resolved_index = _match_face_by_centroid(faces, req.face_centroid)
    else:
        resolved_index = req.face_index


    if resolved_index < 0 or resolved_index >= len(faces):
        raise HTTPException(status_code=400, detail=f"Face index {resolved_index} out of range")

    face_meta = faces[resolved_index]
    if not face_meta["is_planar"]:
        raise HTTPException(status_code=400, detail=f"Resolved face {resolved_index} is not planar")

    out_dir = str(session_mgr.session_dir(req.session_id))

    try:
        dxf_path = export_body_face(
            solid_cq_shape=body["shape"],
            face_index=resolved_index,
            output_dir=out_dir,
            body_name=req.body_name,
            layer_style=req.layer_style or "default",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DXF export failed: {e}")

    safe_name = Path(dxf_path).name
    return FileResponse(
        path=dxf_path,
        media_type="application/dxf",
        filename=safe_name,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Remove session files and cached data."""
    import shutil
    _session_cache.pop(session_id, None)
    sdir = session_mgr.session_dir(session_id)
    if sdir.exists():
        shutil.rmtree(sdir, ignore_errors=True)
    return {"status": "deleted"}


def _body_extent_along(cq_shape, normal: list[float]) -> float:
    """Return the body's extent (mm) along a direction vector."""
    from OCP.BRep import BRep_Tool
    from OCP.TopoDS import TopoDS
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_VERTEX

    nx, ny, nz = normal
    explorer = TopExp_Explorer(cq_shape.wrapped, TopAbs_VERTEX)
    projections = []
    while explorer.More():
        vertex = TopoDS.Vertex_s(explorer.Current())
        pnt = BRep_Tool.Pnt_s(vertex)
        projections.append(pnt.X() * nx + pnt.Y() * ny + pnt.Z() * nz)
        explorer.Next()
    return (max(projections) - min(projections)) if projections else 0.0


def _match_face_by_centroid(faces: list[dict], centroid: list[float]) -> int:
    """
    Return the index of the planar face whose centroid is closest to the given 3D point.
    Falls back to face 0 if no planar face has a centroid stored.
    """
    best_idx = -1
    best_dist = float("inf")
    for face in faces:
        if not face.get("is_planar") or face.get("centroid") is None:
            continue
        c = face["centroid"]
        dist = (c[0] - centroid[0]) ** 2 + (c[1] - centroid[1]) ** 2 + (c[2] - centroid[2]) ** 2
        if dist < best_dist:
            best_dist = dist
            best_idx = face["index"]
    return best_idx if best_idx >= 0 else 0


class PreviewRequest(BaseModel):
    session_id: str
    body_index: int
    face_index: int
    face_centroid: list[float] | None = None


@app.post("/preview")
async def preview_projection(req: PreviewRequest):
    """
    Return edge data (JSON) for an in-browser SVG preview.
    Projects the full solid from the selected face's view direction using HLR.
    """
    bodies = _session_cache.get(req.session_id)
    if bodies is None:
        step_path = session_mgr.session_step_path(req.session_id)
        if not step_path.exists():
            raise HTTPException(status_code=404, detail="Session not found")
        bodies = load_bodies(str(step_path))
        _session_cache[req.session_id] = bodies

    body = next((b for b in bodies if b["index"] == req.body_index), None)
    if body is None:
        raise HTTPException(status_code=404, detail=f"Body index {req.body_index} not found")

    faces = body["faces"]
    if req.face_centroid is not None:
        resolved_index = _match_face_by_centroid(faces, req.face_centroid)
    else:
        resolved_index = req.face_index

    if resolved_index < 0 or resolved_index >= len(faces):
        raise HTTPException(status_code=400, detail=f"Face index {resolved_index} out of range")

    face_meta = faces[resolved_index]
    if not face_meta["is_planar"]:
        raise HTTPException(status_code=400, detail=f"Face {resolved_index} is not planar")

    try:
        from projection import collapse_closed_line_loops, project_body_orthographic
        edge_data = project_body_orthographic(body["shape"], resolved_index, reference_mode="selected")
        edge_data = {**edge_data, "edges": collapse_closed_line_loops(edge_data.get("edges", []))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Projection failed: {e}")

    # Compute projected face dimensions so the frontend can save accurate l/w/t
    face_dims_mm = None
    edges = edge_data.get("edges", [])
    if edges:
        from sheet_export import _edge_bbox
        min_u, min_v, max_u, max_v = _edge_bbox(edges)
        face_w = max_u - min_u
        face_h = max_v - min_v
        l_mm, w_mm = sorted([face_w, face_h], reverse=True)
        t_mm = _body_extent_along(body["shape"], edge_data["plane_normal"])
        face_dims_mm = [round(l_mm, 6), round(w_mm, 6), round(t_mm, 6)]

    return JSONResponse(content={**edge_data, "face_dims_mm": face_dims_mm})


class SheetPlacement(BaseModel):
    body_index: int
    face_index: int
    body_name: str
    x_mm: float
    y_mm: float
    rot: bool = False
    session_id: str = ""  # per-placement session; falls back to request-level session_id


class RectPlacement(BaseModel):
    body_name: str
    x_mm: float
    y_mm: float
    w_mm: float
    h_mm: float


class SheetExportRequest(BaseModel):
    session_id: str
    sheet_width_mm: float
    sheet_length_mm: float
    sheet_name: str = "Sheet"
    placements: List[SheetPlacement]
    rect_placements: List[RectPlacement] = []
    layer_style: str | None = None


@app.post("/export/sheet")
async def export_sheet_dxf(req: SheetExportRequest):
    """
    Assemble a full-sheet DXF: project each placement's face, apply rotation/translation,
    add sheet boundary and part labels, return the DXF file.
    """
    from sheet_export import build_sheet_dxf

    # Collect all unique session IDs referenced by placements.
    # Each placement may carry its own session_id; fall back to the request-level one.
    all_session_ids: set[str] = set()
    if req.session_id:
        all_session_ids.add(req.session_id)
    for p in req.placements:
        sid = p.session_id or req.session_id
        if sid:
            all_session_ids.add(sid)

    # Load bodies for every referenced session into a {session_id: bodies} map.
    bodies_by_session: dict[str, list[dict]] = {}
    missing_sessions: list[str] = []
    for sid in all_session_ids:
        if sid in bodies_by_session:
            continue
        cached = _session_cache.get(sid)
        if cached is not None:
            bodies_by_session[sid] = cached
            continue
        step_path = session_mgr.session_step_path(sid)
        if step_path.exists():
            loaded = load_bodies(str(step_path))
            _session_cache[sid] = loaded
            bodies_by_session[sid] = loaded
        else:
            missing_sessions.append(sid)

    # If STEP-sourced placements reference sessions whose files are gone,
    # return a clear error instead of silently producing an empty DXF.
    if missing_sessions and req.placements:
        raise HTTPException(
            status_code=410,
            detail="STEP session expired — re-upload the STEP file and re-add parts to the cut list.",
        )

    # Resolve the effective session_id into each placement dict so
    # build_sheet_dxf can look up the correct body list per placement.
    enriched_placements = []
    for p in req.placements:
        d = p.model_dump()
        d["session_id"] = p.session_id or req.session_id
        enriched_placements.append(d)

    # Use a stable output dir: either the first session dir or a temp dir
    if req.session_id:
        out_dir = str(session_mgr.session_dir(req.session_id))
    else:
        import tempfile
        out_dir = tempfile.mkdtemp()

    try:
        doc = build_sheet_dxf(
            bodies_by_session=bodies_by_session,
            sheet_width_mm=req.sheet_width_mm,
            sheet_length_mm=req.sheet_length_mm,
            sheet_name=req.sheet_name,
            placements=enriched_placements,
            rect_placements=[p.model_dump() for p in req.rect_placements],
            layer_style=req.layer_style or "default",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sheet DXF export failed: {e}")

    from ezdxf import appsettings, zoom

    extents = appsettings.update_extents(doc)
    if extents.has_data:
        zoom.center(doc.modelspace(), extents.center, extents.size)

    safe_sheet_name = re.sub(r'[\\/*?:"<>|]', "_", req.sheet_name)
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    out_path = str(Path(out_dir) / f"Sheet_{safe_sheet_name}.dxf")
    doc.saveas(out_path)

    filename = Path(out_path).name
    return FileResponse(
        path=out_path,
        media_type="application/dxf",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/export/sheet/preview")
async def preview_sheet(req: SheetExportRequest):
    """
    Return JSON edge data for an in-browser SVG preview of the sheet layout.
    Same geometry as /export/sheet but returns edges instead of a DXF file.
    """
    from sheet_export import build_sheet_preview

    all_session_ids: set[str] = set()
    if req.session_id:
        all_session_ids.add(req.session_id)
    for p in req.placements:
        sid = p.session_id or req.session_id
        if sid:
            all_session_ids.add(sid)

    bodies_by_session: dict[str, list[dict]] = {}
    for sid in all_session_ids:
        if sid in bodies_by_session:
            continue
        cached = _session_cache.get(sid)
        if cached is not None:
            bodies_by_session[sid] = cached
            continue
        step_path = session_mgr.session_step_path(sid)
        if step_path.exists():
            loaded = load_bodies(str(step_path))
            _session_cache[sid] = loaded
            bodies_by_session[sid] = loaded

    enriched_placements = []
    for p in req.placements:
        d = p.model_dump()
        d["session_id"] = p.session_id or req.session_id
        enriched_placements.append(d)

    try:
        result = build_sheet_preview(
            bodies_by_session=bodies_by_session,
            sheet_width_mm=req.sheet_width_mm,
            sheet_length_mm=req.sheet_length_mm,
            placements=enriched_placements,
            rect_placements=[p.model_dump() for p in req.rect_placements],
            layer_style=req.layer_style or "default",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sheet preview failed: {e}")

    return JSONResponse(content=result)


@app.get("/session/{session_id}/mesh")
async def get_mesh(session_id: str):
    """
    Return tessellated triangle mesh data for all bodies in a session.
    Used by the Three.js 3D viewer in the frontend.
    Face indices match the indices returned by /session/{session_id}/bodies.
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from tessellate import tessellate_body

    bodies = _session_cache.get(session_id)
    if bodies is None:
        step_path = session_mgr.session_step_path(session_id)
        if not step_path.exists():
            raise HTTPException(status_code=404, detail="Session not found")
        bodies = load_bodies(str(step_path))
        _session_cache[session_id] = bodies

    def _do_tessellate():
        result = []
        for body in bodies:
            face_meshes = tessellate_body(body["shape"])
            result.append({
                "body_index": body["index"],
                "face_meshes": face_meshes,
            })
        return result

    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=1) as executor:
        mesh_data = await loop.run_in_executor(executor, _do_tessellate)

    return {"bodies": mesh_data}


@app.get("/health")
async def health():
    return {"status": "ok"}
