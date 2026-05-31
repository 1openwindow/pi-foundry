import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, posix, relative, resolve, sep } from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

export function createArtifactManager({
  filesDir,
  artifactPublishMode,
  artifactStorageAccount,
  artifactStaticWebEndpoint,
  artifactStaticWebContainer,
  artifactBlobPrefix,
  artifactMaxPublishBytes,
  artifactPromptHints,
  HttpError,
  isInside,
  log,
}) {
  let artifactContainerClientPromise;

  function contentTypeForPath(path) {
    switch (extname(path).toLowerCase()) {
      case ".html":
        return "text/html; charset=utf-8";
      case ".css":
        return "text/css; charset=utf-8";
      case ".js":
      case ".mjs":
        return "text/javascript; charset=utf-8";
      case ".json":
        return "application/json; charset=utf-8";
      case ".md":
      case ".txt":
        return "text/plain; charset=utf-8";
      case ".mp3":
        return "audio/mpeg";
      case ".wav":
        return "audio/wav";
      case ".vtt":
        return "text/vtt; charset=utf-8";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".svg":
        return "image/svg+xml; charset=utf-8";
      case ".zip":
        return "application/zip";
      case ".mp4":
        return "video/mp4";
      case ".webm":
        return "video/webm";
      case ".mov":
        return "video/quicktime";
      default:
        return "application/octet-stream";
    }
  }

  function resolveArtifactPath(urlPathname) {
    const encodedRelativePath = urlPathname.slice("/artifacts/".length);
    if (encodedRelativePath.length === 0) throw new HttpError(400, "artifact path is required");

    let relativePath;
    try {
      relativePath = decodeURIComponent(encodedRelativePath);
    } catch (error) {
      throw new HttpError(400, `invalid artifact path encoding: ${error.message}`);
    }

    if (relativePath.includes("\0")) throw new HttpError(400, "artifact path contains invalid characters");
    const requested = resolve(filesDir, relativePath);
    if (!isInside(filesDir, requested)) {
      throw new HttpError(400, `artifact path must stay within FILES_DIR (${filesDir})`);
    }
    return requested;
  }

  async function sendArtifactFile(res, path) {
    let fileStat;
    try {
      fileStat = await stat(path);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new HttpError(404, "artifact not found");
      }
      throw error;
    }

    if (!fileStat.isFile()) throw new HttpError(404, "artifact not found");

    res.writeHead(200, {
      "content-type": contentTypeForPath(path),
      "content-length": fileStat.size,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });

    await new Promise((resolveStream, reject) => {
      const stream = createReadStream(path);
      stream.on("error", reject);
      stream.on("end", resolveStream);
      stream.pipe(res);
    });
  }

  function staticWebPublishingEnabled() {
    return artifactPublishMode === "static-web" && Boolean(artifactStorageAccount && artifactStaticWebEndpoint);
  }

  function getArtifactContainerClient() {
    if (!staticWebPublishingEnabled()) return undefined;
    artifactContainerClientPromise ??= Promise.resolve().then(() => {
      const credential = new DefaultAzureCredential({
        managedIdentityClientId: process.env.AZURE_CLIENT_ID || undefined,
      });
      const serviceClient = new BlobServiceClient(`https://${artifactStorageAccount}.blob.core.windows.net`, credential);
      return serviceClient.getContainerClient(artifactStaticWebContainer);
    });
    return artifactContainerClientPromise;
  }

  // Heuristics for whether the user prompt looks like it expects downloadable output.
  // Intentionally narrow: weak words like `file`, `files`, `page`, `文件`, `页面`,
  // `生成` are excluded because they fire on most coding/QA prompts and silently inject
  // a long instruction block. Tighten further when in doubt: false negatives mean a user
  // gets a less-helpful artifact response; false positives waste tokens on every turn.
  function likelyArtifactPrompt(prompt) {
    return /\b(artifact|artifacts|download|downloadable|mp3|mp4|wav|webm|mov|zip|html|webpage|presentation|slides?|report|audio|video)\b/i.test(prompt) ||
      /下载|产物|网页|报告|音频|视频|演示|幻灯片|可播放|预览/.test(prompt);
  }

  function likelyHtmlPresentationPrompt(prompt) {
    return /\b(html|webpage|presentation|slides?|hyperframes?)\b/i.test(prompt) ||
      /网页|演示|幻灯片|可播放|预览/.test(prompt);
  }

  function withArtifactPromptHint(prompt, artifactDir) {
    if (!artifactPromptHints) return prompt;
    // Never inject hints when there is nowhere to publish the resulting files;
    // the instructions would tell the model to produce artifacts that vanish.
    if (!staticWebPublishingEnabled()) return prompt;
    if (!likelyArtifactPrompt(prompt)) return prompt;
    log("info", "artifact_prompt_hint_injected", { artifactDir, htmlPresentation: likelyHtmlPresentationPrompt(prompt), promptLength: prompt.length });
    const hints = [
      "Artifact delivery contract:",
      `- Write all generated downloadable files under: ${artifactDir}`,
      "- Do not write downloadable artifacts outside that directory unless the user explicitly asks.",
      "- Use relative paths between files inside that directory, for example ./narration.mp3 from index.html.",
      "- When finished, summarize generated file names only. Do not paste full generated file contents into chat unless asked.",
    ];

    if (likelyHtmlPresentationPrompt(prompt)) {
      hints.push(
        "",
        "Browser-playable HTML report/presentation contract:",
        "- Generate index.html as a standalone static website; do not rely on external CDN or external JavaScript.",
        "- Generate script.md for speaker notes or narration draft.",
        "- Generate artifact-manifest.json listing the files that should be published.",
        "- Prefer a 1920x1080 16:9 scene-based presentation over one long scrolling page.",
        "- Use <section class=\"scene\" data-start=\"...\" data-duration=\"...\"> for each scene.",
        "- CSS must hide inactive scenes and show only .scene.active: .scene { opacity: 0; pointer-events: none; } .scene.active { opacity: 1; pointer-events: auto; }",
        "- JavaScript must read data-start/data-duration and switch the active scene over time.",
        "- Add simple play/pause, previous/next, and progress controls.",
        "- Initial view must show scene 1, not the final scene. Do not allow all scenes to be visible at once.",
      );
    }

    return [hints.join("\n"), "", prompt].join("\n");
  }

  function encodeStaticWebPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async function listArtifactFiles(root) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }

    const files = [];
    for (const entry of entries) {
      const child = resolve(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listArtifactFiles(child)));
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
    return files;
  }

  function serializeError(error) {
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { message: String(error) };
  }

  async function readArtifactManifest(root) {
    const manifestPath = resolve(root, "artifact-manifest.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
      log("warn", "artifact_manifest_ignored", { manifestPath, error: serializeError(error) });
      return undefined;
    }

    if (!Array.isArray(manifest.artifacts)) return undefined;
    return manifest.artifacts
      .map((entry) => {
        if (!entry || typeof entry.path !== "string") return undefined;
        const localPath = resolve(root, entry.path);
        if (!isInside(root, localPath)) return undefined;
        return {
          localPath,
          name: typeof entry.name === "string" ? entry.name : basename(entry.path),
          description: typeof entry.description === "string" ? entry.description : undefined,
          contentType: typeof entry.contentType === "string" ? entry.contentType : undefined,
        };
      })
      .filter(Boolean);
  }

  async function collectArtifactEntries(root) {
    const manifestEntries = await readArtifactManifest(root);
    if (manifestEntries?.length) return manifestEntries;
    return (await listArtifactFiles(root))
      .filter((filePath) => basename(filePath) !== "artifact-manifest.json")
      .map((localPath) => ({ localPath, name: basename(localPath) }));
  }

  async function publishStaticWebArtifacts({ artifactId, artifactDir, requestId, sessionId }) {
    if (!staticWebPublishingEnabled()) return [];

    const containerClient = await getArtifactContainerClient();
    const entries = await collectArtifactEntries(artifactDir);
    if (!entries.length) return [];

    let totalBytes = 0;
    const artifacts = [];
    const endpoint = artifactStaticWebEndpoint.replace(/\/+$/, "");
    const root = resolve(artifactDir);

    for (const entry of entries) {
      const fileStat = await stat(entry.localPath);
      if (!fileStat.isFile()) continue;
      totalBytes += fileStat.size;
      if (totalBytes > artifactMaxPublishBytes) {
        throw new HttpError(413, `artifact publish size exceeds ${artifactMaxPublishBytes} bytes`);
      }

      const relativePath = relative(root, entry.localPath).split(sep).join("/");
      const blobName = posix.join(artifactBlobPrefix, artifactId, relativePath);
      const contentType = entry.contentType ?? contentTypeForPath(entry.localPath);
      await containerClient.getBlockBlobClient(blobName).uploadFile(entry.localPath, {
        blobHTTPHeaders: { blobContentType: contentType },
      });

      artifacts.push({
        name: entry.name ?? basename(entry.localPath),
        description: entry.description,
        path: relativePath,
        contentType,
        size: fileStat.size,
        url: `${endpoint}/${encodeStaticWebPath(blobName)}`,
      });
    }

    log("info", "artifacts_published", {
      requestId,
      sessionId,
      artifactId,
      count: artifacts.length,
      totalBytes,
      mode: artifactPublishMode,
    });
    return artifacts;
  }

  function appendArtifactLinks(output, artifacts) {
    if (!artifacts?.length) return output;
    const links = artifacts.map((artifact) => `- [${artifact.name}](${artifact.url})`).join("\n");
    return `${output.trimEnd()}\n\nArtifacts:\n\n${links}`;
  }

  return {
    appendArtifactLinks,
    contentTypeForPath,
    publishStaticWebArtifacts,
    resolveArtifactPath,
    sendArtifactFile,
    staticWebPublishingEnabled,
    withArtifactPromptHint,
    // Exposed for unit testing only.
    _internals: { likelyArtifactPrompt, likelyHtmlPresentationPrompt },
  };
}
