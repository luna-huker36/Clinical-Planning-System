
function resizeOverlay(){
  overlay.width = overlay.clientWidth * devicePixelRatio;
  overlay.height = overlay.clientHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  redraw();
}

function drawHandle(pClient, color){
  ctx.fillStyle = color;
  ctx.fillRect(pClient.x - 4, pClient.y - 4, 8, 8);
  ctx.strokeStyle = "rgba(0,0,0,.25)";
  ctx.strokeRect(pClient.x - 4, pClient.y - 4, 8, 8);
}


function redraw(){
  ctx.clearRect(0,0,overlay.clientWidth, overlay.clientHeight);
  const fit = getFit();
  if(fit){
    ctx.strokeStyle = "rgba(148,163,184,.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(fit.offsetX, fit.offsetY, fit.drawW, fit.drawH);
  }
  for(const key of Object.keys(measurements)){
    const m = measurements[key];
    const a = imageToClient(m.p1.x, m.p1.y);
    const b = imageToClient(m.p2.x, m.p2.y);
    if(!a || !b) continue;

    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    drawHandle(a, "#ef4444");
    drawHandle(b, "#ef4444");
  }
  if(pendingPoints.length){
    for(const p of pendingPoints){
      const c = imageToClient(p.x, p.y);
      if(!c) continue;
      drawHandle(c, "#ef4444");
    }
  }
  if(guides && guides.midline){
    const a = imageToClient(guides.midline.p1.x, guides.midline.p1.y);
    const b = imageToClient(guides.midline.p2.x, guides.midline.p2.y);
    if(a && b){
      ctx.strokeStyle = "rgba(250,204,21,0.95)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6,4]);
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if(guides && guides.eyeline){
    const a = imageToClient(guides.eyeline.p1.x, guides.eyeline.p1.y);
    const b = imageToClient(guides.eyeline.p2.x, guides.eyeline.p2.y);
    if(a && b){
      ctx.strokeStyle = "rgba(249,115,22,0.95)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6,4]);
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if(guides && guides.thirds){
    const fit = getFit();
    if(fit){
      const ys = [guides.thirds.topY, guides.thirds.glabellaY, guides.thirds.subnasaleY, guides.thirds.chinY];
      ctx.strokeStyle = "rgba(34,211,238,0.95)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4,4]);
      for(const iy of ys){
        const c1 = imageToClient(0, iy);
        const c2 = imageToClient(fit.iw, iy);
        if(c1 && c2){
          ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
  }
  if(showBefore && beforeSnapshot){
    try{
      const bZones = beforeSnapshot.planZones || [];
      const bItems = beforeSnapshot.planItems || [];
      const bMeas = beforeSnapshot.measurements || {};
      for(const z of bZones){
        if(!z.points || z.points.length < 3) continue;
        ctx.save();
        ctx.beginPath();
        const p0 = imageToClient(z.points[0].x, z.points[0].y);
        if(!p0){ ctx.restore(); continue; }
        ctx.moveTo(p0.x, p0.y);
        for(let i=1;i<z.points.length;i++){
          const c = imageToClient(z.points[i].x, z.points[i].y);
          if(c) ctx.lineTo(c.x, c.y);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(148,163,184,0.06)";
        ctx.fill();
        ctx.strokeStyle = "rgba(148,163,184,0.70)";
        ctx.lineWidth = 2;
        ctx.setLineDash([10,6]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      for(const it of bItems){
        if(!it.p1 || !it.p2) continue;
        const a = imageToClient(it.p1.x, it.p1.y);
        const b = imageToClient(it.p2.x, it.p2.y);
        if(!a || !b) continue;
        ctx.save();
        ctx.strokeStyle = "rgba(148,163,184,0.80)";
        ctx.lineWidth = 2;
        ctx.setLineDash([10,6]);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        if(it.type === "angle3" && it.p3){
          const c = imageToClient(it.p3.x, it.p3.y);
          const v = imageToClient(it.p2.x, it.p2.y);
          if(c && v){
            ctx.save();
            ctx.strokeStyle = "rgba(148,163,184,0.80)";
            ctx.lineWidth = 2;
            ctx.setLineDash([10,6]);
            ctx.beginPath(); ctx.moveTo(v.x,v.y); ctx.lineTo(c.x,c.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        }
      }
      for(const key of Object.keys(bMeas)){
        const mm = bMeas[key];
        if(!mm || !mm.p1 || !mm.p2) continue;
        const a = imageToClient(mm.p1.x, mm.p1.y);
        const b = imageToClient(mm.p2.x, mm.p2.y);
        if(a){
          ctx.beginPath(); ctx.arc(a.x, a.y, 3.5, 0, Math.PI*2);
          ctx.fillStyle = "rgba(148,163,184,0.85)"; ctx.fill();
        }
        if(b){
          ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI*2);
          ctx.fillStyle = "rgba(148,163,184,0.85)"; ctx.fill();
        }
      }
    }catch(e){
      console.warn("Before/After overlay error:", e);
    }
  }
  if(planZones && planZones.length){
    for(const z of planZones){
      const isSelZone = (selectedPlan && selectedPlan.kind==="zone" && selectedPlan.id===z.id);
      if(!z.points || z.points.length < 3) continue;
      ctx.save();
      ctx.beginPath();
      const p0 = imageToClient(z.points[0].x, z.points[0].y);
      if(!p0){ ctx.restore(); continue; }
      ctx.moveTo(p0.x, p0.y);
      for(let i=1;i<z.points.length;i++){
        const c = imageToClient(z.points[i].x, z.points[i].y);
        if(c) ctx.lineTo(c.x, c.y);
      }
      ctx.closePath();
      ctx.fillStyle = isSelectedZoneId(z.id) ? "rgba(59,130,246,0.10)" : "rgba(16,185,129,0.12)";
      ctx.fill();
      ctx.strokeStyle = isSelectedZoneId(z.id) ? "rgba(59,130,246,0.85)" : "rgba(16,185,129,0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6,4]);
      ctx.stroke();
      ctx.setLineDash([]);
      for(const pt of z.points){
        const c = imageToClient(pt.x, pt.y);
        if(c) drawHandle(c, isSelectedZoneId(z.id) ? "#3b82f6" : "#10b981");
      }
      if(z.liftTo){
        const cen = polygonCentroid(z.points);
        const a = imageToClient(cen.x, cen.y);
        const b = imageToClient(z.liftTo.x, z.liftTo.y);
        if(a && b){
          ctx.strokeStyle = "rgba(16,185,129,0.95)";
          ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
          const ang = Math.atan2(b.y-a.y, b.x-a.x);
          const len = 10;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - len*Math.cos(ang - Math.PI/7), b.y - len*Math.sin(ang - Math.PI/7));
          ctx.lineTo(b.x - len*Math.cos(ang + Math.PI/7), b.y - len*Math.sin(ang + Math.PI/7));
          ctx.closePath();
          ctx.fillStyle = "rgba(16,185,129,0.95)";
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
  if(planItems && planItems.length){
    for(const it of planItems){
      const a = imageToClient(it.p1.x, it.p1.y);
      const b = imageToClient(it.p2.x, it.p2.y);
      if(!a || !b) continue;
      const isSel = (selectedPlan && selectedPlan.kind==="plan" && selectedPlan.id===it.id);


      if(it.type === "vector"){
        ctx.strokeStyle = "rgba(168,85,247,0.95)";
        ctx.lineWidth = isSelectedPlanId(it.id) ? 3.8 : 2.5;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        const ang = Math.atan2(b.y-a.y, b.x-a.x);
        const len = 10;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - len*Math.cos(ang - Math.PI/7), b.y - len*Math.sin(ang - Math.PI/7));
        ctx.lineTo(b.x - len*Math.cos(ang + Math.PI/7), b.y - len*Math.sin(ang + Math.PI/7));
        ctx.closePath();
        ctx.fillStyle = "rgba(168,85,247,0.95)";
        ctx.fill();

        drawHandle(a, "#a855f7");
        drawHandle(b, "#a855f7");
      } else if(it.type === "measure"){
        ctx.strokeStyle = isSelectedPlanId(it.id) ? "rgba(59,130,246,0.95)" : "rgba(20,184,166,0.95)";
        ctx.lineWidth = isSelectedPlanId(it.id) ? 3.8 : 2.5;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        drawHandle(a, "#14b8a6");
        drawHandle(b, "#14b8a6");
      }
      else if(it.type === "guide"){
        ctx.strokeStyle = isSelectedPlanId(it.id) ? "rgba(59,130,246,0.95)" : "rgba(34,197,94,0.95)";
        ctx.lineWidth = 2.2;
        ctx.setLineDash([8,6]);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        ctx.setLineDash([]);
        drawHandle(a, "#22c55e");
        drawHandle(b, "#22c55e");
      } else if(it.type === "tilt"){
        ctx.strokeStyle = isSelectedPlanId(it.id) ? "rgba(59,130,246,0.95)" : "rgba(245,158,11,0.95)";
        ctx.lineWidth = isSelectedPlanId(it.id) ? 3.8 : 2.5;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        drawHandle(a, "#f59e0b");
        drawHandle(b, "#f59e0b");
        ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + 60, a.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      else if(it.type === "angle3"){
        const v = imageToClient(it.p2.x, it.p2.y);
        const a1 = imageToClient(it.p1.x, it.p1.y);
        const a2 = imageToClient(it.p3.x, it.p3.y);
        if(v && a1 && a2){
          ctx.strokeStyle = isSelectedPlanId(it.id) ? "rgba(59,130,246,0.95)" : "rgba(245,158,11,0.95)";
          ctx.lineWidth = isSelectedPlanId(it.id) ? 3.8 : 2.5;
          ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();

          drawHandle(v, "#f59e0b");
          drawHandle(a1, "#f59e0b");
          drawHandle(a2, "#f59e0b");

          const r = 30;
          const ang1 = Math.atan2(a1.y - v.y, a1.x - v.x);
          const ang2 = Math.atan2(a2.y - v.y, a2.x - v.x);
          let start = ang1, end = ang2;
          let diff = end - start;
          while(diff <= -Math.PI) diff += 2*Math.PI;
          while(diff > Math.PI) diff -= 2*Math.PI;
          end = start + diff;

          ctx.beginPath();
          ctx.arc(v.x, v.y, r, start, end, diff < 0);
          ctx.strokeStyle = "rgba(245,158,11,0.75)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  }
  if(planPending && planPending.length){
    for(const p of planPending){
      const c = imageToClient(p.x, p.y);
      if(c) drawHandle(c, "#a855f7");
    }
  }
  if(trichionPoint){
    const c = imageToClient(trichionPoint.x, trichionPoint.y);
    if(c){
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4.5, 0, Math.PI*2);
      ctx.fillStyle = "#a855f7";
      ctx.fill();
    }
  }
  if(aiPoints.length){
    for(const p of aiPoints){
      const c = imageToClient(p.x, p.y);
      if(!c) continue;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3.5, 0, Math.PI*2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
    }
  }
  if(selectedPlan){
    try{
      if(selectedPlan.kind === "plan"){
        const it = (planItems||[]).find(x=>x.id===selectedPlan.id);
        if(it && it.p1 && it.p2){
          const a = imageToClient(it.p1.x, it.p1.y);
          const b = imageToClient(it.p2.x, it.p2.y);
          if(a && b){
            ctx.save();
            ctx.strokeStyle = "rgba(249,115,22,0.98)";
            ctx.lineWidth = 5;
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
            if(it.type === "angle3" && it.p3){
              const v = imageToClient(it.p2.x, it.p2.y);
              const c = imageToClient(it.p3.x, it.p3.y);
              if(v && c){
                ctx.beginPath(); ctx.moveTo(v.x,v.y); ctx.lineTo(c.x,c.y); ctx.stroke();
              }
            }
            drawHandle(a, "#f97316");
            drawHandle(b, "#f97316");
            if(it.type === "angle3" && it.p3){
              const c = imageToClient(it.p3.x, it.p3.y);
              if(c) drawHandle(c, "#f97316");
            }
            ctx.restore();
          }
        }
      } else if(selectedPlan.kind === "zone"){
        const z = (planZones||[]).find(x=>x.id===selectedPlan.id);
        if(z && z.points && z.points.length>=3){
          ctx.save();
          ctx.beginPath();
          const p0 = imageToClient(z.points[0].x, z.points[0].y);
          if(p0){
            ctx.moveTo(p0.x,p0.y);
            for(let i=1;i<z.points.length;i++){
              const c = imageToClient(z.points[i].x, z.points[i].y);
              if(c) ctx.lineTo(c.x,c.y);
            }
            ctx.closePath();
            ctx.fillStyle = "rgba(249,115,22,0.08)";
            ctx.fill();
            ctx.strokeStyle = "rgba(249,115,22,0.98)";
            ctx.lineWidth = 4.5;
            ctx.setLineDash([8,5]);
            ctx.stroke();
            ctx.setLineDash([]);
            for(const pt of z.points){
              const c = imageToClient(pt.x, pt.y);
              if(c) drawHandle(c, "#f97316");
            }
          }
          ctx.restore();
        }
      }
    }catch(e){}
  }

}
