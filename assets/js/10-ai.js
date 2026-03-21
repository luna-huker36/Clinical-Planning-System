
document.getElementById("btnAI").addEventListener("click", runAI);

let faceModel = null;



async function ensureFaceModel(){
  if(faceModel) return faceModel;

  if(typeof faceLandmarksDetection === "undefined"){
    throw new Error("face-landmarks-detection не загрузился");
  }
  const model = faceLandmarksDetection.SupportedModels?.MediaPipeFaceMesh;
  if(!model){
    throw new Error("Нет SupportedModels.MediaPipeFaceMesh (обновите скрипт / проверьте CDN)");
  }
  faceModel = await faceLandmarksDetection.createDetector(model, {
    runtime: "mediapipe",
    solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4",
    refineLandmarks: true,
    maxFaces: 1
  });

  return faceModel;
}

async function runAI(){
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  try{
    setStatus("AI: загрузка детектора и поиск ориентиров… (нужен интернет)");
    const detector = await ensureFaceModel();
    const tmp = document.createElement("canvas");
    tmp.width = photo.naturalWidth;
    tmp.height = photo.naturalHeight;
    const tctx = tmp.getContext("2d", { willReadFrequently:true });
    tctx.drawImage(photo, 0, 0);

    const faces = await detector.estimateFaces(tmp, { flipHorizontal: false });
    if(!faces || !faces.length){
      aiPoints = [];
      redraw();
      setStatus("AI: лицо не найдено. Попробуйте другое фото (фронтально, хорошее освещение).");
      return;
    }
    const keypoints = faces[0].keypoints || faces[0].keypoints3D || [];
    lastAIKeypoints = keypoints;
    if(!keypoints.length){
      aiPoints = [];
      redraw();
      setStatus("AI: ориентиры не получены.");
      return;
    }
    function pickByName(name){
      const kp = keypoints.find(k => k.name === name);
      return kp ? { x: kp.x, y: kp.y, label: name } : null;
    }
    const picked = [];
    const byName = [
      "noseTip",
      "rightEyeOuter",
      "leftEyeOuter",
      "chin",
      "lipsUpperOuter",
      "lipsLowerOuter",
    ];
    for(const n of byName){
      const p = pickByName(n);
      if(p) picked.push(p);
    }
    if(picked.length < 4){
      const idxs = [1, 33, 263, 152, 13, 14];
      for(const i of idxs){
        const kp = keypoints[i];
        if(kp) picked.push({ x: kp.x, y: kp.y, label: "p"+i });
      }
    }
    const uniq = [];
    for(const p of picked){
      if(!uniq.some(u => Math.hypot(u.x-p.x,u.y-p.y) < 0.5)) uniq.push(p);
    }

    aiPoints = uniq;
    buildGuidesAndMetricsFromDetector(faces[0], keypoints);
    redraw();
    renderAiMetrics();
    setStatus(`AI: ориентиры найдены (${aiPoints.length} точек).`);
  }catch(err){
    console.error(err);
    const msg = (err && err.message) ? err.message : "неизвестная ошибка";
    setStatus("AI: ошибка ("+msg+"). Проверьте интернет и консоль браузера (F12 → Console).");
  }
}




function pickKeypoint(keypoints, wantedNames, fallbackIndex){
  if(Array.isArray(wantedNames)){
    for(const n of wantedNames){
      const kp = keypoints.find(k => k && k.name === n);
      if(kp) return { x: kp.x, y: kp.y, label: n };
    }
  }
  if(typeof fallbackIndex === "number" && keypoints[fallbackIndex]){
    const kp = keypoints[fallbackIndex];
    return { x: kp.x, y: kp.y, label: "p"+fallbackIndex };
  }
  return null;
}

function buildGuidesAndMetricsFromDetector(face, keypoints){
  const leftEyeOuter  = pickKeypoint(keypoints, ["leftEyeOuter"], 263);
  const rightEyeOuter = pickKeypoint(keypoints, ["rightEyeOuter"], 33);
  const noseTip       = pickKeypoint(keypoints, ["noseTip"], 1);
  const chin          = pickKeypoint(keypoints, ["chin"], 152);
  let topMost = null;
  for(const kp of keypoints){
    if(!kp || typeof kp.x!=="number" || typeof kp.y!=="number") continue;
    if(!topMost || kp.y < topMost.y) topMost = { x: kp.x, y: kp.y, label:"topMost" };
  }

  const glabella = pickKeypoint(keypoints, ["midwayBetweenEyes"], 9) || (leftEyeOuter && rightEyeOuter
    ? { x: (leftEyeOuter.x+rightEyeOuter.x)/2, y: (leftEyeOuter.y+rightEyeOuter.y)/2, label:"midEyes" }
    : null);

  const subnasale = pickKeypoint(keypoints, ["noseBottom"], 2) || pickKeypoint(keypoints, ["noseTip"], 1);
  guides.eyeline = (leftEyeOuter && rightEyeOuter) ? { p1: rightEyeOuter, p2: leftEyeOuter } : null;
  const midTop = glabella || noseTip || topMost;
  const midBottom = chin || noseTip;
  guides.midline = (midTop && midBottom) ? { p1: midTop, p2: midBottom } : null;
  const topY = (trichionPoint && typeof trichionPoint.y === "number") ? trichionPoint.y : (topMost ? topMost.y : (glabella ? glabella.y - 120 : 0));
  const glabY = glabella ? glabella.y : (noseTip ? noseTip.y - 80 : topY + 120);
  const subY = subnasale ? subnasale.y : (noseTip ? noseTip.y + 60 : glabY + 120);
  const chinY = chin ? chin.y : (subY + 180);

  guides.thirds = { topY, glabellaY: glabY, subnasaleY: subY, chinY };
  let eyeTiltDeg = 0;
  if(leftEyeOuter && rightEyeOuter){
    eyeTiltDeg = angleDeg(rightEyeOuter, leftEyeOuter);
  }
  let symScore = 0, eyesAsymMM = 0, noseOffsetMM = 0;
  if(guides.midline && scaleMMperPx){
    const line = lineFromPoints(guides.midline.p1, guides.midline.p2);
    if(noseTip){
      noseOffsetMM = Math.abs(signedDistanceToLine(line, noseTip)) * scaleMMperPx;
    }
    if(leftEyeOuter && rightEyeOuter){
      const dL = Math.abs(signedDistanceToLine(line, leftEyeOuter));
      const dR = Math.abs(signedDistanceToLine(line, rightEyeOuter));
      eyesAsymMM = Math.abs(dL - dR) * scaleMMperPx;
    }
    let faceW = (leftEyeOuter && rightEyeOuter) ? distPx(leftEyeOuter, rightEyeOuter) * scaleMMperPx : 60;
    const asymNorm = (eyesAsymMM + noseOffsetMM) / Math.max(faceW, 1);
    symScore = Math.max(0, 100 - asymNorm * 220);
  }
  const upperPx = Math.max(1, glabY - topY);
  const middlePx = Math.max(1, subY - glabY);
  const lowerPx = Math.max(1, chinY - subY);
  const totalPx = upperPx + middlePx + lowerPx;
  const upperRatio = upperPx / totalPx;
  const middleRatio = middlePx / totalPx;
  const lowerRatio = lowerPx / totalPx;
  const dev = Math.abs(upperRatio - 1/3) + Math.abs(middleRatio - 1/3) + Math.abs(lowerRatio - 1/3);
  const thirdsScore = Math.max(0, 100 - dev * 300);

  const px2mm = scaleMMperPx || 1;
  const upperMM = upperPx * px2mm;
  const middleMM = middlePx * px2mm;
  const lowerMM = lowerPx * px2mm;
  const tiltPenalty = Math.min(30, Math.abs(eyeTiltDeg) * 2.0);
  const thirdsPenalty = Math.min(45, (100 - thirdsScore) * 0.45);
  const symPenalty = (scaleMMperPx ? Math.min(35, (100 - symScore) * 0.35) : 10);

  const harmony = Math.max(0, 100 - (tiltPenalty + thirdsPenalty + symPenalty));

  aiMetrics = {
    symmetry: {
      score: scaleMMperPx ? symScore : 0,
      eyesAsymMM: scaleMMperPx ? eyesAsymMM : 0,
      noseOffsetMM: scaleMMperPx ? noseOffsetMM : 0
    },
    proportions: {
      eyeTiltDeg
    },
    thirds: {
      score: thirdsScore,
      upperMM, middleMM, lowerMM,
      upperRatio, middleRatio, lowerRatio
    },
    harmonyIndex: harmony
  };
}


function getAIKeypoint(names, fallbackIdx){
  const kps = lastAIKeypoints;
  if(!kps || !kps.length) return null;
  if(Array.isArray(names)){
    for(const n of names){
      const kp = kps.find(k => k && k.name === n);
      if(kp) return { x: kp.x, y: kp.y };
    }
  }
  if(typeof fallbackIdx === "number" && kps[fallbackIdx]){
    const kp = kps[fallbackIdx];
    return { x: kp.x, y: kp.y };
  }
  return null;
}

function requireAI(){
  if(!photo.src){ setStatus("Сначала загрузите фото."); return false; }
  if(!lastAIKeypoints || !lastAIKeypoints.length){
    setStatus("Для пресетов сначала нажмите: AI ориентиры.");
    return false;
  }
  return true;
}


function applyPreset(presetId){
  if(!requireAI()) return;

  const labelEl = document.getElementById("planLabel");
  const presetLabelMap = {
    eye_cant: "Eye cant (tilt)",
    nose_axis: "Nose axis (tilt)",
    nasolabial: "Nasolabial angle",
    chin_tilt: "Chin line (tilt)",
    facelift_lines: "Facelift vectors (basic)",
    facelift_smas: "Facelift • SMAS plication",
    facelift_deepplane: "Facelift • Deep-plane",
    facelift_macs: "Facelift • MACS"
  };

  const label = (labelEl && labelEl.value) ? labelEl.value : (presetLabelMap[presetId] || "Preset");
  let item = null;

  if(presetId === "eye_cant"){
    const r = getAIKeypoint(["rightEyeOuter"], 33);
    const l = getAIKeypoint(["leftEyeOuter"], 263);
    if(!r || !l){ setStatus("Пресет не найден: точки глаз недоступны."); return; }
    item = computePlanItem("tilt", label, r, l);
  }

  if(presetId === "nose_axis"){
    const g = getAIKeypoint(["midwayBetweenEyes"], 9) || getAIKeypoint(["noseTip"], 1);
    const n = getAIKeypoint(["noseTip"], 1);
    if(!g || !n){ setStatus("Пресет не найден: точки носа недоступны."); return; }
    item = computePlanItem("tilt", label, g, n);
  }

  if(presetId === "nasolabial"){
    const A = getAIKeypoint(["noseBottom"], 2) || getAIKeypoint(["noseTip"], 1);
    const B = getAIKeypoint(["noseBottom"], 2) || getAIKeypoint(["noseTip"], 1);
    const C = getAIKeypoint(["lipsUpperOuter", "upperLipTop"], 13) || getAIKeypoint(["upperLipTop"], 13);
    if(!A || !B || !C){ setStatus("Пресет не найден: точки нос/губ недоступны."); return; }
    item = computePlanItem("angle3", label, A, B, C);
  }

  if(presetId === "chin_tilt"){
    const lip = getAIKeypoint(["lipsLowerOuter", "lowerLipBottom"], 14) || getAIKeypoint(["lipsLowerOuter"], 14);
    const chin = getAIKeypoint(["chin"], 152);
    if(!lip || !chin){ setStatus("Пресет не найден: точки подбородка/губ недоступны."); return; }
    item = computePlanItem("tilt", label, lip, chin);
  }
  if(presetId === "facelift_lines" || presetId === "facelift_smas" || presetId === "facelift_deepplane" || presetId === "facelift_macs"){
    const rEye = getAIKeypoint(["rightEyeOuter"], 33);
    const lEye = getAIKeypoint(["leftEyeOuter"], 263);
    const rMouth = getAIKeypoint(["mouthRight", "lipsRight"], 291);
    const lMouth = getAIKeypoint(["mouthLeft", "lipsLeft"], 61);
    const chin = getAIKeypoint(["chin"], 152);

    if(!rEye || !lEye || !rMouth || !lMouth || !chin){
      setStatus("Фейслифтинг пресет: недостаточно AI-точек. Нажмите AI ориентиры и используйте фронтальное фото.");
      return;
    }

    const faceW = Math.hypot(lEye.x - rEye.x, lEye.y - rEye.y) || 200;
    const rTemp = { x: rEye.x - 0.45*faceW, y: rEye.y - 0.20*faceW };
    const lTemp = { x: lEye.x + 0.45*faceW, y: lEye.y - 0.20*faceW };
    const rEar  = { x: rEye.x - 0.55*faceW, y: rEye.y + 0.15*faceW };
    const lEar  = { x: lEye.x + 0.55*faceW, y: lEye.y + 0.15*faceW };

    const rJowl = getAIKeypoint([], 172) || { x: (rMouth.x + chin.x)/2, y: (rMouth.y + chin.y)/2 + 0.10*faceW };
    const lJowl = getAIKeypoint([], 397) || { x: (lMouth.x + chin.x)/2, y: (lMouth.y + chin.y)/2 + 0.10*faceW };

    const rMalar = { x: (rEye.x + rMouth.x)/2, y: (rEye.y + rMouth.y)/2 };
    const lMalar = { x: (lEye.x + lMouth.x)/2, y: (lEye.y + lMouth.y)/2 };

    function clamp(p){
      const iw = photo.naturalWidth || 0, ih = photo.naturalHeight || 0;
      return { x: Math.max(0, Math.min(iw, p.x)), y: Math.max(0, Math.min(ih, p.y)) };
    }

    function addItems(items){
      for(const it of items){
        it.p1 = clamp(it.p1); it.p2 = clamp(it.p2);
        if(it.type==="angle3" && it.p3) it.p3 = clamp(it.p3);
        planItems.push(it);
      }
    }

    function addZone(labelZ, side, pts, liftTo){
      const z = { id: nextId(), label: labelZ, side, points: pts.map(clamp), liftTo: liftTo ? clamp(liftTo) : null };
      planZones.push(z);
    }
    const base = (label || "Facelift");

    if(presetId === "facelift_lines"){
      addItems([
        computePlanItem("guide", base + " • Malar→Temporal (R)", rMalar, rTemp),
        computePlanItem("guide", base + " • Jowl→Preauricular (R)", rJowl, rEar),
        computePlanItem("guide", base + " • Mouth→Temporal (R)", rMouth, rTemp),
        computePlanItem("guide", base + " • Malar→Temporal (L)", lMalar, lTemp),
        computePlanItem("guide", base + " • Jowl→Preauricular (L)", lJowl, lEar),
        computePlanItem("guide", base + " • Mouth→Temporal (L)", lMouth, lTemp),
      ]);
    }

    if(presetId === "facelift_smas"){
      const rTemp2 = { x: rEye.x - 0.38*faceW, y: rEye.y - 0.16*faceW };
      const lTemp2 = { x: lEye.x + 0.38*faceW, y: lEye.y - 0.16*faceW };
      addItems([
        computePlanItem("vector", base + " • SMAS malar (R)", rMalar, rTemp2),
        computePlanItem("vector", base + " • SMAS jowl (R)", rJowl, rEar),
        computePlanItem("vector", base + " • SMAS malar (L)", lMalar, lTemp2),
        computePlanItem("vector", base + " • SMAS jowl (L)", lJowl, lEar),
      ]);
    }

    if(presetId === "facelift_deepplane"){
      const rTemp3 = { x: rEye.x - 0.50*faceW, y: rEye.y - 0.24*faceW };
      const lTemp3 = { x: lEye.x + 0.50*faceW, y: lEye.y - 0.24*faceW };
      const rNeckAnchor = { x: rEar.x, y: rEar.y + 0.25*faceW };
      const lNeckAnchor = { x: lEar.x, y: lEar.y + 0.25*faceW };
      const rNeck = { x: (rJowl.x + chin.x)/2, y: rJowl.y + 0.25*faceW };
      const lNeck = { x: (lJowl.x + chin.x)/2, y: lJowl.y + 0.25*faceW };
      addItems([
        computePlanItem("vector", base + " • Deep-plane malar (R)", rMalar, rTemp3),
        computePlanItem("vector", base + " • Deep-plane jowl (R)", rJowl, rEar),
        computePlanItem("vector", base + " • Deep-plane neck (R)", rNeck, rNeckAnchor),
        computePlanItem("vector", base + " • Deep-plane malar (L)", lMalar, lTemp3),
        computePlanItem("vector", base + " • Deep-plane jowl (L)", lJowl, lEar),
        computePlanItem("vector", base + " • Deep-plane neck (L)", lNeck, lNeckAnchor),
      ]);
    }

    if(presetId === "facelift_macs"){
      const rTemp4 = { x: rEye.x - 0.42*faceW, y: rEye.y - 0.22*faceW };
      const lTemp4 = { x: lEye.x + 0.42*faceW, y: lEye.y - 0.22*faceW };
      const rMidCheek = { x: (rMalar.x + rJowl.x)/2, y: (rMalar.y + rJowl.y)/2 };
      const lMidCheek = { x: (lMalar.x + lJowl.x)/2, y: (lMalar.y + lJowl.y)/2 };
      addItems([
        computePlanItem("vector", base + " • MACS cheek 1 (R)", rMalar, rTemp4),
        computePlanItem("vector", base + " • MACS cheek 2 (R)", rMidCheek, rTemp4),
        computePlanItem("vector", base + " • MACS jowl (R)", rJowl, rTemp4),
        computePlanItem("vector", base + " • MACS cheek 1 (L)", lMalar, lTemp4),
        computePlanItem("vector", base + " • MACS cheek 2 (L)", lMidCheek, lTemp4),
        computePlanItem("vector", base + " • MACS jowl (L)", lJowl, lTemp4),
      ]);
    }
    const zOff = 0.10*faceW;
    addZone(base + " • MALAR (R)", "R", [
      {x:rEye.x - 0.12*faceW, y:rEye.y + 0.02*faceW},
      {x:rEye.x - 0.30*faceW, y:rEye.y + 0.12*faceW},
      {x:rMouth.x - 0.20*faceW, y:rMouth.y - 0.05*faceW},
      {x:rMouth.x - 0.05*faceW, y:rMouth.y - 0.18*faceW},
    ], rTemp);

    addZone(base + " • JOWL (R)", "R", [
      {x:rMouth.x - 0.05*faceW, y:rMouth.y + 0.02*faceW},
      {x:rMouth.x - 0.25*faceW, y:rMouth.y + 0.18*faceW},
      {x:rJowl.x - 0.10*faceW, y:rJowl.y + 0.18*faceW},
      {x:rJowl.x + 0.05*faceW, y:rJowl.y + 0.02*faceW},
    ], rEar);

    addZone(base + " • NECK (R)", "R", [
      {x:rJowl.x - 0.10*faceW, y:rJowl.y + 0.18*faceW},
      {x:rEar.x - 0.05*faceW, y:rEar.y + 0.40*faceW},
      {x:(rEar.x + chin.x)/2, y:rEar.y + 0.55*faceW},
      {x:(rJowl.x + chin.x)/2, y:rJowl.y + 0.45*faceW},
    ], {x:rEar.x, y:rEar.y + 0.20*faceW});
    addZone(base + " • MALAR (L)", "L", [
      {x:lEye.x + 0.12*faceW, y:lEye.y + 0.02*faceW},
      {x:lEye.x + 0.30*faceW, y:lEye.y + 0.12*faceW},
      {x:lMouth.x + 0.20*faceW, y:lMouth.y - 0.05*faceW},
      {x:lMouth.x + 0.05*faceW, y:lMouth.y - 0.18*faceW},
    ], lTemp);

    addZone(base + " • JOWL (L)", "L", [
      {x:lMouth.x + 0.05*faceW, y:lMouth.y + 0.02*faceW},
      {x:lMouth.x + 0.25*faceW, y:lMouth.y + 0.18*faceW},
      {x:lJowl.x + 0.10*faceW, y:lJowl.y + 0.18*faceW},
      {x:lJowl.x - 0.05*faceW, y:lJowl.y + 0.02*faceW},
    ], lEar);

    addZone(base + " • NECK (L)", "L", [
      {x:lJowl.x + 0.10*faceW, y:lJowl.y + 0.18*faceW},
      {x:lEar.x + 0.05*faceW, y:lEar.y + 0.40*faceW},
      {x:(lEar.x + chin.x)/2, y:lEar.y + 0.55*faceW},
      {x:(lJowl.x + chin.x)/2, y:lJowl.y + 0.45*faceW},
    ], {x:lEar.x, y:lEar.y + 0.20*faceW});

    renderPlanList();
    redraw();
    saveProject();
    setStatus("Фейслифтинг: добавлены векторы и зоны (полигоны). Точки/вершины можно перетаскивать мышью.");
    return;
  }

  if(!item){ setStatus("Не удалось применить пресет."); return; }

  planItems.push(item);
  renderPlanList();
  redraw();
  saveProject();
  setStatus("Пресет добавлен в план.");
}

function updatePresetHint(){
  const sel = document.getElementById("presetSelect");
  const hint = document.getElementById("presetHint");
  if(!sel || !hint) return;
  const v = sel.value;
  const map = {
    eye_cant: "Использует AI-точки наружных углов глаз. Результат: наклон линии глаз относительно горизонта.",
    nose_axis: "Использует точку между глазами (glabella proxy) и кончик носа. Результат: наклон оси носа.",
    nasolabial: "Угол (3 точки): основание носа → subnasale (вершина) → верхняя губа. Пригодно для ринопластики (оценка носогубного угла).",
    chin_tilt: "Использует нижнюю губу и подбородок. Результат: наклон линии нижней трети.",
    facelift_lines: "Базовые линии/векторы для фейслифтинга: malar→temporal, jowl→preauricular, mouth→temporal (R/L).",
    facelift_smas: "SMAS plication: более короткие суперолатеральные векторы + зоны (malar/jowl/neck) с расчетом площади и смещения.",
    facelift_deepplane: "Deep-plane: усиленный malar-лифт + jowl/neck векторы; строит зоны и смещения (мм).",
    facelift_macs: "MACS: 2–3 вертикально-суперолатеральных purse-string вектора к височной фасции; строит зоны и смещения."
  };
  hint.textContent = map[v] || "";
}

