const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function applyWinIcon(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const executablePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.resolve(__dirname, "..", "assets", "icons", "flow-shuttle-icon.ico");
  const scriptPath = path.resolve(__dirname, "apply-win-icon.ps1");

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-ExecutablePath",
      executablePath,
      "-IconPath",
      iconPath
    ],
    { stdio: "inherit" }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Failed to apply Windows icon to ${executablePath}`);
  }
};
