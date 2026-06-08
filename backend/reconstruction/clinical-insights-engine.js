const INSIGHT_CATEGORIES = new Set([
  "facial_analysis",
  "symmetry",
  "measurements",
  "reconstruction_quality",
  "landmark_quality",
  "planning",
  "custom"
]);

const INSIGHT_SEVERITIES = new Set(["info", "warning", "attention"]);

function normalizeInsight(input = {}, context = {}) {
  const makeId = typeof context.makeId === "function" ? context.makeId : prefix => `${prefix}-${Date.now().toString(36)}`;
  const nowIso = typeof context.nowIso === "function" ? context.nowIso : () => new Date().toISOString();
  const category = INSIGHT_CATEGORIES.has(input.category) ? input.category : "custom";
  const severity = INSIGHT_SEVERITIES.has(input.severity) ? input.severity : "info";
  return {
    insightId: String(input.insightId || makeId("insight")),
    caseId: String(input.caseId || context.caseId || ""),
    modelId: String(input.modelId || ""),
    category,
    severity,
    title: String(input.title || "Clinical observation"),
    description: String(input.description || ""),
    source: String(input.source || "clinical_insights_engine"),
    createdAt: input.createdAt || nowIso(),
    reviewed: Boolean(input.reviewed),
    dismissed: Boolean(input.dismissed),
    pinned: Boolean(input.pinned),
    reviewedAt: input.reviewedAt || "",
    dismissedAt: input.dismissedAt || ""
  };
}

function insightSignature(insight) {
  return [
    insight.caseId || "",
    insight.modelId || "",
    insight.category || "",
    insight.title || "",
    insight.source || ""
  ].join("::");
}

function generateClinicalInsights(input = {}, context = {}) {
  const caseId = String(input.caseId || context.caseId || "");
  const nowIso = context.nowIso || (() => new Date().toISOString());
  const makeId = context.makeId;
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  const measurements = Array.isArray(input.measurements) ? input.measurements : [];
  const landmarks = Array.isArray(input.landmarks) ? input.landmarks : [];
  const comparisons = Array.isArray(input.comparisons) ? input.comparisons : [];
  const simulations = Array.isArray(input.simulations) ? input.simulations : [];
  const existingBySignature = new Map((input.existingInsights || []).map(item => [insightSignature(item), item]));
  const drafts = [];

  const add = draft => {
    const normalized = normalizeInsight({ caseId, ...draft }, { makeId, nowIso, caseId });
    const existing = existingBySignature.get(insightSignature(normalized));
    drafts.push(existing ? { ...normalized, ...existing, createdAt: existing.createdAt || normalized.createdAt } : normalized);
  };

  jobs.forEach(job => {
    const score = Number(job.readinessScore);
    if (Number.isFinite(score) && score > 0 && score < 50) {
      add({
        modelId: job.resultGlbUrl || job.jobId || "",
        category: "reconstruction_quality",
        severity: "warning",
        title: "Модель имеет низкий readiness score.",
        description: `Readiness score ${Math.round(score)}/100. Наблюдение указывает только на необходимость внимательной проверки качества модели врачом.`,
        source: `job:${job.jobId}:readiness`
      });
    } else if (Number.isFinite(score) && score >= 50 && score < 70) {
      add({
        modelId: job.resultGlbUrl || job.jobId || "",
        category: "reconstruction_quality",
        severity: "attention",
        title: "Readiness score требует внимания.",
        description: `Readiness score ${Math.round(score)}/100. Перед использованием результатов стоит сверить пригодность модели для выбранной задачи.`,
        source: `job:${job.jobId}:readiness`
      });
    }
    const warningsCount = Number(job.warningsCount || (Array.isArray(job.warnings) ? job.warnings.length : 0));
    if (warningsCount >= 3) {
      add({
        modelId: job.resultGlbUrl || job.jobId || "",
        category: "reconstruction_quality",
        severity: "warning",
        title: "Реконструкция выполнена с большим количеством предупреждений.",
        description: `Для модели связано ${warningsCount} предупреждений. Это observation для проверки входных данных и артефактов реконструкции.`,
        source: `job:${job.jobId}:warnings`
      });
    }
  });

  const missingLandmarks = landmarks.filter(item => item.status === "unplaced" || (item.required && item.status !== "placed" && item.status !== "approved" && item.status !== "corrected"));
  if (missingLandmarks.length) {
    add({
      modelId: missingLandmarks[0]?.modelId || "",
      category: "landmark_quality",
      severity: "attention",
      title: "Отсутствуют обязательные landmarks.",
      description: `${missingLandmarks.length} landmark(s) отмечены как отсутствующие или неразмещенные. Это может влиять на автоматические измерения.`,
      source: "landmarks:missing"
    });
  }

  const lowConfidence = landmarks.filter(item => Number.isFinite(Number(item.confidence)) && Number(item.confidence) < 60);
  if (lowConfidence.length) {
    add({
      modelId: lowConfidence[0]?.modelId || "",
      category: "landmark_quality",
      severity: "attention",
      title: "Некоторые landmarks имеют низкую уверенность.",
      description: `${lowConfidence.length} AI landmark(s) имеют confidence ниже 60%. Эти точки стоит рассматривать как предложенные для врачебной проверки.`,
      source: "landmarks:low_confidence"
    });
  }

  const reviewMeasurements = measurements.filter(item => ["missing_landmarks", "needs_review", "error"].includes(item.status) || (item.warnings || []).length || (item.missingLandmarks || []).length);
  if (reviewMeasurements.length) {
    add({
      modelId: reviewMeasurements[0]?.modelId || "",
      category: "measurements",
      severity: "attention",
      title: "Некоторые измерения требуют ручной проверки.",
      description: `${reviewMeasurements.length} measurement(s) имеют статус review/missing landmarks или предупреждения. Это не интерпретация результата, а флаг качества данных.`,
      source: "measurements:review"
    });
  }

  if (comparisons.length >= 1) {
    add({
      modelId: comparisons[0]?.afterJobId || comparisons[0]?.beforeJobId || "",
      category: "symmetry",
      severity: "info",
      title: "Есть данные для сравнения двух моделей.",
      description: `${comparisons.length} before/after comparison object(s) доступны. Проверьте визуальные различия между моделями в viewer.`,
      source: "comparisons:available"
    });
  }

  const simulationWarnings = simulations.flatMap(item => item.warnings || []);
  if (simulationWarnings.length) {
    add({
      modelId: simulations[0]?.simulatedModelId || simulations[0]?.modelId || "",
      category: "planning",
      severity: "attention",
      title: "Simulation results содержат предупреждения.",
      description: `${simulationWarnings.length} simulation warning(s) доступны. Это observation о качестве/ограничениях planning preview.`,
      source: "simulations:warnings"
    });
  }

  return drafts.sort((a, b) => {
    const weight = { warning: 3, attention: 2, info: 1 };
    return (weight[b.severity] || 0) - (weight[a.severity] || 0) || String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

module.exports = {
  INSIGHT_CATEGORIES,
  INSIGHT_SEVERITIES,
  normalizeInsight,
  insightSignature,
  generateClinicalInsights
};
