
const LS_KEY = "pmas_ultimate_project_v2";

function saveProject(){
  try{
    const payload = {
      patient: document.getElementById("patientName").value || "",
      date: document.getElementById("examDate").value || "",
      photoSrc: photo.src || "",
      measurements,
      scaleMMperPx,
      zoom,
      trichionPoint,
      planItems,
      planZones,
      beforeSnapshot,
      showBefore,
      procedure: document.getElementById("procedure")?.value || "",
      goal: document.getElementById("goal")?.value || "",
      notes: document.getElementById("notes")?.value || ""
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  }catch(e){  }
}

function loadProject(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    document.getElementById("patientName").value = data.patient || "";
    document.getElementById("examDate").value = data.date || "";
    measurements = data.measurements || {};
    scaleMMperPx = (typeof data.scaleMMperPx === "number") ? data.scaleMMperPx : null;
    if(scaleMMperPx != null) scaleBadge.textContent = `${scaleMMperPx.toFixed(6)} мм/пиксель`;
    const z = (typeof data.zoom === "number") ? data.zoom : 1;
    setZoom(z);
    trichionPoint = data.trichionPoint || null;
    planItems = Array.isArray(data.planItems) ? data.planItems : [];
    planZones = Array.isArray(data.planZones) ? data.planZones : [];
    beforeSnapshot = data.beforeSnapshot || null;
    showBefore = !!data.showBefore;
    const procEl = document.getElementById("procedure");
    if(procEl) procEl.value = data.procedure || "";
    const goalEl = document.getElementById("goal");
    if(goalEl) goalEl.value = data.goal || "";
    const notesEl = document.getElementById("notes");
    if(notesEl) notesEl.value = data.notes || "";
    if(data.photoSrc){
      photo.src = data.photoSrc;
      setStatus("Проект восстановлен. Если нужно — обновите калибровку.");
    }
    computeAndRender();
  }catch(e){  }
}

document.getElementById("patientName").addEventListener("input", saveProject);
document.getElementById("examDate").addEventListener("change", saveProject);
document.getElementById("procedure").addEventListener("change", saveProject);
document.getElementById("goal").addEventListener("input", saveProject);
document.getElementById("notes").addEventListener("input", saveProject);
document.getElementById("presetSelect").addEventListener("change", updatePresetHint);
document.getElementById("btnAddPreset").addEventListener("click", ()=>{
  const v = document.getElementById("presetSelect").value;
  if(!v){ setStatus("Выберите пресет."); return; }
  applyPreset(v);
});
updatePresetHint();
computeAsymmetry();
updateSelectedInfo();
if(document.getElementById("btnSnapshotBeforeTop")) document.getElementById("btnSnapshotBeforeTop").addEventListener("click", snapshotBefore);
if(document.getElementById("btnToggleBeforeTop")) document.getElementById("btnToggleBeforeTop").addEventListener("click", toggleBefore);
if(document.getElementById("btnResetToBeforeTop")) document.getElementById("btnResetToBeforeTop").addEventListener("click", resetToBefore);


document.getElementById("btnApplyShift").addEventListener("click", ()=>{
  if(!selectedPlan){ setStatus("Сначала выберите элемент плана (клик по строке)."); return; }
  if(!scaleMMperPx){ setStatus("Сначала выполните калибровку, чтобы работать в мм."); return; }
  const v = parseFloat(document.getElementById("plannedShiftMM").value);
  if(!isFinite(v) || v<=0){ setStatus("Введите смещение в мм (например 6.0)."); return; }

  if(selectedPlan.kind === "plan"){
    const it = (planItems||[]).find(x=>x.id===selectedPlan.id);
    if(!it || !it.p1 || !it.p2){ setStatus("Элемент не найден."); return; }

    if(it.type === "angle3"){
      setStatus("Планируемое смещение применяется к вектору/линии/измерению или зоне. Для клинического угла используйте drag&drop точек.");
      return;
    }

    const oldMM = (it.mm!=null ? it.mm : (it.px!=null ? mmFromPx(it.px) : null));
    const targetPx = v / scaleMMperPx;
    let dx = it.p2.x - it.p1.x;
    let dy = it.p2.y - it.p1.y;
    let cur = Math.hypot(dx,dy);
    if(!isFinite(cur) || cur < 1e-3){
      dx = 0; dy = -1;
      cur = 1;
    }

    const ux = dx/cur, uy = dy/cur;
    it.p2 = clampPointToImage({ x: it.p1.x + ux*targetPx, y: it.p1.y + uy*targetPx });
    it.px = distPx(it.p1, it.p2);
    it.mm = mmFromPx(it.px);
    if(it.type === "vector" || it.type === "tilt") it.deg = angleDeg(it.p1, it.p2);

    renderPlanList(); updateSelectedInfo(); redraw(); saveProject();
    const msg = (oldMM!=null) ? `Смещение применено: ${oldMM.toFixed(2)} → ${it.mm.toFixed(2)} мм.` : `Смещение применено: ${it.mm.toFixed(2)} мм.`;
    setStatus(msg);
  } else if(selectedPlan.kind === "zone"){
    const z = (planZones||[]).find(x=>x.id===selectedPlan.id);
    if(!z || !z.points || z.points.length<3){ setStatus("Зона не найдена."); return; }
    const cen = polygonCentroid(z.points);
    if(!z.liftTo){
      z.liftTo = clampPointToImage({ x: cen.x, y: cen.y - 50 });
    }

    const oldShiftPx = distPx(cen, z.liftTo);
    const oldShiftMM = mmFromPx(oldShiftPx);

    let dx = z.liftTo.x - cen.x;
    let dy = z.liftTo.y - cen.y;
    let cur = Math.hypot(dx,dy);

    if(!isFinite(cur) || cur < 1e-3){
      dx = 0; dy = -1; cur = 1;
    }

    const ux = dx/cur, uy = dy/cur;
    const targetPx = v / scaleMMperPx;
    z.liftTo = clampPointToImage({ x: cen.x + ux*targetPx, y: cen.y + uy*targetPx });

    renderPlanList(); updateSelectedInfo(); redraw(); saveProject();
    setStatus(`Смещение зоны применено: ${oldShiftMM!=null ? oldShiftMM.toFixed(2) : ""} → ${v.toFixed(2)} мм.`);
  }
});

function snapshotBefore(){
  beforeSnapshot = {
    ts: Date.now(),
    planItems: JSON.parse(JSON.stringify(planItems||[])),
    planZones: JSON.parse(JSON.stringify(planZones||[])),
    measurements: JSON.parse(JSON.stringify(measurements||{})),
    trichionPoint: (trichionPoint ? JSON.parse(JSON.stringify(trichionPoint)) : null),
    guides: (guides ? JSON.parse(JSON.stringify(guides)) : null),
    scaleMMperPx: (typeof scaleMMperPx==="number" ? scaleMMperPx : null)
  };
  showBefore = false;
  const bb = document.getElementById("beforeBadge");
  if(bb) bb.style.display = "none";
  const bt = document.getElementById("btnToggleBefore");
  if(bt) bt.textContent = "Показать «До»";
  const bt2 = document.getElementById("btnToggleBeforeTop");
  if(bt2) bt2.textContent = "Показать «До»";
  renderPlanList(); redraw(); saveProject();
  setStatus("Снимок «До» сохранён.");
}
function toggleBefore(){
  if(!beforeSnapshot){ setStatus("Сначала нажмите «Сохранить До»."); return; }
  showBefore = !showBefore;
  const bb = document.getElementById("beforeBadge");
  if(bb) bb.style.display = showBefore ? "inline-flex" : "none";
  const t = showBefore ? "Скрыть «До»" : "Показать «До»";
  const bt = document.getElementById("btnToggleBefore");
  if(bt) bt.textContent = t;
  const bt2 = document.getElementById("btnToggleBeforeTop");
  if(bt2) bt2.textContent = t;
  renderPlanList(); redraw();
  setStatus(showBefore ? "Показ «До» включен (серые пунктирные линии)." : "Показ «До» выключен.");
}
function resetToBefore(){
  if(!beforeSnapshot){ setStatus("Нет снимка «До»."); return; }
  planItems = JSON.parse(JSON.stringify(beforeSnapshot.planItems||[]));
  planZones = JSON.parse(JSON.stringify(beforeSnapshot.planZones||[]));
  measurements = JSON.parse(JSON.stringify(beforeSnapshot.measurements||{}));
  trichionPoint = beforeSnapshot.trichionPoint || null;
  guides = beforeSnapshot.guides || { midline:null, eyeline:null, thirds:null };
  if(beforeSnapshot.scaleMMperPx!=null) scaleMMperPx = beforeSnapshot.scaleMMperPx;

  selectedPlan = null;
  showBefore = false;
  const bb = document.getElementById("beforeBadge");
  if(bb) bb.style.display = "none";
  const bt = document.getElementById("btnToggleBefore");
  if(bt) bt.textContent = "Показать «До»";
  const bt2 = document.getElementById("btnToggleBeforeTop");
  if(bt2) bt2.textContent = "Показать «До»";
  renderPlanList(); updateSelectedInfo(); redraw(); saveProject();
  setStatus("Откат выполнен к состоянию «До».");
}


document.getElementById("btnSnapshotBefore").addEventListener("click", snapshotBefore);

document.getElementById("btnToggleBefore").addEventListener("click", toggleBefore);

document.getElementById("btnResetToBefore").addEventListener("click", resetToBefore);


loadProject();
renderPlanList();
try{
  const bb = document.getElementById('beforeBadge');
  const bt = document.getElementById('btnToggleBefore');
  if(bb) bb.style.display = (showBefore && beforeSnapshot) ? 'inline-flex' : 'none';
  if(bt) bt.textContent = (showBefore && beforeSnapshot) ? 'Скрыть «До»' : 'Показать «До»';
}catch(e){}
resizeOverlay();
