
function hitTestHandle(clientX, clientY){
  const hitR = 10;
  const x = clientX / zoom;
  const y = clientY / zoom;
  for(const key of Object.keys(measurements)){
    const m = measurements[key];
    const a = imageToClient(m.p1.x, m.p1.y);
    const b = imageToClient(m.p2.x, m.p2.y);
    if(a && Math.hypot(a.x-x, a.y-y) <= hitR) return { kind:"measure", id:key, which:"p1" };
    if(b && Math.hypot(b.x-x, b.y-y) <= hitR) return { kind:"measure", id:key, which:"p2" };
  }
  for(const it of (planItems || [])){
    const a = imageToClient(it.p1.x, it.p1.y);
    const b = imageToClient(it.p2.x, it.p2.y);
    if(a && Math.hypot(a.x-x, a.y-y) <= hitR) return { kind:"plan", id:it.id, which:"p1" };
    if(b && Math.hypot(b.x-x, b.y-y) <= hitR) return { kind:"plan", id:it.id, which:"p2" };
    if(it.type === "angle3" && it.p3){
      const c = imageToClient(it.p3.x, it.p3.y);
      if(c && Math.hypot(c.x-x, c.y-y) <= hitR) return { kind:"plan", id:it.id, which:"p3" };
    }
  }
  for(const z of (planZones || [])){
    if(!z.points) continue;
    for(let i=0;i<z.points.length;i++){
      const pt = z.points[i];
      const c = imageToClient(pt.x, pt.y);
      if(c && Math.hypot(c.x-x, c.y-y) <= hitR){
        return { kind:"zone", id:z.id, index:i };
      }
    }
  }
  if(trichionPoint){
    const c = imageToClient(trichionPoint.x, trichionPoint.y);
    if(c && Math.hypot(c.x-x, c.y-y) <= hitR) return { kind:"trichion", id:"trichion" };
  }

  return null;
}

function hitTestPlanElement(clientX, clientY){
  const hitTol = 10;
  const x = clientX / zoom;
  const y = clientY / zoom;
  const imgPt = clientToImage(clientX, clientY);
  if(imgPt){
    for(let k=(planZones||[]).length-1; k>=0; k--){
      const z = planZones[k];
      if(!z.points || z.points.length<3) continue;
      if(pointInPolygon(imgPt, z.points)){
        return { kind:"zone", id:z.id };
      }
    }
  }
  for(let k=(planItems||[]).length-1; k>=0; k--){
    const it = planItems[k];
    if(!it.p1 || !it.p2) continue;
    const a = imageToClient(it.p1.x, it.p1.y);
    const b = imageToClient(it.p2.x, it.p2.y);
    if(!a || !b) continue;

    const d1 = pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
    if(d1 <= hitTol) return { kind:"plan", id:it.id };

    if(it.type === "angle3" && it.p3){
      const c = imageToClient(it.p3.x, it.p3.y);
      const v = imageToClient(it.p2.x, it.p2.y);
      if(c && v){
        const d2 = pointToSegmentDist(x, y, v.x, v.y, c.x, c.y);
        if(d2 <= hitTol) return { kind:"plan", id:it.id };
      }
    }
  }
  return null;
}
