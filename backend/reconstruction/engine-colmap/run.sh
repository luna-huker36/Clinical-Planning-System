#!/bin/bash
# Полный фотограмметрический пайплайн: COLMAP (позы камер, CPU) ->
# OpenMVS (плотное облако, меш, текстура, CPU) -> GLB.
#
# Использование: run.sh <framesDir> <masksDir|-> <outputDir>
# Результат: <outputDir>/model.glb
set -eo pipefail

FRAMES="$1"
MASKS="$2"
OUT="$3"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
W="${COLMAP_WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/colmap-job-XXXXXX")}"
# Рабочая папка с логами сохраняется при падении; успешный прогон чистит сам.
mkdir -p "$OUT" "$W/sparse"

# Headless-сервер: GPU-SIFT требует OpenGL-контекст и падает с SIGABRT.
# У COLMAP 3.x есть флаги use_gpu, у 4.x их нет (он сам решает) — определяем.
GPU_EXTRACT=()
GPU_MATCH=()
if colmap feature_extractor --help 2>&1 | grep -q "SiftExtraction.use_gpu"; then
  GPU_EXTRACT=(--SiftExtraction.use_gpu 0)
  GPU_MATCH=(--SiftMatching.use_gpu 0)
fi

echo "[colmap] feature extraction"
MASK_ARG=()
if [ -n "$MASKS" ] && [ "$MASKS" != "-" ] && [ -d "$MASKS" ]; then
  MASK_ARG=(--ImageReader.mask_path "$MASKS")
fi
colmap feature_extractor \
  --database_path "$W/db.db" \
  --image_path "$FRAMES" \
  --ImageReader.camera_model SIMPLE_RADIAL \
  --ImageReader.single_camera 1 \
  "${GPU_EXTRACT[@]}" \
  "${MASK_ARG[@]}" > "$W/colmap.log" 2>&1

echo "[colmap] matching"
colmap exhaustive_matcher --database_path "$W/db.db" "${GPU_MATCH[@]}" >> "$W/colmap.log" 2>&1

echo "[colmap] sparse mapping"
colmap mapper \
  --database_path "$W/db.db" \
  --image_path "$FRAMES" \
  --output_path "$W/sparse" >> "$W/colmap.log" 2>&1

# Выбираем модель с наибольшим числом зарегистрированных кадров.
BEST=""
BEST_SIZE=0
for M in "$W"/sparse/*/; do
  [ -f "$M/images.bin" ] || continue
  SIZE=$(stat -c%s "$M/images.bin" 2>/dev/null || stat -f%z "$M/images.bin")
  if [ "$SIZE" -gt "$BEST_SIZE" ]; then BEST="$M"; BEST_SIZE="$SIZE"; fi
done
if [ -z "$BEST" ]; then
  echo "SfM не собрал ни одной модели — недостаточно перекрытия между кадрами." >&2
  exit 2
fi
echo "[colmap] best sparse model: $BEST"

echo "[colmap] undistortion"
colmap image_undistorter \
  --image_path "$FRAMES" \
  --input_path "$BEST" \
  --output_path "$W/dense" >> "$W/colmap.log" 2>&1

echo "[openmvs] import"
InterfaceCOLMAP -i "$W/dense" -o "$W/scene.mvs" -w "$W" > "$W/openmvs.log" 2>&1

echo "[openmvs] densify"
DensifyPointCloud -i "$W/scene.mvs" -o "$W/dense.mvs" -w "$W" \
  --resolution-level 2 --number-views 6 >> "$W/openmvs.log" 2>&1

echo "[openmvs] mesh"
ReconstructMesh -i "$W/dense.mvs" -o "$W/mesh.mvs" -w "$W" >> "$W/openmvs.log" 2>&1

echo "[openmvs] texture"
TextureMesh -i "$W/mesh.mvs" -o "$W/textured.mvs" -w "$W" \
  --export-type obj >> "$W/openmvs.log" 2>&1

OBJ=$(ls "$W"/textured*.obj 2>/dev/null | head -1)
if [ -z "$OBJ" ]; then
  echo "TextureMesh не создал OBJ." >&2
  tail -20 "$W/openmvs.log" >&2
  exit 3
fi

echo "[convert] OBJ -> GLB"
node "$SCRIPT_DIR/obj2glb.js" "$OBJ" "$OUT/model.glb"
rm -rf "$W"
echo "[done] $OUT/model.glb"
