
document.getElementById("imageLoader").addEventListener("change", (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;

  if(file.name.toLowerCase().endsWith(".dcm")){
    const reader = new FileReader();
    reader.onload = (evt)=>{
      try{
        const byteArray = new Uint8Array(evt.target.result);
        const dataSet = dicomParser.parseDicom(byteArray);
        const rows = dataSet.uint16("x00280010");
        const cols = dataSet.uint16("x00280011");
        setStatus(`DICOM загружен (метаданные). Размер: ${rows}×${cols}. Для пиксельного отображения нужен Cornerstone-вьюер.`);
      }catch(err){
        console.error(err);
        setStatus("Не удалось разобрать DICOM файл.");
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt)=>{
    photo.src = evt.target.result;
    setStatus("Фото загружено. Сделайте калибровку (2 точки известного расстояния).");
    saveProject();
  };
  reader.readAsDataURL(file);
});

photo.onload = ()=>{
  resizeOverlay();
  redraw();
    clearPlanForNewPhoto();

  };
