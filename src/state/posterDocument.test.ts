import { describe, expect, it } from "vitest";
import {
  createDocument,
  createDocumentFromImage,
  createTextLayer,
  fitInto,
  hitTestLayer,
} from "./posterDocument";

describe("poster document model", () => {
  it("creates an empty document with dimensions", () => {
    const document = createDocument(1024, 1536);
    expect(document.width).toBe(1024);
    expect(document.height).toBe(1536);
    expect(document.layers).toHaveLength(0);
  });

  it("creates a document with the image as the full-size base layer", () => {
    const document = createDocumentFromImage(800, 600, "data:image/png;base64,x");
    expect(document.layers).toHaveLength(1);
    const layer = document.layers[0];
    expect(layer.kind).toBe("image");
    if (layer.kind === "image") {
      expect(layer.width).toBe(800);
      expect(layer.height).toBe(600);
      expect(layer.x).toBe(0);
      expect(layer.y).toBe(0);
      expect(layer.src).toBe("data:image/png;base64,x");
    }
  });

  it("fitInto preserves the aspect ratio and never upscales", () => {
    expect(fitInto(4000, 2000, 1000, 1000)).toEqual({ width: 800, height: 400 });
    expect(fitInto(100, 100, 1000, 1000)).toEqual({ width: 100, height: 100 });
  });

  it("createTextLayer picks a readable default font size", () => {
    const layer = createTextLayer(10, 20, 1000);
    expect(layer.kind).toBe("text");
    expect(layer.fontSize).toBeGreaterThanOrEqual(24);
    expect(layer.opacity).toBe(1);
    expect(layer.text).toBe("Your text");
  });

  it("hitTestLayer finds the topmost visible layer", () => {
    const document = createDocument(500, 500);
    const bottom = createTextLayer(0, 0, 500);
    const top = createTextLayer(0, 0, 500);
    document.layers.push(bottom, top);
    // Overlapping text layers at the same spot select the topmost.
    const hit = hitTestLayer(document, 10, 10);
    expect(hit).toBe(top.id);
  });

  it("hitTestLayer skips hidden layers", () => {
    const document = createDocument(500, 500);
    const visible = createTextLayer(100, 100, 500);
    const hidden = createTextLayer(100, 100, 500);
    hidden.visible = false;
    document.layers.push(visible, hidden);
    const hit = hitTestLayer(document, 150, 110);
    expect(hit).toBe(visible.id);
  });

  it("hitTestLayer returns null outside all layers", () => {
    const document = createDocument(500, 500);
    const layer = createTextLayer(10, 10, 500);
    document.layers.push(layer);
    expect(hitTestLayer(document, 400, 400)).toBeNull();
  });
});
