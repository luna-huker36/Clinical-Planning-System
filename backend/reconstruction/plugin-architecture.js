const PLUGIN_CATEGORIES = new Set([
  "reconstruction",
  "landmarks",
  "measurements",
  "analysis",
  "reports",
  "simulation",
  "export",
  "custom"
]);

const EXTENSION_POINTS = Object.freeze([
  "reconstruction_pipeline",
  "landmark_detection",
  "measurement_templates",
  "clinical_analysis",
  "report_generation",
  "surgical_simulation",
  "export_system"
]);

const SUPPORTED_PLUGIN_API_VERSION = "v1";

const BUILT_IN_PLUGINS = Object.freeze([
  {
    pluginId: "builtin-landmark-templates",
    name: "Landmark Templates",
    version: "v1",
    category: "landmarks",
    description: "Built-in PMAS landmark template registry.",
    author: "PMAS Core",
    enabled: true,
    builtIn: true,
    extensionPoints: ["landmark_detection"]
  },
  {
    pluginId: "builtin-measurement-templates",
    name: "Measurement Templates",
    version: "v1",
    category: "measurements",
    description: "Built-in PMAS measurement template engine.",
    author: "PMAS Core",
    enabled: true,
    builtIn: true,
    extensionPoints: ["measurement_templates"]
  },
  {
    pluginId: "builtin-clinical-analysis-presets",
    name: "Clinical Analysis Presets",
    version: "v1",
    category: "analysis",
    description: "Built-in PMAS clinical analysis preset layer.",
    author: "PMAS Core",
    enabled: true,
    builtIn: true,
    extensionPoints: ["clinical_analysis"]
  },
  {
    pluginId: "builtin-report-builder",
    name: "Report Builder",
    version: "v1",
    category: "reports",
    description: "Built-in PMAS clinical and case report builder.",
    author: "PMAS Core",
    enabled: true,
    builtIn: true,
    extensionPoints: ["report_generation", "export_system"]
  }
]);

function normalizePlugin(input = {}, context = {}) {
  const nowIso = typeof context.nowIso === "function" ? context.nowIso : () => new Date().toISOString();
  const pluginId = String(input.pluginId || "").trim();
  const category = PLUGIN_CATEGORIES.has(input.category) ? input.category : "custom";
  return {
    pluginId,
    name: String(input.name || pluginId || "PMAS Plugin").trim() || "PMAS Plugin",
    version: String(input.version || SUPPORTED_PLUGIN_API_VERSION).trim() || SUPPORTED_PLUGIN_API_VERSION,
    category,
    description: String(input.description || "").trim(),
    author: String(input.author || "Unknown").trim() || "Unknown",
    enabled: input.enabled !== false,
    createdAt: input.createdAt || nowIso(),
    updatedAt: input.updatedAt || input.createdAt || nowIso(),
    builtIn: Boolean(input.builtIn),
    compatibleVersion: String(input.compatibleVersion || SUPPORTED_PLUGIN_API_VERSION).trim() || SUPPORTED_PLUGIN_API_VERSION,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies.map(String).filter(Boolean) : [],
    extensionPoints: Array.isArray(input.extensionPoints)
      ? input.extensionPoints.map(String).filter(item => EXTENSION_POINTS.includes(item))
      : []
  };
}

function validatePlugin(input = {}, existingPlugins = []) {
  const plugin = normalizePlugin(input);
  const ids = new Set(existingPlugins.map(item => item.pluginId).filter(Boolean));
  const errors = [];
  if (!plugin.pluginId) errors.push("pluginId is required.");
  if (ids.has(plugin.pluginId)) errors.push(`Plugin ${plugin.pluginId} is already registered.`);
  if (plugin.compatibleVersion !== SUPPORTED_PLUGIN_API_VERSION) errors.push(`Unsupported plugin API version: ${plugin.compatibleVersion}.`);
  const existingIds = new Set(existingPlugins.map(item => item.pluginId));
  const missingDependencies = plugin.dependencies.filter(item => !existingIds.has(item));
  if (missingDependencies.length) errors.push(`Missing dependencies: ${missingDependencies.join(", ")}.`);
  return {
    ok: errors.length === 0,
    errors,
    plugin
  };
}

function pluginSummary(plugins = []) {
  const safePlugins = plugins.map(normalizePlugin);
  return {
    pluginsCount: safePlugins.length,
    enabledCount: safePlugins.filter(item => item.enabled).length,
    disabledCount: safePlugins.filter(item => !item.enabled).length,
    builtInCount: safePlugins.filter(item => item.builtIn).length,
    categories: safePlugins.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {}),
    extensionPoints: EXTENSION_POINTS.map(point => ({
      extensionPoint: point,
      pluginsCount: safePlugins.filter(item => item.enabled && item.extensionPoints.includes(point)).length
    }))
  };
}

module.exports = {
  PLUGIN_CATEGORIES,
  EXTENSION_POINTS,
  SUPPORTED_PLUGIN_API_VERSION,
  BUILT_IN_PLUGINS,
  normalizePlugin,
  validatePlugin,
  pluginSummary
};
