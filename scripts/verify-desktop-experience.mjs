import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
const databaseSource = readFileSync(new URL("../src/main/database.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(
  new URL("../src/renderer/src/MarkdownWysiwygEditor.tsx", import.meta.url),
  "utf8"
);
const styles = readFileSync(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

test("the desktop shell atomically reveals the branded tray menu until explicit quit", () => {
  const createTrayMenuStart = mainSource.indexOf("function createTrayMenuWindow");
  const createTrayMenuEnd = mainSource.indexOf("function trayMenuDomSyncScript", createTrayMenuStart);
  const createTrayMenuSource = mainSource.slice(createTrayMenuStart, createTrayMenuEnd);
  const showTrayMenuStart = mainSource.indexOf("async function showTrayMenu");
  const showTrayMenuEnd = mainSource.indexOf("function updateTrayMenu", showTrayMenuStart);
  const showTrayMenuSource = mainSource.slice(showTrayMenuStart, showTrayMenuEnd);
  assert.match(mainSource, /let trayRef: Tray \| null = null;/);
  assert.match(mainSource, /mainWindow\.on\("close", \(event\) => \{[\s\S]*?if \(isQuitting \|\| !trayRef\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?mainWindow\.hide\(\);/);
  assert.doesNotMatch(mainSource, /label: labels\.show/);
  assert.doesNotMatch(mainSource, /show: "(?:Show|显示|顯示) Flow Shuttle"/);
  assert.doesNotMatch(mainSource, /trayRef\.setContextMenu/);
  assert.match(createTrayMenuSource, /frame: false,[\s\S]*?transparent: true,[\s\S]*?focusable: true,[\s\S]*?show: false,[\s\S]*?opacity: 0,[\s\S]*?paintWhenInitiallyHidden: true/);
  assert.match(createTrayMenuSource, /alwaysOnTop: true,[\s\S]*?hasShadow: false,[\s\S]*?backgroundColor: "#00000000"/);
  assert.match(createTrayMenuSource, /contextIsolation: true,[\s\S]*?nodeIntegration: false,[\s\S]*?sandbox: true,[\s\S]*?backgroundThrottling: false/);
  assert.ok(createTrayMenuSource.indexOf('once("ready-to-show"') < createTrayMenuSource.indexOf("loadURL("));
  assert.match(mainSource, /const trayMenuActionInset = trayMenuShadowInset \+ 6;/);
  assert.match(mainSource, /let x = cursor\.x - trayMenuActionInset;[\s\S]*?cursor\.x - trayMenuWidth \+ trayMenuActionInset;/);
  assert.match(mainSource, /let y = cursor\.y - trayMenuActionInset;[\s\S]*?cursor\.y - trayMenuHeight \+ trayMenuActionInset;/);
  assert.match(mainSource, /hasShadow: false/);
  assert.match(mainSource, /\.tray-menu-action:hover,[\s\S]*?background: var\(--tray-menu-hover\);/);
  assert.match(mainSource, /data-tray-label="zh-CN">退出流梭<[\s\S]*?data-tray-label="en">Quit Flow Shuttle</);
  assert.doesNotMatch(showTrayMenuSource, /loadURL/);
  assert.match(showTrayMenuSource, /setOpacity\(0\);[\s\S]*?setBounds\([\s\S]*?setAlwaysOnTop\(true, "pop-up-menu"\);[\s\S]*?showInactive\(\);[\s\S]*?moveTop\(\);[\s\S]*?trayMenuZOrderSettleDelay[\s\S]*?\.focus\(\);[\s\S]*?trayMenuFocusSettleDelay[\s\S]*?setOpacity\(1\);/);
  assert.match(createTrayMenuSource, /before-input-event[\s\S]*?input\.key !== "Escape"[\s\S]*?hideTrayMenuWindow\(\);[\s\S]*?trayRef\?\.focus\(\);/);
  assert.match(createTrayMenuSource, /trayMenuWindow\.on\("blur", \(\) => \{[\s\S]*?!trayMenuRevealInProgress[\s\S]*?hideTrayMenuWindow\(\);/);
  assert.doesNotMatch(mainSource, /startTrayMenuPointerMonitor|trayMenuPointerLeaveDelay/);
  assert.match(mainSource, /url !== trayQuitUrl[\s\S]*?isQuitting = true;[\s\S]*?app\.quit\(\);/);
  assert.match(mainSource, /trayRef\.on\("click", \(\) => \{[\s\S]*?focusMainWindow\(\);/);
  assert.match(mainSource, /trayRef\.on\("double-click", \(\) => \{[\s\S]*?focusMainWindow\(\);/);
  assert.match(mainSource, /trayRef\.on\("right-click", \(\) => \{[\s\S]*?showTrayMenu\(\);/);
  assert.match(mainSource, /app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?applyThemeFromConfig\(\);[\s\S]*?createTray\(\);/);
  assert.match(mainSource, /app\.on\("window-all-closed", \(\) => \{[\s\S]*?if \(!trayRef && process\.platform !== "darwin"\)[\s\S]*?app\.quit\(\);/);
});

test("daily journal groups are seeded from every active project", () => {
  const projectQueryIndex = databaseSource.indexOf("const projects = connection");
  const projectSeedIndex = databaseSource.indexOf("projects.map((project) => [", projectQueryIndex);
  const itemLoopIndex = databaseSource.indexOf("for (const item of items)", projectSeedIndex);
  assert.ok(projectQueryIndex >= 0);
  assert.ok(projectSeedIndex > projectQueryIndex);
  assert.ok(itemLoopIndex > projectSeedIndex);
  assert.match(databaseSource.slice(projectSeedIndex, itemLoopIndex), /projectMemo: getOrCreateProjectMemo\(project\.id\)/);
  assert.match(databaseSource.slice(projectSeedIndex, itemLoopIndex), /items: \[\]/);
  assert.match(appSource, /todayProjectNoWorkItemsTitle/);
  assert.match(appSource, /group\.projectMemo\.updated_at/);
});

test("project memo shares adaptive format actions and keeps AI polish pinned right", () => {
  assert.match(appSource, /function ProjectMemoPage[\s\S]*?<MarkdownWysiwygEditor[\s\S]*?onChange=\{onContentChange\}/);
  assert.match(editorSource, /useAdaptiveToolbar\(toolbarGroups\.length\)/);
  assert.match(editorSource, /className="markdown-editor-toolbar-trailing">\{aiPolishButton\}/);
  assert.match(editorSource, /onClick=\{activateFormatPainter\}/);
  assert.match(editorSource, /onClick=\{clearFormatting\}/);
  assert.match(
    styles,
    /\.markdown-editor-toolbar-trailing\s*\{[^}]*margin-left:\s*auto;/s
  );
  assert.match(styles, /\.memo-editor-card::before\s*\{[^}]*z-index:\s*4;/s);
  assert.doesNotMatch(styles, /\.memo-editor-card \.markdown-editor-toolbar-spacer/);
});

test("editor images use a lightweight hover affordance and a full preview toolbar", () => {
  assert.doesNotMatch(editorSource, /markdown-editor-image-view-hint/);
  assert.match(editorSource, /root\.querySelectorAll<HTMLImageElement>\("img\.markdown-editor-image"\)/);
  assert.match(editorSource, /className="image-lightbox-toolbar"/);
  assert.match(editorSource, /onWheel=\{\(event\) => \{/);
  assert.match(editorSource, /interface ImagePreviewState[\s\S]*?offsetX: number;[\s\S]*?offsetY: number;/);
  assert.match(editorSource, /const clampImagePreviewOffset = useCallback/);
  assert.match(editorSource, /onPointerDown=\{\(event\) => \{[\s\S]*?setPointerCapture/);
  assert.match(editorSource, /onPointerMove=\{\(event\) => \{[\s\S]*?clampImagePreviewOffset/);
  assert.match(editorSource, /translate3d\(\$\{previewImage\.offsetX\}px, \$\{previewImage\.offsetY\}px, 0\) scale/);
  assert.match(editorSource, /<ZoomIn /);
  assert.match(editorSource, /<ZoomOut /);
  assert.match(editorSource, /<RotateCcw /);
  assert.match(editorSource, /<Maximize2 /);
  assert.match(editorSource, /<Copy /);
  assert.match(editorSource, /<Download /);
  assert.match(styles, /\.image-lightbox-toolbar\s*\{[^}]*bottom:\s*24px;/s);
  assert.match(styles, /\.image-lightbox-stage\.can-pan\s*\{[^}]*cursor:\s*grab;/s);
  assert.match(styles, /\.image-lightbox-stage\.is-dragging\s*\{[^}]*cursor:\s*grabbing;/s);
  assert.match(styles, /\.markdown-editor-image-resize-wrapper:hover > \.markdown-editor-image\s*\{[^}]*filter:\s*brightness\(0\.86\);/s);
  assert.match(styles, /\.markdown-editor-image\s*\{[^}]*cursor:\s*zoom-in;/s);
});
