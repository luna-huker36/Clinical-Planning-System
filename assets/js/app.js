// ===== PMAS App — Tabs + 3D Scene + Full 3D Clinical Tools =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ==================== TAB NAVIGATION ====================
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const tabNav = document.getElementById('tabNav');
let scene3dInitialized = false;
const TYPE_NAMES_RU = { point: 'Точка', distance: 'Расстояние', angle: 'Угол', vector: 'Вектор', tilt: 'Наклон', measure: 'Измерение', volume: 'Объём' };
const TYPE_ICONS = { point: '📍', distance: '📏', angle: '📐', vector: '➡️', tilt: '📊', measure: '📏', volume: '🧠' };

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(tc => tc.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
    tabNav.classList.remove('open');

    if (target === 'tab3d' && !scene3dInitialized) {
      init3DScene();
      scene3dInitialized = true;
    }
    if (target === 'tab3d') onResize3D();
  });
});

hamburgerBtn?.addEventListener('click', () => tabNav.classList.toggle('open'));

// ==================== 3D SCENE ====================
let renderer, scene, camera, controls, labelRenderer;
let currentModel = null;
let wireframeMode = false, normalsMode = false;
let lights = [];
const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ==================== 3D CLINICAL STATE ====================
// Tools: 'point','distance','angle','vector','tilt','measure','calibration'
let tool3dMode = null;
let tool3dPoints = [];
let markers3d = [];
let lines3d = [];
let labels3d = [];

// Plan items (like 2D planItems)
let plan3dItems = []; // {id, type, label, points:[], value, deg}
let selected3dPlan = null; // id of selected item

// Calibration: mm per model unit
let scale3dMMperUnit = null; // null = auto (model units displayed as-is)
let calibrationPoints = []; // temporary for calibration

// Before/After
let before3dSnapshot = null;
let show3dBefore = false;

// ==================== HELPERS ====================
function nextId3d() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function setStatus3d(msg) {
  const el = document.getElementById('status3d');
  if (el) el.textContent = msg;
}

function dist3d(a, b) {
  return a.distanceTo(b);
}

function mmFromUnit(unitDist) {
  if (scale3dMMperUnit != null) return unitDist * scale3dMMperUnit;
  return null;
}

function formatDist(unitDist) {
  const mm = mmFromUnit(unitDist);
  if (mm != null) return `${mm.toFixed(2)} мм`;
  return `${unitDist.toFixed(4)} ед.`;
}

function mm3FromUnitVolume(unitVolume) {
  if (scale3dMMperUnit == null) return null;
  return unitVolume * Math.pow(scale3dMMperUnit, 3);
}

function formatVolume(unitVolume) {
  const mm3 = mm3FromUnitVolume(unitVolume);
  if (mm3 != null) {
    const cm3 = mm3 / 1000;
    return `${cm3.toFixed(1)} см³ (${cm3.toFixed(1)} мл)`;
  }
  return `${unitVolume.toFixed(6)} ед³`;
}

function formatPlan3DValue(item) {
  if (!item) return '';
  if (item.type === 'angle') {
    return item.deg != null ? `${item.deg.toFixed(1)}°` : '';
  }
  if (item.type === 'tilt') {
    return `${item.deg != null ? item.deg.toFixed(1) + '°' : ''} | ${item.value != null ? formatDist(item.value) : ''}`;
  }
  if (item.type === 'volume') {
    return item.value != null ? formatVolume(item.value) : '';
  }
  if (item.value != null) {
    return formatDist(item.value);
  }
  return '';
}

function formatVolumeQuality(item) {
  if (!item || item.type !== 'volume') return '';
  const boundaryEdges = Number(item.boundaryEdges) || 0;
  const nonManifoldEdges = Number(item.nonManifoldEdges) || 0;
  if (boundaryEdges === 0 && nonManifoldEdges === 0) {
    return 'по фактической поверхности меша';
  }
  return `есть открытые края: ${boundaryEdges}, неманифолдные рёбра: ${nonManifoldEdges}`;
}

function computeGeometryEdgeStats(geometry) {
  const pos = geometry?.attributes?.position;
  if (!pos || pos.count < 3) return { boundaryEdges: 0, nonManifoldEdges: 0 };

  const tolerance = 1e-5;
  const vertexIds = new Array(pos.count);
  const vertexMap = new Map();
  let nextId = 0;

  for (let i = 0; i < pos.count; i += 1) {
    const key = `${Math.round(pos.getX(i) / tolerance)},${Math.round(pos.getY(i) / tolerance)},${Math.round(pos.getZ(i) / tolerance)}`;
    let id = vertexMap.get(key);
    if (id == null) {
      id = nextId++;
      vertexMap.set(key, id);
    }
    vertexIds[i] = id;
  }

  const edgeCounts = new Map();
  const addEdge = (ia, ib) => {
    const a = vertexIds[ia];
    const b = vertexIds[ib];
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  };

  const index = geometry.index ? geometry.index.array : null;
  if (index) {
    for (let i = 0; i + 2 < index.length; i += 3) {
      addEdge(index[i], index[i + 1]);
      addEdge(index[i + 1], index[i + 2]);
      addEdge(index[i + 2], index[i]);
    }
  } else {
    for (let i = 0; i + 2 < pos.count; i += 3) {
      addEdge(i, i + 1);
      addEdge(i + 1, i + 2);
      addEdge(i + 2, i);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  }
  return { boundaryEdges, nonManifoldEdges };
}

function computeMeshVolumeStats(mesh) {
  const geometry = mesh?.geometry;
  const pos = geometry?.attributes?.position;
  if (!pos || pos.count < 3) return null;

  const index = geometry.index ? geometry.index.array : null;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let signedVolume = 0;
  let triangleCount = 0;

  const readVertex = (vertexIndex, target) => target.fromBufferAttribute(pos, vertexIndex).applyMatrix4(mesh.matrixWorld);

  if (index) {
    for (let i = 0; i + 2 < index.length; i += 3) {
      readVertex(index[i], a);
      readVertex(index[i + 1], b);
      readVertex(index[i + 2], c);
      signedVolume += a.dot(cross.crossVectors(b, c)) / 6;
      triangleCount += 1;
    }
  } else {
    for (let i = 0; i + 2 < pos.count; i += 3) {
      readVertex(i, a);
      readVertex(i + 1, b);
      readVertex(i + 2, c);
      signedVolume += a.dot(cross.crossVectors(b, c)) / 6;
      triangleCount += 1;
    }
  }

  const topology = computeGeometryEdgeStats(geometry);
  return {
    volumeUnits: Math.abs(signedVolume),
    triangleCount,
    boundaryEdges: topology.boundaryEdges,
    nonManifoldEdges: topology.nonManifoldEdges
  };
}

function computeModelVolumeStats(root) {
  if (!root) return null;
  root.updateWorldMatrix(true, true);

  const total = {
    volumeUnits: 0,
    triangleCount: 0,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    meshCount: 0,
    closedMeshes: 0
  };

  root.traverse(obj => {
    if (!obj.isMesh) return;
    const stats = computeMeshVolumeStats(obj);
    if (!stats) return;
    total.meshCount += 1;
    total.volumeUnits += stats.volumeUnits;
    total.triangleCount += stats.triangleCount;
    total.boundaryEdges += stats.boundaryEdges;
    total.nonManifoldEdges += stats.nonManifoldEdges;
    if (stats.boundaryEdges === 0 && stats.nonManifoldEdges === 0) {
      total.closedMeshes += 1;
    }
  });

  return total.meshCount > 0 ? total : null;
}

// ==================== 3D SCENE INIT ====================
function init3DScene() {
  const container = document.getElementById('canvas3d-container');
  const w = container.clientWidth, h = container.clientHeight;

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.style.position = 'relative';
  container.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 200);
  camera.position.set(0, 0, 3);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  setupLight1();

  // KTX2 texture support (for facecap.glb etc.)
  const ktx2Loader = new KTX2Loader()
    .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/')
    .detectSupport(renderer);
  loader.setKTX2Loader(ktx2Loader);
  loader.setMeshoptDecoder(MeshoptDecoder);

  loadModel3D(document.getElementById('modelSelect').value);

  renderer.domElement.addEventListener('click', on3DClick);
  renderer.domElement.addEventListener('dblclick', () => { if (currentModel) fitCamera3D(currentModel); });
  window.addEventListener('resize', onResize3D);

  animate3D();
  bindUI3D();
  load3dProject();
}

function animate3D() {
  requestAnimationFrame(animate3D);
  if (!renderer) return;
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function onResize3D() {
  if (!renderer) return;
  const container = document.getElementById('canvas3d-container');
  const w = container.clientWidth, h = container.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
}

// ==================== LIGHTS ====================
function clearLights() { lights.forEach(l => scene.remove(l)); lights = []; }

function setupLight1() {
  clearLights();
  const a = new THREE.AmbientLight(0x404050, 0.6);
  const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(2, 3, 4);
  const f = new THREE.DirectionalLight(0x8888ff, 0.8); f.position.set(-2, -1, 2);
  lights.push(a, d, f); lights.forEach(l => scene.add(l));
}
function setupLight2() {
  clearLights();
  const a = new THREE.AmbientLight(0x303030, 0.4);
  const k = new THREE.SpotLight(0xffeedd, 5, 20, Math.PI / 4); k.position.set(3, 4, 3);
  const r = new THREE.PointLight(0x4488ff, 3, 10); r.position.set(-3, 1, -2);
  lights.push(a, k, r); lights.forEach(l => scene.add(l));
}
function setupLight3() {
  clearLights();
  const a = new THREE.AmbientLight(0xffffff, 0.3);
  const t = new THREE.DirectionalLight(0xffffff, 1.5); t.position.set(0, 5, 0);
  const f = new THREE.DirectionalLight(0xffffff, 1.2); f.position.set(0, 0, 5);
  const l = new THREE.DirectionalLight(0xccddff, 0.8); l.position.set(-4, 2, 2);
  const r = new THREE.DirectionalLight(0xffddcc, 0.8); r.position.set(4, 2, 2);
  lights.push(a, t, f, l, r); lights.forEach(x => scene.add(x));
}

// ==================== MODEL ====================
function removeModel3D() {
  if (!currentModel) return;
  scene.remove(currentModel);
  currentModel.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
    }
  });
  currentModel = null;
}

function fitCamera3D(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = (maxDim / (2 * Math.tan(camera.fov * Math.PI / 360))) * 1.4;
  camera.position.set(center.x, center.y, center.z + dist);
  controls.target.copy(center);
  controls.update();
}

function applyVisualMode3D(obj) {
  obj.traverse(c => {
    if (!c.isMesh) return;
    if (normalsMode) {
      c.material = new THREE.MeshNormalMaterial({ wireframe: wireframeMode });
    } else if (c.userData.originalMaterial) {
      c.material = c.userData.originalMaterial.clone();
      c.material.wireframe = wireframeMode;
    } else {
      c.material.wireframe = wireframeMode;
    }
  });
}

function loadModel3D(url) {
  removeModel3D();
  const loadEl = document.getElementById('loading3d');
  loadEl.classList.add('visible');
  wireframeMode = false; normalsMode = false;
  updateBtn3DStates();

  loader.load(url, gltf => {
    const model = gltf.scene;
    model.traverse(c => { if (c.isMesh) c.userData.originalMaterial = c.material.clone(); });
    scene.add(model);
    currentModel = model;
    fitCamera3D(model);
    loadEl.classList.remove('visible');

    // Auto-detect scale from bounding box (GLB face scans are typically in meters)
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    // If model is ~0.1-0.4 range, likely meters (face ~0.2m), set auto mm/unit = 1000
    if (maxDim > 0.05 && maxDim < 1.0) {
      scale3dMMperUnit = 1000; // 1 unit = 1 meter = 1000mm
      updateScaleBadge();
      setStatus3d('Модель загружена. Авто-масштаб: 1 ед. = 1000 мм (метры).');
    } else if (maxDim >= 1.0 && maxDim < 500) {
      scale3dMMperUnit = 1; // likely already in mm
      updateScaleBadge();
      setStatus3d('Модель загружена. Авто-масштаб: 1 ед. = 1 мм.');
    } else {
      scale3dMMperUnit = null;
      updateScaleBadge();
      setStatus3d('Модель загружена. Выполните калибровку для измерений в мм.');
    }
  }, null, err => {
    loadEl.classList.remove('visible');
    console.error('Model load error:', err);
  });
}

function updateScaleBadge() {
  const el = document.getElementById('scale3dBadge');
  if (!el) return;
  if (scale3dMMperUnit != null) {
    el.textContent = `${scale3dMMperUnit.toFixed(2)} мм/ед.`;
  } else {
    el.textContent = 'авто';
  }
}

// ==================== 3D CLICK (CLINICAL TOOLS) ====================
function raycastMesh(e) {
  if (!currentModel) return null;
  const container = document.getElementById('canvas3d-container');
  const rect = container.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = [];
  currentModel.traverse(c => { if (c.isMesh) meshes.push(c); });
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return null;
  return hits[0].point.clone();
}

function on3DClick(e) {
  if (!tool3dMode || !currentModel) return;
  if (controls.enabled && e.detail > 1) return;

  const point = raycastMesh(e);
  if (!point) return;

  // Calibration mode
  if (tool3dMode === 'calibration') {
    calibrationPoints.push(point);
    addMarker3D(point, 0xef4444);
    if (calibrationPoints.length === 2) {
      const unitDist = calibrationPoints[0].distanceTo(calibrationPoints[1]);
      const realMM = parseFloat(prompt('Введите реальное расстояние между точками (мм):') || '');
      if (Number.isFinite(realMM) && realMM > 0 && unitDist > 0) {
        scale3dMMperUnit = realMM / unitDist;
        updateScaleBadge();
        setStatus3d(`Калибровка установлена: ${scale3dMMperUnit.toFixed(2)} мм/ед.`);
        // Re-render labels with new scale
        rebuildAllVisuals();
      } else {
        setStatus3d('Калибровка отменена.');
      }
      // Remove calibration markers
      while (markers3d.length > plan3dItems.reduce((s, it) => s + it.points.length, 0)) {
        const m = markers3d.pop();
        scene.remove(m); m.geometry.dispose(); m.material.dispose();
      }
      calibrationPoints = [];
      tool3dMode = null;
      updateBtn3DStates();
    } else {
      setStatus3d('Калибровка: выберите вторую точку...');
    }
    return;
  }

  tool3dPoints.push(point);
  addMarker3D(point);

  const label = document.getElementById('planLabel3d')?.value || '';

  if (tool3dMode === 'point') {
    finalizePlanItem('point', label, [point]);
    tool3dPoints = [];
  } else if (tool3dMode === 'distance' && tool3dPoints.length === 2) {
    const d = dist3d(tool3dPoints[0], tool3dPoints[1]);
    addLine3D(tool3dPoints[0], tool3dPoints[1], 0x2563eb);
    addLabel3D(midpoint(tool3dPoints[0], tool3dPoints[1]), formatDist(d));
    finalizePlanItem('distance', label, [...tool3dPoints], d);
    tool3dPoints = [];
  } else if (tool3dMode === 'angle' && tool3dPoints.length === 3) {
    const [a, b, c] = tool3dPoints;
    addLine3D(a, b, 0x0891b2);
    addLine3D(b, c, 0x0891b2);
    const angle = computeAngle3(a, b, c);
    addLabel3D(b, `${angle.toFixed(1)}°`);
    finalizePlanItem('angle', label, [...tool3dPoints], angle, angle);
    tool3dPoints = [];
  } else if (tool3dMode === 'vector' && tool3dPoints.length === 2) {
    addArrow3D(tool3dPoints[0], tool3dPoints[1]);
    const d = dist3d(tool3dPoints[0], tool3dPoints[1]);
    addLabel3D(midpoint(tool3dPoints[0], tool3dPoints[1]), `→ ${formatDist(d)}`);
    finalizePlanItem('vector', label, [...tool3dPoints], d);
    tool3dPoints = [];
  } else if (tool3dMode === 'tilt' && tool3dPoints.length === 2) {
    addLine3D(tool3dPoints[0], tool3dPoints[1], 0xf59e0b);
    // Compute tilt angle relative to horizontal (XZ) plane
    const dx = tool3dPoints[1].x - tool3dPoints[0].x;
    const dy = tool3dPoints[1].y - tool3dPoints[0].y;
    const dz = tool3dPoints[1].z - tool3dPoints[0].z;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const tiltDeg = Math.atan2(dy, horizDist) * 180 / Math.PI;
    const d = dist3d(tool3dPoints[0], tool3dPoints[1]);
    addLabel3D(midpoint(tool3dPoints[0], tool3dPoints[1]), `${tiltDeg.toFixed(1)}° | ${formatDist(d)}`);
    finalizePlanItem('tilt', label, [...tool3dPoints], d, tiltDeg);
    tool3dPoints = [];
  } else if (tool3dMode === 'measure' && tool3dPoints.length === 2) {
    addLine3D(tool3dPoints[0], tool3dPoints[1], 0x14b8a6);
    const d = dist3d(tool3dPoints[0], tool3dPoints[1]);
    addLabel3D(midpoint(tool3dPoints[0], tool3dPoints[1]), formatDist(d));
    finalizePlanItem('measure', label, [...tool3dPoints], d);
    tool3dPoints = [];
  } else {
    // Need more points
    const need = tool3dMode === 'angle' ? 3 : 2;
    setStatus3d(`Выберите ${tool3dPoints.length === 1 ? 'вторую' : 'третью'} точку... (${tool3dPoints.length}/${need})`);
  }
}

function computeAngle3(a, b, c) {
  const v1 = new THREE.Vector3().subVectors(a, b).normalize();
  const v2 = new THREE.Vector3().subVectors(c, b).normalize();
  return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, v1.dot(v2)))));
}

function midpoint(a, b) {
  return new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
}

// ==================== 3D MARKERS, LINES, LABELS ====================
function addMarker3D(pos, color = 0x22c55e) {
  const geo = new THREE.SphereGeometry(0.005, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color });
  const sphere = new THREE.Mesh(geo, mat);
  sphere.position.copy(pos);
  scene.add(sphere);
  markers3d.push(sphere);
}

function addLine3D(from, to, color = 0x2563eb) {
  // Use a thin cylinder (tube) for visible thick lines (WebGL ignores linewidth)
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1e-6) return;
  const tubeGeo = new THREE.CylinderGeometry(0.0015, 0.0015, len, 6, 1);
  tubeGeo.translate(0, len / 2, 0);
  tubeGeo.rotateX(Math.PI / 2);
  const tubeMat = new THREE.MeshBasicMaterial({ color });
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  tube.position.copy(from);
  tube.lookAt(to);
  scene.add(tube);
  lines3d.push(tube);
}

function addArrow3D(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  dir.normalize();
  const arrow = new THREE.ArrowHelper(dir, from, len, 0xef4444, 0.02, 0.01);
  scene.add(arrow);
  lines3d.push(arrow);
}

function addLabel3D(pos, text, bg = 'rgba(37,99,235,0.9)') {
  const div = document.createElement('div');
  div.style.cssText = `background:${bg};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap;`;
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.copy(pos);
  scene.add(label);
  labels3d.push(label);
}

// ==================== CLEAR / REBUILD VISUALS ====================
function clearAllVisuals() {
  markers3d.forEach(m => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
  lines3d.forEach(l => { scene.remove(l); if (l.geometry) l.geometry.dispose(); if (l.material) l.material.dispose(); });
  labels3d.forEach(l => scene.remove(l));
  markers3d = []; lines3d = []; labels3d = [];
  tool3dPoints = [];
}

function rebuildAllVisuals() {
  clearAllVisuals();
  // Rebuild from plan3dItems
  for (const item of plan3dItems) {
    const pts = item.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    pts.forEach(p => addMarker3D(p));

    if (item.type === 'distance') {
      addLine3D(pts[0], pts[1], 0x2563eb);
      addLabel3D(midpoint(pts[0], pts[1]), formatDist(item.value));
    } else if (item.type === 'angle' && pts.length >= 3) {
      addLine3D(pts[0], pts[1], 0x0891b2);
      addLine3D(pts[1], pts[2], 0x0891b2);
      addLabel3D(pts[1], `${item.deg.toFixed(1)}°`);
    } else if (item.type === 'vector') {
      addArrow3D(pts[0], pts[1]);
      addLabel3D(midpoint(pts[0], pts[1]), `→ ${formatDist(item.value)}`);
    } else if (item.type === 'tilt') {
      addLine3D(pts[0], pts[1], 0xf59e0b);
      addLabel3D(midpoint(pts[0], pts[1]), `${item.deg.toFixed(1)}° | ${formatDist(item.value)}`);
    } else if (item.type === 'measure') {
      addLine3D(pts[0], pts[1], 0x14b8a6);
      addLabel3D(midpoint(pts[0], pts[1]), formatDist(item.value));
    }
  }

  // Before snapshot overlay
  if (show3dBefore && before3dSnapshot) {
    for (const item of before3dSnapshot.items) {
      const pts = item.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
      pts.forEach(p => addMarker3D(p, 0x94a3b8));
      if (item.type === 'distance' || item.type === 'measure' || item.type === 'tilt') {
        addLine3D(pts[0], pts[1], 0x94a3b8);
      } else if (item.type === 'vector') {
        addLine3D(pts[0], pts[1], 0x94a3b8);
      } else if (item.type === 'angle' && pts.length >= 3) {
        addLine3D(pts[0], pts[1], 0x94a3b8);
        addLine3D(pts[1], pts[2], 0x94a3b8);
      }
    }
  }

  render3dPlanList();
}

function clearAll3D() {
  clearAllVisuals();
  plan3dItems = [];
  selected3dPlan = null;
  before3dSnapshot = null;
  show3dBefore = false;
  document.getElementById('before3dBadge').style.display = 'none';
  document.getElementById('btn3dToggleBefore').textContent = 'Показать «До»';
  render3dPlanList();
  compute3dAsymmetry();
  update3dSelectedInfo();
  save3dProject();
  setStatus3d('План очищен.');
}

function undo3D() {
  if (plan3dItems.length === 0) return;
  plan3dItems.pop();
  rebuildAllVisuals();
  save3dProject();
  setStatus3d('Последний элемент удалён.');
}

// ==================== PLAN ITEM MANAGEMENT ====================
function finalizePlanItem(type, label, points, value = null, deg = null) {
  const serPoints = points.map(p => ({ x: p.x, y: p.y, z: p.z }));
  plan3dItems.push({
    id: nextId3d(),
    type,
    label: label || TYPE_NAMES_RU[type] || type,
    points: serPoints,
    value,
    deg
  });
  render3dPlanList();
  compute3dAsymmetry();
  save3dProject();
  setStatus3d('Элемент плана добавлен.');
}

function upsertHeadVolumeItem(stats) {
  const customLabel = document.getElementById('planLabel3d')?.value?.trim();
  let item = plan3dItems.find(x => x.type === 'volume');

  if (!item) {
    item = {
      id: nextId3d(),
      type: 'volume',
      label: customLabel || 'Объём головы',
      points: [],
      value: stats.volumeUnits,
      deg: null
    };
    plan3dItems.push(item);
  }

  item.label = customLabel || item.label || 'Объём головы';
  item.points = [];
  item.value = stats.volumeUnits;
  item.deg = null;
  item.meshCount = stats.meshCount;
  item.triangleCount = stats.triangleCount;
  item.boundaryEdges = stats.boundaryEdges;
  item.nonManifoldEdges = stats.nonManifoldEdges;

  selected3dPlan = item.id;
  render3dPlanList();
  compute3dAsymmetry();
  update3dSelectedInfo();
  save3dProject();
  return item;
}

function measure3dHeadVolume() {
  if (!currentModel) {
    setStatus3d('Сначала загрузите 3D-модель.');
    return;
  }

  const stats = computeModelVolumeStats(currentModel);
  if (!stats || !isFinite(stats.volumeUnits) || stats.volumeUnits <= 0) {
    setStatus3d('Не удалось вычислить объём: у модели нет пригодной геометрии.');
    return;
  }

  const item = upsertHeadVolumeItem(stats);
  const topologyMsg = stats.boundaryEdges === 0 && stats.nonManifoldEdges === 0
    ? 'Сетка замкнута, расчёт выполнен по всей поверхности.'
    : `Есть открытые края (${stats.boundaryEdges}) или неманифолдные рёбра (${stats.nonManifoldEdges}), поэтому результат ориентировочный.`;
  const scaleMsg = scale3dMMperUnit == null ? ' Для перевода в мл выполните калибровку.' : '';
  setStatus3d(`${item.label}: ${formatVolume(item.value)}. ${topologyMsg}${scaleMsg}`);
}

function render3dPlanList() {
  const el = document.getElementById('measurements3d');
  const badge = document.getElementById('plan3dCountBadge');
  if (!el) return;
  if (badge) badge.textContent = String(plan3dItems.length);
  if (plan3dItems.length === 0) {
    el.innerHTML = '<div class="hint">Нет измерений. Выберите инструмент и кликните на модель.</div>';
    return;
  }
  el.innerHTML = plan3dItems.map((m, i) => {
    const val = formatPlan3DValue(m);
    const isSel = selected3dPlan === m.id;
    const selStyle = isSel ? 'outline:2px solid rgba(59,130,246,0.55);' : '';
    const typeName = TYPE_NAMES_RU[m.type] || m.type;
    const showLabel = m.label && m.label !== m.type && m.label !== typeName;
    const meta = formatVolumeQuality(m);
    return `<div style="cursor:pointer;${selStyle}" onclick="window._select3dPlan('${m.id}')">
      <div>
        ${TYPE_ICONS[m.type] || ''} <strong>${typeName} ${i + 1}</strong>
        ${showLabel ? ' • <em>' + escHtml(m.label) + '</em>' : ''}
        : ${val}
      </div>
      ${meta ? '<div class="hint" style="margin-top:4px">' + escHtml(meta) + '</div>' : ''}
      <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); window._delete3dPlan('${m.id}')" style="margin-top:4px;font-size:10px;">Удалить</button>
    </div>`;
  }).join('');
}

// Global handlers for onclick in rendered HTML
window._select3dPlan = function (id) {
  selected3dPlan = id;
  update3dSelectedInfo();
  render3dPlanList();
};
window._delete3dPlan = function (id) {
  plan3dItems = plan3dItems.filter(x => x.id !== id);
  if (selected3dPlan === id) selected3dPlan = null;
  rebuildAllVisuals();
  compute3dAsymmetry();
  update3dSelectedInfo();
  save3dProject();
};

function update3dSelectedInfo() {
  const el = document.getElementById('selectedItem3dInfo');
  if (!el) return;
  if (!selected3dPlan) { el.textContent = '—'; return; }
  const it = plan3dItems.find(x => x.id === selected3dPlan);
  if (!it) { el.textContent = '—'; return; }
  const valTxt = formatPlan3DValue(it);
  const metaTxt = formatVolumeQuality(it);
  el.textContent = `${it.label} (${TYPE_NAMES_RU[it.type] || it.type})${valTxt ? ' • ' + valTxt : ''}${metaTxt ? ' • ' + metaTxt : ''}`;
}

// ==================== ASYMMETRY (R vs L) ====================
function compute3dAsymmetry() {
  const box = document.getElementById('asymmetry3dBox');
  if (!box) return;

  function normLabel(lbl) {
    return String(lbl || '').replace(/\s*\((R|L)\)\s*$/i, '').replace(/\s*•\s*(R|L)\s*$/i, '').trim();
  }
  function sideFromLabel(lbl) {
    const s = String(lbl || '');
    if (/\(R\)/i.test(s)) return 'R';
    if (/\(L\)/i.test(s)) return 'L';
    return null;
  }

  const pairs = {};
  for (const it of plan3dItems) {
    const side = sideFromLabel(it.label);
    if (!side) continue;
    const key = it.type + '::' + normLabel(it.label);
    pairs[key] = pairs[key] || {};
    pairs[key][side] = it;
  }

  const lines = [];
  for (const key of Object.keys(pairs)) {
    const p = pairs[key];
    if (!p.R || !p.L) continue;
    const name = key.split('::')[1] || '—';
    const parts = [];
    if (p.R.value != null && p.L.value != null) {
      const rmm = mmFromUnit(p.R.value);
      const lmm = mmFromUnit(p.L.value);
      if (rmm != null && lmm != null) {
        parts.push(`Δдлина ${Math.abs(rmm - lmm).toFixed(2)} мм`);
      } else {
        parts.push(`Δдлина ${Math.abs(p.R.value - p.L.value).toFixed(4)} ед.`);
      }
    }
    if (p.R.deg != null && p.L.deg != null) {
      parts.push(`Δугол ${Math.abs(p.R.deg - p.L.deg).toFixed(1)}°`);
    }
    if (parts.length) lines.push(`<div>• <b>${escHtml(name)}</b>: ${parts.join(' • ')}</div>`);
  }

  box.innerHTML = lines.length ? lines.join('') : '— (для расчёта нужны пары R/L элементов)';
}

// ==================== BEFORE / AFTER ====================
function snapshot3dBefore() {
  before3dSnapshot = {
    ts: Date.now(),
    items: JSON.parse(JSON.stringify(plan3dItems))
  };
  show3dBefore = false;
  document.getElementById('before3dBadge').style.display = 'none';
  document.getElementById('btn3dToggleBefore').textContent = 'Показать «До»';
  save3dProject();
  setStatus3d('Снимок «До» сохранён.');
}

function toggle3dBefore() {
  if (!before3dSnapshot) { setStatus3d('Сначала нажмите «Сохранить До».'); return; }
  show3dBefore = !show3dBefore;
  document.getElementById('before3dBadge').style.display = show3dBefore ? 'inline-flex' : 'none';
  document.getElementById('btn3dToggleBefore').textContent = show3dBefore ? 'Скрыть «До»' : 'Показать «До»';
  rebuildAllVisuals();
  setStatus3d(show3dBefore ? 'Показ «До» включен (серые линии).' : 'Показ «До» выключен.');
}

function reset3dToBefore() {
  if (!before3dSnapshot) { setStatus3d('Нет снимка «До».'); return; }
  plan3dItems = JSON.parse(JSON.stringify(before3dSnapshot.items));
  selected3dPlan = null;
  show3dBefore = false;
  document.getElementById('before3dBadge').style.display = 'none';
  document.getElementById('btn3dToggleBefore').textContent = 'Показать «До»';
  rebuildAllVisuals();
  compute3dAsymmetry();
  update3dSelectedInfo();
  save3dProject();
  setStatus3d('Откат выполнен к состоянию «До».');
}

// ==================== SHIFT PLANNING ====================
function apply3dShift() {
  if (!selected3dPlan) { setStatus3d('Сначала выберите элемент плана.'); return; }
  const v = parseFloat(document.getElementById('plannedShift3dMM')?.value);
  if (!isFinite(v) || v <= 0) { setStatus3d('Введите смещение в мм (например 6.0).'); return; }
  if (scale3dMMperUnit == null) { setStatus3d('Сначала выполните калибровку.'); return; }

  const it = plan3dItems.find(x => x.id === selected3dPlan);
  if (!it || it.points.length < 2) { setStatus3d('Элемент не найден или не имеет 2 точек.'); return; }
  if (it.type === 'angle' || it.type === 'point') { setStatus3d('Смещение применяется к вектору/линии/измерению.'); return; }

  const p1 = new THREE.Vector3(it.points[0].x, it.points[0].y, it.points[0].z);
  const p2 = new THREE.Vector3(it.points[1].x, it.points[1].y, it.points[1].z);
  const dir = new THREE.Vector3().subVectors(p2, p1);
  let curLen = dir.length();
  if (curLen < 1e-6) { dir.set(0, 1, 0); curLen = 1; }
  dir.normalize();

  const targetUnits = v / scale3dMMperUnit;
  const newP2 = p1.clone().add(dir.multiplyScalar(targetUnits));
  it.points[1] = { x: newP2.x, y: newP2.y, z: newP2.z };
  it.value = targetUnits;

  if (it.type === 'tilt') {
    const dx = newP2.x - p1.x;
    const dy = newP2.y - p1.y;
    const dz = newP2.z - p1.z;
    it.deg = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
  }

  rebuildAllVisuals();
  update3dSelectedInfo();
  save3dProject();
  setStatus3d(`Смещение применено: ${v.toFixed(2)} мм.`);
}

// ==================== EXPORT ====================
async function export3dPDF() {
  try {
    setStatus3d('Генерация PDF...');
    const { jsPDF } = window.jspdf;

    const patient = document.getElementById('patientName3d')?.value || '—';
    const date = document.getElementById('examDate3d')?.value || '—';
    const procedure = document.getElementById('procedure3d')?.value || '—';
    const goal = document.getElementById('goal3d')?.value || '—';
    const notes = document.getElementById('notes3d')?.value || '';

    const canvas3d = renderer.domElement;
    const screenDataUrl = canvas3d.toDataURL('image/png');

    // Build beautiful report HTML
    const reportDiv = document.createElement('div');
    reportDiv.style.cssText = 'position:fixed;top:0;left:0;width:800px;background:#fff;color:#1e293b;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;z-index:99999;';

    let html = '';
    // Header bar
    html += `<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:24px 30px;border-radius:0 0 12px 12px;">`;
    html += `<div style="font-size:24px;font-weight:700;letter-spacing:0.5px;">PMAS — 3D Клинический протокол</div>`;
    html += `<div style="margin-top:6px;font-size:13px;opacity:0.85;">Планирование медицинских и эстетических процедур</div>`;
    html += `</div>`;

    // Patient info cards
    html += `<div style="padding:20px 30px 0;">`;
    html += `<div style="display:flex;gap:12px;flex-wrap:wrap;">`;
    const infoItems = [
      ['Пациент', patient], ['Дата обследования', date],
      ['Процедура', procedure], ['Цель', goal]
    ];
    for (const [lbl, val] of infoItems) {
      html += `<div style="flex:1;min-width:170px;background:#f1f5f9;border-radius:8px;padding:12px 16px;border-left:3px solid #3b82f6;">`;
      html += `<div style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:600;letter-spacing:0.5px;">${lbl}</div>`;
      html += `<div style="font-size:14px;font-weight:600;margin-top:4px;">${escHtml(val)}</div>`;
      html += `</div>`;
    }
    html += `</div></div>`;

    // 3D screenshot
    html += `<div style="padding:16px 30px;">`;
    html += `<div style="background:#0f172a;border-radius:10px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,0.15);">`;
    html += `<img src="${screenDataUrl}" style="width:100%;border-radius:6px;display:block;">`;
    html += `</div></div>`;

    // Measurements section
    if (plan3dItems.length > 0) {
      html += `<div style="padding:0 30px 12px;">`;
      html += `<div style="font-size:16px;font-weight:700;color:#1e40af;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #dbeafe;">📊 Измерения и разметка</div>`;
      html += `<table style="width:100%;border-collapse:collapse;font-size:13px;">`;
      html += `<tr style="background:#f1f5f9;"><th style="text-align:left;padding:8px 10px;font-weight:600;color:#475569;">№</th><th style="text-align:left;padding:8px 10px;font-weight:600;color:#475569;">Тип</th><th style="text-align:left;padding:8px 10px;font-weight:600;color:#475569;">Метка</th><th style="text-align:right;padding:8px 10px;font-weight:600;color:#475569;">Значение</th></tr>`;
      plan3dItems.forEach((item, i) => {
        const val = formatPlan3DValue(item);
        const typeName = TYPE_NAMES_RU[item.type] || item.type;
        const icon = TYPE_ICONS[item.type] || '';
        const label = (item.label && item.label !== item.type && item.label !== typeName) ? item.label : '—';
        const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
        html += `<tr style="background:${bg};border-bottom:1px solid #e2e8f0;">`;
        html += `<td style="padding:7px 10px;color:#94a3b8;">${i + 1}</td>`;
        html += `<td style="padding:7px 10px;">${icon} ${typeName}</td>`;
        html += `<td style="padding:7px 10px;color:#475569;">${escHtml(label)}</td>`;
        html += `<td style="padding:7px 10px;text-align:right;font-weight:600;color:#1e40af;">${val}</td>`;
        html += `</tr>`;
      });
      html += `</table></div>`;
    }

    // Notes
    if (notes) {
      html += `<div style="padding:0 30px 12px;">`;
      html += `<div style="font-size:16px;font-weight:700;color:#1e40af;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #dbeafe;">📝 Заметки</div>`;
      html += `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 6px 6px 0;font-size:13px;color:#78350f;white-space:pre-wrap;">${escHtml(notes)}</div>`;
      html += `</div>`;
    }

    // Footer
    html += `<div style="padding:12px 30px;text-align:center;color:#94a3b8;font-size:10px;border-top:1px solid #e2e8f0;margin-top:8px;">`;
    html += `PMAS v1.0 • Масштаб: ${scale3dMMperUnit != null ? scale3dMMperUnit.toFixed(2) + ' мм/ед.' : 'авто'} • Сформировано: ${new Date().toLocaleDateString('ru-RU')}`;
    html += `</div>`;

    reportDiv.innerHTML = html;
    document.body.appendChild(reportDiv);

    const capture = await html2canvas(reportDiv, { scale: 2, useCORS: true });
    document.body.removeChild(reportDiv);

    const imgData = capture.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const imgW = pageW;
    const imgH = (capture.height / capture.width) * imgW;
    // Multi-page if needed
    if (imgH <= 297) {
      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
    } else {
      let yOffset = 0;
      while (yOffset < imgH) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -yOffset, imgW, imgH);
        yOffset += 297;
      }
    }

    pdf.save('PMAS_3D_Report.pdf');
    setStatus3d('PDF экспортирован.');
  } catch (err) {
    console.error(err);
    setStatus3d('Ошибка экспорта PDF: ' + (err?.message || err));
  }
}

async function export3dDOCX() {
  try {
    if (!window.docx) { alert('Библиотека docx не загрузилась.'); return; }
    setStatus3d('Генерация DOCX...');
    const D = window.docx;
    const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel,
            Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
            ShadingType, TableLayoutType } = D;

    const patient = document.getElementById('patientName3d')?.value || '—';
    const date = document.getElementById('examDate3d')?.value || '—';
    const procedure = document.getElementById('procedure3d')?.value || '—';
    const goal = document.getElementById('goal3d')?.value || '—';
    const notes = document.getElementById('notes3d')?.value || '—';

    // Capture 3D screenshot
    const canvas3d = renderer.domElement;
    const dataUrl = canvas3d.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const imgW = 520;
    const imgH = Math.round((canvas3d.height / canvas3d.width) * imgW);

    const blueBorder = { style: BorderStyle.SINGLE, size: 1, color: '3B82F6' };
    const noBorder = { style: BorderStyle.NONE, size: 0 };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

    // Helper: info cell pair (label + value)
    function infoCell(label, value) {
      return new TableCell({
        borders: noBorders,
        shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [
          new Paragraph({ spacing: { after: 40 }, children: [
            new TextRun({ text: label, size: 16, color: '64748B', bold: true, font: 'Segoe UI' })
          ] }),
          new Paragraph({ children: [
            new TextRun({ text: value, size: 22, color: '1E293B', font: 'Segoe UI' })
          ] })
        ]
      });
    }

    const children = [];

    // Title
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: 'PMAS — 3D Клинический протокол', size: 36, bold: true, color: '1E40AF', font: 'Segoe UI' })
      ]
    }));
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: 'Планирование медицинских и эстетических процедур', size: 20, color: '64748B', font: 'Segoe UI' })
      ]
    }));

    // Patient info as 2x2 table
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType ? TableLayoutType.FIXED : undefined,
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' }, insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' } },
      rows: [
        new TableRow({ children: [infoCell('ПАЦИЕНТ', patient), infoCell('ДАТА ОБСЛЕДОВАНИЯ', date)] }),
        new TableRow({ children: [infoCell('ПРОЦЕДУРА', procedure), infoCell('ЦЕЛЬ', goal)] }),
      ]
    }));
    children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));

    // 3D screenshot
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ data: imgBytes, transformation: { width: imgW, height: imgH }, type: 'png' })]
    }));
    children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));

    // Measurements table
    if (plan3dItems.length > 0) {
      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: '📊  Измерения и разметка', size: 28, bold: true, color: '1E40AF', font: 'Segoe UI' })]
      }));

      // Table header
      const headerShading = { type: ShadingType.CLEAR, fill: '1E40AF' };
      const headerBorders = { top: blueBorder, bottom: blueBorder, left: blueBorder, right: blueBorder };
      function hCell(text, w) {
        return new TableCell({
          width: { size: w, type: WidthType.PERCENTAGE },
          shading: headerShading,
          borders: headerBorders,
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          children: [new Paragraph({ children: [new TextRun({ text, size: 20, bold: true, color: 'FFFFFF', font: 'Segoe UI' })] })]
        });
      }

      const dataRows = plan3dItems.map((item, i) => {
        const val = formatPlan3DValue(item);
        const typeName = TYPE_NAMES_RU[item.type] || item.type;
        const icon = TYPE_ICONS[item.type] || '';
        const label = (item.label && item.label !== item.type && item.label !== typeName) ? item.label : '—';
        const rowFill = i % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
        const cellBorders = { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' }, left: noBorder, right: noBorder };
        const cellMargins = { top: 40, bottom: 40, left: 80, right: 80 };
        function dCell(children, w) {
          return new TableCell({
            width: { size: w, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: rowFill },
            borders: cellBorders,
            margins: cellMargins,
            children: [new Paragraph({ children })]
          });
        }
        return new TableRow({ children: [
          dCell([new TextRun({ text: `${i + 1}`, size: 20, color: '94A3B8', font: 'Segoe UI' })], 8),
          dCell([new TextRun({ text: `${icon} ${typeName}`, size: 20, font: 'Segoe UI' })], 25),
          dCell([new TextRun({ text: label, size: 20, color: '475569', font: 'Segoe UI' })], 37),
          dCell([new TextRun({ text: val, size: 20, bold: true, color: '1E40AF', font: 'Segoe UI' })], 30),
        ] });
      });

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [hCell('№', 8), hCell('Тип', 25), hCell('Метка', 37), hCell('Значение', 30)] }),
          ...dataRows
        ]
      }));
      children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
    }

    // Notes
    if (notes && notes !== '—') {
      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: '📝  Заметки', size: 28, bold: true, color: '1E40AF', font: 'Segoe UI' })]
      }));
      children.push(new Paragraph({
        spacing: { after: 200 },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'F59E0B', space: 8 } },
        children: [new TextRun({ text: notes, size: 22, color: '78350F', font: 'Segoe UI' })]
      }));
    }

    // Footer
    children.push(new Paragraph({
      spacing: { before: 200 },
      border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0', space: 8 } },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `PMAS v1.0  •  Масштаб: ${scale3dMMperUnit != null ? scale3dMMperUnit.toFixed(2) + ' мм/ед.' : 'авто'}  •  ${new Date().toLocaleDateString('ru-RU')}`, size: 16, color: '94A3B8', font: 'Segoe UI' })
      ]
    }));

    const doc = new Document({ sections: [{ children }] });

    const blob = await Packer.toBlob(doc);
    const fname = `PMAS_3D_Protocol_${patient.replace(/[^a-zA-Z0-9а-яА-Я _-]+/g, '') || 'Patient'}.docx`;
    if (window.saveAs) {
      window.saveAs(blob, fname);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    setStatus3d('DOCX экспортирован.');
  } catch (err) {
    console.error(err);
    setStatus3d('Ошибка экспорта DOCX: ' + (err?.message || err));
  }
}

// ==================== PERSISTENCE (localStorage) ====================
const LS_KEY_3D = 'pmas_3d_project_v1';

function save3dProject() {
  try {
    const payload = {
      patient: document.getElementById('patientName3d')?.value || '',
      date: document.getElementById('examDate3d')?.value || '',
      procedure: document.getElementById('procedure3d')?.value || '',
      goal: document.getElementById('goal3d')?.value || '',
      notes: document.getElementById('notes3d')?.value || '',
      plan3dItems,
      scale3dMMperUnit,
      before3dSnapshot,
      show3dBefore
    };
    localStorage.setItem(LS_KEY_3D, JSON.stringify(payload));
  } catch (e) { /* ignore */ }
}

function load3dProject() {
  try {
    const raw = localStorage.getItem(LS_KEY_3D);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.patient) document.getElementById('patientName3d').value = data.patient;
    if (data.date) document.getElementById('examDate3d').value = data.date;
    if (data.procedure) document.getElementById('procedure3d').value = data.procedure;
    if (data.goal) document.getElementById('goal3d').value = data.goal;
    if (data.notes) document.getElementById('notes3d').value = data.notes;
    if (Array.isArray(data.plan3dItems)) plan3dItems = data.plan3dItems;
    if (typeof data.scale3dMMperUnit === 'number') scale3dMMperUnit = data.scale3dMMperUnit;
    before3dSnapshot = data.before3dSnapshot || null;
    show3dBefore = !!data.show3dBefore;
    updateScaleBadge();
    // Visuals will be rebuilt once model loads
    setTimeout(() => { rebuildAllVisuals(); compute3dAsymmetry(); update3dSelectedInfo(); }, 500);
  } catch (e) { /* ignore */ }
}

// ==================== UI BINDINGS ====================
function updateBtn3DStates() {
  document.getElementById('btnWireframe')?.classList.toggle('btn-active', wireframeMode);
  document.getElementById('btnNormals')?.classList.toggle('btn-active', normalsMode);

  const toolBtns = ['btn3dPoint', 'btn3dDistance', 'btn3dAngle', 'btn3dVector', 'btn3dTilt', 'btn3dMeasure', 'btn3dCalibrate'];
  toolBtns.forEach(id => document.getElementById(id)?.classList.remove('btn-active'));

  if (tool3dMode) {
    const map = {
      point: 'btn3dPoint', distance: 'btn3dDistance', angle: 'btn3dAngle',
      vector: 'btn3dVector', tilt: 'btn3dTilt', measure: 'btn3dMeasure',
      calibration: 'btn3dCalibrate'
    };
    document.getElementById(map[tool3dMode])?.classList.add('btn-active');
  }
}

function setTool3D(mode) {
  tool3dMode = tool3dMode === mode ? null : mode;
  tool3dPoints = [];
  calibrationPoints = [];
  updateBtn3DStates();

  const msgs = {
    point: 'Точка: кликните на модель.',
    distance: 'Расстояние: выберите 2 точки.',
    angle: 'Угол: выберите 3 точки (A → B(вершина) → C).',
    vector: 'Вектор: выберите 2 точки (откуда → куда).',
    tilt: 'Наклон: выберите 2 точки.',
    measure: 'Измерение: выберите 2 точки.',
    calibration: 'Калибровка: выберите 2 точки на модели.'
  };
  if (tool3dMode) setStatus3d(msgs[tool3dMode] || '');
}

function bindUI3D() {
  // Model controls
  document.getElementById('modelSelect').addEventListener('change', e => {
    document.getElementById('fileInput3d').value = '';
    loadModel3D(e.target.value);
  });
  document.getElementById('fileInput3d').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    loadModel3D(URL.createObjectURL(f));
  });
  document.getElementById('btnDeleteModel').addEventListener('click', () => {
    removeModel3D();
    currentModel = null;
    setStatus3d('Модель удалена. Выберите новую модель или загрузите файл.');
  });

  // Visual modes
  document.getElementById('btnWireframe').addEventListener('click', () => {
    wireframeMode = !wireframeMode; updateBtn3DStates();
    if (currentModel) applyVisualMode3D(currentModel);
  });
  document.getElementById('btnNormals').addEventListener('click', () => {
    normalsMode = !normalsMode; updateBtn3DStates();
    if (currentModel) applyVisualMode3D(currentModel);
  });
  document.getElementById('btnResetView').addEventListener('click', () => {
    wireframeMode = false; normalsMode = false; updateBtn3DStates();
    if (currentModel) { applyVisualMode3D(currentModel); fitCamera3D(currentModel); }
  });

  // Lights
  document.getElementById('btnLight1').addEventListener('click', setupLight1);
  document.getElementById('btnLight2').addEventListener('click', setupLight2);
  document.getElementById('btnLight3').addEventListener('click', setupLight3);

  // Clinical tools
  document.getElementById('btn3dPoint').addEventListener('click', () => setTool3D('point'));
  document.getElementById('btn3dDistance').addEventListener('click', () => setTool3D('distance'));
  document.getElementById('btn3dAngle').addEventListener('click', () => setTool3D('angle'));
  document.getElementById('btn3dVector').addEventListener('click', () => setTool3D('vector'));
  document.getElementById('btn3dTilt').addEventListener('click', () => setTool3D('tilt'));
  document.getElementById('btn3dMeasure').addEventListener('click', () => setTool3D('measure'));
  document.getElementById('btn3dCalibrate').addEventListener('click', () => setTool3D('calibration'));
  document.getElementById('btn3dHeadVolume').addEventListener('click', measure3dHeadVolume);

  // Plan controls
  document.getElementById('btn3dClearAll').addEventListener('click', clearAll3D);
  document.getElementById('btn3dUndo').addEventListener('click', undo3D);

  // Before/After
  document.getElementById('btn3dSnapshotBefore').addEventListener('click', snapshot3dBefore);
  document.getElementById('btn3dToggleBefore').addEventListener('click', toggle3dBefore);
  document.getElementById('btn3dResetToBefore').addEventListener('click', reset3dToBefore);

  // Shift
  document.getElementById('btn3dApplyShift').addEventListener('click', apply3dShift);

  // Export
  document.getElementById('btn3dPDF').addEventListener('click', export3dPDF);
  document.getElementById('btn3dDOCX').addEventListener('click', export3dDOCX);

  // Auto-save on input changes
  ['patientName3d', 'examDate3d', 'procedure3d', 'goal3d', 'notes3d'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', save3dProject);
  });
}

// Add active button style
const style = document.createElement('style');
style.textContent = '.btn-active { background: var(--primary) !important; color: #fff !important; border-color: var(--primary) !important; }';
document.head.appendChild(style);

// Init measurements list
render3dPlanList();

// Expose internals for programmatic annotation placement
window._3d = {
  get scene() { return scene; },
  get camera() { return camera; },
  get currentModel() { return currentModel; },
  get raycaster() { return raycaster; },
  get mouse() { return mouse; },
  setTool: setTool3D,
  addMarker: addMarker3D,
  addLine: addLine3D,
  addArrow: addArrow3D,
  addLabel: addLabel3D,
  finalize: finalizePlanItem,
  dist: dist3d,
  midpoint: midpoint,
  angle: computeAngle3,
  formatDist: formatDist,
  clearAll: clearAll3D,
  rebuild: rebuildAllVisuals,
  measureHeadVolume: measure3dHeadVolume,
  raycastAt(cx, cy) {
    const container = document.getElementById('canvas3d-container');
    const rect = container.getBoundingClientRect();
    mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const meshes = [];
    currentModel.traverse(c => { if (c.isMesh) meshes.push(c); });
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length > 0 ? hits[0].point.clone() : null;
  }
};
