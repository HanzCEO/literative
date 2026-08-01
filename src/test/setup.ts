import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// Node 25 exposes an experimental webstorage global that shadows jsdom's
// localStorage. Install a working in-memory implementation for tests.
function createMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

Object.defineProperty(globalThis, "localStorage", {
  value: createMemoryStorage(),
  configurable: true,
});

// jsdom does not implement object URLs; provide a working mock.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    value: () => `mock-object-url-${Math.random().toString(36).slice(2)}`,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: () => {},
    configurable: true,
  });
}

// jsdom does not implement Canvas 2D; provide a stub so components that
// render to a canvas can run in tests.
function createContextStub(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_, prop) {
      if (prop === "canvas") {
        return { width: 300, height: 150 };
      }
      if (prop === "measureText") {
        return (text: string) => ({ width: text.length * 8 });
      }
      if (prop === "getImageData") {
        return () => ({
          data: new Uint8ClampedArray(4),
          width: 1,
          height: 1,
        });
      }
      if (typeof prop === "string" && !(prop in target)) {
        target[prop] = () => {};
      }
      return target[prop as string];
    },
    set(_, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () => createContextStub(),
  configurable: true,
});

Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
  value: (callback: (blob: Blob | null) => void) => {
    callback(new Blob(["png-bytes"], { type: "image/png" }));
  },
  configurable: true,
});

Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
  value: () => "data:image/png;base64,cG5n",
  configurable: true,
});

// jsdom's Image never fires load events; provide a mock that resolves
// asynchronously with natural dimensions.
class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 600;
  private _src = "";

  set src(value: string) {
    this._src = value;
    setTimeout(() => this.onload?.(), 0);
  }

  get src(): string {
    return this._src;
  }
}

Object.defineProperty(globalThis, "Image", {
  value: MockImage,
  configurable: true,
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
