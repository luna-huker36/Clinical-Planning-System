
document.getElementById("btnPDF").addEventListener("click", exportPDF);

function escHtml2d(s){
  return String(s||'').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function addPagedCanvasToPdf2d(pdf, sourceCanvas, options = {}){
  const margin = options.margin ?? 8;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const printableW = pageW - margin * 2;
  const printableH = pageH - margin * 2;

  const scale = printableW / sourceCanvas.width;
  const pageSlicePx = Math.max(1, Math.floor(printableH / scale));
  let offsetY = 0;
  let pageIndex = 0;

  while(offsetY < sourceCanvas.height){
    const sliceHeight = Math.min(pageSlicePx, sourceCanvas.height - offsetY);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = sourceCanvas.width;
    pageCanvas.height = sliceHeight;
    const pageCtx = pageCanvas.getContext('2d');
    pageCtx.fillStyle = '#ffffff';
    pageCtx.fillRect(0,0,pageCanvas.width,pageCanvas.height);
    pageCtx.drawImage(
      sourceCanvas,
      0, offsetY, sourceCanvas.width, sliceHeight,
      0, 0, pageCanvas.width, pageCanvas.height
    );

    const imgData = pageCanvas.toDataURL('image/png');
    const renderH = sliceHeight * scale;
    if(pageIndex > 0) pdf.addPage();
    pdf.addImage(imgData, 'PNG', margin, margin, printableW, renderH);

    offsetY += sliceHeight;
    pageIndex += 1;
  }
}

async function exportPDF(){
  try{
    setStatus('Генерация PDF...');
    const { jsPDF } = window.jspdf;

    const patient = document.getElementById("patientName")?.value || "—";
    const date    = document.getElementById("examDate")?.value || "—";
    const procedure = document.getElementById("procedure")?.value || "—";
    const goal    = document.getElementById("goal")?.value || "—";
    const notes   = document.getElementById("notes")?.value || "";
    const vpEl = document.getElementById("viewport");
    let screenDataUrl = '';
    if(vpEl){
      const cap = await html2canvas(vpEl, { scale: 2, useCORS: true, backgroundColor: "#0f172a" });
      screenDataUrl = cap.toDataURL('image/png');
    }
    const reportDiv = document.createElement('div');
    reportDiv.style.cssText = 'position:fixed;top:0;left:0;width:800px;background:#fff;color:#1e293b;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;z-index:99999;';

    let html = '';
    html += `<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:24px 30px;border-radius:0 0 12px 12px;">`;
    html += `<div style="font-size:24px;font-weight:700;letter-spacing:0.5px;">Clinical Planning System — 2D Клинический протокол</div>`;
    html += `<div style="margin-top:6px;font-size:13px;opacity:0.85;">Планирование медицинских и эстетических процедур</div>`;
    html += `</div>`;
    html += `<div style="padding:20px 30px 0;">`;
    html += `<div style="display:flex;gap:12px;flex-wrap:wrap;">`;
    const infoItems = [
      ['ПАЦИЕНТ', patient], ['ДАТА ОБСЛЕДОВАНИЯ', date],
      ['ПРОЦЕДУРА', procedure], ['ЦЕЛЬ', goal]
    ];
    for(const [lbl, val] of infoItems){
      html += `<div style="flex:1;min-width:170px;background:#f1f5f9;border-radius:8px;padding:12px 16px;border-left:3px solid #3b82f6;">`;
      html += `<div style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:600;letter-spacing:0.5px;">${lbl}</div>`;
      html += `<div style="font-size:14px;font-weight:600;margin-top:4px;">${escHtml2d(val)}</div>`;
      html += `</div>`;
    }
    html += `</div></div>`;
    if(screenDataUrl){
      html += `<div style="padding:16px 30px;">`;
      html += `<div style="background:#0f172a;border-radius:10px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,0.15);">`;
      html += `<img src="${screenDataUrl}" style="width:100%;border-radius:6px;display:block;">`;
      html += `</div></div>`;
    }
    const measKeys = Object.keys(measurements);
    if(measKeys.length > 0){
      html += `<div style="padding:0 30px 12px;">`;
      html += `<div style="font-size:16px;font-weight:700;color:#1e40af;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #dbeafe;">📐 Измерения</div>`;
      html += `<table style="width:100%;border-collapse:collapse;font-size:13px;">`;
      html += `<tr style="background:#f1f5f9;"><th style="text-align:left;padding:8px 10px;font-weight:600;color:#475569;">Метка</th><th style="text-align:right;padding:8px 10px;font-weight:600;color:#475569;">мм</th><th style="text-align:right;padding:8px 10px;font-weight:600;color:#475569;">px</th></tr>`;

      let Hval=null, Lval=null;
      let idx=0;
      for(const key of measKeys){
        const m = measurements[key];
        const px = distPx(m.p1, m.p2);
        const mm = scaleMMperPx ? px * scaleMMperPx : null;
        if(key==="H") Hval = mm;
        if(key==="L") Lval = mm;
        const bg = idx%2===0 ? '#fff' : '#f8fafc';
        html += `<tr style="background:${bg};border-bottom:1px solid #e2e8f0;">`;
        html += `<td style="padding:7px 10px;font-weight:600;">${escHtml2d(key)}</td>`;
        html += `<td style="padding:7px 10px;text-align:right;font-weight:600;color:#1e40af;">${mm!=null ? mm.toFixed(2)+' мм' : '—'}</td>`;
        html += `<td style="padding:7px 10px;text-align:right;color:#94a3b8;">${px.toFixed(1)} px</td>`;
        html += `</tr>`;
        idx++;
      }

      const AB = (Hval!=null && Lval!=null) ? Math.sqrt(Hval*Hval + Lval*Lval) : null;
      if(AB){
        html += `<tr style="background:#eff6ff;border-top:2px solid #3b82f6;">`;
        html += `<td style="padding:8px 10px;font-weight:700;color:#1e40af;">AB = √(H² + L²)</td>`;
        html += `<td style="padding:8px 10px;text-align:right;font-weight:700;color:#1e40af;">${AB.toFixed(2)} мм</td>`;
        html += `<td style="padding:8px 10px;"></td>`;
        html += `</tr>`;
      }
      html += `</table></div>`;
    }
    if((planItems && planItems.length) || (planZones && planZones.length)){
      html += `<div style="padding:0 30px 12px;">`;
      html += `<div style="font-size:16px;font-weight:700;color:#1e40af;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #dbeafe;">📊 План операции</div>`;
      html += `<table style="width:100%;border-collapse:collapse;font-size:13px;">`;
      html += `<tr style="background:#f1f5f9;"><th style="text-align:left;padding:8px 10px;font-weight:600;color:#475569;">№</th><th style="text-align:left;padding:8px 10px;font-weight:600;color:#475569;">Тип</th><th style="text-align:left;padding:8px 10px;font-weight:600;color:#475569;">Метка</th><th style="text-align:right;padding:8px 10px;font-weight:600;color:#475569;">Значение</th></tr>`;

      let rowIdx = 0;
      for(const it of (planItems || [])){
        const typeTxt = it.type==="vector"?"Вектор":it.type==="tilt"?"Наклон":it.type==="angle3"?"Угол":it.type==="guide"?"Линия":"Измерение";
        const mmTxt = it.mm!=null ? it.mm.toFixed(2)+' мм' : it.px.toFixed(1)+' px';
        const degTxt = it.deg!=null ? ' • '+it.deg.toFixed(1)+'°' : '';
        const label = (it.label && it.label !== it.type && it.label !== typeTxt) ? it.label : '—';
        const bg = rowIdx%2===0 ? '#fff' : '#f8fafc';
        html += `<tr style="background:${bg};border-bottom:1px solid #e2e8f0;">`;
        html += `<td style="padding:7px 10px;color:#94a3b8;">${rowIdx+1}</td>`;
        html += `<td style="padding:7px 10px;">${typeTxt}</td>`;
        html += `<td style="padding:7px 10px;color:#475569;">${escHtml2d(label)}</td>`;
        html += `<td style="padding:7px 10px;text-align:right;font-weight:600;color:#1e40af;">${mmTxt}${degTxt}</td>`;
        html += `</tr>`;
        rowIdx++;
      }

      for(const z of (planZones || [])){
        const areaPx2 = polygonAreaPx2(z.points);
        const areaMm2 = scaleMMperPx ? areaPx2 * scaleMMperPx * scaleMMperPx : null;
        const cen = polygonCentroid(z.points);
        const shiftPx = z.liftTo ? distPx(cen, z.liftTo) : 0;
        const shiftMm = scaleMMperPx ? shiftPx * scaleMMperPx : null;
        const aTxt = areaMm2!=null ? (areaMm2/100.0).toFixed(2)+' см²' : areaPx2.toFixed(0)+' px²';
        const sTxt = z.liftTo ? (shiftMm!=null ? shiftMm.toFixed(2)+' мм' : shiftPx.toFixed(1)+' px') : '—';
        const bg = rowIdx%2===0 ? '#fff' : '#f8fafc';
        html += `<tr style="background:${bg};border-bottom:1px solid #e2e8f0;">`;
        html += `<td style="padding:7px 10px;color:#94a3b8;">${rowIdx+1}</td>`;
        html += `<td style="padding:7px 10px;">🟩 Зона</td>`;
        html += `<td style="padding:7px 10px;color:#475569;">${escHtml2d(z.label||'—')}</td>`;
        html += `<td style="padding:7px 10px;text-align:right;font-weight:600;color:#1e40af;">S: ${aTxt} • Δ: ${sTxt}</td>`;
        html += `</tr>`;
        rowIdx++;
      }
      html += `</table></div>`;
    }
    if(aiMetrics){
      const m = aiMetrics;
      html += `<div style="padding:0 30px 12px;">`;
      html += `<div style="font-size:16px;font-weight:700;color:#1e40af;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #dbeafe;">🤖 AI анализ</div>`;
      html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">`;
      const scores = [
        ['Гармония', m.harmonyIndex.toFixed(0)+'/100'],
        ['Симметрия', m.symmetry.score.toFixed(0)+'/100'],
        ['Трети', m.thirds.score.toFixed(0)+'/100']
      ];
      for(const [lbl,val] of scores){
        html += `<div style="flex:1;min-width:100px;background:#eff6ff;border-radius:8px;padding:10px 14px;text-align:center;">`;
        html += `<div style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:600;">${lbl}</div>`;
        html += `<div style="font-size:20px;font-weight:700;color:#1e40af;margin-top:2px;">${val}</div>`;
        html += `</div>`;
      }
      html += `</div>`;
      html += `<div style="font-size:12px;color:#475569;line-height:1.6;">`;
      html += `Средняя линия: отклонение носа ≈ ${m.symmetry.noseOffsetMM.toFixed(2)} мм; асимметрия глаз ≈ ${m.symmetry.eyesAsymMM.toFixed(2)} мм<br>`;
      html += `Горизонталь глаз: наклон ≈ ${m.proportions.eyeTiltDeg.toFixed(1)}°<br>`;
      html += `Трети лица: ${m.thirds.upperMM.toFixed(1)} / ${m.thirds.middleMM.toFixed(1)} / ${m.thirds.lowerMM.toFixed(1)} мм `;
      html += `(${(m.thirds.upperRatio*100).toFixed(1)}% / ${(m.thirds.middleRatio*100).toFixed(1)}% / ${(m.thirds.lowerRatio*100).toFixed(1)}%)`;
      html += `</div></div>`;
    }
    if(notes && notes.trim()){
      html += `<div style="padding:0 30px 12px;">`;
      html += `<div style="font-size:16px;font-weight:700;color:#1e40af;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #dbeafe;">📝 Заметки</div>`;
      html += `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 6px 6px 0;font-size:13px;color:#78350f;white-space:pre-wrap;">${escHtml2d(notes)}</div>`;
      html += `</div>`;
    }
    const scaleTxt = scaleMMperPx != null ? (scaleMMperPx).toFixed(4)+' мм/px' : 'не задан';
    html += `<div style="padding:12px 30px;text-align:center;color:#94a3b8;font-size:10px;border-top:1px solid #e2e8f0;margin-top:8px;">`;
    html += `Clinical Planning System v1.0 • Масштаб: ${scaleTxt} • Сформировано: ${new Date().toLocaleDateString('ru-RU')}`;
    html += `</div>`;

    reportDiv.innerHTML = html;
    document.body.appendChild(reportDiv);

    const capture = await html2canvas(reportDiv, { scale: 2, useCORS: true });
    document.body.removeChild(reportDiv);

    const pdf = new jsPDF('p', 'mm', 'a4');
    addPagedCanvasToPdf2d(pdf, capture, { margin: 8 });

    pdf.save('Clinical_Planning_System_2D_Report.pdf');
    setStatus('PDF экспортирован.');
  }catch(err){
    console.error(err);
    alert("Не удалось экспортировать PDF: " + (err?.message || err));
  }
}


document.getElementById("btnDOCX").addEventListener("click", exportDOCX);

async function exportDOCX(){
  try{
    if(typeof docx === "undefined"){
      alert("Библиотека docx не загрузилась (проверьте интернет).");
      return;
    }
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, HeadingLevel, ShadingType } = docx;

    const patient = document.getElementById("patientName").value || "—";
    const date = document.getElementById("examDate").value || "—";
    const procedure = document.getElementById("procedure")?.value || "—";
    const goal = document.getElementById("goal")?.value || "—";
    const notes = document.getElementById("notes")?.value || "";

    const blueBorder = { style: BorderStyle.SINGLE, size: 1, color: "2563EB" };
    const noBorder = { style: BorderStyle.NONE, size: 0 };
    const allNoBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
    let vpImageData = null;
    const vpEl = document.getElementById("viewport");
    if(vpEl){
      const capture = await html2canvas(vpEl, { scale: 2, useCORS: true, backgroundColor: "#0f172a" });
      const dataUrl = capture.toDataURL("image/png");
      vpImageData = dataUrl.split(",")[1];
    }
    function sectionHeading(text){
      return new Paragraph({
        spacing: { before: 300, after: 100 },
        shading: { type: ShadingType.SOLID, color: "2563EB" },
        children: [
          new TextRun({ text: "  " + text, bold: true, size: 20, color: "FFFFFF", font: "Calibri" })
        ]
      });
    }
    function kvRow(key, value, bold = false){
      return new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: key + ": ", bold: true, size: 18, color: "64748B", font: "Calibri" }),
          new TextRun({ text: value, bold: bold, size: 18, color: "0F172A", font: "Calibri" })
        ]
      });
    }

    const children = [];
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
      children: [
        new TextRun({ text: "Clinical Planning System — 2D Клинический протокол", bold: true, size: 36, color: "2563EB", font: "Calibri" }),
      ]
    }));
    children.push(new Paragraph({
      spacing: { after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "E2E8F0" } },
      children: []
    }));
    children.push(sectionHeading("Пациент"));
    children.push(kvRow("ФИО", patient));
    children.push(kvRow("Дата осмотра", date));
    children.push(kvRow("Процедура", procedure));
    children.push(kvRow("Цель", goal));
    if(vpImageData){
      children.push(new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }));
      const { ImageRun } = docx;
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: Uint8Array.from(atob(vpImageData), c => c.charCodeAt(0)),
            transformation: { width: 560, height: 320 },
            type: "png"
          })
        ]
      }));
    }
    const measKeys = Object.keys(measurements);
    if(measKeys.length > 0){
      children.push(sectionHeading("Измерения"));
      let Hval=null, Lval=null;
      for(const key of measKeys){
        const m = measurements[key];
        const px = distPx(m.p1, m.p2);
        const mm = scaleMMperPx ? px * scaleMMperPx : null;
        if(key==="H") Hval = mm;
        if(key==="L") Lval = mm;
        children.push(kvRow(key, mm ? `${mm.toFixed(2)} мм (${px.toFixed(1)} px)` : `${px.toFixed(1)} px`));
      }
      const AB = (Hval!=null && Lval!=null) ? Math.sqrt(Hval*Hval + Lval*Lval) : null;
      if(AB){
        children.push(new Paragraph({
          spacing: { before: 100 },
          children: [
            new TextRun({ text: `AB = √(H² + L²) = ${AB.toFixed(2)} мм`, bold: true, size: 20, color: "2563EB", font: "Calibri" })
          ]
        }));
      }
    }
    if((planItems && planItems.length) || (planZones && planZones.length)){
      children.push(sectionHeading("План операции"));

      for(const it of (planItems || [])){
        const typeTxt = it.type==="vector"?"Вектор":it.type==="tilt"?"Наклон":it.type==="angle3"?"Клинич. угол":it.type==="guide"?"Линия":"Измерение";
        const mmTxt = it.mm!=null ? it.mm.toFixed(2)+" мм" : it.px.toFixed(1)+" px";
        const degTxt = it.deg!=null ? " • "+it.deg.toFixed(1)+"°" : "";
        children.push(new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: typeTxt + " ", size: 16, color: "64748B", font: "Calibri" }),
            new TextRun({ text: (it.label || "—"), bold: true, size: 18, color: "0F172A", font: "Calibri" }),
            new TextRun({ text: ` — ${mmTxt}${degTxt}`, size: 18, color: "0F172A", font: "Calibri" })
          ]
        }));
      }

      for(const z of (planZones || [])){
        const areaPx2 = polygonAreaPx2(z.points);
        const areaMm2 = scaleMMperPx ? areaPx2 * scaleMMperPx * scaleMMperPx : null;
        const cen = polygonCentroid(z.points);
        const shiftPx = z.liftTo ? distPx(cen, z.liftTo) : 0;
        const shiftMm = scaleMMperPx ? shiftPx * scaleMMperPx : null;
        const aTxt = areaMm2!=null ? (areaMm2/100.0).toFixed(2)+" см²" : areaPx2.toFixed(0)+" px²";
        const sTxt = z.liftTo ? (shiftMm!=null ? shiftMm.toFixed(2)+" мм" : shiftPx.toFixed(1)+" px") : "—";
        children.push(new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: "Зона ", size: 16, color: "64748B", font: "Calibri" }),
            new TextRun({ text: (z.label || "—"), bold: true, size: 18, color: "0F172A", font: "Calibri" }),
            new TextRun({ text: ` — S: ${aTxt} • Δ: ${sTxt}`, size: 18, color: "0F172A", font: "Calibri" })
          ]
        }));
      }
    }
    if(aiMetrics){
      children.push(sectionHeading("AI анализ"));
      const m = aiMetrics;
      children.push(kvRow("Индекс гармонии", `${m.harmonyIndex.toFixed(0)}/100`));
      children.push(kvRow("Симметрия", `${m.symmetry.score.toFixed(0)}/100 (отклонение носа: ${m.symmetry.noseOffsetMM.toFixed(2)} мм, глаз: ${m.symmetry.eyesAsymMM.toFixed(2)} мм)`));
      children.push(kvRow("Горизонталь глаз", `наклон ${m.proportions.eyeTiltDeg.toFixed(1)}°`));
      children.push(kvRow("Трети лица", `${m.thirds.upperMM.toFixed(1)} / ${m.thirds.middleMM.toFixed(1)} / ${m.thirds.lowerMM.toFixed(1)} мм (${(m.thirds.upperRatio*100).toFixed(1)}% / ${(m.thirds.middleRatio*100).toFixed(1)}% / ${(m.thirds.lowerRatio*100).toFixed(1)}%)`));
    }
    if(notes && notes.trim()){
      children.push(sectionHeading("Заметки"));
      children.push(new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text: notes, size: 18, color: "0F172A", font: "Calibri" })]
      }));
    }
    children.push(new Paragraph({
      spacing: { before: 400 },
      border: { top: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" } },
      children: []
    }));
    children.push(new Paragraph({
      spacing: { before: 60 },
      children: [
        new TextRun({ text: "Clinical Planning System v1.0 — 2D Клинический протокол • Автоматически сгенерированный отчёт", size: 14, color: "94A3B8", font: "Calibri", italics: true })
      ]
    }));

    const doc = new Document({
      sections: [{ children }]
    });

    const blob = await Packer.toBlob(doc);
    const safePatient = (patient||"").replace(/[^a-zA-Z0-9а-яА-Я _-]+/g,"").trim() || "Patient";
    const safeDate = (date||"").replace(/[^0-9.-]+/g,"").trim() || "";
    const fname = `Clinical_Planning_System_Protocol_${safePatient}${safeDate?("_"+safeDate):""}.docx`;
    if(typeof saveAs !== "undefined"){
      saveAs(blob, fname);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    }
    setStatus("DOCX экспортирован.");
  }catch(err){
    console.error(err);
    alert("Не удалось экспортировать DOCX: " + (err?.message || err));
  }
}
