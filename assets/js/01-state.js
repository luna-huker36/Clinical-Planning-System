
const photo = document.getElementById("photo");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const abEl = document.getElementById("abResult");
const scaleBadge = document.getElementById("scaleBadge");
const zoomBadge = document.getElementById("zoomBadge");

let mode = null;
let currentType = null;
let pendingPoints = [];
let measurements = {};
let scaleMMperPx = null;
let zoom = 1.0;
let drag = { active:false, kind:null, id:null, which:null, index:null };
let aiPoints = [];
let guides = {
  midline: null,
  eyeline: null,
  thirds: null
};
let trichionPoint = null;

let aiMetrics = null;
let planItems = [];
let planZones = [];
let selectedPlan = null;
let beforeSnapshot = null;
let showBefore = false;

let planMode = null;
let planPending = [];
let aiPickMode = false;
let aiPickPending = [];
let lastAIKeypoints = null;

