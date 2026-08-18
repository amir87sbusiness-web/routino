import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = join(ROOT, "android");
const PROPERTIES_FILE = join(ANDROID, "keystore.properties");
const EXPECTED_PACKAGE = "com.routino.app";
const API_URL = "https://api.routino.me/v1";

function parseProperties(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return separator < 1 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

export function validateSigningProperties(properties, fileExists = existsSync) {
  const required = ["storeFile", "storePassword", "keyAlias", "keyPassword"];
  const missing = required.filter((key) => !properties[key]);
  if (missing.length) {
    throw new Error(
      `android/keystore.properties is missing or incomplete (${missing.join(", ")}). Run npm run android:signing:init once.`,
    );
  }
  if (!fileExists(properties.storeFile)) {
    throw new Error(
      "The release keystore referenced by android/keystore.properties does not exist.",
    );
  }
  return properties;
}

export function validateSignerOutput(output) {
  if (!/Verifies/i.test(output)) throw new Error("APK signature verification did not pass.");
  if (/Android Debug/i.test(output)) throw new Error("Refusing a debug-signed APK.");
  const certificateSha256 = output.match(/certificate SHA-256 digest:\s*([^\r\n]+)/i)?.[1]?.trim();
  const certificateDn = output.match(/certificate DN:\s*([^\r\n]+)/i)?.[1]?.trim();
  if (!certificateSha256 || !certificateDn) {
    throw new Error("Could not read the release certificate from apksigner output.");
  }
  return { certificateSha256, certificateDn };
}

export function parseBadging(output) {
  const match = output.match(
    /package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']+)'/,
  );
  if (!match) throw new Error("Could not read Android package metadata from the APK.");
  const [, packageName, versionCode, versionName] = match;
  if (packageName !== EXPECTED_PACKAGE) {
    throw new Error(`Expected package ${EXPECTED_PACKAGE}, received ${packageName}.`);
  }
  return { packageName, versionCode: Number(versionCode), versionName };
}

function run(command, args, options = {}) {
  const isBatch = process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
  const executable = isBatch ? (process.env.ComSpec ?? "cmd.exe") : command;
  const commandArgs = isBatch
    ? [
        "/d",
        "/s",
        "/c",
        [command, ...args]
          .map((value) => {
            const text = String(value);
            return /[\s&()^|<>]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
          })
          .join(" "),
      ]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
    throw new Error(`${command} failed with exit code ${result.status}.${detail}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function javaTool(name) {
  const candidates = [
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, "bin", `${name}.exe`),
    "E:\\softwears\\android\\jbr\\bin\\" + `${name}.exe`,
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Android Studio JBR ${name} was not found. Set JAVA_HOME first.`);
  return found;
}

function androidSdk() {
  const sdk =
    process.env.ANDROID_SDK_ROOT ??
    process.env.ANDROID_HOME ??
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : "");
  if (!sdk || !existsSync(sdk)) throw new Error("Android SDK was not found. Set ANDROID_SDK_ROOT.");
  return sdk;
}

function latestBuildTool(name) {
  const root = join(androidSdk(), "build-tools");
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const suffix = process.platform === "win32" ? (name === "apksigner" ? ".bat" : ".exe") : "";
  const found = versions.map((version) => join(root, version, `${name}${suffix}`)).find(existsSync);
  if (!found) throw new Error(`${name} was not found in Android SDK build-tools.`);
  return found;
}

function initSigning() {
  if (existsSync(PROPERTIES_FILE)) {
    validateSigningProperties(parseProperties(readFileSync(PROPERTIES_FILE, "utf8")));
    console.log("Android release signing is already configured; existing key was kept.");
    return;
  }

  const signingDir = process.env.ROUTINO_SIGNING_DIR ?? join(homedir(), ".routino-signing");
  const keystore = join(signingDir, "routino-release.p12");
  if (existsSync(keystore)) {
    throw new Error(
      `A keystore already exists at ${keystore}, but android/keystore.properties is absent. Restore the matching properties file instead of replacing the key.`,
    );
  }
  mkdirSync(signingDir, { recursive: true });
  const password = randomBytes(32).toString("base64url");
  run(javaTool("keytool"), [
    "-genkeypair",
    "-keystore",
    keystore,
    "-storetype",
    "PKCS12",
    "-storepass",
    password,
    "-keypass",
    password,
    "-alias",
    "routino-release",
    "-keyalg",
    "RSA",
    "-keysize",
    "4096",
    "-validity",
    "10000",
    "-dname",
    "CN=Routino Release,O=Routino,C=IR",
  ]);
  const portablePath = keystore.replace(/\\/g, "/");
  writeFileSync(
    PROPERTIES_FILE,
    [
      `storeFile=${portablePath}`,
      `storePassword=${password}`,
      "keyAlias=routino-release",
      `keyPassword=${password}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log(
    `Release signing created outside Git at ${signingDir}. Back up this folder securely.`,
  );
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function buildRelease() {
  if (!existsSync(PROPERTIES_FILE)) validateSigningProperties({});
  validateSigningProperties(parseProperties(readFileSync(PROPERTIES_FILE, "utf8")));

  const env = {
    ...process.env,
    JAVA_HOME: process.env.JAVA_HOME ?? "E:\\softwears\\android\\jbr",
    ANDROID_SDK_ROOT: androidSdk(),
    VITE_API_URL: API_URL,
  };
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:mobile"], { env });
  run(process.platform === "win32" ? "npx.cmd" : "npx", ["cap", "sync", "android"], { env });
  run(
    process.platform === "win32" ? join(ANDROID, "gradlew.bat") : join(ANDROID, "gradlew"),
    [":app:clean", ":app:assembleRelease", "-PskipWebBuild"],
    { cwd: ANDROID, env },
  );

  const builtApk = join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!existsSync(builtApk))
    throw new Error("Gradle finished but app-release.apk was not produced.");

  const signer = validateSignerOutput(
    run(latestBuildTool("apksigner"), ["verify", "--verbose", "--print-certs", builtApk], {
      capture: true,
    }),
  );
  const app = parseBadging(
    run(latestBuildTool("aapt2"), ["dump", "badging", builtApk], { capture: true }),
  );
  const outputDir = join(ROOT, "output", "android");
  mkdirSync(outputDir, { recursive: true });
  const filename = `routino-android-${app.versionName}.apk`;
  const apk = join(outputDir, filename);
  copyFileSync(builtApk, apk);
  const digest = sha256(apk);
  writeFileSync(`${apk}.sha256`, `${digest}  ${filename}\n`);
  writeFileSync(
    `${apk}.json`,
    JSON.stringify(
      {
        format: "routino-android-release",
        packageName: app.packageName,
        versionCode: app.versionCode,
        versionName: app.versionName,
        bytes: statSync(apk).size,
        sha256: digest,
        certificateSha256: signer.certificateSha256,
        certificateDn: signer.certificateDn,
        apiUrl: API_URL,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Verified release APK: ${apk}`);
  console.log(`SHA-256: ${digest}`);
  console.log(`Certificate SHA-256: ${signer.certificateSha256}`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href
) {
  if (process.argv.includes("--init-signing")) initSigning();
  else buildRelease();
}
