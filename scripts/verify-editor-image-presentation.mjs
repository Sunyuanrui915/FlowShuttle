import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import {
  DEFAULT_IMAGE_DISPLAY_HEIGHT,
  DEFAULT_IMAGE_DISPLAY_WIDTH,
  FlowShuttleImage,
  MAX_IMAGE_DIMENSION,
  defaultImageDisplayWidth,
  sanitizeImageDimension,
  sanitizeImagePresentation,
  serializeFlowShuttleImageMarkdown
} from "../src/renderer/src/editorImagePresentation.ts";

const extensions = [StarterKit, FlowShuttleImage];
const markdownManager = new MarkdownManager({ extensions });
const schema = getSchema(extensions);
const styles = readFileSync(
  new URL("../src/renderer/src/styles.css", import.meta.url),
  "utf8"
);
const imageExtensionSource = readFileSync(
  new URL("../src/renderer/src/editorImagePresentation.ts", import.meta.url),
  "utf8"
);

test("ordinary images keep standard Markdown", () => {
  assert.equal(
    serializeFlowShuttleImageMarkdown({
      src: "attachment://images/example.png",
      alt: "example",
      title: null,
      width: null,
      height: null,
      presentation: "none"
    }),
    "![example](attachment://images/example.png)"
  );

  const parsed = schema.nodeFromJSON(
    markdownManager.parse("![example](attachment://images/example.png)")
  ).toJSON();
  assert.deepEqual({ ...parsed.content[0].attrs }, {
    src: "attachment://images/example.png",
    alt: "example",
    title: null,
    width: null,
    height: null,
    presentation: "none"
  });
});

test("size and presentation serialize to the controlled HTML subset", () => {
  const serialized = markdownManager.serialize({
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: "attachment://images/example.png",
          alt: "example",
          title: "reference",
          width: 640,
          height: 360,
          presentation: "shadow"
        }
      }
    ]
  });

  assert.equal(
    serialized,
    '<img src="attachment://images/example.png" alt="example" data-flow-shuttle-image="1" title="reference" width="640" height="360" data-flow-shuttle-image-style="shadow" />'
  );
  assert.doesNotMatch(serialized, /\s(?:style|class|on\w+)=/i);
});

test("HTML attribute content is escaped", () => {
  const serialized = serializeFlowShuttleImageMarkdown({
    src: 'attachment://images/a&b".png',
    alt: '<private "caption">',
    width: 320,
    presentation: "frame"
  });

  assert.match(serialized, /src="attachment:\/\/images\/a&amp;b&quot;\.png"/);
  assert.match(serialized, /alt="&lt;private &quot;caption&quot;&gt;"/);
  assert.doesNotMatch(serialized, /<private|\s(?:style|class|on\w+)=/i);
});

test("dimension and presentation values are strictly sanitized", () => {
  assert.equal(sanitizeImageDimension("480.4"), 480);
  assert.equal(sanitizeImageDimension("480px"), null);
  assert.equal(sanitizeImageDimension(-20), null);
  assert.equal(sanitizeImageDimension(999_999), MAX_IMAGE_DIMENSION);
  assert.equal(sanitizeImagePresentation("dark"), "dark");
  assert.equal(sanitizeImagePresentation("url(javascript:alert(1))"), "none");
});

test("fresh screenshots use a bounded shrink-wrapped display width", () => {
  assert.equal(defaultImageDisplayWidth(320), 320);
  assert.equal(defaultImageDisplayWidth(2_560), DEFAULT_IMAGE_DISPLAY_WIDTH);
  assert.equal(defaultImageDisplayWidth("1440"), DEFAULT_IMAGE_DISPLAY_WIDTH);
  assert.equal(defaultImageDisplayWidth(1_440, 900), DEFAULT_IMAGE_DISPLAY_WIDTH);
  assert.equal(defaultImageDisplayWidth(1_080, 2_400), 234);
  assert.equal(DEFAULT_IMAGE_DISPLAY_HEIGHT, 520);
  assert.equal(defaultImageDisplayWidth(0), null);
  assert.equal(defaultImageDisplayWidth(Number.NaN), null);
});

test("the first live resize releases the fresh-image wrapper width", () => {
  assert.match(
    imageExtensionSource,
    /onResize:\s*\(\)\s*=>\s*\{[\s\S]*?querySelector<HTMLElement>\("\[data-resize-wrapper\]"\)[\s\S]*?removeProperty\("width"\)/
  );
});

test("image presentation styles keep the calibrated visual contract", () => {
  assert.match(
    styles,
    /\.markdown-editor-image-resize-wrapper\s*\{[^}]*display:\s*inline-flex\s*!important;[^}]*width:\s*fit-content;[^}]*align-items:\s*flex-start;/s
  );
  assert.match(styles, /\.markdown-editor-image\s*\{[^}]*max-height:\s*520px;/s);
  assert.match(
    styles,
    /data-image-presentation="light"[\s\S]*?border-width:\s*1px;[\s\S]*?padding:\s*0;/
  );
  assert.match(
    styles,
    /data-image-presentation="dark"[\s\S]*?border-width:\s*2px;[\s\S]*?padding:\s*0;/
  );
  assert.match(
    styles,
    /data-image-presentation="shadow"[\s\S]*?0 3px 9px[\s\S]*?0 14px 30px/
  );
  assert.match(
    styles,
    /data-image-presentation="frame"[\s\S]*?padding:\s*5px;/
  );
  assert.doesNotMatch(
    styles,
    /data-image-presentation="frame"[\s\S]*?padding:\s*11px;/
  );
  assert.match(
    styles,
    /\.markdown-editor-image-resize-container\.ProseMirror-selectednode[\s\S]*?outline-offset:\s*0;/
  );
});
