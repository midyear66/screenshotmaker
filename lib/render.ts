"use client";

import Konva from "konva";
import {
  PANEL_GAP_PX,
  PANEL_W,
  PANEL_H,
  CanvasElement,
  ScreenshotAsset,
  TemplateConfig,
  isCustomIcon,
  customIconPath,
  panelIdxFor,
} from "@/lib/editor-types";
import { renderBackgroundCanvas } from "@/lib/background";
import {
  BEZEL_H,
  BEZEL_W,
  CORNER_RADIUS,
  renderFlatDeviceFrame,
} from "@/lib/deviceFrame";
import { computeTiltedDevice, renderTiltedDevice } from "@/lib/perspective";
import { scaleColor } from "@/lib/color";
import { ICON_VIEWBOX_SIZE, ICONS } from "@/lib/icons";

export type DeviceSize = {
  key: string;
  label: string;
  folder: string;
  width: number;
  height: number;
};

export const DEVICE_SIZES: DeviceSize[] = [
  { key: "iphone-6.7", label: 'iPhone 6.7"', folder: "iPhone-6.7", width: 1290, height: 2796 },
  { key: "iphone-6.5", label: 'iPhone 6.5"', folder: "iPhone-6.5", width: 1242, height: 2688 },
  { key: "ipad-13", label: 'iPad Pro 13"', folder: "iPad-13", width: 2064, height: 2752 },
];

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Load all screenshots referenced by DeviceElements in one pass. */
async function loadScreenshotMap(
  screenshots: ScreenshotAsset[]
): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>();
  await Promise.all(
    screenshots.map(async (s) => {
      try {
        const img = await loadImage(`/api/uploads/${s.path}`);
        map.set(s.id, img);
      } catch {
        // missing or broken image; device will fall back to placeholder
      }
    })
  );
  return map;
}

/**
 * Render one panel of the project's continuous canvas at the device's native
 * pixel size. Elements are positioned in panel-space (`pos.x` is panels,
 * `pos.y` is 0..1 of height); the renderer translates them to panel-local
 * pixel coords and relies on Konva's stage-bounds clipping to hard-crop at
 * panel edges.
 */
export async function renderPanelToBlob(args: {
  template: TemplateConfig;
  panelIndex: number;
  device: DeviceSize;
  /** Pre-loaded screenshot map (avoids re-fetching across multiple panels). */
  screenshotMap?: Map<string, HTMLImageElement>;
  bgImage?: HTMLImageElement | null;
}): Promise<Blob> {
  const { template, panelIndex, device } = args;
  const panelCount = Math.max(1, template.panelCount);
  // pixel-scale relative to base panel logical dimensions
  const xScale = device.width / PANEL_W;
  // y scale is device.height / PANEL_H; intentionally allowed to differ from
  // xScale so the export matches the editor's non-uniform scaling.
  const yScale = device.height / PANEL_H;

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-99999px";
  container.style.top = "-99999px";
  document.body.appendChild(container);

  const stage = new Konva.Stage({
    container,
    width: device.width,
    height: device.height,
  });
  const layer = new Konva.Layer();
  stage.add(layer);

  try {
    const screenshotMap =
      args.screenshotMap ?? (await loadScreenshotMap(template.screenshots));
    const bgImage =
      args.bgImage ??
      (template.bgImagePath
        ? await loadImage(`/api/uploads/${template.bgImagePath}`).catch(() => null)
        : null);

    // ---- Background (sliced to this panel) ----
    const bgCanvas = renderBackgroundCanvas({
      width: device.width,
      height: device.height,
      bgImage,
      slot: {
        devicePos: { x: 0, y: 0 },
        deviceScale: 1,
        deviceRotation: 0,
        deviceTiltX: 0,
        deviceTiltY: 0,
        bgImagePan: { x: 0, y: 0 },
        bgImageZoom: 1,
        bgImageBlur: 0,
        bgImageBrightness: 1,
        elements: [],
      },
      fallbackColor: template.backgroundColor,
      panorama: {
        slotIndex: panelIndex,
        totalSlots: panelCount,
        zoom: template.bgImagePanoZoom,
        blur: template.bgImagePanoBlur,
        brightness: template.bgImagePanoBrightness,
        // gap=0: split the cover-fit area into N equal slices, one per
        // panel. No source pixels are "lost" between bands — sliding the
        // exported PNGs together reconstructs the full cover-fit area.
        // Editor uses the same mapping (see EditorCanvas) so spanning
        // iPhones land at the same source pixels in both views.
        gap: 0,
      },
    });
    layer.add(
      new Konva.Image({
        image: bgCanvas,
        x: 0,
        y: 0,
        width: device.width,
        height: device.height,
        listening: false,
      })
    );

    // ---- Elements: render only the elements that belong to THIS tile,
    // partitioned the same way as the editor (`panelIdxFor`). Devices use
    // their explicit `panelIndex`; text + icons use `Math.floor(pos.x)`.
    // Elements that extend past the tile edge (e.g. a phone positioned near
    // the right edge of its tile) get clipped by Konva's stage-canvas
    // bounds — the stage is exactly one tile wide.
    for (const el of template.elements) {
      if (panelIdxFor(el, panelCount) !== panelIndex) continue;

      const xPanel = (el.pos.x - panelIndex) * device.width;
      const yPanel = el.pos.y * device.height;

      if (el.type === "text") {
        renderText(layer, el, xPanel, yPanel, xScale, template);
      } else if (el.type === "device") {
        await renderDeviceElement(
          layer,
          el,
          xPanel,
          yPanel,
          xScale,
          template,
          screenshotMap
        );
      } else if (el.type === "icon") {
        renderIcon(layer, el, xPanel, yPanel, xScale, yScale);
      }
    }

    layer.draw();

    const canvas = stage.toCanvas();
    if (canvas.width !== device.width || canvas.height !== device.height) {
      throw new Error(
        `Render dimension mismatch: got ${canvas.width}x${canvas.height}, expected ${device.width}x${device.height}`
      );
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });
    return blob;
  } finally {
    stage.destroy();
    container.remove();
  }
}

function renderText(
  layer: Konva.Layer,
  el: Extract<CanvasElement, { type: "text" }>,
  xPanel: number,
  yPanel: number,
  xScale: number,
  template: TemplateConfig
) {
  const blockW = el.width * PANEL_W * xScale;
  const fontPx = el.fontSize * xScale;
  const shadow = el.shadow;
  layer.add(
    new Konva.Text({
      x: xPanel,
      y: yPanel,
      width: blockW,
      offsetX: blockW / 2,
      offsetY: fontPx * 0.6,
      rotation: el.rotation,
      align: el.align,
      text: el.text,
      fontSize: fontPx,
      fontFamily: el.fontFamily ?? template.fontFamily,
      fontStyle: `${el.italic ? "italic " : ""}${el.weight}`,
      fill: el.color,
      // Shadow distances are stored in panel-space (same as fontSize) so
      // they get the same xScale multiplier here.
      shadowEnabled: !!shadow,
      shadowColor: shadow?.color,
      shadowBlur: shadow ? shadow.blur * xScale : undefined,
      shadowOffsetX: shadow ? shadow.offsetX * xScale : undefined,
      shadowOffsetY: shadow ? shadow.offsetY * xScale : undefined,
      shadowOpacity: shadow?.opacity,
    })
  );
}

function renderIcon(
  layer: Konva.Layer,
  el: Extract<CanvasElement, { type: "icon" }>,
  xPanel: number,
  yPanel: number,
  xScale: number,
  _yScale: number
) {
  void _yScale;
  if (isCustomIcon(el.icon)) {
    // Custom SVG: load synchronously isn't possible from inside this helper —
    // for export we'd need it pre-loaded. Pull it from a cache keyed by path,
    // or skip if not already loaded. We do load it here on demand:
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = `/api/uploads/${customIconPath(el.icon)}`;
    // Konva.Image accepts an image that hasn't finished loading; the layer
    // will repaint when it does. For final-PNG output we rely on the caller
    // having preloaded; otherwise the icon may be missing. Pragmatic: most
    // export passes await the bg + screenshots, and SVGs decode fast.
    const longest = el.size * xScale;
    layer.add(
      new Konva.Image({
        image: img,
        x: xPanel,
        y: yPanel,
        width: longest,
        height: longest,
        offsetX: longest / 2,
        offsetY: longest / 2,
        rotation: el.rotation,
      })
    );
    return;
  }
  const def = ICONS[el.icon];
  if (!def) return;
  const iconScale = (el.size * xScale) / ICON_VIEWBOX_SIZE;
  layer.add(
    new Konva.Path({
      x: xPanel,
      y: yPanel,
      data: def.path,
      fill: def.stroke ? undefined : el.color,
      stroke: def.stroke ? el.color : undefined,
      strokeWidth: def.stroke ? 2 : 0,
      lineCap: "round",
      lineJoin: "round",
      scaleX: iconScale,
      scaleY: iconScale,
      offsetX: ICON_VIEWBOX_SIZE / 2,
      offsetY: ICON_VIEWBOX_SIZE / 2,
      rotation: el.rotation,
    })
  );
}

async function renderDeviceElement(
  layer: Konva.Layer,
  el: Extract<CanvasElement, { type: "device" }>,
  xPanel: number,
  yPanel: number,
  xScale: number,
  template: TemplateConfig,
  screenshotMap: Map<string, HTMLImageElement>
) {
  const screenshot = el.screenshotId ? screenshotMap.get(el.screenshotId) ?? null : null;

  const flat = renderFlatDeviceFrame({
    screenshot,
    bezelColor: template.bezelColor,
    cornerRadius: template.bezelCornerRadius,
  });

  let warpedCanvas: HTMLCanvasElement = flat;
  let warpedW = flat.width;
  let warpedH = flat.height;
  let pivotX = flat.width / 2;
  let pivotY = flat.height / 2;
  if (Math.abs(el.tiltX) >= 0.5 || Math.abs(el.tiltY) >= 0.5) {
    const sideFill = scaleColor(template.bezelColor, 0.6);
    const tilted = computeTiltedDevice(
      BEZEL_W,
      BEZEL_H,
      template.bezelCornerRadius ?? CORNER_RADIUS,
      el.tiltX,
      el.tiltY,
      { sideFill }
    );
    warpedCanvas = renderTiltedDevice(flat, tilted, { subdivisions: 60 });
    warpedW = tilted.width;
    warpedH = tilted.height;
    pivotX = tilted.pivot.x;
    pivotY = tilted.pivot.y;
  }

  // `el.size` is a fraction of PANEL_W. The flat raster is BEZEL_W wide.
  // Render size in canvas px = el.size * PANEL_W. At device pixel scale:
  // device px size = el.size * PANEL_W * xScale.
  // The Konva.Image is given native warped raster dimensions, scaled by:
  // (target / source) = (el.size * PANEL_W * xScale) / BEZEL_W
  const deviceScale = (el.size * PANEL_W * xScale) / BEZEL_W;

  layer.add(
    new Konva.Image({
      image: warpedCanvas,
      x: xPanel,
      y: yPanel,
      width: warpedW,
      height: warpedH,
      offsetX: pivotX,
      offsetY: pivotY,
      scaleX: deviceScale,
      scaleY: deviceScale,
      rotation: el.rotation,
      shadowColor: "black",
      shadowBlur: 40,
      shadowOpacity: 0.35,
      shadowOffsetY: 20,
    })
  );
}
