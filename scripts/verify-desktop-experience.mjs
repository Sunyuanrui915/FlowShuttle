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

test("the desktop shell keeps Flow Shuttle in the tray until explicit quit", () => {
  assert.match(mainSource, /let trayRef: Tray \| null = null;/);
  assert.match(mainSource, /const trayMenuSurfaceWidth = 164;/);
  assert.match(mainSource, /const trayMenuSurfaceHeight = 45;/);
  assert.match(mainSource, /const trayMenuShadowInset = 8;/);
  assert.match(mainSource, /const trayMenuWidth = trayMenuSurfaceWidth \+ trayMenuShadowInset \* 2;/);
  assert.match(mainSource, /const trayMenuHeight = trayMenuSurfaceHeight \+ trayMenuShadowInset \* 2;/);
  assert.match(mainSource, /mainWindow\.on\("close", \(event\) => \{[\s\S]*?if \(isQuitting \|\| !trayRef\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?mainWindow\.hide\(\);/);
  assert.doesNotMatch(mainSource, /label: labels\.show/);
  assert.doesNotMatch(mainSource, /show: "(?:Show|显示|顯示) Flow Shuttle"/);
  assert.doesNotMatch(mainSource, /trayRef\.setContextMenu/);
  assert.match(mainSource, /frame: false,[\s\S]*?skipTaskbar: true,[\s\S]*?alwaysOnTop: true/);
  assert.match(mainSource, /contextIsolation: true,[\s\S]*?nodeIntegration: false,[\s\S]*?sandbox: true/);
  assert.match(mainSource, /let traySystemAppearance: "light" \| "dark" = "light";/);
  assert.match(mainSource, /const windowsThemeRegistryKey = "HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Themes\\\\Personalize";/);
  assert.match(mainSource, /async function readWindowsSystemAppearance\(\): Promise<"light" \| "dark" \| null>[\s\S]*?"reg\.exe",[\s\S]*?"SystemUsesLightTheme"[\s\S]*?return match\[1\] === "0" \? "dark" : "light";/);
  assert.match(mainSource, /async function resolveTrayMenuAppearance\(\): Promise<"light" \| "dark">[\s\S]*?await readWindowsSystemAppearance\(\)[\s\S]*?traySystemAppearance = detectedAppearance[\s\S]*?getThemePreference\(\) === "system"[\s\S]*?return traySystemAppearance;/);
  assert.match(mainSource, /<html lang="\$\{language\}" data-theme="\$\{appearance\}">/);
  assert.match(mainSource, /const appearance = await resolveTrayMenuAppearance\(\);[\s\S]*?trayMenuDocument\(loadConfig\(\)\.language, appearance\)/);
  assert.match(mainSource, /--tray-menu-surface: #ffffff;[\s\S]*?--tray-menu-border: #e4e4e4;[\s\S]*?--tray-menu-text: #19191a;[\s\S]*?--tray-menu-shadow: 0 2px 10px rgba\(0, 0, 0, 0\.22\);[\s\S]*?--tray-menu-hover: #00c375;/);
  assert.match(mainSource, /:root\[data-theme="dark"\][\s\S]*?--tray-menu-surface: #242424;[\s\S]*?--tray-menu-border: #343434;[\s\S]*?--tray-menu-shadow: none;[\s\S]*?--tray-menu-hover: #00a361;/);
  assert.match(mainSource, /html, body \{[^}]*background: transparent;/);
  assert.match(mainSource, /body \{[\s\S]*?padding: \$\{trayMenuShadowInset\}px;[\s\S]*?font-family:/);
  assert.match(mainSource, /\.tray-menu-surface \{[\s\S]*?padding: 5\.6667px 5\.6667px 5px;[\s\S]*?border: 1px solid var\(--tray-menu-border\);[\s\S]*?border-radius: 9px;[\s\S]*?box-shadow: var\(--tray-menu-shadow\);[\s\S]*?overflow: hidden;/);
  assert.match(mainSource, /a \{[\s\S]*?justify-content: center;[\s\S]*?height: 34px;[\s\S]*?border-radius: 5px;[\s\S]*?text-align: center;/);
  assert.match(mainSource, /a > span \{[\s\S]*?transform: translateZ\(0\);[\s\S]*?-webkit-font-smoothing: antialiased;[\s\S]*?text-rendering: geometricPrecision;/);
  assert.match(mainSource, /<body><main class="tray-menu-surface"><a href="\$\{trayQuitUrl\}"><span>\$\{label\}<\/span><\/a><\/main><\/body>/);
  assert.match(mainSource, /let x = cursor\.x \+ trayMenuOffset - trayMenuShadowInset;[\s\S]*?cursor\.x - trayMenuSurfaceWidth - trayMenuOffset - trayMenuShadowInset;/);
  assert.match(mainSource, /let y = cursor\.y \+ trayMenuOffset - trayMenuShadowInset;[\s\S]*?cursor\.y - trayMenuSurfaceHeight - trayMenuOffset - trayMenuShadowInset;/);
  assert.match(mainSource, /url !== trayQuitUrl[\s\S]*?isQuitting = true;[\s\S]*?app\.quit\(\);/);
  assert.match(mainSource, /trayRef\.on\("click", \(\) => \{[\s\S]*?focusMainWindow\(\);/);
  assert.match(mainSource, /trayRef\.on\("right-click", \(\) => \{[\s\S]*?showTrayMenu\(\);/);
  assert.match(mainSource, /app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?traySystemAppearance = nativeTheme\.shouldUseDarkColors \? "dark" : "light";[\s\S]*?applyThemeFromConfig\(\);[\s\S]*?createTray\(\);/);
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

test("project memo toolbar exposes format actions and keeps AI polish aligned right", () => {
  assert.match(appSource, /<MarkdownWysiwygEditor[\s\S]*?showFormatActionsInline[\s\S]*?onChange=\{onContentChange\}/);
  assert.match(editorSource, /showFormatActionsInline \? \([\s\S]*?<PaintRoller [\s\S]*?<RemoveFormatting /);
  assert.match(
    styles,
    /\.markdown-editor-toolbar-spacer\s*\{[^}]*flex:\s*1 1 10px;/s
  );
  assert.match(styles, /\.memo-editor-card::before\s*\{[^}]*z-index:\s*4;/s);
  assert.doesNotMatch(styles, /\.memo-editor-card \.markdown-editor-toolbar-spacer/);
});

test("editor images use a lightweight hover affordance and a full preview toolbar", () => {
  assert.doesNotMatch(editorSource, /markdown-editor-image-view-hint/);
  assert.match(editorSource, /root\.querySelectorAll<HTMLImageElement>\("img\.markdown-editor-image"\)/);
  assert.match(editorSource, /className="image-lightbox-toolbar"/);
  assert.match(editorSource, /onWheel=\{\(event\) => \{/);
  assert.match(editorSource, /<ZoomIn /);
  assert.match(editorSource, /<ZoomOut /);
  assert.match(editorSource, /<RotateCcw /);
  assert.match(editorSource, /<Maximize2 /);
  assert.match(editorSource, /<Copy /);
  assert.match(editorSource, /<Download /);
  assert.match(styles, /\.image-lightbox-toolbar\s*\{[^}]*bottom:\s*24px;/s);
  assert.match(styles, /\.markdown-editor-image-resize-wrapper:hover > \.markdown-editor-image\s*\{[^}]*filter:\s*brightness\(0\.86\);/s);
  assert.match(styles, /\.markdown-editor-image\s*\{[^}]*cursor:\s*zoom-in;/s);
});
