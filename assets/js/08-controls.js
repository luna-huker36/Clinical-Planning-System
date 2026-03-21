
document.getElementById("btnCal").addEventListener("click", ()=>{
  planMode = null; planPending = []; aiPickPending = []; aiPickMode = false; document.getElementById("aiPickBadge").style.display="none";
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  mode = "calibration";
  currentType = null;
  pendingPoints = [];
  setStatus("Калибровка: выберите 2 точки известного расстояния.");
});

document.getElementById("btnH").addEventListener("click", ()=>{
  planMode = null; planPending = [];
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  if(!scaleMMperPx){ setStatus("Сначала выполните калибровку."); return; }
  mode = "measure";
  currentType = "H";
  pendingPoints = [];
  setStatus("Измерение H: выберите 2 точки.");
});

document.getElementById("btnL").addEventListener("click", ()=>{
  planMode = null; planPending = [];
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  if(!scaleMMperPx){ setStatus("Сначала выполните калибровку."); return; }
  mode = "measure";
  currentType = "L";
  pendingPoints = [];
  setStatus("Измерение L: выберите 2 точки.");
});

document.getElementById("btnTrichion").addEventListener("click", ()=>{
  planMode = null; planPending = [];
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  mode = "trichion";
  currentType = null;
  pendingPoints = [];
  setStatus("Trichion: кликните по средней линии роста волос (верхняя граница верхней трети).");
});

document.getElementById("btnPlanVector").addEventListener("click", ()=>{
  mode = null; currentType = null; pendingPoints = [];
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  if(!scaleMMperPx){ setStatus("Для клинических мм сначала выполните калибровку."); return; }
  planMode = "vector"; planPending = [];
  setStatus("План: Вектор перемещения — выберите 2 точки (откуда → куда).");
});

document.getElementById("btnPlanTilt").addEventListener("click", ()=>{
  mode = null; currentType = null; pendingPoints = [];
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  planMode = "tilt"; planPending = [];
  setStatus("План: Наклон (2 точки) — выберите 2 точки (база → направление).");
});
document.getElementById("btnPlanAngle3").addEventListener("click", ()=>{
  mode = null; currentType = null; pendingPoints = [];
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  planMode = "angle3"; planPending = [];
  setStatus("План: Клинический угол (3 точки) — выберите 3 точки: A → B(вершина) → C.");
});
document.getElementById("btnPlanMeasure").addEventListener("click", ()=>{
  mode = null; currentType = null; pendingPoints = [];
  if(!photo.src){ setStatus("Сначала загрузите фото."); return; }
  planMode = "measure"; planPending = [];
  setStatus("План: Измерение — выберите 2 точки.");
});
document.getElementById("btnClearPlan").addEventListener("click", ()=>{
  planItems = [];
  planZones = [];
  selectedPlan = null;
  beforeSnapshot = null;
  showBefore = false;
  pendingPoints = [];
  planPending = [];
  aiPickPending = [];
  planMode = null;
  mode = null;
  currentType = null;

  try{
    const bb = document.getElementById("beforeBadge");
    if(bb) bb.style.display = "none";
    const bt = document.getElementById("btnToggleBefore");
    if(bt) bt.textContent = "Показать «До»";
  }catch(e){}

  renderPlanList();
  computeAsymmetry && computeAsymmetry();
  redraw();
  saveProject();
  setStatus("План очищен.");
});

document.getElementById("btnUseAIasPoints").addEventListener("click", ()=>{
  aiPickMode = !aiPickMode;
  aiPickPending = [];
  const b = document.getElementById("aiPickBadge");
  b.style.display = aiPickMode ? "inline-flex" : "none";
  setStatus(aiPickMode ? "Выбор AI-точек включен: кликните по двум зелёным точкам." : "Выбор AI-точек выключен.");
});

document.getElementById("btnClear").addEventListener("click", ()=> clearAll());

document.getElementById("btnZoomIn").addEventListener("click", ()=> setZoom(zoom + 0.1));
document.getElementById("btnZoomOut").addEventListener("click", ()=> setZoom(zoom - 0.1));
document.getElementById("btnZoomReset").addEventListener("click", ()=> setZoom(1));

function deleteMeasurement(key){
  delete measurements[key];
  computeAndRender();
  redraw();
}
window.deleteMeasurement = deleteMeasurement;

