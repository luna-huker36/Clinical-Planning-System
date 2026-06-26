/**
 * End-to-end API test: boots the Express app on an ephemeral port, uploads a
 * synthetic turntable photo set, drives the reconstruction job through the
 * review checkpoint to "ready" and validates the resulting GLB is a real
 * reconstruction (not the bundled mock model).
 *
 * Run: node backend/reconstruction/engine/e2e-test.js
 */

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const express = require("express");
const { generateTurntableDataset } = require("./synthetic-dataset");
const { validateGlbBuffer } = require("./glb-writer");

const MOCK_MODEL_PATH = path.resolve(__dirname, "../../../models/LeePerrySmith.glb");

function startServer() {
  const reconstructionRoutes = require("../routes");
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/api/reconstruction", reconstructionRoutes);
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function api(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${route} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  return payload;
}

async function waitForStatus(base, jobId, targetStatuses, timeoutMs = 120000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await api(base, `/api/reconstruction/jobs/${jobId}/status`);
    if (targetStatuses.includes(last.status)) return last;
    if (last.status === "error") {
      throw new Error(`Job failed: ${last.errorMessage}`);
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${targetStatuses}; last status: ${last && last.status}`);
}

async function main() {
  const errors = [];
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pmas-e2e-"));
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`E2E server on ${base}`);

  try {
    const health = await api(base, "/api/reconstruction/health");
    if (!health.ok) errors.push("Health endpoint did not return ok:true");
    console.log(`health: engineMode=${health.engineMode}`);
    if (health.engineMode !== "pmas_native") {
      errors.push(`Expected default engineMode pmas_native, got ${health.engineMode}`);
    }

    const dataset = await generateTurntableDataset({
      outDir: path.join(workRoot, "photos"),
      shape: "sphere",
      viewCount: 18,
      imageSize: 320,
      radius: 0.8
    });

    const form = new FormData();
    for (const filePath of dataset.files) {
      form.append("files", new Blob([await fs.readFile(filePath)], { type: "image/png" }), path.basename(filePath));
    }
    const uploadResult = await api(base, "/api/reconstruction/upload", { method: "POST", body: form });
    console.log(`uploaded ${uploadResult.files.length} files, uploadId=${uploadResult.uploadId}`);

    const patientCase = await api(base, "/api/reconstruction/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientName: "E2E Test", patientId: "e2e-001" })
    });
    const caseId = patientCase.caseId || patientCase.case?.caseId;
    if (!caseId) throw new Error(`Case creation returned no caseId: ${JSON.stringify(patientCase).slice(0, 200)}`);

    const job = await api(base, "/api/reconstruction/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: uploadResult.uploadId, caseId, settings: { processingMode: "balanced" } })
    });
    await api(base, `/api/reconstruction/jobs/${job.jobId}/start`, { method: "POST" });

    const review = await waitForStatus(base, job.jobId, ["review_required"]);
    console.log(`review checkpoint: ${review.selectedFramesCount} frames selected`);
    await api(base, `/api/reconstruction/jobs/${job.jobId}/review/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    const finished = await waitForStatus(base, job.jobId, ["ready", "manual_adjustment_required"]);
    let finalJob = finished;
    if (finished.status === "manual_adjustment_required") {
      console.log("manual adjustment requested — skipping");
      await api(base, `/api/reconstruction/jobs/${job.jobId}/adjustment/skip`, { method: "POST" });
      finalJob = await waitForStatus(base, job.jobId, ["ready"]);
    }

    console.log(`job ready: engine="${finalJob.engineName}", mode=${finalJob.reconstructionMode}, quality=${finalJob.reconstructionQuality}`);
    if (finalJob.reconstructionMode !== "pmas_native") {
      errors.push(`Job finished in mode ${finalJob.reconstructionMode}, expected pmas_native`);
    }
    if (!finalJob.resultGlbUrl) errors.push("Job has no resultGlbUrl");

    const glbResponse = await fetch(`${base}${finalJob.resultGlbUrl}`);
    if (!glbResponse.ok) throw new Error(`GLB download failed: ${glbResponse.status}`);
    const glb = Buffer.from(await glbResponse.arrayBuffer());
    const validation = validateGlbBuffer(glb);
    if (!validation.ok) errors.push(`Result GLB invalid: ${validation.errors.join("; ")}`);
    console.log(`result GLB: ${glb.length} bytes, ${validation.stats.vertexCount} verts, ${validation.stats.triangleCount} tris, colors=${validation.stats.hasColors}, texture=${validation.stats.hasTexture}`);

    const mockGlb = await fs.readFile(MOCK_MODEL_PATH);
    if (glb.length === mockGlb.length && glb.equals(mockGlb)) {
      errors.push("Result GLB is byte-identical to the mock LeePerrySmith model — engine did not run");
    }
    if (!validation.stats.hasColors && !validation.stats.hasTexture) {
      errors.push("Result GLB has neither vertex colors nor a baked texture");
    }
    if (validation.stats.triangleCount < 1000) errors.push(`Suspiciously low triangle count: ${validation.stats.triangleCount}`);

    const stats = finalJob.reconstructionStats;
    if (!stats || !stats.usableFrames) {
      errors.push("Job is missing reconstructionStats from the native engine");
    } else {
      console.log(`engine stats: frames=${stats.usableFrames}/${stats.inputFrames}, grid=${stats.voxelGrid}, watertight=${stats.watertight}`);
    }
  } catch (err) {
    errors.push(`E2E crashed: ${err.message}`);
  } finally {
    server.close();
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => null);
  }

  if (errors.length) {
    errors.forEach(error => console.error(`ERROR: ${error}`));
    console.error("E2E FAILED");
    process.exit(1);
  }
  console.log("E2E PASSED");
  process.exit(0);
}

main().catch(err => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
