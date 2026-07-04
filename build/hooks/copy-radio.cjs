// afterPack: bundle the gnosis-radio exe when the sibling checkout has a
// release build (host builds). CI has no radio source — the app is fail-soft
// without it (radio view shows offline), so this quietly skips there.
// Ships as resources/radio/meridian-radio.exe — the radio is BRANDED
// Meridian Radio in anything user-facing; "gnosis-radio" is the dev-only
// crate name and stops at this rename.
const path = require("path");
const fs = require("fs");

exports.default = async (context) => {
  if (process.platform !== "win32") return;
  const src = path.resolve(
    __dirname, "..", "..", "..",
    "gnosis-radio", "target", "release", "gnosis-radio.exe"
  );
  if (!fs.existsSync(src)) {
    console.log("[copy-radio] no radio build at sibling checkout — skipping (app is fail-soft)");
    return;
  }
  const dstDir = path.join(context.appOutDir, "resources", "radio");
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, path.join(dstDir, "meridian-radio.exe"));
  console.log("[copy-radio] bundled meridian-radio.exe");
};
