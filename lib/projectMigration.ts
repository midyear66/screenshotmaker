// Server-side migrations on top of the stored TemplateConfig.
//
// Two steps, applied in order on every project load:
//
//   v0 → v1: per-slot data → continuous-canvas model.
//     Translates each Slot's text/icon elements (slot-local 0..1) into
//     canvas-space (`pos.x` offset by slot index) and synthesises a
//     DeviceElement from the slot's device fields. Each Screen row becomes
//     a ScreenshotAsset; the matching slot's device gets its screenshotId.
//
//   v1 → v2: span-positioning shift.
//     Every device shifted `pos.x` right by 0.2 panel-units (so a centred
//     iPhone at i + 0.5 became i + 0.7) to extend into the next panel.
//     Superseded by v3 below — kept as a historical step.
//
//   v2 → v3: undo the v1→v2 shift.
//     Once panels regained a visible white gutter and elements became
//     hard-clipped per panel, the v2 right-shift just wasted the right
//     half of every device into the gap. v3 subtracts 0.2 from every
//     non-last-panel device's `pos.x`, snapping them back to roughly the
//     centre of their tile so the user starts from a sane layout.
//
// `config.migrationVersion` tracks the highest step that has been applied.

import { prisma } from "@/lib/db";
import {
  CanvasElement,
  DeviceElement,
  isMigratedConfig,
  LATEST_MIGRATION_VERSION,
  newElementId,
  parseSlotConfig,
  parseTemplateConfig,
  ScreenshotAsset,
  SlotElement,
  TemplateConfig,
} from "@/lib/editor-types";

type FullProject = Awaited<ReturnType<typeof loadFullProject>>;

function loadFullProject(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      template: { include: { slots: { orderBy: { order: "asc" } } } },
      screens: { orderBy: { slotOrder: "asc" } },
    },
  });
}

/**
 * Bring the project's stored TemplateConfig up to LATEST_MIGRATION_VERSION,
 * persisting any changes, and return the up-to-date project. Idempotent —
 * already-current projects no-op.
 */
export async function migrateProjectIfNeeded(
  projectId: string
): Promise<NonNullable<FullProject>> {
  const project = await loadFullProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  let config = parseTemplateConfig(project.template.config);
  let dirty = false;

  // ---- v0 → v1: per-slot data → continuous-canvas model ----
  if (!isMigratedConfig(config)) {
    config = applyV0toV1(config, project);
    dirty = true;
  }

  // ---- v1 → v2: shift devices right so they span panel boundaries ----
  if ((config.migrationVersion ?? 0) < 2) {
    config = applyV1toV2(config);
    dirty = true;
  }

  // ---- v2 → v3: undo the v1→v2 shift (panels now clip per-tile) ----
  if ((config.migrationVersion ?? 0) < 3) {
    config = applyV2toV3(config);
    dirty = true;
  }

  if (!dirty) return project;

  await prisma.template.update({
    where: { id: project.template.id },
    data: { config: JSON.stringify(config) },
  });
  const refreshed = await loadFullProject(projectId);
  if (!refreshed) throw new Error("project disappeared during migration");
  return refreshed;
}

function applyV0toV1(
  config: TemplateConfig,
  project: NonNullable<FullProject>
): TemplateConfig {
  // ---- Build screenshots pool from Screen rows ----
  const screenshots: ScreenshotAsset[] = [];
  const screenshotByOrder = new Map<number, string>();
  for (const s of project.screens) {
    const asset: ScreenshotAsset = {
      id: newElementId(),
      path: s.screenshotPath,
      uploadedAt: s.id, // we don't have a true timestamp; the id sorts roughly
    };
    screenshots.push(asset);
    screenshotByOrder.set(s.slotOrder, asset.id);
  }

  // ---- Build canvas-space elements from slots ----
  const elements: CanvasElement[] = [];
  for (const slot of project.template.slots) {
    const slotIdx = slot.order - 1; // 0-based panel index
    const slotConfig = parseSlotConfig(slot.config);

    for (const el of slotConfig.elements) {
      const offsetX = slotIdx + el.pos.x;
      const moved: SlotElement = {
        ...el,
        pos: { x: offsetX, y: el.pos.y },
      } as SlotElement;
      elements.push(moved);
    }

    const device: DeviceElement = {
      type: "device",
      id: newElementId(),
      pos: {
        x: slotIdx + (slotConfig.devicePos?.x ?? 0.5),
        y: slotConfig.devicePos?.y ?? 0.62,
      },
      size: slotConfig.deviceScale ?? 0.7,
      rotation: slotConfig.deviceRotation ?? 0,
      tiltX: slotConfig.deviceTiltX ?? 0,
      tiltY: slotConfig.deviceTiltY ?? 0,
      screenshotId: screenshotByOrder.get(slot.order),
    };
    elements.push(device);
  }

  return {
    ...config,
    panelCount: project.template.slotCount || 1,
    elements,
    screenshots,
    migrationVersion: 1,
  };
}

/**
 * Shift every device's `pos.x` right by 0.2 panel-units so its body extends
 * into the next panel. Devices already in the last panel are left untouched
 * (shifting them would push the body partly off the right edge of the
 * canvas; the rightmost device naturally caps the panorama).
 */
function applyV1toV2(config: TemplateConfig): TemplateConfig {
  const panelCount = Math.max(1, config.panelCount);
  const SHIFT = 0.2;
  return {
    ...config,
    migrationVersion: 2,
    elements: config.elements.map((el) => {
      if (el.type !== "device") return el;
      const panelIdx = Math.floor(el.pos.x);
      if (panelIdx >= panelCount - 1) return el;
      return {
        ...el,
        pos: { x: el.pos.x + SHIFT, y: el.pos.y },
      };
    }),
  };
}

/**
 * Reverse the v1→v2 shift. Skips devices in the last panel (which v1→v2
 * also skipped) so the inverse is exact for projects that went through v2.
 * Projects that never saw v2 (fresh out of v1) have no shift to undo, but
 * applying this anyway leaves their last-panel devices alone and shifts
 * everyone else left by 0.2 — which would mis-position freshly-built
 * configs. To stay safe we only undo when the stored version was 2.
 */
function applyV2toV3(config: TemplateConfig): TemplateConfig {
  const cameFromV2 = (config.migrationVersion ?? 0) === 2;
  if (!cameFromV2) {
    return { ...config, migrationVersion: LATEST_MIGRATION_VERSION };
  }
  const panelCount = Math.max(1, config.panelCount);
  const SHIFT = 0.2;
  return {
    ...config,
    migrationVersion: LATEST_MIGRATION_VERSION,
    elements: config.elements.map((el) => {
      if (el.type !== "device") return el;
      const panelIdx = Math.floor(el.pos.x - SHIFT);
      if (panelIdx >= panelCount - 1) return el;
      return {
        ...el,
        pos: { x: el.pos.x - SHIFT, y: el.pos.y },
      };
    }),
  };
}
