import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createArtifactManager } from "../src/runtime/artifacts.mjs";

class TestHttpError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; }
}
const noopLog = () => {};
const isInside = (parent, child) => child === parent || child.startsWith(`${parent}/`);

function makeManager({ mode = "disabled", account, endpoint, promptHints = true } = {}) {
  return createArtifactManager({
    filesDir: "/files",
    artifactPublishMode: mode,
    artifactStorageAccount: account,
    artifactStaticWebEndpoint: endpoint,
    artifactStaticWebContainer: "$web",
    artifactBlobPrefix: "test-agent",
    artifactMaxPublishBytes: 1024 * 1024,
    artifactPromptHints: promptHints,
    HttpError: TestHttpError,
    isInside,
    log: noopLog,
  });
}

describe("likelyArtifactPrompt", () => {
  const m = makeManager();
  const positive = [
    "Create an HTML report of last quarter's metrics",
    "Generate an mp4 from these slides",
    "Build a presentation about pi-foundry",
    "Please produce a downloadable zip of the dataset",
    "生成一个网页报告",
    "做一个幻灯片演示",
    "导出一个可播放的视频",
  ];
  for (const prompt of positive) {
    it(`fires on: ${prompt}`, () => {
      assert.equal(m._internals.likelyArtifactPrompt(prompt), true);
    });
  }

  // Regression: these used to falsely trigger the hint injection under the old regex
  // (`file`, `files`, `page`, `生成`, `文件`, `页面` were over-broad keywords).
  const negative = [
    "Read this file and summarize",
    "Open the file foo.py and fix the bug",
    "Navigate to the next page of the docs",
    "请帮我看一下这个文件",
    "翻到下一页",
    "生成一段示例代码",
    "What is the capital of France?",
    "Refactor backend.mjs",
  ];
  for (const prompt of negative) {
    it(`does NOT fire on: ${prompt}`, () => {
      assert.equal(m._internals.likelyArtifactPrompt(prompt), false);
    });
  }
});

describe("likelyHtmlPresentationPrompt", () => {
  const m = makeManager();
  it("fires on explicit html/presentation/slides asks", () => {
    assert.equal(m._internals.likelyHtmlPresentationPrompt("Build a presentation"), true);
    assert.equal(m._internals.likelyHtmlPresentationPrompt("Generate slides"), true);
    assert.equal(m._internals.likelyHtmlPresentationPrompt("一个网页演示"), true);
  });
  it("does NOT fire on generic report/page words alone", () => {
    assert.equal(m._internals.likelyHtmlPresentationPrompt("Write a report on X"), false);
    assert.equal(m._internals.likelyHtmlPresentationPrompt("写一份报告"), false);
    assert.equal(m._internals.likelyHtmlPresentationPrompt("Navigate to the next page"), false);
  });
});

describe("withArtifactPromptHint", () => {
  it("returns the prompt unchanged when publishing is disabled", () => {
    const m = makeManager({ mode: "disabled" });
    const prompt = "Create an HTML report";
    assert.equal(m.withArtifactPromptHint(prompt, "/files/x"), prompt);
  });

  it("returns the prompt unchanged when ARTIFACT_PROMPT_HINTS=0", () => {
    const m = makeManager({ mode: "static-web", account: "acct", endpoint: "https://x", promptHints: false });
    const prompt = "Create an HTML report";
    assert.equal(m.withArtifactPromptHint(prompt, "/files/x"), prompt);
  });

  it("returns the prompt unchanged when the heuristic does not fire", () => {
    const m = makeManager({ mode: "static-web", account: "acct", endpoint: "https://x" });
    const prompt = "Read this file and summarize";
    assert.equal(m.withArtifactPromptHint(prompt, "/files/x"), prompt);
  });

  it("injects the artifact contract when publishing is enabled and the prompt matches", () => {
    const m = makeManager({ mode: "static-web", account: "acct", endpoint: "https://x" });
    const prompt = "Create an HTML report";
    const out = m.withArtifactPromptHint(prompt, "/files/abc");
    assert.notEqual(out, prompt);
    assert.ok(out.includes("Artifact delivery contract:"));
    assert.ok(out.includes("/files/abc"));
    assert.ok(out.endsWith(prompt));
  });

  it("adds HTML-presentation contract when the prompt is presentation-shaped", () => {
    const m = makeManager({ mode: "static-web", account: "acct", endpoint: "https://x" });
    const out = m.withArtifactPromptHint("Build a slides presentation", "/files/abc");
    assert.ok(out.includes("Browser-playable HTML report/presentation contract:"));
    assert.ok(out.includes("scene-based presentation"));
  });

  it("does NOT add HTML-presentation contract for plain audio/zip requests", () => {
    const m = makeManager({ mode: "static-web", account: "acct", endpoint: "https://x" });
    const out = m.withArtifactPromptHint("Generate an mp3 narration", "/files/abc");
    assert.ok(out.includes("Artifact delivery contract:"));
    assert.ok(!out.includes("Browser-playable"));
  });
});

describe("appendArtifactLinks", () => {
  const m = makeManager();
  it("returns the output unchanged when there are no artifacts", () => {
    assert.equal(m.appendArtifactLinks("hello", []), "hello");
    assert.equal(m.appendArtifactLinks("hello", undefined), "hello");
  });

  it("appends a markdown Artifacts section", () => {
    const out = m.appendArtifactLinks("hello", [{ name: "index.html", url: "https://x/index.html" }]);
    assert.ok(out.endsWith("\n\nArtifacts:\n\n- [index.html](https://x/index.html)"));
  });
});
