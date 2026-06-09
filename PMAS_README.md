# PMAS - Patient/Plastic Medical Analysis System

PMAS is a browser-based clinical planning and documentation platform for facial analysis workflows. The current version is a demo/MVP foundation that connects 2D analysis, 3D model viewing, patient cases, reconstruction workflow, landmarks, measurements, reports, timeline, audit, QA checks, backups, release management and plugin architecture.

Live site:

https://luna-huker36.github.io/Clinical-Planning-System/

Repository:

https://github.com/luna-huker36/Clinical-Planning-System

## Important Status

PMAS v1.0 is suitable for product demos, workflow demonstrations and architecture review.

PMAS v1.0 is not a certified medical device, not a diagnostic system and not a replacement for physician review.

The reconstruction backend currently works as a scaffold/demo pipeline. By default it uses mock reconstruction output and a test GLB model to demonstrate the workflow.

## What PMAS Does

PMAS organizes the full case workflow:

1. Create or open a patient case.
2. Load a 2D photo or 3D model.
3. Run or review reconstruction workflow.
4. Add landmarks and measurements.
5. Review clinical observations.
6. Run QA and production readiness checks.
7. Generate reports.
8. Track all case activity through timeline and audit log.
9. Export or restore local backup data.
10. Manage internal release candidates and plugin registry.

## Core Modules

### 2D Analysis

The 2D module allows the user to load a facial photo and perform planning measurements directly in the browser.

Features:

- image upload;
- AI face landmarks in browser;
- manual points, lines, angles, vectors and zones;
- calibration in millimeters;
- asymmetry comparison;
- before/after overlay;
- PDF and DOCX export.

### 3D Viewer

The 3D module allows the user to inspect and annotate a facial model.

Features:

- GLB/GLTF model loading;
- orbit, pan and zoom controls;
- wireframe, normals and lighting modes;
- 3D points and measurements;
- 3D landmarks;
- planning element list;
- PDF and DOCX export.

### Patient Cases

Patient cases are the central unit of PMAS.

Each case can contain:

- patient data;
- notes;
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

The reconstruction workflow demonstrates the planned pipeline from source files to a PMAS-ready 3D model.

Pipeline:

1. Upload input files.
2. Validate input.
3. Analyze frames.
4. Extract frames from video when needed.
5. Run frame quality checks.
6. Generate or mock segmentation masks.
7. Pause for frame review.
8. Run reconstruction engine.
9. Convert mesh to GLB.
10. Run mesh cleanup.
11. Align model for PMAS.
12. Optionally request manual adjustment.
13. Produce final model metadata.

Current limitation:

- the default engine is a mock engine;
- external CLI integration points exist, but production reconstruction is not fully configured;
- the output should be treated as demo data unless a real reconstruction engine is connected.

### Landmarks

Landmarks represent key facial or anatomical reference points.

Supported data:

- landmark ID;
- case ID;
- model ID;
- name;
- category;
- 3D position;
- source;
- detection mode;
- confidence;
- status;
- required flag;
- template metadata.

Landmarks are used by measurements, clinical observations, QA checks and reports.

### Measurements

Measurements store clinical planning values and annotations.

Supported types:

- distance;
- angle;
- vector;
- point;
- annotation;
- ratio;
- custom.

Measurements can be manual or template-driven. They can be linked to landmarks and included in reports, QA checks and clinical insights.

### Clinical Analysis

PMAS includes a rule-based clinical analysis layer.

It can summarize:

- selected clinical presets;
- generated landmarks;
- generated measurements;
- missing data;
- warnings;
- comparison results.

This module does not make diagnoses and does not provide medical recommendations.

### Clinical Insights Engine

The Clinical Insights Engine creates structured observations from case data.

It analyzes:

- readiness score;
- measurements;
- missing landmarks;
- low-confidence landmarks;
- reconstruction warnings;
- comparison results;
- simulation results.

Example observations:

- "Some landmarks have low confidence."
- "Model readiness score requires attention."
- "Required landmarks are missing."
- "Some measurements require manual review."

Supported severity values:

- info;
- warning;
- attention.

### Reports

PMAS can generate structured report data for:

- clinical report;
- case report;
- reconstruction report;
- comparison report;
- system report;
- release summary report.

Reports can include:

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

The timeline shows the history of a patient case.

It can include:

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

Audit Log records important user actions inside a patient case.

Examples:

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
- plugin enabled or disabled.

Audit events contain:

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

PMAS supports a basic collaboration model.

Supported roles:

- owner;
- surgeon;
- assistant;
- viewer.

Each role has a permissions list. The current implementation is suitable for demo and data modeling. Production-ready backend authentication and permission enforcement still need to be added.

### Backup & Recovery

PMAS supports local backup and recovery through PMAS Backup JSON.

Backup includes:

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
- plugin/release metadata where available.

Backup supports:

- export full backup;
- validate backup format;
- validate backup version;
- verify checksum;
- show preview;
- restore selected cases or full backup data.

Current limitation:

- backup focuses on JSON application state;
- binary model artifacts and durable external storage need a stronger production strategy.

### QA Dashboard

The QA Dashboard checks the technical completeness of each case.

It validates:

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

This is technical and product validation, not medical validation.

### Production Readiness

Production Readiness checks whether a case, model, report or system is ready for internal working use.

Supported scopes:

- case;
- model;
- report;
- system.

Readiness levels:

- not_ready;
- limited;
- ready;
- production_ready.

This is an internal PMAS readiness check, not medical certification.

### Release Candidate Manager

The Release Candidate Manager supports internal PMAS version snapshots.

It can:

- create release candidates;
- promote release status;
- archive releases;
- clone releases;
- export release summary.

Release statuses:

- draft;
- testing;
- release_candidate;
- approved;
- archived.

The release manager is not a Git replacement. It is an internal product readiness and snapshot layer.

### Plugin Architecture

PMAS includes a Plugin Registry and Plugin Manager.

Plugin categories:

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

Current limitation:

- registry and validation are implemented;
- runtime loading, plugin sandboxing and lifecycle hooks are future work.

## System Architecture

PMAS currently consists of:

- static browser frontend;
- modular JavaScript files under `assets/js`;
- Express backend scaffold under `backend`;
- reconstruction API under `backend/reconstruction`;
- local model assets under `models`;
- localStorage fallback for frontend demo mode;
- in-memory backend store for backend scaffold mode.

Important files:

- `index.html` - main application page;
- `assets/js/app.js` - 3D viewer and planning logic;
- `assets/js/12-reconstruction.js` - PMAS reconstruction/case UI controller;
- `assets/js/15-reconstruction-api.js` - frontend PMAS API adapter and mock fallback;
- `backend/server.js` - Express server;
- `backend/reconstruction/routes.js` - reconstruction API routes;
- `backend/reconstruction/store.js` - in-memory PMAS domain store;
- `backend/reconstruction/reconstruction-results.js` - reports, timelines and result summaries;
- `backend/reconstruction/clinical-insights-engine.js` - insights engine;
- `backend/reconstruction/qa-validation-engine.js` - QA engine;
- `backend/reconstruction/production-readiness-check.js` - readiness engine;
- `backend/reconstruction/backup-recovery.js` - backup validation and export;
- `backend/reconstruction/release-candidate-manager.js` - release manager logic;
- `backend/reconstruction/plugin-architecture.js` - plugin registry definitions.

## Running Locally

Install dependencies:

```bash
npm install
```

Start the backend:

```bash
npm start
```

Open frontend:

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

Suggested demo flow:

1. Open the PMAS site.
2. Show 2D analysis with a sample face photo.
3. Switch to 3D model viewer.
4. Create a patient case.
5. Attach or load model data.
6. Show reconstruction workflow stages.
7. Add landmarks.
8. Add measurements.
9. Open Clinical Insights.
10. Run QA Dashboard checks.
11. Run Production Readiness.
12. Generate Case Report or Clinical Report.
13. Open Timeline and Audit Log.
14. Export PMAS Backup JSON.
15. Show Release Manager.
16. Show Plugin Manager and built-in plugins.

Recommended positioning:

"PMAS v1.0 demonstrates the full product workflow and platform architecture. The next milestone is production hardening: persistence, authentication, real reconstruction integration, tests and clinical validation."

## Current Limitations

- No production database.
- Backend state is currently in-memory.
- Frontend mock mode uses localStorage.
- Reconstruction engine is mock by default.
- No production authentication.
- Team permissions are modeled but not fully enforced by backend auth.
- No clinical validation of measurements or observations.
- Backup is JSON-first and does not fully solve durable artifact storage.
- Plugin architecture has registry and extension points, but not runtime plugin execution.
- No full automated test suite or CI gate yet.

## PMAS v1.1 Priorities

- Add persistent database and migrations.
- Add authentication and backend permission enforcement.
- Split large frontend controllers into feature modules.
- Add automated unit, API and smoke tests.
- Add strict API/domain schemas.
- Improve backup to include artifact manifest and binary recovery strategy.
- Improve report templates and export quality.
- Add global immutable audit trail.
- Configure real reconstruction backend integration.

## PMAS v2.0 Vision

Future PMAS can evolve into a medical planning platform with:

- real reconstruction workers;
- durable case database;
- AI-assisted 3D landmark proposals;
- advanced model comparison;
- specialty-specific clinical modules;
- plugin marketplace;
- enterprise audit, SSO and retention;
- clinical report template marketplace;
- managed reconstruction processing service.

## Safety Notes

PMAS should always keep the physician in control.

The system may highlight observations, warnings and data quality issues, but it must not:

- make diagnoses;
- prescribe treatment;
- replace clinician judgment;
- hide uncertainty;
- present mock reconstruction as real clinical output.

