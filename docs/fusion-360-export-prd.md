# PRD: Fusion 360 Manufacturing Export

Author: Nicola
Status: Draft, revised
Last updated: 2026-04-19
Target: Kerfuffle export feature plus companion Fusion 360 import script

## 1. Summary

Extend Kerfuffle so an optimized nest can be exported as a Fusion-ready package containing:

- normalized per-part manufacturing STEP files
- a manifest describing sheet stock and part placements
- optional verification DXFs

The companion Fusion 360 script will import the package, place each 3D part on the correct sheet at the correct location and orientation, and preserve the 3D geometry needed for downstream CAM operations such as pockets, holes, and through-cuts.

This feature builds on Kerfuffle's existing workflow:

- upload one or more STEP files
- choose the machining face for each body
- assign material and thickness metadata
- optimize sheet layout

The new work is the export contract and the 3D placement handoff to Fusion.

## 2. Problem

Current workflow options are both bad:

- DXF-only workflow: preserves the optimized 2D layout but loses 3D machining information
- STEP-in-Fusion workflow: preserves 3D machining information but requires manual alignment to the nested layout

Users need both at once:

- keep the optimized nest from Kerfuffle
- keep the 3D machining intelligence from the original part geometry
- avoid manual placement for jobs with many parts

## 3. Existing Project Findings

The current codebase already answers several design questions:

- Kerfuffle already supports multiple uploaded STEP sessions in one project.
- The STEP workflow already asks the user to choose a planar machining face per body and stores that selection on the cut row.
- The backend already derives part dimensions from the selected machining face and the body thickness along that face normal.
- The projection pipeline already distinguishes outer profile, holes, and pocket-depth geometry.
- If the user clicks the back face, the backend already tries to reinterpret the better machining-side reference plane for depth calculations.
- Sheet export already uses per-part placement data shaped like `x_mm`, `y_mm`, and `rot`.
- Material and thickness are already first-class project data and already constrain optimization.

Important current limitations:

- no manufacturing STEP export yet
- no arbitrary-angle nesting; current placement rotation is orthogonal only
- no mirror or flip support
- no grain-direction model
- no tabs, bridges, or common-line metadata
- overlap validation in the layout editor is rectangle-based, not true silhouette-based

These findings should shape v1 instead of fighting them.

## 4. Product Decisions for v1

### 4.1 Export manufacturing STEPs, not raw source STEPs

Fusion import should not have to infer the machining orientation from an arbitrary source STEP.

For each exported part, Kerfuffle will generate a manufacturing STEP in a normalized local frame:

- selected machining face lies on `Z=0`
- part thickness extends in `+Z`
- the selected face silhouette is represented in local `XY`
- the silhouette is normalized so its 2D minimum corner is at local `(0, 0)`
- the local frame is portrait-normalized to match Kerfuffle's current optimizer convention

This is a rigid transform only. It must not change topology or machining features.

### 4.2 Confirmed machining face is required for STEP-backed parts

Fusion export must fail fast if a STEP-backed part does not have a resolved machining face. v1 should not silently guess.

### 4.3 Orthogonal rotation only in v1

Kerfuffle's current optimizer stores rotation as a boolean `rot`, not an arbitrary angle. The export schema should therefore treat v1 as orthogonal nesting only.

Allowed values for v1:

- `0`
- `90`

Rotation direction must be explicitly defined as clockwise in sheet space.

### 4.4 No mirror or flip transforms in v1

Remove `flipped` from the placement contract for v1.

Instead:

- the exported manufacturing STEP already represents the final machining-side-up orientation
- the manifest may carry informational metadata such as `machining_side`
- mirrored placements are rejected in v1

This keeps Fusion import simple and avoids ambiguous "flipped relative to what?" logic.

### 4.5 Manifest coordinates are sheet-local and millimeter-only

The package format will standardize on:

- units: `mm`
- origin: bottom-left of each sheet
- sheet plane: `Z=0`

Any UI-specific display offsets, preview flips, or sheet-to-sheet gallery spacing belong in the Fusion script or frontend only, not in the manifest truth.

### 4.6 The placement transform is authoritative

To avoid hidden offset rules around 90 degree placement, the manifest will include an explicit transform per placed instance.

Human-readable `x_mm`, `y_mm`, and `rotation_deg` may still be included, but the transform is authoritative for the Fusion script.

## 5. Goals

- Export a portable package containing manufacturing STEPs and nest metadata
- Automatically place all 3D parts in Fusion on the correct sheets
- Preserve traceability from Fusion occurrences back to Kerfuffle source parts
- Support multi-sheet nests
- Support projects assembled from multiple uploaded STEP sessions
- Preserve enough metadata for downstream CAM setup and human verification
- Keep the file format stable enough that Kerfuffle and the Fusion script can evolve independently

## 6. Non-Goals

- automatic CAM toolpath generation
- support for CAM tools other than Fusion 360
- live sync between Kerfuffle and Fusion
- topology edits to part geometry
- mirrored or double-sided placement automation in v1
- grain-aware nesting in v1
- tabs, bridges, or common-line cutting metadata in v1

## 7. User Workflow

1. User uploads one or more source STEP files into Kerfuffle.
2. User selects the machining face for each included body.
3. User assigns material and thickness metadata as needed.
4. User runs layout optimization.
5. User clicks `Export to Fusion 360`.
6. Kerfuffle produces a `.zip` package containing manufacturing STEPs, manifest, and optional verification DXFs.
7. User opens Fusion 360 and runs the companion `Import Nest` script.
8. The script imports the package, creates sheet components, and places each part occurrence using the authoritative placement transform.
9. User proceeds with Fusion CAM setup using full 3D geometry.

## 8. Export Package

Required package structure:

```text
fusion_export_<timestamp>/
├── manifest.json
├── parts/
│   ├── <part_id_1>.step
│   ├── <part_id_2>.step
│   └── ...
├── layouts/
│   ├── sheet_1.dxf
│   └── sheet_2.dxf
└── README.txt
```

Optional future additions:

- `sources/` for original uploaded STEP files
- `schema/manifest.schema.json`

For v1, `layouts/` is optional but recommended. In the current Kerfuffle product, DXF is primarily a verification artifact, not the authoritative placement source.

## 9. Manifest Schema

`manifest.json` is the source of truth. Fusion should not infer placement from DXF.

Example:

```json
{
  "schema_version": "1.0.0",
  "export_metadata": {
    "exporter_name": "kerfuffle",
    "exporter_version": "0.1.0",
    "exported_at": "2026-04-19T14:30:00Z",
    "units": "mm",
    "project_name": "white_oak_dresser"
  },
  "coordinate_system": {
    "sheet_origin": "bottom_left",
    "sheet_plane": "Z0",
    "part_local_frame": "normalized_manufacturing_step",
    "rotation_direction": "cw",
    "allowed_rotations_deg": [0, 90]
  },
  "parts": [
    {
      "part_id": "drawer_side_left",
      "display_name": "Drawer Side Left",
      "manufacturing_step_file": "parts/drawer_side_left.step",
      "dimensions_mm": {
        "length": 450.0,
        "width": 200.0,
        "thickness": 19.0
      },
      "material": "white_oak_plywood",
      "machining_side": "selected_face_up",
      "source_ref": {
        "step_session_id": "session_abc123",
        "body_index": 4,
        "face_index": 17,
        "body_name": "Drawer Side Left"
      }
    }
  ],
  "sheets": [
    {
      "sheet_id": "sheet_1",
      "stock": {
        "width_mm": 2440.0,
        "height_mm": 1220.0,
        "thickness_mm": 19.0,
        "material": "white_oak_plywood",
        "name": "4x8 White Oak Ply"
      },
      "dxf_reference": "layouts/sheet_1.dxf",
      "placements": [
        {
          "instance_id": "drawer_side_left__1",
          "part_id": "drawer_side_left",
          "x_mm": 100.0,
          "y_mm": 50.0,
          "rotation_deg": 90,
          "transform_matrix": [
            [0.0, 1.0, 0.0, 100.0],
            [-1.0, 0.0, 0.0, 500.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
          ]
        }
      ]
    }
  ],
  "validation": {
    "method": "rect_aabb",
    "warnings": []
  }
}
```

## 10. Schema Rules

### 10.1 Part records

Each `parts[]` record describes one reusable manufacturing part definition.

Required:

- `part_id`
- `manufacturing_step_file`
- `dimensions_mm`
- `source_ref`

Notes:

- `part_id` is the catalog identity.
- `instance_id` is the per-placement identity.
- `source_ref` exists for traceability and debugging, not for Fusion placement logic.

### 10.2 Placement records

Each `placements[]` record describes one placed occurrence.

Required:

- `instance_id`
- `part_id`
- `transform_matrix`

Recommended:

- `x_mm`
- `y_mm`
- `rotation_deg`

Rules:

- `transform_matrix` is authoritative.
- `rotation_deg` must be `0` or `90` in v1.
- `x_mm` and `y_mm` refer to the sheet-local minimum corner of the placed footprint for human readability.
- `instance_id` should be stable within an export and should map cleanly to the optimizer's instance identity when available.

### 10.3 Units

All manifest geometry must be millimeters.

Kerfuffle may continue to support inch-based projects in the UI, but export must convert to mm before writing the package.

## 11. Geometry Contract

This is the most important part of the spec.

### 11.1 Manufacturing STEP local frame

For every exported part:

1. Resolve the machining face selected by the user.
2. Derive the machining reference plane from that face.
3. Normalize the body into a manufacturing frame:
   - machining face on `Z=0`
   - thickness in `+Z`
   - silhouette in local `XY`
4. Normalize the 2D silhouette so its minimum corner is at `(0, 0)`.
5. Apply the same rigid transform to the full 3D body.
6. Export that transformed body as the manufacturing STEP.

This intentionally mirrors the current Kerfuffle DXF export behavior, which already:

- derives geometry from the machining face
- normalizes the projected silhouette to origin
- normalizes orientation to match optimizer assumptions

### 11.2 Placement transform

The placement transform maps manufacturing STEP local coordinates into sheet coordinates.

Fusion import should:

1. import the manufacturing STEP
2. apply `transform_matrix`
3. name the resulting occurrence with `instance_id`

Fusion should not re-derive face orientation, recalculate bounding-box offsets, or reinterpret the sheet origin.

## 12. Validation and Error Handling

Kerfuffle must refuse export when:

- a referenced manufacturing STEP cannot be generated
- a source STEP session is missing or expired
- a STEP-backed part has no confirmed machining face
- a referenced body or face cannot be resolved
- any required manifest field is missing
- a placement uses rotation outside the v1 contract
- a mirrored placement is requested

Validation levels:

- Required in v1: rectangle-based bounds and overlap checks using the same placement model Kerfuffle already uses
- Future enhancement: true silhouette intersection checks for irregular parts

The manifest must record the validation method used:

- `rect_aabb` for current rectangle-based validation
- future values may include `silhouette_2d`

Warnings may include:

- unusually close spacing
- coarse validation only
- missing optional DXF references

## 13. DXF Export

DXF sheet exports are optional but recommended.

For v1 they are used for:

- visual verification
- debugging Fusion placement
- preserving a familiar artifact for shop review

They are not authoritative for placement.

In current Kerfuffle behavior, DXF layers already preserve machining semantics such as:

- outer profile
- holes and interior openings
- pocket depths by layer

That is useful context, but Fusion placement must still be driven by `manifest.json`.

## 14. Fusion 360 Import Script Requirements

Separate deliverable, but the package must support the following flow:

1. Read `manifest.json`.
2. Verify `schema_version`.
3. For each sheet:
   - create a parent component or manufacturing model grouping
   - create a sheet outline sketch
   - optionally import the verification DXF
4. For each placement:
   - import the referenced manufacturing STEP
   - apply `transform_matrix`
   - name the occurrence with `instance_id`
5. Lay out multiple sheets with a display-only gap in the Fusion scene.

Important:

- sheet-to-sheet display gap is not part of manifest truth
- transform application must be deterministic and side-effect free

## 15. Success Criteria

- User exports a 20-part cabinet job across multiple sheets in under 30 seconds.
- Fusion imports and places all parts in under 2 minutes.
- Visual verification shows manufacturing STEPs aligned with the exported sheet layout.
- User can create Fusion CAM pocket operations from real 3D geometry without manually redefining depths.

## 16. Deliverables

- Kerfuffle `Export to Fusion 360` feature
- manifest schema documentation
- sample export package from a real project
- companion Fusion 360 Python script

## Appendix A: Current Project Assessment

### Already answered by the codebase

| Question | Current answer |
| --- | --- |
| Does the app already track the chosen machining face? | Yes. STEP-backed cuts store session, body, and face references. |
| Does the app already know part thickness? | Yes. Thickness is derived from extent along the selected face normal and also stored on cuts/stocks. |
| Does the app already distinguish profile vs pockets vs holes? | Yes. The projection/export pipeline already emits separate layers. |
| Can a project include parts from multiple STEP uploads? | Yes. Multi-session STEP handling already exists. |
| Can the app already export original STEP files for traceability? | Yes. Project bundle export already downloads stored STEP session files. |

### Not yet answered by the codebase

| Question | Current answer |
| --- | --- |
| Can Kerfuffle export a normalized manufacturing STEP per part? | No, not yet. |
| Does the optimizer support arbitrary-angle nesting? | No. Current placement is orthogonal only. |
| Does the data model track mirrored or flipped placements? | No. |
| Does the data model track grain direction? | No. |
| Does the exporter track tabs, bridges, or common-line cuts? | No. |
| Does validation use true part silhouettes? | No. Current conflict detection is rectangle-based. |

### Design implication

The Fusion export feature should be designed as an extension of the current product, not a separate geometry system. The safest v1 is:

- confirmed machining face required
- manufacturing STEP normalized at export time
- transform-driven placement
- mm-only manifest
- orthogonal rotation only
- no mirror support

