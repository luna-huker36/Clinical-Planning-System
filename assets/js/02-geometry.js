
function getFit(){
  const vw = overlay.clientWidth;
  const vh = overlay.clientHeight;
  const iw = photo.naturalWidth || 0;
  const ih = photo.naturalHeight || 0;
  if(!iw || !ih) return null;

  const scale = Math.min(vw/iw, vh/ih);
  const drawW = iw * scale;
  const drawH = ih * scale;
  const offsetX = (vw - drawW) / 2;
  const offsetY = (vh - drawH) / 2;
  return { vw, vh, iw, ih, scale, drawW, drawH, offsetX, offsetY };
}

function clientToImage(cx, cy){
  const fit = getFit();
  if(!fit) return null;
  const x = cx / zoom;
  const y = cy / zoom;
  const ix = (x - fit.offsetX) / fit.scale;
  const iy = (y - fit.offsetY) / fit.scale;
  return { x: ix, y: iy };
}

function imageToClient(ix, iy){
  const fit = getFit();
  if(!fit) return null;
  const x = (fit.offsetX + ix * fit.scale);
  const y = (fit.offsetY + iy * fit.scale);
  return { x, y };
}

function clampPointToImage(p){
  const iw = photo.naturalWidth || 0;
  const ih = photo.naturalHeight || 0;
  return { x: Math.max(0, Math.min(iw, p.x)), y: Math.max(0, Math.min(ih, p.y)) };
}

function distPx(p1, p2){
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function lineFromPoints(p1, p2){
  const a = p2.y - p1.y;
  const b = p1.x - p2.x;
  const c = -(a*p1.x + b*p1.y);
  const norm = Math.hypot(a,b) || 1;
  return { a: a/norm, b: b/norm, c: c/norm, p1, p2 };
}
function signedDistanceToLine(line, p){
  return line.a*p.x + line.b*p.y + line.c;
}
function angleDeg(p1,p2){
  return Math.atan2(p2.y-p1.y, p2.x-p1.x) * 180/Math.PI;
}

function polygonAreaPx2(pts){
  let a = 0;
  for(let i=0;i<pts.length;i++){
    const j = (i+1)%pts.length;
    a += pts[i].x*pts[j].y - pts[j].x*pts[i].y;
  }
  return Math.abs(a)/2;
}
function polygonCentroid(pts){
  let cx=0, cy=0, a=0;
  for(let i=0;i<pts.length;i++){
    const j=(i+1)%pts.length;
    const cross = pts[i].x*pts[j].y - pts[j].x*pts[i].y;
    a += cross;
    cx += (pts[i].x + pts[j].x)*cross;
    cy += (pts[i].y + pts[j].y)*cross;
  }
  a = a/2;
  if(Math.abs(a) < 1e-6){
    const n = pts.length || 1;
    return { x: pts.reduce((s,p)=>s+p.x,0)/n, y: pts.reduce((s,p)=>s+p.y,0)/n };
  }
  cx = cx/(6*a); cy = cy/(6*a);
  return { x: cx, y: cy };
}

function pointToSegmentDist(px, py, ax, ay, bx, by){
  const vx = bx-ax, vy = by-ay;
  const wx = px-ax, wy = py-ay;
  const c1 = vx*wx + vy*wy;
  if(c1 <= 0) return Math.hypot(px-ax, py-ay);
  const c2 = vx*vx + vy*vy;
  if(c2 <= c1) return Math.hypot(px-bx, py-by);
  const t = c1 / c2;
  const projx = ax + t*vx;
  const projy = ay + t*vy;
  return Math.hypot(px-projx, py-projy);
}
function pointInPolygon(pt, poly){
  let inside = false;
  for(let i=0, j=poly.length-1; i<poly.length; j=i++){
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}
