# ScreenshotMaker

Self-hosted web app for generating App Store Connect–ready screenshots.

One project = one app's screenshot set: visual design + screenshots + export, all on a single page. Drop new screenshots in for each release → download a ZIP organized by device size, ready to upload to App Store Connect.

---

## What it does

1. A **Project** is the unit of work — it owns the visual recipe **and** the screenshots:
   - **Continuous wide canvas** of N "tiles" separated by a visible white gutter, App Store Connect–style. Each tile exports as one PNG.
   - **Free-form elements on a single canvas** (paint-program style): text boxes, icons, and **device frames** are all first-class draggable / rotatable / resizable elements. Create as many as you want, position them anywhere.
   - **Devices are tile-assigned.** Each device has an explicit `panelIndex` — dragging only moves the phone within its tile, never accidentally hops it to a neighbour. The device inspector has a **Tile** dropdown to reassign. Visually they hard-crop at the tile edge, so the App-Store "phone bridging two screens" look is achieved by dropping **one device per adjacent tile** and aligning them at the gap.
   - **Screenshots are a pool, not slot-bound.** Upload screenshots to the project pool; attach any of them to any device via the device inspector. Multiple devices can share one screenshot.
   - **Text:** per-element font picker (~20 system families), bold + italic toggles, weight 400–800, color, alignment, rotation; box width auto-fits the typed content. Double-click to edit in place.
   - **Icons:** 12 built-in monoline icons + upload your own SVG files (per project) — colour, size, rotation, all work uniformly.
   - **Background image** is cover-fit across the full canvas once and sliced contiguously — adjacent tiles' background pixels match exactly at the gap (no source pixels disappear behind the gutter). Template-wide zoom / blur / brightness.
   - Bezel colour picker (black / graphite / grey / silver / custom) — side ribbon shade auto-derived.
   - **Bezel corner radius** slider (0–200 px) for sharp-rectangle to pill-shaped device frames.
   - Device tilt around **both** X and Y axes (real pseudo-3D perspective with visible side edges), plus Z-axis spin (-90° to +90°).

2. **Screenshots are managed on the same page as the design.** Drop files onto the screenshots panel → they join the pool; attach by clicking a thumbnail in the device inspector.

3. **Export** renders every (tile × device-size) combination at native App Store pixel dimensions and bundles them into a ZIP:
   ```
   <ProjectName>/
     iPhone-6.7/   01.png 02.png 03.png ...
     iPhone-6.5/   01.png 02.png 03.png ...
     iPad-13/      01.png 02.png 03.png ...
   ```
   Each PNG is exactly one tile's worth of canvas; Konva's stage bounds hard-clip elements that would have crossed a tile edge.

---

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind 4**
- **React Konva** for the canvas editor; vanilla **Konva** for off-DOM export rendering
- Custom canvas2D **perspective renderer** (rounded-rect prism, triangle-subdivision warp) — no Three.js
- **Prisma 6** + **SQLite** for persistence
- **JSZip** for client-side ZIP bundling
- **Docker + docker-compose** for self-hosted deploy

---

## Architecture

```
screenshotmaker/
├── app/
│   ├── page.tsx                              # Project list (single home view)
│   ├── projects/[id]/page.tsx                # Unified editor — runs migration helper, then renders
│   ├── templates/[id]/page.tsx               # Legacy URL redirect → /projects/<id>
│   └── api/
│       ├── projects/                         # GET, POST, PATCH, DELETE
│       ├── projects/[id]/screenshots/        # POST (pool upload), DELETE /<screenshotId>
│       ├── templates/[id]/background/        # POST + DELETE for bg image
│       ├── templates/[id]/icons/             # POST (SVG upload), DELETE /<iconId>
│       ├── projects/[id]/screens/            # Legacy (pre-canvas model) — kept for read-only migration
│       ├── screens/[id]/                     # Legacy — DELETE
│       ├── slots/[id]/                       # Legacy — PATCH/DELETE; no longer written by the editor
│       └── uploads/[...path]/                # GET file (path-traversal protected)
├── components/
│   ├── NewProjectButton / DeleteButton
│   ├── editor/
│   │   ├── TemplateEditor.tsx                # right-side inspector + project header + drop zone
│   │   ├── EditorCanvas.tsx                  # react-konva Stage; per-tile clip groups; gap-aware bg
│   │   ├── DeviceFrame.tsx                   # warped Konva.Image of the flat+tilted device canvas
│   │   └── useImage.ts
│   └── project/
│       └── ExportButton.tsx                  # renders every (tile × device-size) → ZIP
├── lib/
│   ├── db.ts                                 # Prisma client singleton
│   ├── editor-types.ts                       # TemplateConfig + CanvasElement + parsers + PANEL_W/H/GAP
│   ├── projectMigration.ts                   # v0 → v1 (slot → canvas) and v1 → v2/v3 device shifts
│   ├── deviceFrame.ts                        # vanilla canvas2D flat device-frame raster
│   ├── perspective.ts                        # rounded-rect prism + triangle-subdivision warp
│   ├── background.ts                         # cover-fit-once-then-slice bg canvas (gap-aware)
│   ├── color.ts                              # scaleColor() helper
│   ├── uploads.ts                            # safe upload-dir helpers
│   └── render.ts                             # off-DOM export PNG renderer (one tile per call)
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── data/                                     # mounted volume — SQLite + uploads/
├── Dockerfile + docker-compose.yml
├── docker-entrypoint.sh                      # runs `prisma migrate deploy` then `node server.js`
└── next.config.ts                            # output: "standalone"
```

---

## Rendering pipeline

The device and background are rendered through the **same code path** in both the live editor preview and the final export, so what you see in the editor is what you get in the PNG.

1. **`renderFlatDeviceFrame`** (`lib/deviceFrame.ts`) — vanilla canvas2D draws the bezel rectangle (configurable color), inner screen, screenshot (clipped to the rounded screen path), and notch onto a 920 × 1900 offscreen canvas.
2. **`computeTiltedDevice`** (`lib/perspective.ts`) — models the device as a rounded-rect prism with `depth = 70`. Samples the rounded perimeter (straights + corner arcs) and extrudes each sample backward, then projects every point through a perspective matrix that combines both X-axis and Y-axis rotations around the device's centre. Per-segment visibility (sign of the rotated outward normal's z-component) carves out only the side faces actually facing the viewer, producing a polygon ribbon that **wraps cleanly around the rounded corners**. Returns front-face quad, visible side quads, bounding box, and the pivot (so callers anchor on the device's true centre, not the bounding box).
3. **`warpCanvasToQuad`** (`lib/perspective.ts`) — warps the flat device-frame raster onto the front-face quad via triangle subdivision (20 cells per side in the editor for smooth interaction, 60 for export).
4. **`renderTiltedDevice`** — fills the side ribbon (auto-shade via `scaleColor(bezelColor, 0.6)`) then overlays the warped front face.
5. **`renderBackgroundCanvas`** (`lib/background.ts`) — fills the solid colour, then cover-fits the bg image **once** to the full canvas (`panelCount × PANEL_W`) and slices it into N contiguous bands. Tile N's band ends where tile N+1's band starts at the same source pixel, so the white gap acts as an opaque gutter without hiding any image pixels. Template-wide blur + brightness apply uniformly.
6. **Per-tile clipping** — the editor wraps each tile's elements in a `Konva.Group` with `clipX/Y/Width/Height` set to the tile rect, so devices, text, and icons near a tile edge are hard-cropped at the gutter rather than spilling across. While an element is being dragged or transformed, its tile's clip is temporarily dropped so the node stays visible mid-interaction. The exporter doesn't need an explicit clip — its stage is exactly one tile wide.

---

## Data model (Prisma / SQLite)

```prisma
model Template {
  // 1:1 sidecar to Project. Holds the visual recipe in a JSON blob.
  // Slot/Screen rows are retained pre-canvas-migration only — they're not
  // written or read once `migrationVersion >= 1` is stamped on the config.
  id        String   @id
  name      String
  slotCount Int                         // legacy — becomes panelCount in TemplateConfig at migration time
  config    String                      // JSON: TemplateConfig
  slots     Slot[]                      // legacy
  projects  Project[]
}

model Project {
  id         String
  name       String
  templateId String
  screens    Screen[]                   // legacy — read once by the migration helper
}

model Slot   { ... }                    // legacy, see git history pre-canvas-model
model Screen { ... }                    // legacy
```

`TemplateConfig` is the only thing the editor reads/writes after migration. Shapes live in `lib/editor-types.ts`:

```ts
TemplateConfig = {
  backgroundColor: string;
  fontFamily: string;                   // template-wide default; per-element fontFamily can override
  bezelColor: string;                   // hex; side ribbon = scaleColor(bezelColor, 0.6)
  bezelCornerRadius: number;            // 0..200 px on 1290-wide canvas
  bgImagePath?: string;                 // relative to UPLOAD_DIR; timestamped per upload
  bgImageMode: "single" | "panorama";   // legacy parse-only — render always treats bg as one panorama
  bgImagePanoZoom: number;              // 1..3
  bgImagePanoBlur: number;              // 0..60 px
  bgImagePanoBrightness: number;        // 0..1.5 multiplier
  customIcons: { id, name, path }[];    // user-uploaded SVG icons (path under UPLOAD_DIR)
  panelCount: number;                   // number of tiles (= number of exported PNGs per device size)
  elements: CanvasElement[];            // text + icon + device, all on the wide canvas
  screenshots: ScreenshotAsset[];       // shared pool; DeviceElement.screenshotId references these
  migrationVersion?: number;            // 1 = canvas model built, 3 = current
}

CanvasElement =
  | TextElement {
      type: "text"; id; pos: { x, y };  // pos.x in [0, panelCount]; pos.y in [0, 1]
      width;                            // fraction of PANEL_W; auto-fits to text
      align: "left" | "center" | "right";
      text; fontSize; fontFamily?; weight: 400..800; italic; color; rotation;
    }
  | IconElement {
      type: "icon"; id; pos: { x, y };
      size;                             // longest-edge px in 1290-wide canvas space
      icon: string;                     // built-in key OR `custom:<path>` for uploaded SVG
      color; rotation;
    }
  | DeviceElement {
      type: "device"; id; pos: { x, y };
      size;                             // fraction of PANEL_W (0.7 ≈ default)
      rotation; tiltX; tiltY;
      screenshotId?: string;            // references ScreenshotAsset.id in the project's pool
      panelIndex?: number;              // authoritative tile assignment — drag never changes this
    };

ScreenshotAsset = { id, path, uploadedAt };   // path is under UPLOAD_DIR
```

### Migration

`lib/projectMigration.ts` runs server-side on every project load and is idempotent. Steps stamped into `config.migrationVersion`:

- **v0 → v1** — translate each `Slot.config.elements[]` (slot-local 0..1) into canvas-space (`pos.x` offset by slot index). Synthesise a `DeviceElement` per old slot from its `devicePos/deviceScale/deviceRotation/deviceTilt*`. Convert each `Screen` row into a `ScreenshotAsset` and attach by `slotOrder`.
- **v1 → v2** — (historical) shift devices right by 0.2 panel-units to span panel boundaries. Superseded.
- **v2 → v3** — undo the v2 shift. Once panels gained a visible gutter and elements became hard-clipped per tile, the v2 shift just wasted half of every device into the gap. v3 subtracts 0.2 from non-last-panel devices when the config was actually persisted at v2.

New devices added in the editor write `panelIndex` explicitly. Legacy migrated devices have `panelIndex` undefined and fall back to `Math.floor(pos.x)` until the user interacts with them, at which point `panelIndex` is locked.

---

## Development

```bash
# install
npm install

# first-time database setup
npx prisma migrate dev

# dev server (HMR)
npm run dev
# → http://localhost:3000

# type-check + production build
npm run build
```

The local `.env` points the database at `./data/screenshotmaker.db` and uploads at `./data/uploads/`. Both directories are created automatically.

### Useful Prisma commands

```bash
npx prisma studio        # browse the DB at localhost:5555
npx prisma migrate dev --name <change_name>
```

---

## Deployment (Docker)

```bash
docker compose up -d --build
# → http://localhost:3000
# Data persists in ./data/ on the host (mounted at /data inside the container)
```

The container runs `prisma migrate deploy` on startup, then `node server.js` from the Next.js standalone build.

### Volume layout

```
./data/
├── screenshotmaker.db                       # SQLite (back this up to back up everything)
├── screenshotmaker.db-journal
└── uploads/
    ├── templates/
    │   └── <templateId>/
    │       ├── bg-<epoch>.<ext>             # template-level background image
    │       └── icons/<iconId>.svg           # user-uploaded SVG icons
    └── <projectId>/
        └── <screenId>.png                   # per-slot screenshot
```

To back up: stop the container, copy `./data/`. To wipe: delete the directory and restart.

### Migrating to another host

Everything stateful lives in `./data/` (the SQLite file + every uploaded screenshot). The Docker image is fully rebuildable from the source tree. So a move is two copies:

```bash
# --- on the old host ---
docker compose down                    # quiesce writes
tar czf screenshotmaker-backup.tgz \
    --exclude='node_modules' \
    --exclude='.next' \
    .                                  # source + data + migrations
scp screenshotmaker-backup.tgz user@newhost:/srv/

# --- on the new host ---
cd /srv && tar xzf screenshotmaker-backup.tgz -C screenshotmaker
cd screenshotmaker
docker compose up -d --build
```

Minimal alternative if the source is already on the new host (e.g. via git):

```bash
# old host
docker compose down
rsync -avz ./data/ user@newhost:/srv/screenshotmaker/data/

# new host
cd /srv/screenshotmaker
docker compose up -d --build           # entrypoint runs `prisma migrate deploy`
```

The entrypoint applies any pending Prisma migrations against the copied SQLite file on first boot, so going from an older to a newer schema across hosts is automatic — no manual migration step needed.

Sanity checks after move:
- Visit `http://<newhost>:3000` and confirm your templates/projects appear.
- Open any project and verify the screenshot previews load (proves `/api/uploads/` is reading from the migrated `data/uploads/`).
- Export a ZIP and spot-check one PNG opens at the expected dimensions.

### Environment variables

| Variable | Default (dev) | Default (container) | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `file:../data/screenshotmaker.db` | `file:/data/screenshotmaker.db` | Prisma SQLite location |
| `UPLOAD_DIR` | `./data/uploads` | `/data/uploads` | Where uploaded screenshots are written |
| `PORT` | — | `3000` | HTTP port |

---

## End-to-end workflow

1. **Create a project:** name + tile count → opens the unified editor.
2. **Upload screenshots** to the project's pool from the inspector. They appear as thumbnails; assign one to a device by selecting the device and clicking a thumbnail.
3. **Design on the single wide canvas:**
   - Add elements with `+ Add text` / `+ Add icon` / `+ Add device`. New devices land on the first empty tile by default.
   - Each element is independently draggable, rotatable (top handle), and resizable (corner handles). Devices are clipped at their tile's edges; while you drag one the clip is dropped so you can see it pass over the gutter.
   - **Tile** dropdown in the device inspector reassigns which tile a device renders inside; `pos.x` is shifted automatically so the device keeps the same relative position inside its new tile.
   - **Double-click text** to edit in place — the overlay textarea matches the rendered font/size/rotation.
   - Per-text-element: font picker (~20 system families), Bold / Italic toggles, weight 400–800, colour, align, rotation slider. Width auto-fits to typed content.
   - Per-icon-element: pick from 12 built-ins, or **upload your own SVG** files (per project); set size, colour (built-ins), rotation.
   - Tune device tilt (X axis = top/bottom edge, Y axis = side edge), Z-axis rotation (-90° to +90°), scale.
   - Pick a **bezel colour** preset / custom hue and a **bezel corner radius** (0 = sharp, 200 = pill).
   - Upload a **background image**; template-wide zoom / blur / brightness sliders apply to the panorama uniformly.
   - Changes autosave every 600ms.
4. **Export ZIP** — renders every `(tile × device-size)` combination, packs into ZIP, downloads.

### Phone-bridging trick

The App-Store split-phone effect (one phone visually spans two tiles with the gap cutting through the body) isn't a single-element behaviour — phones are tile-locked. Instead, add **two devices**: assign one to tile N, position it near the inside (right) edge; add a second, assign it to tile N+1, position it near its inside (left) edge with matching tilt / size. Each clips at its own tile's edge and the white gutter sits between them, matching App Store Connect's preview.

---

## Known limits / trade-offs

- **iPad layout is naive.** Normalized coords are referenced to the iPhone 6.7 aspect (≈0.46). The iPad 13" canvas (≈0.75) renders the same layout, leaving large empty bands. Tweak positions with iPad in mind, or skip iPad for now.
- **Stylized device frame**, not real Apple bezel PNGs. The pseudo-3D prism + rounded-corner ribbon reads as a phone but isn't pixel-accurate to any specific model. Notch is always black regardless of bezel colour (matches real iPhones).
- **Fonts are OS-resolved system fonts.** The font picker lists ~20 cross-platform families; rendering depends on what the browser/container has installed. Custom font upload + web fonts (Google Fonts) aren't wired up yet.
- **Custom SVG icons keep their own colours.** Multi-colour SVGs don't recolour from the inspector; the colour picker is a no-op for uploaded icons (built-in icons recolour as before).
- **No undo/redo** in the editor — changes are autosaved live.
- **No auth.** Anyone with network access to the port can use the app. Intended for LAN / Tailscale. Add basic auth middleware if exposing publicly.
- **Perspective tilt is rounded-rect prism, not true 3D.** Looks correct for typical hero-shot angles (≤30°); extreme angles will show projection artefacts.
- **Phone-bridging is two-device manual alignment**, not single-element spanning — see the workflow note above.
- **Devices are tile-locked.** Dragging never changes a device's tile assignment; use the inspector's Tile dropdown to move a device between tiles.
- **Legacy `Slot`, `Screen`, and `Slot.headline/subhead` rows + columns** still exist in the DB schema. They're read once by `lib/projectMigration.ts` (v0 → v1) and then ignored. Safe to drop in a future schema cleanup once no project on the host predates v1.
- **DB still has separate `Template` and `Project` tables** even though the UI presents them as one. They're a 1:1 sidecar. Orphan templates (without a project) are auto-promoted by creating a matching project on home-page load.

---

## Build history

Built incrementally:

1. **Skeleton** — Next.js + Prisma + SQLite scaffold, project/template list pages, CRUD API, Docker.
2. **Template editor** — Konva canvas, slot navigation, background/font/tilt/scale controls, debounced autosave.
3. **Project flow** — drag-and-drop multi-file upload, slot grid with real screenshot previews, replace/remove/reorder.
4. **Export** — vanilla-Konva off-DOM rendering at native device pixel sizes, multi-size ZIP packaging via JSZip, progress indicator.
5. **Filmstrip + perspective tilt + image backgrounds** — all-slots-at-once view, real Y-axis perspective tilt (custom quad warp + canvas triangle subdivision), template-level bg image upload with per-slot pan/zoom/blur/brightness.
6. **3D edges + dual-axis tilt + bezel colors** — device modelled as a rounded-rect prism with visible side ribbon that wraps around rounded corners; both X and Y tilt axes; bezel color picker with auto-derived side shade.
7. **Panorama backgrounds** — second bg mode that splits the source image into N equal vertical bands so the slots side-by-side form one continuous backdrop; template-wide zoom/blur/brightness sliders keep the panorama seamless; uploads timestamped to defeat HTTP + React caches.
8. **Free-form elements + paint-program direct manipulation** — replaced the fixed headline/subhead pair with an unbounded `elements: SlotElement[]` array of text boxes and icons. Konva `Transformer` gives every selected element corner-resize + rotate handles; double-click text opens an in-place HTML overlay editor matching the rendered font / size / rotation. Text boxes auto-fit their typed content (no manual wrap-width). Per-element font picker (~20 system fonts), Bold + Italic toggles, weight, colour, align, rotation.
9. **Custom SVG icons + bezel corner radius** — upload your own SVG files per template (stored under `data/uploads/templates/<id>/icons/`), pick them from the same icon picker grid; new `TemplateConfig.bezelCornerRadius` slider (0–200 px) lets the device frame range from sharp rectangle to pill shape.
10. **UI collapse: one project, one editor** — Template and Project were redundant in practice (you almost always make one project per template). The home page now lists Projects only; the project page hosts the full visual editor + drop zone + per-slot screenshot management + export on a single screen. DB schema is unchanged (Template still exists as a 1:1 sidecar); orphan templates from before the collapse get auto-promoted to projects on home load. Legacy `/templates/<id>` URLs redirect to their matching project.
11. **Continuous-canvas model + tile-locked devices** — replaced the per-slot data model with a single wide canvas split into N "tiles" by a visible white gutter (matching App Store Connect's preview). All elements — text, icons, **and** devices — live on one `elements[]` array with panel-space coordinates. Screenshots become a project-wide pool referenced by `DeviceElement.screenshotId`. Per-tile `Konva.Group` clip rects hard-crop content at the gutter; the bg image is cover-fit once across the full canvas and sliced contiguously (no source pixels disappear behind the gap). A server-side migration (`lib/projectMigration.ts`) reshapes legacy per-slot data on first load and stamps `migrationVersion`. Devices carry an explicit `panelIndex` so dragging never accidentally re-assigns the device to a neighbouring tile — the inspector's Tile dropdown is the only way to move one between tiles.

---

## License

Personal project. No license declared.
