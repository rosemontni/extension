import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "lib/wanderlog-utils.js"
];

const jsFiles = ["background.js", "content.js", "popup.js", "lib/wanderlog-utils.js"];
const requiredPermissions = [
  "activeTab",
  "clipboardWrite",
  "contextMenus",
  "scripting",
  "storage",
  "tabs"
];

for (const file of files) {
  assert(existsSync(file), `Missing extension file: ${file}`);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.name === "Wanderlog Notes Clipper", "manifest name should match release branding");
assert(manifest.version === packageJson.version, "manifest and package versions must match");
assert(manifest.description?.length <= 132, "Chrome extension descriptions should stay concise");
assert(manifest.homepage_url?.startsWith("https://github.com/rosemontni/extension"), "homepage_url should point to the release repo");

for (const permission of requiredPermissions) {
  assert(manifest.permissions?.includes(permission), `Missing permission: ${permission}`);
}

for (const host of ["https://app.wanderlog.com/*", "https://extensionembed.wanderlog.com/*"]) {
  assert(manifest.host_permissions?.includes(host), `Missing host permission: ${host}`);
}

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  assert(result.status === 0, `JavaScript syntax check failed: ${file}`);
}

console.log("Extension manifest and JavaScript checks passed.");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
