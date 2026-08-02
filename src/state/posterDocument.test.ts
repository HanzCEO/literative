import { describe, expect, it } from "vitest";
import {
  createDocument,
  createDocumentFromImage,
  createShapeLayer,
  createTextLayer,
  fitInto,
  hitTestLayer,
  layerBounds,
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

describe("shape layers", () => {
  it("creates a rect with default fill and no stroke", () => {
    const shape = createShapeLayer(10, 20, 100, 50, "rect");
    expect(shape.kind).toBe("shape");
    expect(shape.shapeType).toBe("rect");
    expect(shape.fill).toBe("#1a1a1f");
    expect(shape.strokeWidth).toBe(0);
    expect(shape.rotation).toBe(0);
    expect(shape.name).toBe("Rectangle");
  });

  it("creates a line with a visible stroke and no fill", () => {
    const shape = createShapeLayer(0, 0, 100, 40, "line");
    expect(shape.strokeWidth).toBeGreaterThan(0);
    expect(shape.fill).toBe("#00000000");
    expect(shape.name).toBe("Line");
  });

  it("layerBounds returns the rendered box for every kind", () => {
    const document = createDocument(500, 500);
    const image = createDocumentFromImage(800, 600, "x");
    const shape = createShapeLayer(0, 0, 120, 60, "ellipse");
    const text = createTextLayer(0, 0, 500);
    document.layers.push(image.layers[0], shape, text);
    expect(layerBounds(image.layers[0])).toEqual({ width: 800, height: 600 });
    expect(layerBounds(shape)).toEqual({ width: 120, height: 60 });
    expect(layerBounds(text)).toEqual({
      width: text.text.length * text.fontSize * 0.55,
      height: text.fontSize * 1.2,
    });
  });

  it("hitTestLayer finds a rect only inside its bounds", () => {
    const document = createDocument(500, 500);
    const shape = createShapeLayer(100, 100, 200, 100, "rect");
    document.layers.push(shape);
    expect(hitTestLayer(document, 150, 120)).toBe(shape.id);
    expect(hitTestLayer(document, 320, 220)).toBeNull();
  });

  it("hitTestLayer ignores the cut corners of a rounded rect", () => {
    const document = createDocument(500, 500);
    const shape = createShapeLayer(0, 0, 100, 100, "rect", {
      cornerRadius: 40,
    });
    document.layers.push(shape);
    // Inside the rounded rectangle body.
    expect(hitTestLayer(document, 50, 50)).toBe(shape.id);
    // The corner arc cuts the point away from the shape.
    expect(hitTestLayer(document, 3, 3)).toBeNull();
    // The arc reaches up to 40px from the corner center at (40, 40).
    expect(hitTestLayer(document, 41, 41)).toBe(shape.id);
  });

  it("hitTestLayer finds an ellipse only inside its outline", () => {
    const document = createDocument(500, 500);
    const shape = createShapeLayer(100, 100, 200, 100, "ellipse");
    document.layers.push(shape);
    expect(hitTestLayer(document, 200, 150)).toBe(shape.id);
    // Inside the bounding box but outside the ellipse: a corner miss.
    expect(hitTestLayer(document, 105, 105)).toBeNull();
  });

  it("hitTestLayer finds a line within stroke distance", () => {
    const document = createDocument(500, 500);
    const shape = createShapeLayer(0, 0, 200, 0, "line");
    document.layers.push(shape);
    // On the segment with the default stroke radius.
    expect(hitTestLayer(document, 100, 2)).toBe(shape.id);
    // Beyond the stroke distance.
    expect(hitTestLayer(document, 100, 10)).toBeNull();
    // Near the end point.
    expect(hitTestLayer(document, 199, 2)).toBe(shape.id);
  });

  it("hitTestLayer honors shape visibility", () => {
    const document = createDocument(500, 500);
    const shape = createShapeLayer(0, 0, 100, 100, "rect");
    shape.visible = false;
    document.layers.push(shape);
    expect(hitTestLayer(document, 50, 50)).toBeNull();
  });
});

describe("rotated layers", () => {
  it("hitTestLayer ignores points inside the unrotated box of a rotated image", () => {
    const document = createDocument(500, 500);
    const image = createDocumentFromImage(100, 50, "x");
    const layer = image.layers[0];
    // 90 degrees around the center (50, 25): the box becomes 50x100.
    layer.rotation = 90;
    document.layers.push(layer);
    // Inside the unrotated box but outside the rotated one.
    expect(hitTestLayer(document, 10, 25)).toBeNull();
    // Inside the rotated box but outside the unrotated one.
    expect(hitTestLayer(document, 50, 70)).toBe(layer.id);
    // The rotation center always hits.
    expect(hitTestLayer(document, 50, 25)).toBe(layer.id);
  });

  it("hitTestLayer rotates shape hit boxes", () => {
    const document = createDocument(500, 500);
    const shape = createShapeLayer(100, 100, 100, 40, "rect");
    shape.rotation = 90;
    document.layers.push(shape);
    // Rotated 90 degrees around the center (150, 120), the box spans
    // x 130..170 and y 70..170.
    expect(hitTestLayer(document, 150, 120)).toBe(shape.id);
    expect(hitTestLayer(document, 150, 150)).toBe(shape.id);
    // Inside the unrotated box but outside the rotated one.
    expect(hitTestLayer(document, 110, 120)).toBeNull();
    // Outside both boxes.
    expect(hitTestLayer(document, 200, 140)).toBeNull();
  });

  it("hitTestLayer rotates text hit boxes", () => {
    const document = createDocument(500, 500);
    const text = createTextLayer(0, 0, 500);
    text.text = "AAAA";
    text.fontSize = 100;
    text.rotation = 90;
    document.layers.push(text);
    // Unrotated box width: 4 chars * 100 * 0.55 = 220; height 120.
    // Rotated 90 degrees around (110, 60): the box spans y 0..220.
    expect(hitTestLayer(document, 110, 150)).toBe(text.id);
    // Far right of the unrotated box, now outside the rotated box.
    expect(hitTestLayer(document, 200, 60)).toBeNull();
  });
});
