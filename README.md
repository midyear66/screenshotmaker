# ScreenshotMaker

Self-hosted web app for generating App Store Connect–ready screenshots from a reusable template.

Build a template once (background, headline copy, device frame, text positions, colors). For each app release, drop in new screenshots → download a ZIP organized by device size, ready to upload to App Store Connect.

---

## What it does

1. **Templates** define the visual recipe for an app's screenshot set:
   - Configurable number of slots (one per screenshot in the final set; up to 10)
   - Filmstrip view — see every slot at once while editing
   - **Free-form text + icon elements** per slot (paint-program style): create / delete / move / rotate any number of text boxes and icons; resize via corner handles, rotate via the top handle, double-click text to edit in place
   - **Text:** per-element font picker (~20 system families), bold + italic toggles, weight 400–800, color, alignment, rotation; box width auto-fits the typed content
   - **Icons:** 12 built-in monoline icons + upload your own SVG files (per template) — colour, size, rotation, all work uniformly
   - Background color **or** uploaded background image with two modes:
     - **Single** — same image on every slot, per-slot pan / zoom / blur / brightness
     - **Panorama** — image is split into N equal vertical bands so the slots side-by-side form one continuous backdrop; template-wide zoom / blur / brightness keep the panorama seamless
   - Bezel color picker (black / graphite / grey / silver / custom) — side ribbon shade auto-derived
   - **Bezel corner radius** slider (0–200 px) for sharp-rectangle to pill-shaped device frames
   - Device tilt around **both** X and Y axes (real pseudo-3D perspective with visible side edges), plus Z-axis spin
   - Device scale / position, all coordinates normalized 0–1 so layouts scale to multiple device sizes at export

2. **Projects** apply a template to a set of screenshots:
   - Drag-and-drop multi-file upload (auto-maps to slots in upload order)
   - Replace, remove, reorder per slot
   - Live preview of how each slot will look

3. **Export** renders every (slot × device-size) combination at native App Store pixel dimensions and bundles them into a ZIP:
   ```
   <ProjectName>/
     iPhone-6.7/   01.png 02.png 03.png ...
     iPhone-6.5/   01.png 02.png 03.png ...
     iPad-13/      01.png 02.png 03.png ...
   ```
   Each PNG is dimension-verified before being added to the zip.

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
│   ├── page.tsx                              # Project + template list
│   ├── templates/[id]/page.tsx               # Template editor host
│   ├── projects/[id]/page.tsx                # Project editor host
│   └── api/
│       ├── templates/                        # GET, POST, PATCH, DELETE
│       ├── templates/[id]/slots/             # POST to add a slot
│       ├── templates/[id]/background/        # POST + DELETE for bg image
│       ├── slots/[id]/                       # PATCH (copy/config), DELETE
│       ├── projects/                         # GET, POST, PATCH, DELETE
│       ├── projects/[id]/screens/            # POST multipart (bulk or single-slot replace)
│       ├── screens/[id]/                     # DELETE
│       ├── screens/[id]/move/                # POST { direction: "up" | "down" }
│       └── uploads/[...path]/                # GET file (path-traversal protected)
├── components/
│   ├── NewTemplateButton / NewProjectButton / DeleteButton
│   ├── editor/
│   │   ├── TemplateEditor.tsx                # editor shell, filmstrip, slot nav, autosave
│   │   ├── EditorCanvas.tsx                  # react-konva Stage (dynamic, ssr:false)
│   │   ├── DeviceFrame.tsx                   # warped Konva.Image of the flat+tilted device canvas
│   │   └── useImage.ts
│   └── project/
│       ├── ProjectEditor.tsx                 # drop zone, slot grid
│       └── ExportButton.tsx                  # renders all (slot × device) → ZIP
├── lib/
│   ├── db.ts                                 # Prisma client singleton
│   ├── editor-types.ts                       # SlotConfig / TemplateConfig + parsers
│   ├── deviceFrame.ts                        # vanilla canvas2D flat device-frame raster
│   ├── perspective.ts                        # rounded-rect prism + triangle-subdivision warp
│   ├── background.ts                         # bg canvas (image + pan/zoom/blur/brightness)
│   ├── color.ts                              # scaleColor() helper
│   ├── uploads.ts                            # safe upload-dir helpers
│   └── render.ts                             # off-DOM export PNG renderer
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
5. **`renderBackgroundCanvas`** (`lib/background.ts`) — fills the solid color, then if a template-level bg image is set, applies `ctx.filter = "blur(...) brightness(...)"` and `drawImage` with cover-fit + per-slot pan/zoom.

---

## Data model (Prisma / SQLite)

```prisma
model Template {
  id        String   @id
  name      String
  slotCount Int
  config    String   // JSON: TemplateConfig
  slots     Slot[]
  projects  Project[]
}

model Slot {
  id         String
  templateId String
  order      Int               // 1-based, unique per template
  headline   String            // legacy; no longer read by the editor
  subhead    String?           // legacy; no longer read by the editor
  config     String            // JSON: SlotConfig (incl. elements[])
}

model Project {
  id         String
  name       String
  templateId String
  screens    Screen[]
}

model Screen {
  id             String
  projectId      String
  slotOrder      Int            // 1-based, unique per project
  screenshotPath String         // relative to UPLOAD_DIR
}
```

`TemplateConfig` and `SlotConfig` are JSON blobs inside the `config` columns; their shapes live in `lib/editor-types.ts`:

```ts
TemplateConfig = {
  backgroundColor: string;
  fontFamily: string;                   // template-wide default; per-element fontFamily can override
  bezelColor: string;                   // hex; side ribbon = scaleColor(bezelColor, 0.6)
  bezelCornerRadius: number;            // 0..200 px on 1290-wide canvas
  bgImagePath?: string;                 // relative to UPLOAD_DIR; timestamped per upload
  bgImageMode: "single" | "panorama";
  bgImagePanoZoom: number;              // 1..3, panorama mode
  bgImagePanoBlur: number;              // 0..60 px, panorama mode
  bgImagePanoBrightness: number;        // 0..1.5 multiplier, panorama mode
  customIcons: { id, name, path }[];    // user-uploaded SVG icons (path under UPLOAD_DIR)
}

SlotConfig = {
  devicePos: { x: 0..1, y: 0..1 };
  deviceScale: number;
  deviceRotation: number;               // Z-axis spin, degrees
  deviceTiltX: number;                  // rotation around device's X axis (top tilt)
  deviceTiltY: number;                  // rotation around device's Y axis (side lean)
  backgroundColor?: string;             // optional solid-color slot override
  bgImagePan: { x: -1..1, y: -1..1 };
  bgImageZoom: number;                  // 1..3
  bgImageBlur: number;                  // px in 1290-wide canvas space
  bgImageBrightness: number;            // 0..1.5 multiplier
  elements: SlotElement[];              // ordered text + icon overlay
}

SlotElement =
  | TextElement {
      type: "text";
      id: string;
      pos: { x, y };                    // normalized centre
      width: number;                    // auto-fit to text content
      align: "left" | "center" | "right";
      text: string;
      fontSize: number;                 // px in 1290-wide canvas space
      fontFamily?: string;              // optional per-element override
      weight: 400..800;
      italic: boolean;
      color: string;
      rotation: number;                 // degrees, around centre
    }
  | IconElement {
      type: "icon";
      id: string;
      pos: { x, y };
      size: number;                     // longest-edge px
      icon: string;                     // built-in key OR `custom:<path>` for uploaded SVG
      color: string;                    // applies to built-in icons; SVG uploads keep own colours
      rotation: number;
    };
```

`parseSlotConfig` merges parsed JSON over `DEFAULT_SLOT_CONFIG`, so existing slots without new fields auto-migrate to defaults at read time. Historic configs that used `deviceTiltX` for what's now `deviceTiltY` are also fixed up in the parser. Slots that pre-date the elements refactor open with an empty `elements` array (clean break — re-add text/icons from the inspector).

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

1. **Create a template:** name + slot count → opens the editor.
2. **In the template editor:**
   - The **filmstrip** at the top shows every slot live; click any thumbnail to make it the active full-size canvas.
   - **Add text or icons** to the active slot with `+ Add text` / `+ Add icon`. Each element is independently draggable, rotatable (top handle), and resizable (corner handles). **Double-click text** to edit in place — the textarea matches the rendered font/size/rotation.
   - Per-text-element: font picker (~20 system families), Bold / Italic toggles, weight 400–800, colour, align, rotation slider. Width auto-fits to typed content.
   - Per-icon-element: pick from 12 built-ins, or **upload your own SVG** files (per template); set size, colour (built-ins), rotation.
   - Tune device tilt (X axis = top/bottom edge, Y axis = side edge), rotation (Z-axis spin), and scale.
   - Pick a **bezel colour** preset / custom hue and a **bezel corner radius** (0 = sharp, 200 = pill).
   - Upload a **background image** to the template; per-slot sliders control pan / zoom / blur / brightness in single mode (template-wide sliders in panorama mode).
   - Changes autosave every 600ms.
3. **Create a project** using that template.
4. **Drop screenshots** into the drop zone. They fill empty slots in upload order.
5. **Tweak:** replace one screenshot, reorder with ↑/↓, remove with ✕.
6. **Export ZIP** — disabled until every slot has a screenshot. Click → renders all `(slot × device-size)` combinations, packs into ZIP, downloads.

---

## Known limits / trade-offs

- **iPad layout is naive.** Normalized coords are referenced to the iPhone 6.7 aspect (≈0.46). The iPad 13" canvas (≈0.75) renders the same layout, leaving large empty bands. Tweak each slot's device/text positions with iPad in mind, or skip iPad for now.
- **Stylized device frame**, not real Apple bezel PNGs. The pseudo-3D prism + rounded-corner ribbon reads as a phone but isn't pixel-accurate to any specific model. Notch is always black regardless of bezel colour (matches real iPhones).
- **Fonts are OS-resolved system fonts.** The font picker lists ~20 cross-platform families; rendering depends on what the browser/container has installed. Custom font upload + web fonts (Google Fonts) aren't wired up yet.
- **Custom SVG icons keep their own colours.** Multi-colour SVGs don't recolour from the inspector; the colour picker is a no-op for uploaded icons (built-in icons recolour as before).
- **No undo/redo** in the editor — changes are autosaved live.
- **No auth.** Anyone with network access to the port can use the app. Intended for LAN / Tailscale. Add basic auth middleware if exposing publicly.
- **Perspective tilt is rounded-rect prism, not true 3D.** Looks correct for typical hero-shot angles (≤30°); extreme angles will show projection artefacts.
- **Legacy `Slot.headline` / `Slot.subhead` columns** still exist in the DB schema but are no longer read or written — kept to avoid a Prisma migration. Safe to drop in a future schema cleanup.

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

---

## License

Personal project. No license declared.
