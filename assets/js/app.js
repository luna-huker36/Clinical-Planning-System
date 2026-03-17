// ===== PMAS App — Tabs + 3D Scene + Full 3D Clinical Tools =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

// ==================== TAB NAVIGATION ====================
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const tabNav = document.getElementById('tabNav');
let scene3dInitialized = false;
const TYPE_NAMES_RU = { point: 'Точка', distance: 'Расстояние', angle: 'Угол', vector: 'Вектор', tilt: 'Наклон', measure: 'Измерение', volume: 'Объём' };
const TYPE_ICONS = { point: '📍', distance: '📏', angle: '📐', vector: '➡️', tilt: '📊', measure: '📏', volume: '🧊' };

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
// Tools: 'point','distance','angle','vector','tilt','measure','calibration','neckClip'
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

// Neck clip plane for isolating head volume above the neck
let neckClipPlaneY = null;
let neckClipHelper = null;

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

function sortedDimsFromSize(size) {
  return [size.x, size.y, size.z]
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => b - a);
}

function estimateHeadScale(size) {
  const dims = sortedDimsFromSize(size);
  if (dims.length !== 3) return null;

  // Base candidates (powers of 10 cover most standard unit systems)
  let candidates = [0.1, 1, 10, 100, 1000];
  // For very small models (bbox < 2 units), add intermediate scales
  // These cover phone photogrammetry (KIRI etc) which use arbitrary small units
  const maxDim = Math.max(...dims);
  if (maxDim < 2) {
    candidates = [0.1, 1, 10, 100, 200, 333, 500, 1000];
  }
  const target = [240, 190, 160];
  const min = [170, 130, 110];
  const max = [320, 260, 220];
  let best = null;

  for (const scale of candidates) {
    const scaled = dims.map(v => v * scale);
    let score = 0;

    for (let i = 0; i < 3; i += 1) {
      const value = scaled[i];
      score += Math.abs(Math.log(value / target[i]));
      if (value < min[i]) score += ((min[i] - value) / min[i]) * 4;
      if (value > max[i]) score += ((value - max[i]) / max[i]) * 4;
    }

    const volumeMm3 = scaled[0] * scaled[1] * scaled[2];
    if (volumeMm3 < 2.5e6 || volumeMm3 > 18e6) score += 1.5;

    if (!best || score < best.score) {
      best = { scale, score, dimsMM: scaled };
    }
  }

  if (!best || best.score > 3.2) return null;
  return best;
}

function getCurrentModelBounds() {
  if (!currentModel) return null;
  return new THREE.Box3().setFromObject(currentModel);
}

function getNeckClipSummary() {
  if (!currentModel || !Number.isFinite(neckClipPlaneY)) return null;
  const box = getCurrentModelBounds();
  if (!box) return null;
  const offsetUnits = Math.max(0, neckClipPlaneY - box.min.y);
  const totalUnits = Math.max(0, box.max.y - box.min.y);
  const offsetMM = mmFromUnit(offsetUnits);
  const totalMM = mmFromUnit(totalUnits);
  return {
    offsetUnits,
    totalUnits,
    offsetMM,
    totalMM
  };
}

function applyNeckClipUI() {
  const badge = document.getElementById('neckClipBadge');
  const info = document.getElementById('neckClipInfo');
  if (!badge || !info) return;

  const summary = getNeckClipSummary();
  if (!summary) {
    badge.className = 'badge';
    badge.textContent = 'Выкл';
    info.textContent = 'Объём считается по всей модели.';
    return;
  }

  badge.className = 'badge badge-info';
  badge.textContent = 'Активно';
  const offsetText = summary.offsetMM != null
    ? `${summary.offsetMM.toFixed(1)} мм`
    : `${summary.offsetUnits.toFixed(3)} ед.`;
  const totalText = summary.totalMM != null
    ? `${summary.totalMM.toFixed(1)} мм`
    : `${summary.totalUnits.toFixed(3)} ед.`;
  info.textContent = `Объём считается выше плоскости шеи: ${offsetText} от нижней границы модели из ${totalText}.`;
}

function removeNeckClipHelper() {
  if (!neckClipHelper) return;
  scene?.remove(neckClipHelper);
  neckClipHelper.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(mat => mat.dispose());
    }
  });
  neckClipHelper = null;
}

function updateNeckClipHelper() {
  removeNeckClipHelper();
  if (!scene || !currentModel || !Number.isFinite(neckClipPlaneY)) {
    applyNeckClipUI();
    return;
  }

  const box = getCurrentModelBounds();
  if (!box || !isFinite(box.min.x) || !isFinite(box.max.x)) {
    applyNeckClipUI();
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const planeWidth = Math.max(size.x * 1.08, size.z * 1.08, 0.05);
  const planeDepth = Math.max(size.z * 1.08, size.x * 1.08, 0.05);
  const planeGeo = new THREE.PlaneGeometry(planeWidth, planeDepth);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const planeMesh = new THREE.Mesh(planeGeo, planeMat);
  planeMesh.rotation.x = -Math.PI / 2;
  planeMesh.position.set(center.x, neckClipPlaneY, center.z);
  planeMesh.renderOrder = 10;

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(planeGeo),
    new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85 })
  );
  outline.rotation.copy(planeMesh.rotation);
  outline.position.copy(planeMesh.position);
  outline.renderOrder = 11;

  neckClipHelper = new THREE.Group();
  neckClipHelper.add(planeMesh);
  neckClipHelper.add(outline);
  scene.add(neckClipHelper);
  applyNeckClipUI();
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
  const a = new THREE.AmbientLight(0xffffff, 0.8);
  const top = new THREE.DirectionalLight(0xffffff, 1.5); top.position.set(0, 5, 0);
  const bot = new THREE.DirectionalLight(0xffffff, 0.4); bot.position.set(0, -5, 0);
  const front = new THREE.DirectionalLight(0xffffff, 1.2); front.position.set(0, 0, 5);
  const back = new THREE.DirectionalLight(0xffffff, 0.5); back.position.set(0, 0, -5);
  const left = new THREE.DirectionalLight(0xccddff, 0.8); left.position.set(-5, 2, 2);
  const right = new THREE.DirectionalLight(0xffddcc, 0.8); right.position.set(5, 2, 2);
  lights.push(a, top, bot, front, back, left, right); lights.forEach(l => scene.add(l));
}
function setupLight2() {
  clearLights();
  const a = new THREE.AmbientLight(0xffffff, 0.6);
  const key = new THREE.SpotLight(0xffeedd, 4, 20, Math.PI / 4); key.position.set(3, 4, 3);
  const fill = new THREE.DirectionalLight(0x8888ff, 0.8); fill.position.set(-3, 1, -2);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(0, 0, -5);
  const bot = new THREE.DirectionalLight(0xffffff, 0.3); bot.position.set(0, -3, 2);
  lights.push(a, key, fill, rim, bot); lights.forEach(l => scene.add(l));
}
function setupLight3() {
  clearLights();
  const a = new THREE.AmbientLight(0xffffff, 0.7);
  const top = new THREE.DirectionalLight(0xffffff, 1.2); top.position.set(0, 5, 0);
  const bot = new THREE.DirectionalLight(0xffffff, 0.4); bot.position.set(0, -5, 0);
  const front = new THREE.DirectionalLight(0xffffff, 1.0); front.position.set(0, 0, 5);
  const back = new THREE.DirectionalLight(0xffffff, 0.5); back.position.set(0, 0, -5);
  const left = new THREE.DirectionalLight(0xccddff, 0.8); left.position.set(-4, 2, 2);
  const right = new THREE.DirectionalLight(0xffddcc, 0.8); right.position.set(4, 2, 2);
  lights.push(a, top, bot, front, back, left, right); lights.forEach(x => scene.add(x));
}

// ==================== MODEL ====================
function removeModel3D() {
  removeNeckClipHelper();
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

function autoDetectScale(size, prefix) {
  const dims = sortedDimsFromSize(size);
  const maxDim = dims[0] || 0;
  const headEstimate = estimateHeadScale(size);

  if (headEstimate) {
    scale3dMMperUnit = headEstimate.scale;
    updateScaleBadge();
    invalidateVolumeMeasurement();
    const dimsText = headEstimate.dimsMM.map(v => Math.round(v)).join('×');
    setStatus3d(`${prefix} Автокалибровка головы: 1 ед. = ${headEstimate.scale.toFixed(2)} мм (${dimsText} мм).`);
    return;
  }

  // Fallback for non-head models when bbox does not resemble a head scan.
  if (maxDim > 0.05 && maxDim < 1.0) {
    scale3dMMperUnit = 1000;
    updateScaleBadge();
    invalidateVolumeMeasurement();
    setStatus3d(`${prefix} Авто-масштаб: 1 ед. = 1000 мм (метры).`);
  } else if (maxDim >= 1.0 && maxDim < 50) {
    scale3dMMperUnit = 10;
    updateScaleBadge();
    invalidateVolumeMeasurement();
    setStatus3d(`${prefix} Авто-масштаб: 1 ед. = 10 мм (сантиметры).`);
  } else if (maxDim >= 50 && maxDim <= 1000) {
    scale3dMMperUnit = 1;
    updateScaleBadge();
    invalidateVolumeMeasurement();
    setStatus3d(`${prefix} Авто-масштаб: 1 ед. = 1 мм.`);
  } else {
    scale3dMMperUnit = null;
    updateScaleBadge();
    invalidateVolumeMeasurement();
    setStatus3d(`${prefix} Не удалось надёжно оценить масштаб. Калибруйте вручную в мм.`);
  }
}

function loadModel3D(url) {
  clearNeckClip({ silent: true });
  removeModel3D();
  const loadEl = document.getElementById('loading3d');
  loadEl.classList.add('visible');
  wireframeMode = false; normalsMode = false;
  updateBtn3DStates();

  const finishLoad = (model) => {
    model.traverse(c => { if (c.isMesh) c.userData.originalMaterial = c.material.clone(); });
    scene.add(model);
    currentModel = model;
    fitCamera3D(model);
    loadEl.classList.remove('visible');

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    autoDetectScale(size, 'Модель загружена.');
    updateNeckClipHelper();
  };

  const onError = (err) => {
    loadEl.classList.remove('visible');
    console.error('Model load error:', err);
  };

  if (url.toLowerCase().endsWith('.obj')) {
    // OBJ format: use OBJLoader
    const objLoader = new OBJLoader();
    const basePath = url.substring(0, url.lastIndexOf('/') + 1);
    const mtlUrl = url.replace(/\.obj$/i, '.obj.mtl');
    // Try loading MTL first
    const mtlLoader = new MTLLoader();
    mtlLoader.setPath(basePath);
    const mtlFile = mtlUrl.substring(mtlUrl.lastIndexOf('/') + 1);
    mtlLoader.load(mtlFile, (materials) => {
      materials.preload();
      objLoader.setMaterials(materials);
      objLoader.setPath(basePath);
      objLoader.load(url.substring(url.lastIndexOf('/') + 1), (model) => {
        // Apply texture if available
        const texLoader = new THREE.TextureLoader();
        const texUrl = basePath + 'texture_0.png';
        texLoader.load(texUrl, (tex) => {
          tex.flipY = false;
          tex.colorSpace = THREE.SRGBColorSpace;
          model.traverse(c => {
            if (c.isMesh) {
              c.material = new THREE.MeshStandardMaterial({
                map: tex, roughness: 0.7, metalness: 0.0
              });
            }
          });
          finishLoad(model);
        }, null, () => finishLoad(model));
      }, null, onError);
    }, null, () => {
      // No MTL — load OBJ directly
      objLoader.load(url, finishLoad, null, onError);
    });
  } else {
    // GLB/GLTF format
    loader.load(url, gltf => finishLoad(gltf.scene), null, onError);
  }
}

function loadOBJModel(objFile, mtlFile, allFiles) {
  clearNeckClip({ silent: true });
  removeModel3D();
  const loadEl = document.getElementById('loading3d');
  loadEl.classList.add('visible');
  wireframeMode = false; normalsMode = false;
  updateBtn3DStates();

  // Collect image files as blob URLs by filename
  const imageFiles = Array.from(allFiles).filter(f => /\.(png|jpg|jpeg)$/i.test(f.name));
  const texBlobUrls = new Map();
  imageFiles.forEach(f => texBlobUrls.set(f.name, URL.createObjectURL(f)));

  const objReader = new FileReader();
  objReader.onload = (ev) => {
    const objText = ev.target.result;
    const objLoader = new OBJLoader();
    const model = objLoader.parse(objText);

    // Apply textures and proper material to all meshes
    const texLoader = new THREE.TextureLoader();
    const texFile = imageFiles.find(f => /tex/i.test(f.name)) || imageFiles[0];
    const normFile = imageFiles.find(f => /norm/i.test(f.name));
    const aoFile = imageFiles.find(f => /ao/i.test(f.name));

    let loadedTex = null, loadedNorm = null, loadedAO = null;
    let pending = 0;

    const onAllLoaded = () => {
      model.traverse(c => {
        if (!c.isMesh) return;
        // Use MeshStandardMaterial for proper lighting
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.7,
          metalness: 0.0,
          side: THREE.DoubleSide,
        });
        if (loadedTex) { mat.map = loadedTex; }
        if (loadedNorm) { mat.normalMap = loadedNorm; }
        if (loadedAO) { mat.aoMap = loadedAO; }
        c.material = mat;
        c.userData.originalMaterial = mat.clone();
      });
      scene.add(model);
      currentModel = model;
      fitCamera3D(model);
      loadEl.classList.remove('visible');

      // Auto-detect scale
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      autoDetectScale(size, 'OBJ загружен.');
      updateNeckClipHelper();
    };

    const tryFinish = () => { if (--pending <= 0) onAllLoaded(); };

    // Load textures
    if (texFile) pending++;
    if (normFile) pending++;
    if (aoFile) pending++;

    if (pending === 0) {
      onAllLoaded();
    } else {
      if (texFile) {
        texLoader.load(texBlobUrls.get(texFile.name), t => { t.flipY = true; t.colorSpace = THREE.SRGBColorSpace; loadedTex = t; tryFinish(); }, undefined, tryFinish);
      }
      if (normFile) {
        texLoader.load(texBlobUrls.get(normFile.name), t => { t.flipY = true; loadedNorm = t; tryFinish(); }, undefined, tryFinish);
      }
      if (aoFile) {
        texLoader.load(texBlobUrls.get(aoFile.name), t => { t.flipY = true; loadedAO = t; tryFinish(); }, undefined, tryFinish);
      }
    }
  };
  objReader.readAsText(objFile);
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

function invalidateVolumeMeasurement() {
  const prevLen = plan3dItems.length;
  plan3dItems = plan3dItems.filter(item => item.type !== 'volume');
  if (selected3dPlan && !plan3dItems.some(item => item.id === selected3dPlan)) {
    selected3dPlan = null;
  }
  if (prevLen !== plan3dItems.length) {
    render3dPlanList();
    update3dSelectedInfo();
    applyVolumeHealthUI(null);
  }
}

function clearNeckClip(options = {}) {
  const { silent = false, keepVolume = false } = options;
  const hadClip = Number.isFinite(neckClipPlaneY);
  neckClipPlaneY = null;
  removeNeckClipHelper();
  applyNeckClipUI();
  if (!keepVolume) invalidateVolumeMeasurement();
  if (hadClip) save3dProject();
  if (!silent && hadClip) setStatus3d('Отсечение по шее отключено.');
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
        applyNeckClipUI();
        invalidateVolumeMeasurement();
        save3dProject();
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

  if (tool3dMode === 'neckClip') {
    neckClipPlaneY = point.y;
    updateNeckClipHelper();
    invalidateVolumeMeasurement();
    save3dProject();
    tool3dMode = null;
    updateBtn3DStates();
    const summary = getNeckClipSummary();
    const cutText = summary
      ? (summary.offsetMM != null
          ? `${summary.offsetMM.toFixed(1)} мм`
          : `${summary.offsetUnits.toFixed(3)} ед.`)
      : point.y.toFixed(3);
    setStatus3d(`Плоскость шеи установлена. Объём будет считаться выше среза (${cutText} от низа модели).`);
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

// ==================== 3D VOLUME ====================
function volumeEdgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function signedTriangleVolume(a, b, c) {
  return a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
}

function mm3FromVolumeUnits(volumeUnits) {
  if (scale3dMMperUnit == null) return null;
  return volumeUnits * Math.pow(scale3dMMperUnit, 3);
}

function formatVolumeUnits(volumeUnits, includeMl = true) {
  const mm3 = mm3FromVolumeUnits(volumeUnits);
  if (mm3 == null) return `${volumeUnits.toFixed(4)} ед³`;
  const cm3 = mm3 / 1000;
  if (cm3 >= 1000) return `${(cm3 / 1000).toFixed(2)} л (${cm3.toFixed(0)} см³)`;
  return includeMl ? `${cm3.toFixed(1)} см³ (${cm3.toFixed(1)} мл)` : `${cm3.toFixed(1)} см³`;
}

function computeLoopNormal(points) {
  const normal = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const n = points[(i + 1) % points.length];
    normal.x += (p.y - n.y) * (p.z + n.z);
    normal.y += (p.z - n.z) * (p.x + n.x);
    normal.z += (p.x - n.x) * (p.y + n.y);
  }
  return normal;
}

function interpolateAtPlaneY(a, b, yCut) {
  const dy = b.y - a.y;
  if (Math.abs(dy) < 1e-9) return a.clone();
  const t = (yCut - a.y) / dy;
  return new THREE.Vector3(
    THREE.MathUtils.lerp(a.x, b.x, t),
    yCut,
    THREE.MathUtils.lerp(a.z, b.z, t)
  );
}

function clipPolygonAbovePlaneY(vertices, yCut) {
  if (!vertices.length) return [];
  const out = [];
  const eps = 1e-7;
  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    const currentInside = current.y >= yCut - eps;
    const nextInside = next.y >= yCut - eps;

    if (currentInside && nextInside) {
      out.push(next.clone());
    } else if (currentInside && !nextInside) {
      out.push(interpolateAtPlaneY(current, next, yCut));
    } else if (!currentInside && nextInside) {
      out.push(interpolateAtPlaneY(current, next, yCut));
      out.push(next.clone());
    }
  }

  if (out.length < 3) return [];
  const cleaned = [];
  for (const point of out) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || prev.distanceToSquared(point) > 1e-12) cleaned.push(point);
  }
  if (cleaned.length >= 2 && cleaned[0].distanceToSquared(cleaned[cleaned.length - 1]) <= 1e-12) {
    cleaned.pop();
  }
  return cleaned.length >= 3 ? cleaned : [];
}

function polygonArea3(vertices) {
  if (vertices.length < 3) return 0;
  const origin = vertices[0];
  let area = 0;
  for (let i = 1; i < vertices.length - 1; i += 1) {
    const ab = new THREE.Vector3().subVectors(vertices[i], origin);
    const ac = new THREE.Vector3().subVectors(vertices[i + 1], origin);
    area += new THREE.Vector3().crossVectors(ab, ac).length() * 0.5;
  }
  return area;
}

function applyNeckClipToTriangles(vertices, triangles, yCut) {
  const clippedVertices = [];
  const clippedTriangles = [];
  const vertexMap = new Map();

  const getVertexId = point => {
    const key = `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)},${Math.round(point.z * 1e5)}`;
    let id = vertexMap.get(key);
    if (id == null) {
      id = clippedVertices.length;
      clippedVertices.push(point.clone());
      vertexMap.set(key, id);
    }
    return id;
  };

  for (const [aId, bId, cId] of triangles) {
    const polygon = clipPolygonAbovePlaneY([vertices[aId], vertices[bId], vertices[cId]], yCut);
    if (polygon.length < 3 || polygonArea3(polygon) < 1e-10) continue;
    const baseId = getVertexId(polygon[0]);
    for (let i = 1; i < polygon.length - 1; i += 1) {
      const bClippedId = getVertexId(polygon[i]);
      const cClippedId = getVertexId(polygon[i + 1]);
      if (baseId === bClippedId || bClippedId === cClippedId || cClippedId === baseId) continue;
      clippedTriangles.push([baseId, bClippedId, cClippedId]);
    }
  }

  return { vertices: clippedVertices, triangles: clippedTriangles };
}

function collectBoundaryLoops(boundaryAdj, boundaryEdges) {
  const loops = [];
  const usedEdges = new Set();

  for (const [start, neighborsSet] of boundaryAdj.entries()) {
    for (const neighbor of neighborsSet) {
      const startEdge = volumeEdgeKey(start, neighbor);
      if (usedEdges.has(startEdge)) continue;

      const loop = [start];
      let prev = start;
      let current = neighbor;
      usedEdges.add(startEdge);
      let closed = false;

      for (let guard = 0; guard < boundaryAdj.size + 8; guard += 1) {
        loop.push(current);
        const neighbors = [...(boundaryAdj.get(current) || [])];
        if (neighbors.length !== 2) break;

        const next = neighbors[0] === prev ? neighbors[1] : neighbors[0];
        const nextEdge = volumeEdgeKey(current, next);

        if (next === start) {
          usedEdges.add(nextEdge);
          closed = true;
          break;
        }
        if (usedEdges.has(nextEdge)) break;

        usedEdges.add(nextEdge);
        prev = current;
        current = next;
      }

      if (closed && loop.length >= 3) loops.push(loop);
    }
  }

  return {
    loops,
    unresolvedBoundaryEdges: Math.max(0, boundaryEdges - usedEdges.size)
  };
}

function analyzeMeshVolume(mesh) {
  const geo = mesh.geometry;
  const pos = geo?.attributes?.position;
  if (!pos || pos.count < 3) return null;

  mesh.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld;
  const index = geo.index;
  const vertexMap = new Map();
  const worldVertices = [];
  const allTris = []; // [aId, bId, cId]
  const tmp = new THREE.Vector3();

  const getVertexId = vertexIndex => {
    tmp.fromBufferAttribute(pos, vertexIndex).applyMatrix4(matrix);
    const key = `${Math.round(tmp.x * 1e5)},${Math.round(tmp.y * 1e5)},${Math.round(tmp.z * 1e5)}`;
    let id = vertexMap.get(key);
    if (id == null) {
      id = worldVertices.length;
      worldVertices.push(tmp.clone());
      vertexMap.set(key, id);
    }
    return id;
  };

  // Step 1: Collect raw triangles and find connected components on RAW indices
  // (before vertex deduplication, which merges nearby vertices across fragments)
  const triCount = index ? index.count / 3 : pos.count / 3;
  const rawTris = []; // [rawA, rawB, rawC] using original buffer indices

  for (let i = 0; i < triCount; i += 1) {
    const ai = index ? index.getX(i * 3) : i * 3;
    const bi = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ci = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    rawTris.push([ai, bi, ci]);
  }

  // BFS component detection: works on indexed geometry directly,
  // or on deduplicated vertices for non-indexed geometry (e.g. OBJ).
  let totalComponents = 1;
  let largestPct = 100;
  let useComponentFilter = false;
  let filteredRawTris = rawTris;

  if (index) {
    // Indexed geometry: BFS on raw vertex indices (fast, uses shared vertices)
    const rawAdj = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) rawAdj[i] = [];
    for (const [ai, bi, ci2] of rawTris) {
      rawAdj[ai].push(bi, ci2);
      rawAdj[bi].push(ai, ci2);
      rawAdj[ci2].push(ai, bi);
    }

    const rawCompId = new Int32Array(pos.count).fill(-1);
    const compSizes = [];
    let ci = 0;
    for (let start = 0; start < pos.count; start++) {
      if (rawCompId[start] !== -1 || rawAdj[start].length === 0) continue;
      const queue = [start];
      rawCompId[start] = ci;
      let head = 0;
      while (head < queue.length) {
        const v = queue[head++];
        for (const n of rawAdj[v]) {
          if (rawCompId[n] === -1) { rawCompId[n] = ci; queue.push(n); }
        }
      }
      compSizes.push({ id: ci, count: queue.length });
      ci++;
    }

    compSizes.sort((a, b) => b.count - a.count);
    const largestCompId = compSizes[0]?.id ?? 0;
    totalComponents = compSizes.length;
    largestPct = pos.count > 0
      ? Math.round(compSizes[0].count / pos.count * 100) : 100;

    if (totalComponents > 1 && (largestPct > 50 || totalComponents > 50)) {
      filteredRawTris = rawTris.filter(([a]) => rawCompId[a] === largestCompId);
      useComponentFilter = true;
    }
  } else {
    // Non-indexed geometry (OBJ): deduplicate vertices by position, then BFS
    const dedupMap = new Map(); // position key → deduplicated ID
    const rawToDedup = new Int32Array(pos.count);
    let dedupCount = 0;
    const tmpV = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      tmpV.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      const key = `${Math.round(tmpV.x * 1e4)},${Math.round(tmpV.y * 1e4)},${Math.round(tmpV.z * 1e4)}`;
      let did = dedupMap.get(key);
      if (did == null) {
        did = dedupCount++;
        dedupMap.set(key, did);
      }
      rawToDedup[i] = did;
    }

    // Build adjacency on deduplicated IDs
    const dedupAdj = new Array(dedupCount);
    for (let i = 0; i < dedupCount; i++) dedupAdj[i] = [];
    const triCompId = new Int32Array(rawTris.length).fill(-1);

    for (let t = 0; t < rawTris.length; t++) {
      const da = rawToDedup[rawTris[t][0]];
      const db = rawToDedup[rawTris[t][1]];
      const dc = rawToDedup[rawTris[t][2]];
      dedupAdj[da].push(db, dc);
      dedupAdj[db].push(da, dc);
      dedupAdj[dc].push(da, db);
    }

    // BFS on deduplicated vertices
    const dedupCompId = new Int32Array(dedupCount).fill(-1);
    const compSizes = [];
    let ci = 0;
    for (let start = 0; start < dedupCount; start++) {
      if (dedupCompId[start] !== -1 || dedupAdj[start].length === 0) continue;
      const queue = [start];
      dedupCompId[start] = ci;
      let head = 0;
      while (head < queue.length) {
        const v = queue[head++];
        for (const n of dedupAdj[v]) {
          if (dedupCompId[n] === -1) { dedupCompId[n] = ci; queue.push(n); }
        }
      }
      compSizes.push({ id: ci, count: queue.length });
      ci++;
    }

    compSizes.sort((a, b) => b.count - a.count);
    const largestCompId = compSizes[0]?.id ?? 0;
    totalComponents = compSizes.length;
    largestPct = dedupCount > 0
      ? Math.round(compSizes[0].count / dedupCount * 100) : 100;

    if (totalComponents > 1 && (largestPct > 50 || totalComponents > 50)) {
      filteredRawTris = rawTris.filter(([a]) => dedupCompId[rawToDedup[a]] === largestCompId);
      useComponentFilter = true;
    }
  }

  // Step 2: Process triangles with deduplication

  for (const [ai, bi, ci2] of filteredRawTris) {
    const aId = getVertexId(ai);
    const bId = getVertexId(bi);
    const cId = getVertexId(ci2);
    if (aId === bId || bId === cId || cId === aId) continue;
    allTris.push([aId, bId, cId]);
  }

  // Build UNFILTERED triangles for slice-based volume (all fragments, no component filter)
  const unfilteredTris = [];
  if (useComponentFilter && filteredRawTris !== rawTris) {
    for (const [ai, bi, ci2] of rawTris) {
      const aId = getVertexId(ai);
      const bId = getVertexId(bi);
      const cId = getVertexId(ci2);
      if (aId === bId || bId === cId || cId === aId) continue;
      unfilteredTris.push([aId, bId, cId]);
    }
  }

  if (worldVertices.length < 3) return null;

  // Step 2b: Spatial density filtering using 3D voxel grid
  // For noisy photogrammetry, vertex density is high on the actual object surface
  // and sparse in noise regions. We find the densest cluster and keep only that.
  let useTris = allTris;
  // Run spatial filter for: (a) indexed with many components, or (b) non-indexed (OBJ) with many tris
  const needsSpatialFilter = (allTris.length > 500) &&
    ((useComponentFilter && totalComponents > 50) || (!index && allTris.length > 5000));
  if (needsSpatialFilter) {
    const vBbox = new THREE.Box3().setFromPoints(worldVertices);
    const vSize = vBbox.getSize(new THREE.Vector3());
    const gridRes = 32;
    const cellSize = new THREE.Vector3(
      vSize.x / gridRes || 1, vSize.y / gridRes || 1, vSize.z / gridRes || 1
    );

    // Count vertices per cell
    const cellCounts = new Map();
    const vertCell = new Int32Array(worldVertices.length);
    for (let i = 0; i < worldVertices.length; i++) {
      const v = worldVertices[i];
      const cx = Math.min(gridRes - 1, Math.floor((v.x - vBbox.min.x) / cellSize.x));
      const cy = Math.min(gridRes - 1, Math.floor((v.y - vBbox.min.y) / cellSize.y));
      const cz = Math.min(gridRes - 1, Math.floor((v.z - vBbox.min.z) / cellSize.z));
      const key = cx + cy * gridRes + cz * gridRes * gridRes;
      vertCell[i] = key;
      cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
    }

    // Find densest cell, then BFS expand to adjacent non-empty cells
    let maxCell = 0, maxCount = 0;
    for (const [key, count] of cellCounts) {
      if (count > maxCount) { maxCount = count; maxCell = key; }
    }

    // Density threshold: median-based, separates dense surface from sparse noise
    const densities = Array.from(cellCounts.values()).sort((a, b) => a - b);
    const medianDensity = densities[Math.floor(densities.length * 0.5)] || 1;
    const densityThreshold = Math.max(2, Math.floor(medianDensity * 0.5));

    // BFS on grid cells: 26-neighbor with density threshold
    const visitedCells = new Set([maxCell]);
    const cellQueue = [maxCell];
    let qHead = 0;
    while (qHead < cellQueue.length) {
      const cur = cellQueue[qHead++];
      const cz = Math.floor(cur / (gridRes * gridRes));
      const cy = Math.floor((cur - cz * gridRes * gridRes) / gridRes);
      const cx = cur - cz * gridRes * gridRes - cy * gridRes;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nx = cx + dx, ny = cy + dy, nz = cz + dz;
            if (nx < 0 || nx >= gridRes || ny < 0 || ny >= gridRes || nz < 0 || nz >= gridRes) continue;
            const nKey = nx + ny * gridRes + nz * gridRes * gridRes;
            if (!visitedCells.has(nKey) && (cellCounts.get(nKey) || 0) >= densityThreshold) {
              visitedCells.add(nKey);
              cellQueue.push(nKey);
            }
          }
        }
      }
    }

    // Conditionally dilate: expand visited region by 1 cell only when the filter was aggressive
    // (removed >25% of triangles). This recovers edge geometry for sparse scans without
    // introducing noise for already-clean scans.
    const keepVertPre = new Uint8Array(worldVertices.length);
    for (let i = 0; i < worldVertices.length; i++) {
      if (visitedCells.has(vertCell[i])) keepVertPre[i] = 1;
    }
    const preDilateCount = allTris.filter(([a, b, c]) => keepVertPre[a] && keepVertPre[b] && keepVertPre[c]).length;
    const preDilatePct = allTris.length > 0 ? preDilateCount / allTris.length : 1;

    const dilated = new Set(visitedCells);
    const shouldDilate = preDilatePct < 0.75; // Only dilate if initial filter removed >25%
    if (shouldDilate) for (const cur of visitedCells) {
      const cz = Math.floor(cur / (gridRes * gridRes));
      const cy = Math.floor((cur - cz * gridRes * gridRes) / gridRes);
      const cx = cur - cz * gridRes * gridRes - cy * gridRes;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nx = cx + dx, ny = cy + dy, nz = cz + dz;
            if (nx < 0 || nx >= gridRes || ny < 0 || ny >= gridRes || nz < 0 || nz >= gridRes) continue;
            const nKey = nx + ny * gridRes + nz * gridRes * gridRes;
            if (cellCounts.has(nKey)) dilated.add(nKey);
          }
        }
      }
    }

    // Keep only triangles whose vertices are all in dilated cells
    const keepVert = new Uint8Array(worldVertices.length);
    for (let i = 0; i < worldVertices.length; i++) {
      if (dilated.has(vertCell[i])) keepVert[i] = 1;
    }
    const spatialTris = allTris.filter(([a, b, c]) => keepVert[a] && keepVert[b] && keepVert[c]);
    const spatialPct = allTris.length > 0 ? Math.round(spatialTris.length / allTris.length * 100) : 100;



    if (spatialTris.length > 100 && spatialPct < 95) {
      useTris = spatialTris;
    }
    // Also apply spatial filter to unfiltered tris (for slice method)
    if (unfilteredTris.length > 0 && keepVert) {
      const spatialUnfiltered = unfilteredTris.filter(([a, b, c]) => keepVert[a] && keepVert[b] && keepVert[c]);
      if (spatialUnfiltered.length > 100) {
        unfilteredTris.length = 0;
        unfilteredTris.push(...spatialUnfiltered);
      }
    }
  }

  const activeNeckClipY = Number.isFinite(neckClipPlaneY) ? neckClipPlaneY : null;
  let volumeVertices = worldVertices;
  let volumeTris = useTris;
  if (activeNeckClipY != null) {
    const clipped = applyNeckClipToTriangles(worldVertices, useTris, activeNeckClipY);
    if (clipped.triangles.length >= 4 && clipped.vertices.length >= 4) {
      volumeVertices = clipped.vertices;
      volumeTris = clipped.triangles;
    }
  }

  if (volumeVertices.length < 3 || volumeTris.length === 0) return null;

  // Step 3: Compute mesh center from USED vertices only (for origin-independent signed volume)
  const usedVertIds = new Set();
  for (const [a, b, c] of volumeTris) { usedVertIds.add(a); usedVertIds.add(b); usedVertIds.add(c); }
  const usedVertArray = Array.from(usedVertIds).map(id => volumeVertices[id]);
  const meshCenter = new THREE.Box3().setFromPoints(usedVertArray).getCenter(new THREE.Vector3());

  // Build edge map and compute base signed volume on filtered triangles
  // Subtract meshCenter from vertices so signed volume is origin-independent
  // (critical for open/non-watertight meshes like photogrammetry scans)
  const edgeMap = new Map();
  let baseSignedVolume = 0;

  const addEdge = (a, b) => {
    const key = volumeEdgeKey(a, b);
    const edge = edgeMap.get(key) || { a, b, count: 0 };
    edge.count += 1;
    edgeMap.set(key, edge);
  };

  // For non-indexed meshes (OBJ), normals may be inconsistent.
  // Fix winding: ensure each triangle's normal points away from meshCenter.
  const fixWinding = !index;
  const correctedTris = []; // [aId, bId, cId] with consistent outward winding

  for (const [aId, bId, cId] of volumeTris) {
    const a = new THREE.Vector3().subVectors(volumeVertices[aId], meshCenter);
    const b = new THREE.Vector3().subVectors(volumeVertices[bId], meshCenter);
    const c = new THREE.Vector3().subVectors(volumeVertices[cId], meshCenter);

    if (fixWinding) {
      // Face normal via cross product
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const faceNormal = new THREE.Vector3().crossVectors(ab, ac);
      // Face center relative to meshCenter
      const faceCenter = new THREE.Vector3().addVectors(a, b).add(c).multiplyScalar(1/3);
      // If normal points toward center (dot < 0), flip winding
      if (faceNormal.dot(faceCenter) < 0) {
        baseSignedVolume += signedTriangleVolume(a, c, b); // swapped b,c
        addEdge(aId, cId);
        addEdge(cId, bId);
        addEdge(bId, aId);
        correctedTris.push([aId, cId, bId]); // flipped
        continue;
      }
    }

    baseSignedVolume += signedTriangleVolume(a, b, c);
    addEdge(aId, bId);
    addEdge(bId, cId);
    addEdge(cId, aId);
    correctedTris.push([aId, bId, cId]); // original order
  }



  // Step 4: Find boundary and build boundary adjacency
  const boundaryAdj = new Map();
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;

  for (const edge of edgeMap.values()) {
    if (edge.count === 1) {
      boundaryEdges += 1;
      if (!boundaryAdj.has(edge.a)) boundaryAdj.set(edge.a, new Set());
      if (!boundaryAdj.has(edge.b)) boundaryAdj.set(edge.b, new Set());
      boundaryAdj.get(edge.a).add(edge.b);
      boundaryAdj.get(edge.b).add(edge.a);
    } else if (edge.count > 2) {
      nonManifoldEdges += 1;
    }
  }

  // Step 5: Close boundary loops with fan triangulation
  // Large loops (main opening) use curved cap toward mesh center to avoid over-estimation
  const { loops, unresolvedBoundaryEdges } = collectBoundaryLoops(boundaryAdj, boundaryEdges);
  let capSignedVolume = 0;
  let cappedLoops = 0;
  let rejectedLoops = 0;
  let maxPlanarityRatio = 0;

  // Compute mesh bounding sphere radius for relative size comparisons
  const meshBbox = new THREE.Box3().setFromPoints(usedVertArray);
  const meshDiag = meshBbox.getSize(new THREE.Vector3()).length();

  for (const loop of loops) {
    const points = loop.map(id => volumeVertices[id]);
    const centroid = points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
    const normal = computeLoopNormal(points);
    if (normal.lengthSq() < 1e-12) {
      rejectedLoops += 1;
      continue;
    }

    normal.normalize();
    if (new THREE.Vector3().subVectors(centroid, meshCenter).dot(normal) < 0) {
      normal.negate();
    }

    let rms = 0;
    let maxRadius = 0;
    for (const p of points) {
      const delta = new THREE.Vector3().subVectors(p, centroid);
      const planeDist = Math.abs(delta.dot(normal));
      rms += planeDist * planeDist;
      maxRadius = Math.max(maxRadius, delta.length());
    }

    const planarityRatio = maxRadius > 1e-6 ? Math.sqrt(rms / points.length) / maxRadius : 0;
    maxPlanarityRatio = Math.max(maxPlanarityRatio, planarityRatio);
    if (planarityRatio > 0.08) {
      rejectedLoops += 1;
      continue;
    }

    const isNeckLoop = activeNeckClipY != null && points.every(p => Math.abs(p.y - activeNeckClipY) <= 1e-5);

    // Skip capping if mesh is heavily fragmented AND spatial filter was NOT applied
    // (noise fragments create false boundary loops; spatial filter cleans them)
    if (!isNeckLoop && useComponentFilter && totalComponents > 10 && useTris === allTris) {
      rejectedLoops += loops.length - cappedLoops;
      break;
    }
    // Only cap small loops — they are genuine holes.
    // For spatially-filtered fragmented meshes, use tighter limit (2%) to avoid noise loops
    const loopSize = maxRadius * 2;
    const sizeLimit = (useTris !== allTris && totalComponents > 10) ? meshDiag * 0.02 : meshDiag * 0.05;
    if (!isNeckLoop && loopSize > sizeLimit) {
      rejectedLoops += 1;
      continue;
    }

    for (let i = 0; i < points.length; i += 1) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const edgeNormal = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(p1, centroid),
        new THREE.Vector3().subVectors(p2, centroid)
      );
      // Subtract meshCenter for origin-independent volume (consistent with base volume)
      const cC = new THREE.Vector3().subVectors(centroid, meshCenter);
      const p1C = new THREE.Vector3().subVectors(p1, meshCenter);
      const p2C = new THREE.Vector3().subVectors(p2, meshCenter);
      capSignedVolume += edgeNormal.dot(normal) >= 0
        ? signedTriangleVolume(cC, p1C, p2C)
        : signedTriangleVolume(cC, p2C, p1C);
    }
    cappedLoops += 1;

    // Budget: if cap volume exceeds 15% of base volume, stop capping
    if (!isNeckLoop && Math.abs(capSignedVolume) > Math.abs(baseSignedVolume) * 0.15) {
      rejectedLoops += loops.length - cappedLoops - rejectedLoops;
      break;
    }
  }

  // Compute convex hull volume as upper bound sanity check
  let convexHullVolume = null;
  try {
    const hull = new ConvexHull().setFromPoints(usedVertArray);
    let hullVol = 0;
    const hullCenter = meshCenter;
    for (const face of hull.faces) {
      let edge = face.edge;
      const a = edge.head().point;
      edge = edge.next;
      while (edge.next !== face.edge) {
        const b = edge.head().point;
        const c = edge.next.head().point;
        const ac = new THREE.Vector3().subVectors(a, hullCenter);
        const bc = new THREE.Vector3().subVectors(b, hullCenter);
        const cc = new THREE.Vector3().subVectors(c, hullCenter);
        hullVol += signedTriangleVolume(ac, bc, cc);
        edge = edge.next;
      }
    }
    convexHullVolume = Math.abs(hullVol);
  } catch (e) {
    console.warn('[VOL] convex hull failed:', e.message);
  }

  // Compute filtered geometry bbox (not the whole model bbox)
  const filteredBbox = meshBbox; // meshBbox was already set from worldVertices (filtered only)
  const filteredBboxSize = filteredBbox.getSize(new THREE.Vector3());

  const rawVolume = Math.abs(baseSignedVolume + capSignedVolume);
  // If convex hull is available and raw volume exceeds it, clamp to hull volume
  let volumeUnits = (convexHullVolume != null && rawVolume > convexHullVolume)
    ? convexHullVolume : rawVolume;

  // For non-indexed meshes (OBJ), signed volume is less stable on open surfaces.
  // Use the secondary inside/outside pass for open meshes when needed.
  const isOpenOBJ = !index && boundaryEdges > 0;
  let gwnParams = null;
  if (isOpenOBJ && convexHullVolume != null && volumeUnits > convexHullVolume * 0.4) {
    const R = 15; // 15³=3375 cells — good balance of accuracy and speed
    const vSzGWN = filteredBboxSize;
    const vMinGWN = { x: meshBbox.min.x, y: meshBbox.min.y, z: meshBbox.min.z };
    const cX = vSzGWN.x/R, cY = vSzGWN.y/R, cZ = vSzGWN.z/R;

    // Use the original triangle set for the secondary pass on open meshes.
    const sampleTris = volumeTris;

    // Precompute flat triangle vertex array for speed
    const nTris = sampleTris.length;
    const tv = new Float64Array(nTris * 9);
    for (let t = 0; t < nTris; t++) {
      const [aId,bId,cId] = sampleTris[t];
      const a = volumeVertices[aId], b = volumeVertices[bId], c = volumeVertices[cId];
      tv[t*9]=a.x; tv[t*9+1]=a.y; tv[t*9+2]=a.z;
      tv[t*9+3]=b.x; tv[t*9+4]=b.y; tv[t*9+5]=b.z;
      tv[t*9+6]=c.x; tv[t*9+7]=c.y; tv[t*9+8]=c.z;
    }

    gwnParams = { R, vMinGWN, cX, cY, cZ, tv, nTris };
  }

  // Compute bounding box of the volume vertices (for slice-based method)
  const volBbox = new THREE.Box3();
  for (const id of usedVertIds) volBbox.expandByPoint(volumeVertices[id]);

  return {
    volumeUnits,
    boundaryEdges,
    nonManifoldEdges,
    boundaryLoops: loops.length,
    cappedLoops,
    rejectedLoops,
    unresolvedBoundaryEdges,
    maxPlanarityRatio,
    totalComponents,
    largestComponentPct: largestPct,
    convexHullVolume,
    filteredBboxSize,
    isOpenOBJ,
    gwnParams,
    neckClipApplied: activeNeckClipY != null,
    neckClipPlaneY: activeNeckClipY,
    // Exported for slice-based volume (corrected tris = filtered)
    sliceData: { vertices: volumeVertices, triangles: correctedTris, bbox: volBbox },
    // ALL triangles (before component/spatial filter) for slice envelope method
    allSliceData: { vertices: worldVertices, triangles: unfilteredTris.length > 0 ? unfilteredTris : allTris, bbox: new THREE.Box3().setFromPoints(worldVertices) }
  };
}

function buildVolumeQuality(stats) {
  const neckClipNote = stats.neckClipApplied ? ' Объём ограничен плоскостью шеи' : '';
  if (stats.nonManifoldEdges === 0 && stats.boundaryEdges === 0) {
    return {
      tag: 'точный по замкнутой сетке',
      note: `Замкнутая сетка без открытых контуров.${neckClipNote}`,
      approximate: false
    };
  }

  if (stats.nonManifoldEdges === 0 && stats.rejectedLoops === 0 && stats.unresolvedBoundaryEdges === 0) {
    return {
      tag: 'сетка автозакрыта',
      note: `Открытый срез закрыт автоматически: ${stats.cappedLoops} контур(ов).${neckClipNote}`,
      approximate: false
    };
  }

  const compNote = stats.totalComponents > 1
    ? ` Фильтр: осн. компонент ${stats.largestComponentPct}% из ${stats.totalComponents} фрагм.`
    : '';
  return {
    tag: 'приближённо',
    note: `Открытые контуры: loops ${stats.boundaryLoops}, rejected ${stats.rejectedLoops}, non-manifold ${stats.nonManifoldEdges}.${compNote}${neckClipNote}`,
    approximate: true
  };
}

function classifyVolumeHealth(volumeUnits, stats, quality) {
  const mm3 = mm3FromVolumeUnits(volumeUnits);
  const liters = mm3 != null ? mm3 / 1000000 : null;
  const reasons = [];
  let severity = 0;

  if (quality.approximate) {
    severity += 1;
    reasons.push('сетка не полностью надёжна');
  }
  if (stats.nonManifoldEdges > 0) {
    severity += 2;
    reasons.push(`non-manifold: ${stats.nonManifoldEdges}`);
  }
  if (stats.rejectedLoops > 0 || stats.unresolvedBoundaryEdges > 0) {
    severity += 2;
    reasons.push('остались проблемные открытые контуры');
  }
  if (stats.totalComponents > 20 || stats.largestComponentPct < 70) {
    severity += 2;
    reasons.push('модель фрагментирована');
  } else if (stats.totalComponents > 1 || stats.largestComponentPct < 90) {
    severity += 1;
    reasons.push('в модели есть лишние фрагменты');
  }
  if (stats.maxPlanarityRatio > 0.12) {
    severity += 1;
    reasons.push('открытые срезы плохо ложатся в плоскость');
  }

  if (liters == null) {
    return {
      tone: severity >= 3 ? 'warning' : 'info',
      label: severity >= 3 ? 'Без калибровки' : 'Нужна калибровка',
      value: formatVolumeUnits(volumeUnits),
      text: `Сначала откалибруйте модель, чтобы оценивать клинический диапазон.${stats.neckClipApplied ? ' Срез по шее активен.' : ''}${reasons.length ? ' Также: ' + reasons.join(', ') + '.' : ''}`
    };
  }

  if (liters < 2.5 || liters > 6.0) {
    severity += 3;
    reasons.push(`объём вне ожидаемого диапазона: ${liters.toFixed(2)} л`);
  } else if (liters < 3.0 || liters > 5.0) {
    severity += 1;
    reasons.push(`объём на границе диапазона: ${liters.toFixed(2)} л`);
  }

  // Cross-validation: compare volume against bbox ellipsoid estimate
  // Use full model bboxSize (not filtered) since slice volume uses all triangles
  if (stats.bboxSize) {
    const s = scale3dMMperUnit ?? 1;
    const bs = stats.bboxSize;
    const W = bs.x * s, H = bs.y * s, D = bs.z * s;
    const ellipsoidMm3 = Math.PI / 6 * W * H * D;
    const ellipsoidL = ellipsoidMm3 / 1e6;
    const ratio = liters / ellipsoidL;
    // Head volume is typically 50-75% of bounding ellipsoid
    if (ratio < 0.3 || ratio > 0.9) {
      severity += 2;
      reasons.push(`эллипсоид bbox: ${ellipsoidL.toFixed(2)} л, отношение: ${(ratio * 100).toFixed(0)}%`);
    } else {
      // Ellipsoid check passed — reduce severity from mesh quality issues
      // Fragmented meshes give good volume via slice/raycast method
      const isSliceMethod = stats.volumeMethod === 'slice';
      if (isSliceMethod && ratio >= 0.45 && ratio <= 0.85) {
        // Strong validation: slice method + good ellipsoid ratio
        severity = Math.min(severity, 2);
      } else if (severity >= 3) {
        severity = Math.max(severity - 2, 2);
      }
      reasons.push(`✓ верификация: ${(ratio * 100).toFixed(0)}% от эллипсоида (${ellipsoidL.toFixed(2)} л)`);
    }
  }

  // Show method used
  if (stats.volumeMethod) {
    const methodNames = { signed: 'знаковый', slice: 'послойный', gwn: 'GWN' };
    reasons.push(`метод: ${methodNames[stats.volumeMethod] || stats.volumeMethod}`);
  }

  if (severity >= 4) {
    return {
      tone: 'danger',
      label: 'Переснять модель',
      value: `${liters.toFixed(2)} л`,
      text: `Объёму доверять нельзя: ${reasons.join(', ')}.${stats.neckClipApplied ? ' Срез по шее активен.' : ''}`
    };
  }
  if (severity >= 2) {
    return {
      tone: 'warning',
      label: 'Сомнительный',
      value: `${liters.toFixed(2)} л`,
      text: `Проверить модель и калибровку: ${reasons.join(', ')}.${stats.neckClipApplied ? ' Срез по шее активен.' : ''}`
    };
  }
  return {
    tone: 'success',
    label: 'Нормальный',
    value: `${liters.toFixed(2)} л`,
    text: `Объём в рабочем диапазоне 3–5 л, топология модели выглядит пригодной.${stats.neckClipApplied ? ' Срез по шее активен.' : ''}`
  };
}

function applyVolumeHealthUI(health, item = null) {
  const card = document.getElementById('volumeHealthCard');
  const badge = document.getElementById('volumeHealthBadge');
  const value = document.getElementById('volumeHealthValue');
  const text = document.getElementById('volumeHealthText');
  if (!card || !badge || !value || !text) return;

  if (!health) {
    card.style.display = 'none';
    badge.className = 'badge';
    badge.textContent = '—';
    value.textContent = '—';
    text.textContent = '—';
    return;
  }

  card.style.display = 'block';
  badge.className = `badge badge-${health.tone}`;
  badge.textContent = health.label;
  value.textContent = health.value;
  text.textContent = item?.note ? `${health.text} ${item.note}` : health.text;
}

function updateVolumeHealthUI() {
  const item = plan3dItems.find(x => x.type === 'volume' && x.value != null);
  if (!item || !item.health) {
    applyVolumeHealthUI(null);
    return;
  }
  applyVolumeHealthUI(item.health, item);
}

function upsertVolumeItem(volumeUnits, quality, stats) {
  let item = plan3dItems.find(x => x.type === 'volume');
  if (!item) {
    item = { id: nextId3d(), type: 'volume', label: 'Объём головы', points: [], value: volumeUnits, deg: null };
    plan3dItems.push(item);
  }

  item.label = 'Объём головы';
  item.points = [];
  item.value = volumeUnits;
  item.deg = null;
  item.note = quality.note;
  item.approximate = quality.approximate;
  item.boundaryEdges = stats.boundaryEdges;
  item.nonManifoldEdges = stats.nonManifoldEdges;
  item.cappedLoops = stats.cappedLoops;
  item.health = classifyVolumeHealth(volumeUnits, stats, quality);
  selected3dPlan = item.id;
}

// ==================== SLICE-BASED VOLUME ====================
// Slices mesh with horizontal planes, computes 2D cross-section areas,
// integrates with Simpson's rule. Works well for open photogrammetry meshes.

function sliceTriangleAtY(verts, tri, yLevel) {
  const [aId, bId, cId] = tri;
  const a = verts[aId], b = verts[bId], c = verts[cId];
  const da = a.y - yLevel, db = b.y - yLevel, dc = c.y - yLevel;
  const eps = 1e-9;
  const sa = Math.abs(da) < eps ? 0 : (da > 0 ? 1 : -1);
  const sb = Math.abs(db) < eps ? 0 : (db > 0 ? 1 : -1);
  const sc = Math.abs(dc) < eps ? 0 : (dc > 0 ? 1 : -1);

  // All on same side — no intersection
  if (sa >= 0 && sb >= 0 && sc >= 0 && (sa + sb + sc) >= 2) return null;
  if (sa <= 0 && sb <= 0 && sc <= 0 && (sa + sb + sc) <= -2) return null;

  const pts = [];
  const edges = [[a, b, da, db], [b, c, db, dc], [c, a, dc, da]];
  for (const [va, vb, dA, dB] of edges) {
    if (dA === 0 && dB === 0) {
      // Edge lies on plane — add both endpoints
      pts.push({ x: va.x, z: va.z }, { x: vb.x, z: vb.z });
    } else if (dA * dB < 0) {
      // Edge crosses plane
      const t = dA / (dA - dB);
      pts.push({ x: va.x + t * (vb.x - va.x), z: va.z + t * (vb.z - va.z) });
    } else if (Math.abs(dA) < eps) {
      pts.push({ x: va.x, z: va.z });
    }
  }

  if (pts.length < 2) return null;
  // Deduplicate close points
  const uniq = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    let dup = false;
    for (const u of uniq) {
      if ((p.x - u.x) ** 2 + (p.z - u.z) ** 2 < 1e-14) { dup = true; break; }
    }
    if (!dup) uniq.push(p);
  }
  if (uniq.length < 2) return null;
  return { p1: uniq[0], p2: uniq[1] };
}

function chainSliceSegments(segments) {
  if (segments.length === 0) return [];
  // Quantize to grid for endpoint matching
  const Q = 1e6;
  const key = p => `${Math.round(p.x * Q)}_${Math.round(p.z * Q)}`;

  const adj = new Map();
  const addAdj = (k, segIdx, end) => {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push({ segIdx, end });
  };
  for (let i = 0; i < segments.length; i++) {
    addAdj(key(segments[i].p1), i, 1);
    addAdj(key(segments[i].p2), i, 2);
  }

  const used = new Uint8Array(segments.length);
  const loops = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const loop = [segments[start].p1, segments[start].p2];
    let curKey = key(loop[loop.length - 1]);
    const startKey = key(loop[0]);

    for (let iter = 0; iter < segments.length; iter++) {
      if (curKey === startKey && loop.length > 2) break; // closed
      const neighbors = adj.get(curKey);
      if (!neighbors) break;
      let found = false;
      for (const nb of neighbors) {
        if (used[nb.segIdx]) continue;
        used[nb.segIdx] = 1;
        const seg = segments[nb.segIdx];
        const nextPt = nb.end === 1 ? seg.p2 : seg.p1;
        loop.push(nextPt);
        curKey = key(nextPt);
        found = true;
        break;
      }
      if (!found) break;
    }

    // Check if closed
    if (loop.length >= 3 && key(loop[loop.length - 1]) === startKey) {
      loop.pop(); // remove duplicate closing point
      loops.push(loop);
    }
  }
  return loops;
}

function shoelaceArea2D(pts) {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return area / 2;
}

function simpsonsIntegrate(areas, dy) {
  const N = areas.length - 1;
  if (N <= 0) return 0;
  if (N === 1) return (areas[0] + areas[1]) * dy / 2;

  // Composite Simpson's rule (needs even N; handle odd with trapezoidal tail)
  const evenN = N % 2 === 0 ? N : N - 1;
  let sum = areas[0] + areas[evenN];
  for (let i = 1; i < evenN; i++) {
    sum += (i % 2 === 1 ? 4 : 2) * areas[i];
  }
  let vol = sum * dy / 3;

  if (N % 2 === 1) {
    vol += (areas[N - 1] + areas[N]) * dy / 2;
  }
  return vol;
}

// For fragmented meshes: estimate cross-section area via ray casting in XZ plane
function rayCastSliceArea(vertices, triangles, bucket, yLevel) {
  const segs = [];
  for (const tIdx of bucket) {
    const seg = sliceTriangleAtY(vertices, triangles[tIdx], yLevel);
    if (seg) segs.push(seg);
  }
  if (segs.length < 3) return { area: 0, method: 'none' };

  // Try contour chaining first
  const loops = chainSliceSegments(segs);
  let contourArea = 0;
  for (const loop of loops) contourArea += Math.abs(shoelaceArea2D(loop));
  const chainedPts = loops.reduce((s, l) => s + l.length, 0);
  const chainRatio = segs.length > 0 ? chainedPts / segs.length : 0;

  // If >60% segments formed closed contours, trust contour method
  if (chainRatio > 0.6 && contourArea > 0) {
    return { area: contourArea, method: 'contour' };
  }

  // Fallback: ray casting in XZ plane
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const seg of segs) {
    xMin = Math.min(xMin, seg.p1.x, seg.p2.x);
    xMax = Math.max(xMax, seg.p1.x, seg.p2.x);
    zMin = Math.min(zMin, seg.p1.z, seg.p2.z);
    zMax = Math.max(zMax, seg.p1.z, seg.p2.z);
  }
  const xSpan = xMax - xMin, zSpan = zMax - zMin;
  if (xSpan < 1e-10 || zSpan < 1e-10) return { area: 0, method: 'none' };

  const numRays = 80;
  const dx = xSpan / numRays;
  let totalInsideZ = 0;

  for (let i = 0; i < numRays; i++) {
    const rx = xMin + (i + 0.5) * dx;
    const zHits = [];
    for (const seg of segs) {
      const x1 = seg.p1.x, z1 = seg.p1.z, x2 = seg.p2.x, z2 = seg.p2.z;
      if ((x1 <= rx && x2 >= rx) || (x2 <= rx && x1 >= rx)) {
        const dxSeg = x2 - x1;
        if (Math.abs(dxSeg) < 1e-12) continue;
        const t = (rx - x1) / dxSeg;
        if (t >= 0 && t <= 1) zHits.push(z1 + t * (z2 - z1));
      }
    }
    if (zHits.length < 2) continue;
    zHits.sort((a, b) => a - b);
    // For fragmented meshes: use first-to-last span (envelope)
    // rather than alternating in/out which fails with gaps
    totalInsideZ += zHits[zHits.length - 1] - zHits[0];
  }

  const rayArea = totalInsideZ * dx;
  const finalArea = Math.max(contourArea, rayArea);
  return { area: finalArea, method: rayArea > contourArea ? 'raycast' : 'contour' };
}

function computeSliceVolumeAsync(sliceData, numSlices = 250) {
  return new Promise(resolve => {
    const { vertices, triangles, bbox } = sliceData;
    const yMin = bbox.min.y;
    const yMax = bbox.max.y;
    const ySpan = yMax - yMin;
    if (ySpan < 1e-10 || triangles.length === 0) { resolve(0); return; }

    const dy = ySpan / numSlices;
    // Build Y-bucket index
    const buckets = new Array(numSlices + 1);
    for (let i = 0; i <= numSlices; i++) buckets[i] = [];
    for (let t = 0; t < triangles.length; t++) {
      const [aId, bId, cId] = triangles[t];
      const tyMin = Math.min(vertices[aId].y, vertices[bId].y, vertices[cId].y);
      const tyMax = Math.max(vertices[aId].y, vertices[bId].y, vertices[cId].y);
      const bStart = Math.max(0, Math.floor((tyMin - yMin) / dy));
      const bEnd = Math.min(numSlices, Math.floor((tyMax - yMin) / dy));
      for (let b = bStart; b <= bEnd; b++) buckets[b].push(t);
    }

    const areas = new Float64Array(numSlices + 1);
    let currentSlice = 0;
    let contourCount = 0, raycastCount = 0;

    function processChunk() {
      const endSlice = Math.min(currentSlice + 15, numSlices + 1);
      for (let s = currentSlice; s < endSlice; s++) {
        const yLevel = yMin + s * dy;
        const bucket = buckets[Math.min(s, numSlices)];
        const result = rayCastSliceArea(vertices, triangles, bucket, yLevel);
        areas[s] = result.area;
        if (result.method === 'contour') contourCount++;
        else if (result.method === 'raycast') raycastCount++;
      }
      currentSlice = endSlice;
      if (currentSlice <= numSlices) {
        setTimeout(processChunk, 0);
      } else {
        const volume = simpsonsIntegrate(areas, dy);
        console.log(`[VOL] slice-based: ${numSlices} slices, vol=${volume.toFixed(6)}, contour=${contourCount}, raycast=${raycastCount}`);
        resolve(volume);
      }
    }
    processChunk();
  });
}

// Run the secondary inside/outside pass asynchronously
function runGWNAsync(gwnParams) {
  return new Promise(resolve => {
    const { R, vMinGWN, cX, cY, cZ, tv, nTris } = gwnParams;
    const FPI = 4 * Math.PI;
    let insideCount = 0;
    let ix = 0;

    // Process one X-slice per frame to avoid blocking UI
    function processSlice() {
      const endIx = Math.min(ix + 1, R); // 1 slice per frame for UI responsiveness
      for (; ix < endIx; ix++) {
        const px = vMinGWN.x + (ix + 0.5) * cX;
        for (let iy = 0; iy < R; iy++) {
          const py = vMinGWN.y + (iy + 0.5) * cY;
          for (let iz = 0; iz < R; iz++) {
            const pz = vMinGWN.z + (iz + 0.5) * cZ;
            let wn = 0;
            for (let t = 0; t < nTris; t++) {
              const i = t * 9;
              const ax=tv[i]-px, ay=tv[i+1]-py, az=tv[i+2]-pz;
              const bx=tv[i+3]-px, by=tv[i+4]-py, bz=tv[i+5]-pz;
              const cx=tv[i+6]-px, cy=tv[i+7]-py, cz=tv[i+8]-pz;
              const la = Math.sqrt(ax*ax+ay*ay+az*az);
              const lb = Math.sqrt(bx*bx+by*by+bz*bz);
              const lc = Math.sqrt(cx*cx+cy*cy+cz*cz);
              if (la < 1e-10 || lb < 1e-10 || lc < 1e-10) continue;
              const tp = ax*(by*cz-bz*cy) + ay*(bz*cx-bx*cz) + az*(bx*cy-by*cx);
              const ab = ax*bx+ay*by+az*bz;
              const bc = bx*cx+by*cy+bz*cz;
              const ca = cx*ax+cy*ay+cz*az;
              wn += 2 * Math.atan2(tp, la*lb*lc + ab*lc + bc*la + ca*lb);
            }
            if (wn / FPI > 0.5) insideCount++;
          }
        }
      }
      if (ix < R) {
        setTimeout(processSlice, 0);
      } else {
        const gwnVolume = insideCount * cX * cY * cZ;
        console.log(`[VOL] secondary pass: ${insideCount}/${R*R*R} inside, vol=${gwnVolume.toFixed(6)}, tris=${nTris}`);
        resolve(gwnVolume);
      }
    }
    processSlice();
  });
}

async function computeMeshVolume() {
  if (!currentModel) { setStatus3d('Сначала загрузите модель.'); return; }

  setStatus3d('Вычисление объёма...');

  const bbox = new THREE.Box3().setFromObject(currentModel);
  const bboxSize = bbox.getSize(new THREE.Vector3());
  const stats = {
    volumeUnits: 0,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    boundaryLoops: 0,
    cappedLoops: 0,
    rejectedLoops: 0,
    unresolvedBoundaryEdges: 0,
    maxPlanarityRatio: 0,
    totalComponents: 0,
    largestComponentPct: 100,
    convexHullVolume: 0,
    filteredBboxSize: null,
    bboxSize: bboxSize,
    neckClipApplied: false
  };

  let pendingGWN = null;
  let pendingSliceData = null;

  currentModel.traverse(child => {
    if (!child.isMesh) return;
    const meshStats = analyzeMeshVolume(child);
    if (!meshStats) return;

    stats.volumeUnits += meshStats.volumeUnits;
    stats.boundaryEdges += meshStats.boundaryEdges;
    stats.nonManifoldEdges += meshStats.nonManifoldEdges;
    stats.boundaryLoops += meshStats.boundaryLoops;
    stats.cappedLoops += meshStats.cappedLoops;
    stats.rejectedLoops += meshStats.rejectedLoops;
    stats.unresolvedBoundaryEdges += meshStats.unresolvedBoundaryEdges;
    stats.maxPlanarityRatio = Math.max(stats.maxPlanarityRatio, meshStats.maxPlanarityRatio);
    stats.totalComponents += meshStats.totalComponents;
    stats.largestComponentPct = Math.min(stats.largestComponentPct, meshStats.largestComponentPct);
    if (meshStats.convexHullVolume != null) stats.convexHullVolume += meshStats.convexHullVolume;
    if (meshStats.filteredBboxSize) stats.filteredBboxSize = meshStats.filteredBboxSize;
    stats.neckClipApplied = stats.neckClipApplied || meshStats.neckClipApplied;
    if (meshStats.gwnParams) pendingGWN = meshStats.gwnParams;
    // Always use ALL triangles for slice method (before component/spatial filter)
    // Slice+raycast handles noise better than filtered-only data
    if (meshStats.allSliceData) {
      pendingSliceData = meshStats.allSliceData;
    } else if (meshStats.sliceData) {
      pendingSliceData = meshStats.sliceData;
    }
  });

  // Run slice-based volume (works well for open meshes)
  let sliceVolume = 0;
  if (pendingSliceData) {
    setStatus3d('Вычисление объёма (послойный метод)...');
    await new Promise(r => setTimeout(r, 30));
    sliceVolume = await computeSliceVolumeAsync(pendingSliceData, 300);
  }

  // Run the secondary GWN pass asynchronously if needed for open OBJ meshes
  let gwnVolume = 0;
  if (pendingGWN) {
    setStatus3d('Вычисление объёма (уточнение открытой сетки)... не закрывайте вкладку.');
    await new Promise(r => setTimeout(r, 50));
    gwnVolume = await runGWNAsync(pendingGWN);
  }

  // Pick best volume: compare signed, slice, GWN; prefer slice for open meshes
  const signedVol = stats.volumeUnits;
  const hullVol = stats.convexHullVolume || Infinity;
  const candidates = [
    { method: 'signed', vol: signedVol },
    { method: 'slice', vol: sliceVolume },
    { method: 'gwn', vol: gwnVolume }
  ].filter(c => {
      if (c.vol <= 0) return false;
      // For slice method on fragmented meshes, hull is from filtered data and too small
      // Use bbox ellipsoid as upper bound instead
      if (c.method === 'slice' && pendingSliceData) {
        const sb = pendingSliceData.bbox;
        const sz = sb.getSize(new THREE.Vector3());
        const ellipsoidVol = Math.PI / 6 * sz.x * sz.y * sz.z;
        return c.vol <= ellipsoidVol * 1.1;
      }
      return c.vol <= hullVol * 1.05;
    });

  if (candidates.length > 0) {
    // For open meshes prefer slice; for closed prefer signed
    const isOpen = stats.boundaryEdges > 0;
    let best;
    if (isOpen) {
      // Prefer slice, then GWN, then signed
      best = candidates.find(c => c.method === 'slice')
          || candidates.find(c => c.method === 'gwn')
          || candidates[0];
    } else {
      best = candidates.find(c => c.method === 'signed') || candidates[0];
    }
    stats.volumeUnits = best.vol;
    stats.volumeMethod = best.method;
    console.log(`[VOL] method selection: signed=${signedVol.toFixed(6)}, slice=${sliceVolume.toFixed(6)}, gwn=${gwnVolume.toFixed(6)} → ${best.method}=${best.vol.toFixed(6)}, hull=${hullVol === Infinity ? 'N/A' : hullVol.toFixed(6)}`);
  }

  if (stats.volumeUnits <= 0) {
    setStatus3d('Не удалось вычислить объём: у модели нет пригодной замкнутой геометрии.');
    applyVolumeHealthUI({
      tone: 'danger',
      label: 'Переснять модель',
      value: '0.00 л',
      text: 'Алгоритм не смог собрать пригодный объём из текущего меша.'
    });
    return;
  }

  const quality = buildVolumeQuality(stats);
  const s = scale3dMMperUnit ?? 1;
  const useBboxSize = stats.filteredBboxSize || bboxSize;
  const bW = (useBboxSize.x * s).toFixed(0);
  const bH = (useBboxSize.y * s).toFixed(0);
  const bD = (useBboxSize.z * s).toFixed(0);
  const valueText = formatVolumeUnits(stats.volumeUnits);
  const extra = scale3dMMperUnit == null ? ' Калибруйте модель для клинических единиц.' : '';
  const clipExtra = stats.neckClipApplied ? ' Считается только часть выше плоскости шеи.' : '';
  const methodNames = { signed: 'знаковый', slice: 'послойный', gwn: 'GWN' };
  const methodLabel = stats.volumeMethod ? ` [${methodNames[stats.volumeMethod] || stats.volumeMethod}]` : '';
  const topologyText = `${quality.tag}; ${quality.note}.`;

  const hullText = stats.convexHullVolume > 0
    ? ` | hull: ${formatVolumeUnits(stats.convexHullVolume, false)}`
    : '';
  upsertVolumeItem(stats.volumeUnits, quality, stats);
  updateVolumeHealthUI();
  setStatus3d(`Объём: ${valueText}${methodLabel}${hullText} | bbox: ${bW}×${bH}×${bD} мм | ${topologyText}${clipExtra}${extra}`);
  render3dPlanList();
  update3dSelectedInfo();
  save3dProject();
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
  applyVolumeHealthUI(null);
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

function render3dPlanList() {
  const el = document.getElementById('measurements3d');
  if (!el) return;
  if (plan3dItems.length === 0) {
    el.innerHTML = '<div class="hint">Нет измерений. Выберите инструмент и кликните на модель.</div>';
    updateVolumeHealthUI();
    return;
  }
  el.innerHTML = plan3dItems.map((m, i) => {
    let val = '';
    if (m.type === 'angle') {
      val = m.deg != null ? `${m.deg.toFixed(1)}°` : '';
    } else if (m.type === 'tilt') {
      val = `${m.deg != null ? m.deg.toFixed(1) + '°' : ''} | ${m.value != null ? formatDist(m.value) : ''}`;
    } else if (m.type === 'volume' && m.value != null) {
      val = formatVolumeUnits(m.value, false);
    } else if (m.value != null) {
      val = formatDist(m.value);
    }
    const isSel = selected3dPlan === m.id;
    const selStyle = isSel ? 'outline:2px solid rgba(59,130,246,0.55);' : '';
    const typeName = TYPE_NAMES_RU[m.type] || m.type;
    const showLabel = m.label && m.label !== m.type && m.label !== typeName;
    return `<div style="cursor:pointer;${selStyle}" onclick="window._select3dPlan('${m.id}')">
      <div>
        ${TYPE_ICONS[m.type] || ''} <strong>${typeName} ${i + 1}</strong>
        ${showLabel ? ' • <em>' + escHtml(m.label) + '</em>' : ''}
        : ${val}
      </div>
      ${m.health ? `<div style="margin-top:4px"><span class="badge badge-${m.health.tone}">${escHtml(m.health.label)}</span></div>` : ''}
      ${m.note ? `<div class="hint" style="margin-top:4px">${escHtml(m.note)}</div>` : ''}
      <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); window._delete3dPlan('${m.id}')" style="margin-top:4px;font-size:10px;">Удалить</button>
    </div>`;
  }).join('');
  updateVolumeHealthUI();
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
  const valTxt = it.type === 'volume' && it.value != null ? formatVolumeUnits(it.value) : (it.value != null ? formatDist(it.value) : '');
  const degTxt = it.deg != null ? ` • ${it.deg.toFixed(1)}°` : '';
  const noteTxt = it.note ? ` • ${it.note}` : '';
  const healthTxt = it.health ? ` • ${it.health.label}` : '';
  el.textContent = `${it.label} (${TYPE_NAMES_RU[it.type] || it.type}) • ${valTxt}${degTxt}${healthTxt}${noteTxt}`;
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
        let val = '';
        if (item.type === 'angle') val = item.deg != null ? `${item.deg.toFixed(1)}°` : '';
        else if (item.type === 'tilt') val = `${item.deg != null ? item.deg.toFixed(1) + '°' : ''} | ${item.value != null ? formatDist(item.value) : ''}`;
        else if (item.type === 'volume' && item.value != null) val = formatVolumeUnits(item.value);
        else if (item.value != null) val = formatDist(item.value);
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
        let val = '';
        if (item.type === 'angle') val = item.deg != null ? `${item.deg.toFixed(1)}°` : '';
        else if (item.type === 'tilt') val = `${item.deg != null ? item.deg.toFixed(1) + '°' : ''} | ${item.value != null ? formatDist(item.value) : ''}`;
        else if (item.type === 'volume' && item.value != null) val = formatVolumeUnits(item.value);
        else if (item.value != null) val = formatDist(item.value);
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
      show3dBefore,
      neckClipPlaneY
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
    neckClipPlaneY = Number.isFinite(data.neckClipPlaneY) ? data.neckClipPlaneY : null;
    updateScaleBadge();
    // Visuals will be rebuilt once model loads
    setTimeout(() => {
      rebuildAllVisuals();
      compute3dAsymmetry();
      update3dSelectedInfo();
      updateNeckClipHelper();
      applyNeckClipUI();
    }, 500);
  } catch (e) { /* ignore */ }
}

// ==================== UI BINDINGS ====================
function updateBtn3DStates() {
  document.getElementById('btnWireframe')?.classList.toggle('btn-active', wireframeMode);
  document.getElementById('btnNormals')?.classList.toggle('btn-active', normalsMode);

  const toolBtns = ['btn3dPoint', 'btn3dDistance', 'btn3dAngle', 'btn3dVector', 'btn3dTilt', 'btn3dMeasure', 'btn3dCalibrate', 'btn3dNeckClip'];
  toolBtns.forEach(id => document.getElementById(id)?.classList.remove('btn-active'));

  if (tool3dMode) {
    const map = {
      point: 'btn3dPoint', distance: 'btn3dDistance', angle: 'btn3dAngle',
      vector: 'btn3dVector', tilt: 'btn3dTilt', measure: 'btn3dMeasure',
      calibration: 'btn3dCalibrate', neckClip: 'btn3dNeckClip'
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
    calibration: 'Калибровка: выберите 2 точки на модели.',
    neckClip: 'Отсечение по шее: кликните по уровню среза на модели.'
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
    const files = e.target.files; if (!files.length) return;
    // Check if OBJ file is present
    const objFile = Array.from(files).find(f => f.name.toLowerCase().endsWith('.obj'));
    const mtlFile = Array.from(files).find(f => f.name.toLowerCase().endsWith('.mtl'));
    if (objFile) {
      loadOBJModel(objFile, mtlFile, files);
    } else {
      const f = files[0];
      loadModel3D(URL.createObjectURL(f));
    }
  });
  document.getElementById('folderInput3d').addEventListener('change', e => {
    const files = e.target.files; if (!files.length) return;
    const objFile = Array.from(files).find(f => f.name.toLowerCase().endsWith('.obj'));
    const mtlFile = Array.from(files).find(f => f.name.toLowerCase().endsWith('.mtl'));
    if (objFile) {
      loadOBJModel(objFile, mtlFile, files);
    } else {
      const glbFile = Array.from(files).find(f => /\.(glb|gltf)$/i.test(f.name));
      if (glbFile) loadModel3D(URL.createObjectURL(glbFile));
      else setStatus3d('В папке не найден .obj или .glb файл.');
    }
  });
  document.getElementById('btnDeleteModel').addEventListener('click', () => {
    clearNeckClip({ silent: true });
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
  document.getElementById('btn3dVolume').addEventListener('click', computeMeshVolume);
  document.getElementById('btn3dCalibrate').addEventListener('click', () => setTool3D('calibration'));
  document.getElementById('btn3dNeckClip').addEventListener('click', () => setTool3D('neckClip'));
  document.getElementById('btn3dClearNeckClip').addEventListener('click', () => clearNeckClip());

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
  loadOBJ: loadOBJModel,
  computeVolume: computeMeshVolume,
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
