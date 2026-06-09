# PMAS - Patient/Plastic Medical Analysis System

PMAS - это браузерная система для анализа лица, клинического планирования и документирования patient case. Текущая версия является demo/MVP foundation: она объединяет 2D-анализ, 3D-viewer, patient cases, reconstruction workflow, landmarks, measurements, reports, timeline, audit, QA checks, backup/recovery, release management и plugin architecture.

Сайт:

https://luna-huker36.github.io/Clinical-Planning-System/

Репозиторий:

https://github.com/luna-huker36/Clinical-Planning-System

## Важный статус

PMAS v1.0 подходит для демонстрации продукта, показа workflow и обсуждения архитектуры.

PMAS v1.0 не является сертифицированным медицинским изделием, диагностической системой или заменой врача.

Текущий reconstruction backend работает как scaffold/demo pipeline. По умолчанию он использует mock reconstruction output и тестовую GLB-модель, чтобы показать процесс работы системы.

## Что делает PMAS

PMAS собирает полный workflow вокруг patient case:

1. Создание или открытие кейса пациента.
2. Загрузка 2D-фото или 3D-модели.
3. Запуск или просмотр reconstruction workflow.
4. Добавление landmarks и measurements.
5. Просмотр clinical observations.
6. Запуск QA и production readiness checks.
7. Генерация отчётов.
8. Отслеживание истории через timeline и audit log.
9. Экспорт или восстановление локального backup.
10. Управление внутренними release candidates и plugin registry.

## Основные модули

### 2D Analysis

2D-модуль позволяет загрузить фотографию лица и выполнять планировочные измерения прямо в браузере.

Возможности:

- загрузка изображения;
- AI face landmarks в браузере;
- ручные точки, линии, углы, векторы и зоны;
- калибровка в миллиметрах;
- анализ асимметрии;
- before/after overlay;
- экспорт в PDF и DOCX.

### 3D Viewer

3D-модуль позволяет открыть, осмотреть и разметить лицевую 3D-модель.

Возможности:

- загрузка GLB/GLTF;
- вращение, перемещение и масштабирование модели;
- режимы wireframe, normals и освещения;
- 3D-точки и измерения;
- 3D-landmarks;
- список элементов плана;
- экспорт в PDF и DOCX.

### Patient Cases

Patient case - центральная сущность PMAS.

Каждый case может содержать:

- данные пациента;
- заметки;
- reconstruction jobs;
- model metadata;
- landmarks;
- measurements;
- reports;
- surgical planning notes;
- simulations;
- clinical insights;
- QA checks;
- production readiness checks;
- team members;
- timeline entries;
- audit events.

### Reconstruction Workflow

Reconstruction workflow показывает запланированный путь от исходных файлов к PMAS-ready 3D-модели.

Pipeline:

1. Загрузка входных файлов.
2. Валидация input.
3. Анализ кадров.
4. Извлечение кадров из видео при необходимости.
5. Проверка качества кадров.
6. Генерация или mock segmentation masks.
7. Пауза для frame review.
8. Запуск reconstruction engine.
9. Конвертация mesh в GLB.
10. Mesh cleanup.
11. Alignment модели под PMAS.
12. Опциональная ручная корректировка.
13. Формирование финальной model metadata.

Текущее ограничение:

- default engine является mock engine;
- точки интеграции с external CLI есть, но production reconstruction ещё не настроен полностью;
- output нужно считать demo data, если не подключён реальный reconstruction engine.

### Landmarks

Landmarks - это ключевые facial/anatomical reference points.

Поддерживаемые данные:

- landmark ID;
- case ID;
- model ID;
- название;
- категория;
- 3D-позиция;
- source;
- detection mode;
- confidence;
- status;
- required flag;
- template metadata.

Landmarks используются в measurements, clinical observations, QA checks и reports.

### Measurements

Measurements хранят значения и аннотации для клинического планирования.

Поддерживаемые типы:

- distance;
- angle;
- vector;
- point;
- annotation;
- ratio;
- custom.

Measurements могут быть ручными или template-driven. Они могут быть связаны с landmarks и попадать в reports, QA checks и clinical insights.

### Clinical Analysis

PMAS содержит rule-based clinical analysis layer.

Он может суммировать:

- выбранные clinical presets;
- generated landmarks;
- generated measurements;
- missing data;
- warnings;
- comparison results.

Этот модуль не ставит диагнозы и не даёт медицинские рекомендации.

### Clinical Insights Engine

Clinical Insights Engine создаёт структурированные observations на основе данных кейса.

Он анализирует:

- readiness score;
- measurements;
- missing landmarks;
- low-confidence landmarks;
- reconstruction warnings;
- comparison results;
- simulation results.

Примеры observations:

- "Некоторые landmarks имеют низкую уверенность."
- "Readiness score модели требует внимания."
- "Отсутствуют обязательные landmarks."
- "Некоторые измерения требуют ручной проверки."

Поддерживаемые severity:

- info;
- warning;
- attention.

### Reports

PMAS может формировать структурированные данные отчётов:

- clinical report;
- case report;
- reconstruction report;
- comparison report;
- system report;
- release summary report.

Reports могут включать:

- patient case summary;
- reconstruction summary;
- landmarks;
- measurements;
- clinical insights;
- QA summary;
- production readiness summary;
- audit summary;
- backup status;
- installed plugins summary.

### Timeline

Timeline показывает историю patient case.

Он может включать:

- reconstruction events;
- model events;
- measurement snapshots;
- report events;
- surgical notes;
- clinical insights;
- QA checks;
- production readiness checks;
- release events.

### Audit Log

Audit Log фиксирует важные действия пользователя внутри patient case.

Примеры событий:

- case created;
- case updated;
- model uploaded;
- reconstruction started;
- reconstruction completed;
- landmark added;
- measurement added;
- note updated;
- report exported;
- team member added;
- backup created;
- QA run;
- readiness check run;
- release action;
- plugin enabled/disabled.

Audit event содержит:

- event ID;
- case ID;
- user ID;
- user name;
- action;
- entity type;
- entity ID;
- timestamp;
- details.

### Team Collaboration

PMAS поддерживает базовую модель командной работы.

Роли:

- owner;
- surgeon;
- assistant;
- viewer.

У каждой роли есть список permissions. Текущая реализация подходит для demo и моделирования данных. Для production ещё нужно добавить полноценную backend authentication и enforcement прав.

### Backup & Recovery

PMAS поддерживает локальный backup/recovery через PMAS Backup JSON.

Backup включает:

- patient cases;
- reconstruction jobs;
- model metadata;
- measurements;
- landmarks;
- reports;
- timeline-related data;
- surgical notes;
- simulations;
- clinical insights;
- QA/readiness data;
- plugin/release metadata, если доступно.

Backup поддерживает:

- export full backup;
- validation формата;
- validation версии;
- checksum verification;
- preview;
- восстановление selected cases или full backup data.

Текущее ограничение:

- backup ориентирован на JSON application state;
- binary model artifacts и durable external storage требуют отдельной production-стратегии.

### QA Dashboard

QA Dashboard проверяет техническую готовность каждого case.

Он проверяет:

- reconstruction status;
- GLB availability;
- readiness score;
- reconstruction errors;
- required landmarks;
- approved landmarks;
- low-confidence landmarks;
- measurements;
- reports;
- patient data;
- model attachment;
- notes;
- backup availability.

QA output:

```json
{
  "qaScore": 0,
  "readinessLevel": "poor | medium | good | excellent",
  "warningsCount": 0,
  "failuresCount": 0
}
```

Это техническая и продуктовая валидация, не медицинская валидация.

### Production Readiness

Production Readiness проверяет, готов ли case, model, report или system к внутреннему рабочему использованию.

Поддерживаемые scope:

- case;
- model;
- report;
- system.

Readiness levels:

- not_ready;
- limited;
- ready;
- production_ready.

Это внутренняя PMAS-проверка готовности, не медицинская сертификация.

### Release Candidate Manager

Release Candidate Manager поддерживает внутренние snapshots версий PMAS.

Он умеет:

- create release candidate;
- promote release status;
- archive release;
- clone release;
- export release summary.

Release statuses:

- draft;
- testing;
- release_candidate;
- approved;
- archived.

Release manager не заменяет Git. Это внутренний слой product readiness и snapshot management.

### Plugin Architecture

PMAS содержит Plugin Registry и Plugin Manager.

Категории plugins:

- reconstruction;
- landmarks;
- measurements;
- analysis;
- reports;
- simulation;
- export;
- custom.

Extension points:

- Reconstruction Pipeline;
- Landmark Detection;
- Measurement Templates;
- Clinical Analysis;
- Report Generation;
- Surgical Simulation;
- Export System.

Built-in plugins:

- Landmark Templates;
- Measurement Templates;
- Clinical Analysis Presets;
- Report Builder.

Текущее ограничение:

- registry и validation реализованы;
- runtime loading, plugin sandboxing и lifecycle hooks относятся к future work.

## Архитектура системы

PMAS сейчас состоит из:

- static browser frontend;
- модульных JavaScript-файлов в `assets/js`;
- Express backend scaffold в `backend`;
- reconstruction API в `backend/reconstruction`;
- локальных model assets в `models`;
- localStorage fallback для frontend demo mode;
- in-memory backend store для backend scaffold mode.

Ключевые файлы:

- `index.html` - главная страница приложения;
- `assets/js/app.js` - 3D viewer и planning logic;
- `assets/js/12-reconstruction.js` - PMAS reconstruction/case UI controller;
- `assets/js/15-reconstruction-api.js` - frontend PMAS API adapter и mock fallback;
- `backend/server.js` - Express server;
- `backend/reconstruction/routes.js` - reconstruction API routes;
- `backend/reconstruction/store.js` - in-memory PMAS domain store;
- `backend/reconstruction/reconstruction-results.js` - reports, timelines и result summaries;
- `backend/reconstruction/clinical-insights-engine.js` - insights engine;
- `backend/reconstruction/qa-validation-engine.js` - QA engine;
- `backend/reconstruction/production-readiness-check.js` - readiness engine;
- `backend/reconstruction/backup-recovery.js` - backup validation/export;
- `backend/reconstruction/release-candidate-manager.js` - release manager logic;
- `backend/reconstruction/plugin-architecture.js` - plugin registry definitions.

## Локальный запуск

Установить зависимости:

```bash
npm install
```

Запустить backend:

```bash
npm start
```

Открыть frontend:

```text
http://localhost:3000/
```

Backend reconstruction mode:

```text
http://localhost:3000/?reconstructionMode=backend
```

Mock frontend mode:

```text
http://localhost:3000/?reconstructionMode=mock
```

## Demo Script

Рекомендуемый сценарий демонстрации:

1. Открыть сайт PMAS.
2. Показать 2D analysis на тестовом фото лица.
3. Перейти в 3D model viewer.
4. Создать patient case.
5. Привязать или загрузить model data.
6. Показать stages reconstruction workflow.
7. Добавить landmarks.
8. Добавить measurements.
9. Открыть Clinical Insights.
10. Запустить QA Dashboard checks.
11. Запустить Production Readiness.
12. Сгенерировать Case Report или Clinical Report.
13. Открыть Timeline и Audit Log.
14. Экспортировать PMAS Backup JSON.
15. Показать Release Manager.
16. Показать Plugin Manager и built-in plugins.

Рекомендуемое позиционирование:

"PMAS v1.0 показывает полный product workflow и platform architecture. Следующий milestone - production hardening: persistence, authentication, real reconstruction integration, tests и clinical validation."

## Текущие ограничения

- Нет production database.
- Backend state сейчас хранится in-memory.
- Frontend mock mode использует localStorage.
- Reconstruction engine по умолчанию mock.
- Нет production authentication.
- Team permissions смоделированы, но не полностью enforced backend auth.
- Нет клинической валидации measurements или observations.
- Backup в первую очередь JSON-first и не решает полностью durable artifact storage.
- Plugin architecture имеет registry и extension points, но не runtime plugin execution.
- Нет полноценного automated test suite и CI gate.

## PMAS v1.1 Priorities

- Добавить persistent database и migrations.
- Добавить authentication и backend permission enforcement.
- Разделить крупные frontend controllers на feature modules.
- Добавить automated unit, API и smoke tests.
- Добавить строгие API/domain schemas.
- Улучшить backup: artifact manifest и binary recovery strategy.
- Улучшить report templates и качество export.
- Добавить global immutable audit trail.
- Настроить real reconstruction backend integration.

## PMAS v2.0 Vision

В будущем PMAS может стать полноценной medical planning platform с:

- real reconstruction workers;
- durable case database;
- AI-assisted 3D landmark proposals;
- advanced model comparison;
- specialty-specific clinical modules;
- plugin marketplace;
- enterprise audit, SSO и retention;
- clinical report template marketplace;
- managed reconstruction processing service.

## Safety Notes

PMAS должен сохранять врача в центре принятия решений.

Система может подсвечивать observations, warnings и data quality issues, но не должна:

- ставить диагнозы;
- назначать лечение;
- заменять clinical judgment врача;
- скрывать uncertainty;
- выдавать mock reconstruction за реальный clinical output.

