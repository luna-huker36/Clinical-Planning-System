
function setStatus(msg){ statusEl.textContent = msg; }

function setZoom(z){
  zoom = Math.max(0.5, Math.min(3.0, z));
  photo.style.transform = `scale(${zoom})`;
  overlay.style.transform = `scale(${zoom})`;
  zoomBadge.textContent = `${Math.round(zoom*100)}%`;
  redraw();
}

function setScale(mmPerPx){
  scaleMMperPx = mmPerPx;
  scaleBadge.textContent = `${mmPerPx.toFixed(6)} мм/пиксель`;
}

function clearAll(){
  mode = null; currentType = null; pendingPoints = [];
  measurements = {}; aiPoints = [];
  setScaleBadgeEmpty();
  abEl.textContent = "—";
  resultsEl.innerHTML = "";
  setStatus("Очищено. Загрузите фото и выполните калибровку.");
  redraw();
  saveProject();
}

function setScaleBadgeEmpty(){
  scaleMMperPx = null;
  scaleBadge.textContent = "—";
}

function computeAndRender(){
  let html = "";
  let H = null, L = null;
  for(const key of Object.keys(measurements)){
    const m = measurements[key];
    const px = distPx(m.p1, m.p2);
    const mm = (scaleMMperPx ? px * scaleMMperPx : null);
    if(key === "H") H = mm;
    if(key === "L") L = mm;

    html += `
      <div class="measure-row">
        <div>
          <span class="badge">${key}</span>
          <span style="margin-left:8px">${scaleMMperPx ? (mm.toFixed(2) + " мм (" + px.toFixed(1) + " px)") : (px.toFixed(1) + " px")}</span>
        </div>
        <button class="danger" onclick="deleteMeasurement('${key}')">Удалить</button>
      </div>`;
  }
  resultsEl.innerHTML = html || '<div class="small">Пока нет измерений</div>';

  if(H != null && L != null){
    const AB = Math.sqrt(H*H + L*L);
    abEl.textContent = `AB = ${AB.toFixed(2)} мм`;
  } else {
    abEl.textContent = "—";
  }
  saveProject();
}


function renderAiMetrics(){
  const sumEl = document.getElementById("aiSummary");
  const detEl = document.getElementById("aiDetails");
  if(!aiMetrics){
    sumEl.textContent = "—";
    detEl.innerHTML = "";
    return;
  }
  const parts = aiMetrics.thirds;
  const sym = aiMetrics.symmetry;
  const prop = aiMetrics.proportions;
  const idx = aiMetrics.harmonyIndex;

  sumEl.textContent = `Индекс гармонии: ${idx.toFixed(0)}/100 • Симметрия: ${sym.score.toFixed(0)}/100 • Трети: ${parts.score.toFixed(0)}/100`;

  detEl.innerHTML = `
    <div><b>Средняя линия</b>: отклонение носа от линии ≈ ${sym.noseOffsetMM.toFixed(2)} мм; асимметрия глаз ≈ ${sym.eyesAsymMM.toFixed(2)} мм</div>
    <div><b>Горизонталь глаз</b>: наклон ≈ ${prop.eyeTiltDeg.toFixed(1)}°</div>
    <div><b>Три трети лица</b>: ${parts.upperMM.toFixed(1)} / ${parts.middleMM.toFixed(1)} / ${parts.lowerMM.toFixed(1)} мм (верх/сред/низ)</div>
    <div><b>Доли</b>: ${(parts.upperRatio*100).toFixed(1)}% / ${(parts.middleRatio*100).toFixed(1)}% / ${(parts.lowerRatio*100).toFixed(1)}% (идеал ~33.3% каждая)</div>
  `;
}

function nextId(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function mmFromPx(px){
  return scaleMMperPx ? px * scaleMMperPx : null;
}
function computePlanItem(type, label, p1, p2, p3=null){
  const px = distPx(p1, p2);
  const mm = mmFromPx(px);

  let deg = null;
  if(type === "vector" || type === "measure" || type === "tilt"){
    deg = angleDeg(p1, p2);
  } else if(type === "angle3"){
    if(p3){
      const v1x = p1.x - p2.x, v1y = p1.y - p2.y;
      const v2x = p3.x - p2.x, v2y = p3.y - p2.y;
      const dot = v1x*v2x + v1y*v2y;
      const n1 = Math.hypot(v1x,v1y) || 1;
      const n2 = Math.hypot(v2x,v2y) || 1;
      const cos = Math.max(-1, Math.min(1, dot/(n1*n2)));
      deg = Math.acos(cos) * 180/Math.PI;
    }
  }

  const item = { id: nextId(), type, label: label || type, p1, p2, px, mm, deg };
  if(type === "angle3" && p3) item.p3 = p3;
  return item;
}
function renderPlanList(){
  const el = document.getElementById("planList");
  const parts = [];
  if(planItems && planItems.length){
    parts.push(planItems.map(it=>{
      const mmTxt = (scaleMMperPx && it.mm!=null) ? (it.mm.toFixed(2)+' мм (' + it.px.toFixed(1)+' px)') : (it.px.toFixed(1)+' px');
      const degTxt = it.deg!=null ? (' • '+it.deg.toFixed(1)+'°') : '';
      const typeTxt = (it.type==="vector"?"Вектор":it.type==="tilt"?"Наклон":it.type==="angle3"?"Клинич. угол":it.type==="guide"?"Линия":"Измерение");
      const isSel = (selectedPlan && selectedPlan.kind==="plan" && selectedPlan.id===it.id);
      const selStyle = isSel ? "outline:2px solid rgba(59,130,246,0.55); border-radius:12px;" : "";
      return `<div class="measure-row" onclick="selectPlanItem('plan','${it.id}')" style="cursor:pointer; ${selStyle}">
        <div>
          <span class="badge">${typeTxt}</span>
          <span style="margin-left:8px"><b>${escapeHtml(it.label)}</b>: ${mmTxt}${degTxt}</span>
        </div>
        <button class="danger" onclick="stopAndDeletePlanItem(event, '${it.id}')">Удалить</button>
      </div>`;
    }).join(""));
  }
  if(planZones && planZones.length){
    const zHtml = planZones.map(z=>{
      const areaPx2 = polygonAreaPx2(z.points);
      const areaMm2 = (scaleMMperPx ? areaPx2 * scaleMMperPx * scaleMMperPx : null);
      const cen = polygonCentroid(z.points);
      const shiftPx = (z.liftTo ? distPx(cen, z.liftTo) : 0);
      const shiftMm = (scaleMMperPx ? shiftPx * scaleMMperPx : null);
      const aTxt = (scaleMMperPx && areaMm2!=null) ? ((areaMm2/100.0).toFixed(2)+' см² (' + areaPx2.toFixed(0)+' px²)') : (areaPx2.toFixed(0)+' px²');
      const sTxt = (z.liftTo ? (scaleMMperPx && shiftMm!=null ? (shiftMm.toFixed(2)+' мм (' + shiftPx.toFixed(1)+' px)') : (shiftPx.toFixed(1)+' px')) : '—');
      const isSel = (selectedPlan && selectedPlan.kind==="zone" && selectedPlan.id===z.id);
      const selStyle = isSel ? "outline:2px solid rgba(59,130,246,0.55); border-radius:12px;" : "";
      return `<div class="measure-row" onclick="selectPlanItem('zone','${z.id}')" style="cursor:pointer; ${selStyle}">
        <div>
          <span class="badge">Зона</span>
          <span style="margin-left:8px"><b>${escapeHtml(z.label)}</b>: площадь ${aTxt} • смещение ${sTxt}</span>
        </div>
        <button class="danger" onclick="stopAndDeleteZone(event, '${z.id}')">Удалить</button>
      </div>`;
    }).join("");
    parts.push(`<div style="margin-top:6px">${zHtml}</div>`);
  }

  el.innerHTML = parts.join("") || '<div class="small">Пока нет элементов плана</div>';
  computeAsymmetry();
  updateSelectedInfo();
}
function deletePlanItem(id){
  planItems = planItems.filter(x=>x.id!==id);
  renderPlanList();
  redraw();
  saveProject();
}
window.deletePlanItem = deletePlanItem;

function stopAndDeletePlanItem(ev, id){ if(ev) ev.stopPropagation(); deletePlanItem(id); }
function stopAndDeleteZone(ev, id){ if(ev) ev.stopPropagation(); deleteZone(id); }
window.stopAndDeletePlanItem = stopAndDeletePlanItem;
window.stopAndDeleteZone = stopAndDeleteZone;

function deleteZone(id){
  planZones = (planZones||[]).filter(z=>z.id!==id);
  renderPlanList();
  redraw();
  saveProject();
}
window.deleteZone = deleteZone;

function selectPlanItem(kind, id){
  selectedPlan = { kind, id };
  updateSelectedInfo();
  renderPlanList();
  redraw();
}
window.selectPlanItem = selectPlanItem;


function isSelectedPlanId(id){ return selectedPlan && selectedPlan.kind==="plan" && selectedPlan.id===id; }
function isSelectedZoneId(id){ return selectedPlan && selectedPlan.kind==="zone" && selectedPlan.id===id; }

function clearPlanForNewPhoto(){
  planItems = [];
  planZones = [];
  selectedPlan = null;
  beforeSnapshot = null;
  showBefore = false;
  aiPickPending = [];
  planPending = [];
  planMode = null;
  document.getElementById("beforeBadge") && (document.getElementById("beforeBadge").style.display="none");
  const bt = document.getElementById("btnToggleBefore");
  if(bt) bt.textContent = "Показать «До»";
  renderPlanList();
  redraw();
  saveProject();
}

function updateSelectedInfo(){
  const el = document.getElementById("selectedItemInfo");
  if(!el) return;
  if(!selectedPlan){ el.textContent = "—"; return; }
  if(selectedPlan.kind === "plan"){
    const it = (planItems||[]).find(x=>x.id===selectedPlan.id);
    if(!it){ el.textContent = "—"; return; }
    const mmTxt = it.mm!=null ? it.mm.toFixed(2)+" мм" : it.px.toFixed(1)+" px";
    const degTxt = it.deg!=null ? (" • "+it.deg.toFixed(1)+"°") : "";
    el.textContent = `${it.label} (${it.type}) • ${mmTxt}${degTxt}`;
  } else if(selectedPlan.kind === "zone"){
    const z = (planZones||[]).find(x=>x.id===selectedPlan.id);
    if(!z){ el.textContent = "—"; return; }
    const areaPx2 = polygonAreaPx2(z.points);
    const areaTxt = scaleMMperPx ? ((areaPx2*scaleMMperPx*scaleMMperPx)/100.0).toFixed(2)+" см²" : areaPx2.toFixed(0)+" px²";
    const cen = polygonCentroid(z.points);
    const shiftPx = z.liftTo ? distPx(cen, z.liftTo) : 0;
    const shiftTxt = z.liftTo ? (scaleMMperPx ? (shiftPx*scaleMMperPx).toFixed(2)+" мм" : shiftPx.toFixed(1)+" px") : "—";
    el.textContent = `${z.label} (zone) • площадь ${areaTxt} • смещение ${shiftTxt}`;
  } else {
    el.textContent = "—";
  }
}



function computeAsymmetry(){
  const box = document.getElementById("asymmetryBox");
  if(!box){ return; }
  function normLabel(lbl){
    return String(lbl||"").replace(/\s*\((R|L)\)\s*$/i,"").replace(/\s*•\s*(R|L)\s*$/i,"").trim();
  }
  function sideFromLabel(lbl){
    const s = String(lbl||"");
    if(/\(R\)\s*$/i.test(s) || /\s•\s*.*\(R\)/i.test(s) || /\s\(R\)/i.test(s) || /\s\bR\b\)?\s*$/i.test(s)) return "R";
    if(/\(L\)\s*$/i.test(s) || /\s\bL\b\)?\s*$/i.test(s)) return "L";
    if(/\(R\)/i.test(s)) return "R";
    if(/\(L\)/i.test(s)) return "L";
    return null;
  }
  const pairs = {};
  for(const it of (planItems||[])){
    const side = sideFromLabel(it.label);
    if(!side) continue;
    const key = it.type + "::" + normLabel(it.label).replace(/\s+\(R\)|\s+\(L\)/gi,"");
    pairs[key] = pairs[key] || {};
    pairs[key][side] = it;
  }

  const lines = [];
  for(const key of Object.keys(pairs)){
    const p = pairs[key];
    if(!p.R || !p.L) continue;
    const name = key.split("::")[1] || "—";
    const rmm = p.R.mm, lmm = p.L.mm;
    const rdeg = p.R.deg, ldeg = p.L.deg;
    const mmDiff = (rmm!=null && lmm!=null) ? Math.abs(rmm - lmm) : null;
    const degDiff = (rdeg!=null && ldeg!=null) ? Math.abs(rdeg - ldeg) : null;
    const parts = [];
    if(mmDiff!=null) parts.push(`Δдлина ${mmDiff.toFixed(2)} мм`);
    if(degDiff!=null) parts.push(`Δугол ${degDiff.toFixed(1)}°`);
    if(parts.length) lines.push(`<div>• <b>${escapeHtml(name)}</b>: ${parts.join(" • ")}</div>`);
  }
  const zpairs = {};
  for(const z of (planZones||[])){
    const side = sideFromLabel(z.label);
    if(!side) continue;
    const key = "zone::" + normLabel(z.label).replace(/\s+\(R\)|\s+\(L\)/gi,"");
    zpairs[key] = zpairs[key] || {};
    zpairs[key][side] = z;
  }
  for(const key of Object.keys(zpairs)){
    const p = zpairs[key];
    if(!p.R || !p.L) continue;
    const name = key.split("::")[1] || "—";
    const aR = polygonAreaPx2(p.R.points);
    const aL = polygonAreaPx2(p.L.points);
    const areaDiff = scaleMMperPx ? Math.abs(aR-aL)*scaleMMperPx*scaleMMperPx/100.0 : Math.abs(aR-aL);
    const cenR = polygonCentroid(p.R.points);
    const cenL = polygonCentroid(p.L.points);
    const sR = p.R.liftTo ? distPx(cenR, p.R.liftTo) : 0;
    const sL = p.L.liftTo ? distPx(cenL, p.L.liftTo) : 0;
    const shiftDiff = scaleMMperPx ? Math.abs(sR-sL)*scaleMMperPx : Math.abs(sR-sL);
    const aTxt = scaleMMperPx ? `Δплощадь ${areaDiff.toFixed(2)} см²` : `Δплощадь ${areaDiff.toFixed(0)} px²`;
    const sTxt = scaleMMperPx ? `Δсмещение ${shiftDiff.toFixed(2)} мм` : `Δсмещение ${shiftDiff.toFixed(1)} px`;
    lines.push(`<div>• <b>${escapeHtml(name)}</b> (зона): ${aTxt} • ${sTxt}</div>`);
  }

  if(!lines.length){
    box.innerHTML = "— (для расчёта нужны пары R/L элементов или зон, например из facelift-пресетов)";
    return;
  }
  box.innerHTML = lines.join("");
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

