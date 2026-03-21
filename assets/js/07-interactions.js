
overlay.addEventListener("pointerdown", (ev)=>{
  if(!photo.src) return;
  overlay.setPointerCapture(ev.pointerId);
  const rect = overlay.getBoundingClientRect();
  const cx = ev.clientX - rect.left;
  const cy = ev.clientY - rect.top;
  const hit = hitTestHandle(cx, cy);
  if(hit){
    drag.active = true;
    drag.kind = hit.kind;
    drag.id = hit.id;
    drag.which = hit.which || null;
    drag.index = (typeof hit.index === "number") ? hit.index : null;
    return;
  }
  if(!mode && !planMode && !aiPickMode){
    const hitEl = hitTestPlanElement(cx, cy);
    if(hitEl){
      selectPlanItem(hitEl.kind, hitEl.id);
      return;
    }
  }
  if(aiPickMode && aiPoints && aiPoints.length){
    const fit = getFit();
    const x0 = cx/zoom, y0 = cy/zoom;
    let best = null, bestD = 1e9;
    for(const p of aiPoints){
      const c = imageToClient(p.x, p.y);
      if(!c) continue;
      const d = Math.hypot(c.x - x0, c.y - y0);
      if(d < bestD){
        bestD = d; best = p;
      }
    }
    if(best && bestD < 14){
      aiPickPending.push({x: best.x, y: best.y});
      const need = (planMode === "angle3") ? 3 : 2;
      setStatus(`AI-точка выбрана (${aiPickPending.length}/${need})…`);
      if(aiPickPending.length === 2){
        const label = document.getElementById("planLabel").value || "";
        const type = planMode || "measure";
        planItems.push(computePlanItem(type, label, aiPickPending[0], aiPickPending[1]));
        aiPickPending = [];
        renderPlanList();
        redraw();
        saveProject();
        setStatus("Элемент плана добавлен по AI-точкам.");
      } else {
        redraw();
      }
      return;
    }
  }
  if(planMode && !mode){
    const imgPt = clientToImage(cx, cy);
    if(!imgPt) return;
    const fit2 = getFit();
    const x2 = cx/zoom, y2 = cy/zoom;
    const inside2 = (x2 >= fit2.offsetX && x2 <= fit2.offsetX+fit2.drawW && y2 >= fit2.offsetY && y2 <= fit2.offsetY+fit2.drawH);
    if(!inside2) return;

    planPending.push(clampPointToImage(imgPt));
    redraw();
    const need = (planMode === "angle3") ? 3 : 2;
    if(planPending.length === need){
      const label = document.getElementById("planLabel").value || "";
      if(planMode === "angle3"){
        planItems.push(computePlanItem(planMode, label, planPending[0], planPending[1], planPending[2]));
      } else {
        planItems.push(computePlanItem(planMode, label, planPending[0], planPending[1]));
      }
      planPending = [];
      renderPlanList();
      redraw();
      saveProject();
      setStatus("Элемент плана добавлен.");
    } else {
      setStatus(`Выберите ${need===3 ? (planPending.length===1?"вторую":"третью") : "вторую"} точку…`);
    }
    return;
  }
  if(!mode) return;

  const imgPt = clientToImage(cx, cy);
  if(!imgPt) return;
  const fit = getFit();
  const x = cx/zoom, y = cy/zoom;
  const inside = (x >= fit.offsetX && x <= fit.offsetX+fit.drawW && y >= fit.offsetY && y <= fit.offsetY+fit.drawH);
  if(!inside) return;
  if(mode === "trichion"){
    const imgPt2 = clientToImage(cx, cy);
    if(!imgPt2) return;
    trichionPoint = clampPointToImage(imgPt2);
    mode = null;
    pendingPoints = [];
    setStatus("Trichion задан. Нажмите AI ориентиры для пересчёта третей по классической антропометрии.");
    redraw();
    saveProject();
    return;
  }

  pendingPoints.push(clampPointToImage(imgPt));
  redraw();

  if(pendingPoints.length === 2){
    const p1 = pendingPoints[0], p2 = pendingPoints[1];
    const px = distPx(p1, p2);

    if(mode === "calibration"){
      setStatus("Калибровка: точки выбраны. Введите расстояние в мм…");
      setTimeout(()=>{
        const real = parseFloat(prompt("Введите реальное расстояние (мм):") || "");
        if(Number.isFinite(real) && real > 0 && px > 0){
          setScale(real / px);
          setStatus("Калибровка установлена. Теперь измерьте H и L.");
        } else {
          setStatus("Калибровка отменена/некорректна.");
        }
        pendingPoints = [];
        mode = null;
        currentType = null;
        computeAndRender();
        redraw();
        saveProject();
      }, 0);
      return;
    } else if(mode === "measure"){
      measurements[currentType] = { p1, p2 };
      setStatus(`Измерение ${currentType} добавлено.`);
    }

    pendingPoints = [];
    mode = null;
    currentType = null;
    computeAndRender();
    redraw();
    saveProject();
  } else {
    setStatus("Выберите вторую точку…");
  }
});

overlay.addEventListener("pointermove", (ev)=>{
  if(!drag.active) return;
  const rect = overlay.getBoundingClientRect();
  const cx = ev.clientX - rect.left;
  const cy = ev.clientY - rect.top;
  const imgPt = clientToImage(cx, cy);
  if(!imgPt) return;

  const fit = getFit();
  const x = cx/zoom, y = cy/zoom;
  const inside = (x >= fit.offsetX && x <= fit.offsetX+fit.drawW && y >= fit.offsetY && y <= fit.offsetY+fit.drawH);
  if(!inside) return;

  const clamped = clampPointToImage(imgPt);

  if(drag.kind === "measure"){
    if(measurements[drag.id] && drag.which){
      measurements[drag.id][drag.which] = clamped;
      computeAndRender();
    }
  } else if(drag.kind === "plan"){
    const it = (planItems || []).find(x => x.id === drag.id);
    if(it && drag.which){
      it[drag.which] = clamped;
      if(it.type === "angle3" && it.p3){
        const v1x = it.p1.x - it.p2.x, v1y = it.p1.y - it.p2.y;
        const v2x = it.p3.x - it.p2.x, v2y = it.p3.y - it.p2.y;
        const dot = v1x*v2x + v1y*v2y;
        const n1 = Math.hypot(v1x,v1y) || 1;
        const n2 = Math.hypot(v2x,v2y) || 1;
        const cos = Math.max(-1, Math.min(1, dot/(n1*n2)));
        it.deg = Math.acos(cos) * 180/Math.PI;
      } else if(it.type === "vector" || it.type === "measure" || it.type === "tilt" || it.type === "guide"){
        it.px = distPx(it.p1, it.p2);
        it.mm = mmFromPx(it.px);
        it.deg = (it.type === "vector" || it.type === "tilt") ? angleDeg(it.p1, it.p2) : it.deg;
      }
      renderPlanList();
      saveProject();
    }
  } else if(drag.kind === "zone"){
    const z = (planZones || []).find(z => z.id === drag.id);
    if(z && z.points && drag.index != null){
      z.points[drag.index] = clamped;
      renderPlanList();
      saveProject();
    }
  } else if(drag.kind === "trichion"){
    trichionPoint = clamped;
    saveProject();
  }

  redraw();
});

overlay.addEventListener("pointerup", (ev)=>{
  drag.active = false; drag.kind = null; drag.id = null; drag.which = null; drag.index = null;
});

window.addEventListener("resize", resizeOverlay);
