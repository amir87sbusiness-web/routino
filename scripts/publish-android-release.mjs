import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GRADLE = join(ROOT, "android", "app", "build.gradle");
const OUTPUT_DIR = join(ROOT, "output", "android");
const LANDING_DIR = join(ROOT, "landing", "downloads");
const STABLE_APK_NAME = "routino-android-1.0.apk";
const EXPECTED_PACKAGE = "com.routino.app";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readReleaseVersion() {
  const gradle = readFileSync(GRADLE, "utf8");
  const versionCodeMatch = gradle.match(/^\s*versionCode\s+(\d+)\s*$/m);
  const versionNameMatch = gradle.match(/^\s*versionName\s+"([^"]+)"\s*$/m);
  if (!versionCodeMatch || !versionNameMatch) {
    throw new Error("Could not read versionCode/versionName from android/app/build.gradle.");
  }
  return {
    versionCode: Number(versionCodeMatch[1]),
    versionName: versionNameMatch[1],
  };
}

function publish() {
  const version = readReleaseVersion();
  const sourceName = `routino-android-${version.versionName}.apk`;
  const sourceApk = join(OUTPUT_DIR, sourceName);
  const sourceManifest = `${sourceApk}.json`;

  if (!existsSync(sourceApk) || !existsSync(sourceManifest)) {
    throw new Error(
      `Verified Android output is missing for ${version.versionName}. Run npm run android:release first.`,
    );
  }

  const metadata = JSON.parse(readFileSync(sourceManifest, "utf8"));
  const digest = sha256(sourceApk);
  const bytes = statSync(sourceApk).size;
  if (
    metadata?.format !== "routino-android-release" ||
    metadata?.packageName !== EXPECTED_PACKAGE ||
    metadata?.versionCode !== version.versionCode ||
    metadata?.versionName !== version.versionName ||
    metadata?.bytes !== bytes ||
    metadata?.sha256 !== digest ||
    typeof metadata?.certificateSha256 !== "string" ||
    !metadata.certificateSha256
  ) {
    throw new Error("Android output metadata does not match the verified APK or Gradle version.");
  }

  mkdirSync(LANDING_DIR, { recursive: true });
  const targetApk = join(LANDING_DIR, STABLE_APK_NAME);
  copyFileSync(sourceApk, targetApk);
  writeFileSync(`${targetApk}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(`${targetApk}.sha256`, `${digest}  ${STABLE_APK_NAME}\n`);

  if (sha256(targetApk) !== digest || statSync(targetApk).size !== bytes) {
    throw new Error("Published landing APK failed the post-copy integrity check.");
  }

  console.log(`Published verified Android release to landing/downloads/${STABLE_APK_NAME}`);
  console.log(`versionCode=${version.versionCode} versionName=${version.versionName}`);
  console.log(`SHA-256: ${digest}`);
}

publish();
