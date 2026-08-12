import {
  ResizableNodeView,
  mergeAttributes,
  type JSONContent
} from "@tiptap/core";
import Image from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const IMAGE_PRESENTATIONS = ["none", "light", "dark", "shadow", "frame"] as const;
export type ImagePresentation = (typeof IMAGE_PRESENTATIONS)[number];

export const MAX_IMAGE_DIMENSION = 8_192;
export const DEFAULT_IMAGE_DISPLAY_WIDTH = 720;
export const DEFAULT_IMAGE_DISPLAY_HEIGHT = 520;

export function defaultImageDisplayWidth(
  naturalWidth: unknown,
  naturalHeight?: unknown
): number | null {
  const parsedWidth = typeof naturalWidth === "number" ? naturalWidth : Number(naturalWidth);
  if (!Number.isFinite(parsedWidth) || parsedWidth <= 0) {
    return null;
  }
  const parsedHeight = typeof naturalHeight === "number" ? naturalHeight : Number(naturalHeight);
  const heightBoundWidth = Number.isFinite(parsedHeight) && parsedHeight > 0
    ? parsedWidth * DEFAULT_IMAGE_DISPLAY_HEIGHT / parsedHeight
    : parsedWidth;
  return Math.min(
    DEFAULT_IMAGE_DISPLAY_WIDTH,
    Math.max(1, Math.round(Math.min(parsedWidth, heightBoundWidth)))
  );
}

export function sanitizeImagePresentation(value: unknown): ImagePresentation {
  return IMAGE_PRESENTATIONS.includes(value as ImagePresentation)
    ? (value as ImagePresentation)
    : "none";
}

export function sanitizeImageDimension(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  const parsed = typeof value === "number"
    ? value
    : /^\d+(?:\.\d+)?$/.test(normalized)
      ? Number(normalized)
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(MAX_IMAGE_DIMENSION, Math.max(1, Math.round(parsed)));
}

function escapeHtmlAttribute(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function standardMarkdownImage(attributes: Record<string, unknown>): string {
  const src = String(attributes.src ?? "");
  const alt = String(attributes.alt ?? "").replace(/[\[\]\n\r]/g, " ");
  const title = String(attributes.title ?? "").replace(/["\n\r]/g, " ").trim();
  return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
}

/**
 * Images without Flow Shuttle metadata remain standard Markdown. Resized or
 * decorated images use a deliberately small HTML subset so width, height and
 * presentation survive save/reopen and Markdown export without accepting
 * arbitrary style or event attributes.
 */
export function serializeFlowShuttleImageMarkdown(
  attributes: Record<string, unknown>
): string {
  const width = sanitizeImageDimension(attributes.width);
  const height = sanitizeImageDimension(attributes.height);
  const presentation = sanitizeImagePresentation(attributes.presentation);

  if (width === null && height === null && presentation === "none") {
    return standardMarkdownImage(attributes);
  }

  const htmlAttributes = [
    `src="${escapeHtmlAttribute(attributes.src)}"`,
    `alt="${escapeHtmlAttribute(attributes.alt)}"`,
    `data-flow-shuttle-image="1"`
  ];
  const title = String(attributes.title ?? "").trim();
  if (title) {
    htmlAttributes.push(`title="${escapeHtmlAttribute(title)}"`);
  }
  if (width !== null) {
    htmlAttributes.push(`width="${width}"`);
  }
  if (height !== null) {
    htmlAttributes.push(`height="${height}"`);
  }
  if (presentation !== "none") {
    htmlAttributes.push(`data-flow-shuttle-image-style="${presentation}"`);
  }

  return `<img ${htmlAttributes.join(" ")} />`;
}

function syncImageElement(
  element: HTMLImageElement,
  container: HTMLElement | null,
  node: ProseMirrorNode,
  staticAttributes: Record<string, unknown>
): void {
  const mergedStaticAttributes = mergeAttributes(staticAttributes);
  Object.entries(mergedStaticAttributes).forEach(([name, value]) => {
    if (value !== null && value !== undefined && name !== "width" && name !== "height") {
      element.setAttribute(name, String(value));
    }
  });

  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const title = String(node.attrs.title ?? "");
  const width = sanitizeImageDimension(node.attrs.width);
  const height = sanitizeImageDimension(node.attrs.height);
  const presentation = sanitizeImagePresentation(node.attrs.presentation);

  if (src) {
    element.setAttribute("src", src);
  } else {
    element.removeAttribute("src");
  }
  element.setAttribute("alt", alt);
  if (title) {
    element.setAttribute("title", title);
  } else {
    element.removeAttribute("title");
  }

  if (width !== null) {
    element.setAttribute("width", String(width));
    element.style.width = `${width}px`;
  } else {
    element.removeAttribute("width");
    element.style.removeProperty("width");
  }
  if (height !== null) {
    element.setAttribute("height", String(height));
    element.style.height = `${height}px`;
  } else {
    element.removeAttribute("height");
    element.style.removeProperty("height");
  }

  element.dataset.flowShuttleImageStyle = presentation;
  if (container) {
    container.dataset.imagePresentation = presentation;
    const wrapper = container.querySelector<HTMLElement>("[data-resize-wrapper]");
    if (wrapper) {
      if (width !== null) {
        wrapper.style.removeProperty("width");
      } else {
        const intrinsicWidth = defaultImageDisplayWidth(
          element.naturalWidth,
          element.naturalHeight
        );
        if (intrinsicWidth === null) {
          wrapper.style.removeProperty("width");
        } else {
          wrapper.style.width = `${intrinsicWidth}px`;
        }
      }
    }
  }
}

export const FlowShuttleImage = Image.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      width: {
        default: null,
        parseHTML: (element) => sanitizeImageDimension(element.getAttribute("width")),
        renderHTML: (attributes) => {
          const width = sanitizeImageDimension(attributes.width);
          return width === null ? {} : { width };
        }
      },
      height: {
        default: null,
        parseHTML: (element) => sanitizeImageDimension(element.getAttribute("height")),
        renderHTML: (attributes) => {
          const height = sanitizeImageDimension(attributes.height);
          return height === null ? {} : { height };
        }
      },
      presentation: {
        default: "none",
        parseHTML: (element) => sanitizeImagePresentation(
          element.getAttribute("data-flow-shuttle-image-style")
        ),
        renderHTML: (attributes) => {
          const presentation = sanitizeImagePresentation(attributes.presentation);
          return presentation === "none"
            ? {}
            : { "data-flow-shuttle-image-style": presentation };
        }
      }
    };
  },

  renderMarkdown(node: JSONContent) {
    return serializeFlowShuttleImageMarkdown(node.attrs ?? {});
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const image = document.createElement("img");
      image.draggable = false;
      let container: HTMLElement | null = null;
      let currentNode = node;

      const sync = (nextNode: ProseMirrorNode) => {
        currentNode = nextNode;
        syncImageElement(image, container, nextNode, this.options.HTMLAttributes);
      };
      sync(node);

      const nodeView = new ResizableNodeView({
        element: image,
        editor,
        node,
        getPos,
        onResize: () => {
          const wrapper = container?.querySelector<HTMLElement>("[data-resize-wrapper]");
          wrapper?.style.removeProperty("width");
          image.dispatchEvent(new CustomEvent("flow-shuttle-image-resize", { bubbles: true }));
        },
        onCommit: (width, height) => {
          const position = getPos();
          if (position === undefined) {
            return;
          }
          editor
            .chain()
            .setNodeSelection(position)
            .updateAttributes(this.name, {
              width: sanitizeImageDimension(width),
              height: sanitizeImageDimension(height)
            })
            .run();
        },
        onUpdate: (updatedNode) => {
          if (updatedNode.type !== node.type) {
            return false;
          }
          sync(updatedNode);
          return true;
        },
        options: {
          directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
          min: { width: 96, height: 32 },
          max: { width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION },
          preserveAspectRatio: true,
          className: {
            container: "markdown-editor-image-resize-container",
            wrapper: "markdown-editor-image-resize-wrapper",
            handle: "markdown-editor-image-resize-handle",
            resizing: "is-resizing"
          }
        }
      });

      container = nodeView.dom as HTMLElement;
      sync(node);

      const reveal = () => {
        sync(currentNode);
        container?.style.removeProperty("visibility");
        container?.style.removeProperty("pointer-events");
        image.dispatchEvent(new CustomEvent("flow-shuttle-image-resize", { bubbles: true }));
      };
      if (!image.complete) {
        container.style.visibility = "hidden";
        container.style.pointerEvents = "none";
        image.addEventListener("load", reveal, { once: true });
        image.addEventListener("error", reveal, { once: true });
      }

      return nodeView;
    };
  }
});
