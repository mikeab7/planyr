/* The 3D viewer's SCENE (owner-only grading layer; NEW-1, 2026-11-11). THE ONLY FILE IN THE APP THAT IMPORTS `three`.
 *
 * ⛔ three.js reaches the browser only through the viewer's own lazy chunk: SitePlanner.jsx loads the viewer component with React.lazy over a dynamic import,
 * and that component statically imports this file. Nothing else may import "three" (repo-root `test/` **grading3dBundle** scans the tree), so the
 * main bundle and the planner chunk carry a button and a loader and nothing more. Named imports only, so the bundler keeps just what is used; the
 * orbit controls are the pure `orbit.js` (no `three/examples`).
 *
 * What it does with the pure mesh builders' typed arrays: one lit solid (the proposed top + the banded side faces), the EXISTING ground as a ghost
 * wire, the buildings' dashed footprints, and — when the slice is on — a clipping plane that removes the near half, the section face drawn in the
 * plane, and a handle on the ground to slide it. Everything is drawn on demand (one frame per change), never in a loop. `dispose()` releases every
 * geometry, material, the renderer and its listeners; `stats()` reports live GPU objects so a harness can prove opening and closing leaks nothing.
 *
 * Colours are written as given (no colour-management conversion) so the 3D vertex colours are the SAME numbers as the 2D cut / fill bands. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Mesh, LineSegments, MeshLambertMaterial, MeshBasicMaterial,
  LineBasicMaterial, DirectionalLight, AmbientLight, Group, Plane, Vector3, Vector2, Raycaster, DoubleSide, CylinderGeometry, Color, ColorManagement,
  LinearSRGBColorSpace,
} from "three";
import { frame, clampState, cameraPosition, orbitBy, panBy, zoomBy, boundsOf, FOV_DEG } from "./orbit.js";
import { VOID_HEX, HANDLE_HEX, STRATA_RGB, OUTLINE_RGB } from "./colors.js";
import { buildSlice, shiftLine, slideRange } from "./meshBuild.js";
import { fieldAt } from "./field.js";

ColorManagement.enabled = false;               // vertex colours and hexes are drawn as written

const live = { geometries: 0, materials: 0, scenes: 0, created: 0, disposed: 0 };
export const liveStats = () => ({ ...live });

const rgbHex = (rgb) => (Math.round(rgb[0]) << 16) | (Math.round(rgb[1]) << 8) | Math.round(rgb[2]);

function geometryOf({ positions, normals = null, colors = null, indices = null }) {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  if (normals) g.setAttribute("normal", new BufferAttribute(normals, 3));
  if (colors) g.setAttribute("color", new BufferAttribute(colors, 3));
  if (indices) g.setIndex(new BufferAttribute(indices, 1));
  live.geometries++; live.created++;
  return g;
}

export function createViewerScene(host, { onSliceLine = null, onDragState = null } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2));
  renderer.setClearColor(new Color(VOID_HEX), 1);
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.style.display = "block"; canvas.style.width = "100%"; canvas.style.height = "100%"; canvas.style.touchAction = "none";
  canvas.setAttribute("data-grading-3d-canvas", "1");
  host.appendChild(canvas);
  live.scenes++;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEG, 1.6, 1, 1e6);
  // three (r155+) lights are in physical units — an intensity of 1 lights a diffuse surface at 1/π of its colour, so the weights below (a flat
  // surface reads at ~96%: ambient 0.58 + sun 0.46 × cos(angle) ≈ 0.38) are scaled by π. Without it the model read as a dim silhouette.
  const ambient = new AmbientLight(0xffffff, 0.58 * Math.PI);
  const sun = new DirectionalLight(0xffffff, 0.46 * Math.PI);
  scene.add(ambient, sun, sun.target);
  const root = new Group();          // the lit model: Y is scaled by the height stretch
  const sliceGroup = new Group();    // the section face and its lines: also Y-scaled
  const handleGroup = new Group();   // the handle: positioned in stretched world units, never clipped
  scene.add(root, sliceGroup, handleGroup);

  // the clipping plane that removes the near half of the model when the slice is on (off = a plane that keeps everything)
  const plane = new Plane(new Vector3(0, 1, 0), 1e9);
  const clip = [plane];
  const mats = [];
  const track = (m) => { mats.push(m); live.materials++; return m; };
  const topMat = track(new MeshLambertMaterial({ vertexColors: true, clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const wallMat = track(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, clippingPlanes: clip }));
  const ghostMat = track(new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, clippingPlanes: clip }));
  const outlineMat = track(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const faceMat = track(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  const strataMat = track(new LineBasicMaterial({ color: rgbHex(STRATA_RGB), transparent: true, opacity: 0.7 }));
  const existLineMat = track(new LineBasicMaterial({ color: rgbHex(OUTLINE_RGB) }));
  const propLineMat = track(new LineBasicMaterial({ color: rgbHex(OUTLINE_RGB) }));
  const handleMat = track(new MeshBasicMaterial({ color: new Color(HANDLE_HEX), side: DoubleSide }));
  const poleMat = track(new LineBasicMaterial({ color: new Color(HANDLE_HEX) }));

  let model = null, stretch = 3, ghostOn = true;
  let sliceOn = false, line = null, keepSign = 1, lineBase = null, range = null;
  let bounds = null, cam = null, home = null;
  let dirty = false, raf = 0, disposed = false, dragging = null;
  const meshes = { top: null, walls: null, ghost: null, outline: null, face: null, strata: null, existing: null, proposed: null, handle: null, pole: null };

  const dropObject = (o) => { if (!o) return; if (o.parent) o.parent.remove(o); if (o.geometry) { o.geometry.dispose(); live.geometries--; live.disposed++; } };
  const render = () => {
    raf = 0; dirty = false;
    if (disposed || !cam) return;
    const p = cameraPosition(cam);
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
  };
  const requestRender = () => { if (dirty || disposed) return; dirty = true; raf = requestAnimationFrame(render); };

  const refreshBounds = () => {
    if (!model) return;
    const b = model.field.bounds;
    bounds = boundsOf({ minX: b.x0, maxX: b.x1, minY: model.baseZ, maxY: model.field.zHi, minZ: b.y0, maxZ: b.y1 }, stretch);
    root.scale.y = stretch; sliceGroup.scale.y = stretch;
    sun.position.set(bounds.cx - bounds.radius * 1.2, bounds.cy + bounds.radius * 2.2, bounds.cz - bounds.radius * 0.9);
    sun.target.position.set(bounds.cx, bounds.cy, bounds.cz);
    camera.near = Math.max(1, bounds.radius * 0.01); camera.far = bounds.radius * 60; camera.updateProjectionMatrix();
  };
  const aspect = () => (host.clientWidth || 1) / (host.clientHeight || 1);
  const resetView = () => {
    if (!bounds) return;
    cam = frame(bounds, aspect()); home = { ...cam };
    requestRender();
  };

  const setMesh = (key, parent, obj) => { dropObject(meshes[key]); meshes[key] = obj; if (obj) parent.add(obj); };
  const solid = (arrs, mat) => { const m = new Mesh(geometryOf(arrs), mat); m.frustumCulled = false; return m; };
  const wire = (arrs, mat) => { const l = new LineSegments(geometryOf(arrs), mat); l.frustumCulled = false; return l; };

  function placePlane() {
    if (!line) return;
    const nx = line.nx * keepSign, nz = line.ny * keepSign;
    plane.normal.set(nx, 0, nz);
    plane.constant = -(nx * line.px + nz * line.py);
  }
  function rebuildSlice() {
    if (!model || !line) return;
    const s = buildSlice(model.field, model.regions, line, model.baseZ, { sample: model.sample });
    setMesh("face", sliceGroup, s.faces.triangleCount ? solid({ positions: s.faces.positions, colors: s.faces.colors, indices: s.faces.indices }, faceMat) : null);
    setMesh("strata", sliceGroup, s.strata.positions.length ? wire({ positions: s.strata.positions }, strataMat) : null);
    setMesh("existing", sliceGroup, s.existing.positions.length ? wire({ positions: s.existing.positions }, existLineMat) : null);
    setMesh("proposed", sliceGroup, s.proposed.positions.length ? wire({ positions: s.proposed.positions }, propLineMat) : null);
    // the handle: a disc on the ground where the cut enters the property, and a pole down to the surface
    handleGroup.visible = sliceOn && s.intervals.length > 0;
    if (s.intervals.length) {
      const t0 = s.intervals[0][0];
      const hx = line.px + line.dx * t0, hz = line.py + line.dy * t0;
      const zg = fieldAt(model.field, "prop", hx, hz);
      const r = Math.max(14, bounds.radius * 0.022);
      const y = (Number.isFinite(zg) ? zg : model.field.zHi) * stretch + r * 0.15;
      if (!meshes.handle) {
        const g = new CylinderGeometry(1, 1, 0.34, 28); live.geometries++; live.created++;
        meshes.handle = new Mesh(g, handleMat); meshes.handle.frustumCulled = false; handleGroup.add(meshes.handle);
        meshes.handle.userData.isHandle = true;
      }
      meshes.handle.scale.set(r, r, r); meshes.handle.position.set(hx, y, hz);
      const pole = geometryOf({ positions: Float32Array.of(hx, y, hz, hx, (Number.isFinite(zg) ? zg : model.field.zHi) * stretch, hz) });
      setMesh("pole", handleGroup, new LineSegments(pole, poleMat));
      meshes.pole.frustumCulled = false;
    }
    placePlane();
  }

  // ---------------------------------------------------------------- public
  function setModel(m) {
    model = m;
    refreshBounds();
    setMesh("top", root, solid(m.top, topMat));
    setMesh("walls", root, solid(m.walls, wallMat));
    setMesh("ghost", root, m.ghost.segmentCount ? wire(m.ghost, ghostMat) : null);
    if (meshes.ghost) meshes.ghost.visible = ghostOn;
    setMesh("outline", root, m.outline.triangleCount ? solid(m.outline, outlineMat) : null);
    if (!cam) resetView(); else { cam = clampState({ ...cam, distMin: bounds.radius * 0.08, distMax: bounds.radius * 6 }, bounds); }
    if (sliceOn && line) { range = slideRange(lineBase, model.regions); rebuildSlice(); }
    requestRender();
  }
  function setStretch(k) {
    if (!(k > 0) || k === stretch) return;
    const ratio = k / stretch; stretch = k;
    refreshBounds();
    if (cam) { cam = clampState({ ...cam, ty: cam.ty * ratio }, bounds); home = home && { ...home, ty: home.ty * ratio }; }
    if (sliceOn && line) rebuildSlice();
    requestRender();
  }
  function setGhost(on) { ghostOn = !!on; if (meshes.ghost) meshes.ghost.visible = ghostOn; requestRender(); }
  /* on/off, with the line it should start from. The near half is the one the camera is on when the slice goes on. */
  function setSlice(on, startLine) {
    sliceOn = !!on;
    if (sliceOn) {
      if (startLine && !lineBase) lineBase = startLine;
      if (startLine) line = line || startLine;
      if (!line) { sliceOn = false; return; }
      const p = cameraPosition(cam);
      keepSign = (p.x - line.px) * line.nx + (p.z - line.py) * line.ny >= 0 ? -1 : 1;
      range = slideRange(lineBase, model.regions);
      rebuildSlice();
      sliceGroup.visible = true; handleGroup.visible = true;
    } else {
      plane.normal.set(0, 1, 0); plane.constant = 1e9;
      sliceGroup.visible = false; handleGroup.visible = false;
    }
    requestRender();
  }
  const getLine = () => line;
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    requestRender();
  }

  // ---------------------------------------------------------------- pointer
  const ray = new Raycaster(), ndc = new Vector2(), ground = new Plane(new Vector3(0, 1, 0), 0), hit = new Vector3();
  const setNdc = (e) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  const overHandle = (e) => { if (!sliceOn || !meshes.handle || !handleGroup.visible) return false; setNdc(e); return ray.intersectObject(meshes.handle, false).length > 0; };
  let last = null;
  function onDown(e) {
    if (disposed) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    last = { x: e.clientX, y: e.clientY };
    if (e.button === 0 && !e.shiftKey && overHandle(e)) {
      dragging = "handle"; ground.constant = -meshes.handle.position.y;
      if (onDragState) onDragState(true);
    } else dragging = e.button === 2 || e.shiftKey || e.button === 1 ? "pan" : "orbit";
    canvas.style.cursor = dragging === "pan" ? "move" : dragging === "handle" ? "grabbing" : "grabbing";
    e.preventDefault();
  }
  function onMove(e) {
    if (disposed) return;
    if (!dragging) { canvas.style.cursor = overHandle(e) ? "grab" : "default"; return; }
    const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
    if (dragging === "orbit") cam = orbitBy(cam, dx, dy, bounds);
    else if (dragging === "pan") cam = panBy(cam, dx, dy, host.clientHeight || 1, bounds);
    else if (dragging === "handle" && lineBase) {
      setNdc(e);
      if (ray.ray.intersectPlane(ground, hit)) {
        let s = (hit.x - lineBase.px) * lineBase.nx + (hit.z - lineBase.py) * lineBase.ny;
        s = Math.max(range.lo, Math.min(range.hi, s));
        line = shiftLine(lineBase, s);
        rebuildSlice();
        if (onSliceLine) onSliceLine(line);
      }
    }
    requestRender();
  }
  function onUp(e) {
    if (!dragging) return;
    if (dragging === "handle" && onDragState) onDragState(false);
    dragging = null; canvas.style.cursor = "default";
    if (canvas.releasePointerCapture && canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  function onWheel(e) { e.preventDefault(); if (disposed || !cam) return; cam = zoomBy(cam, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY, bounds); requestRender(); }
  const noMenu = (e) => e.preventDefault();
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false }); canvas.addEventListener("contextmenu", noMenu);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(host);
  resize();

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
    canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("wheel", onWheel); canvas.removeEventListener("contextmenu", noMenu);
    for (const k of Object.keys(meshes)) { dropObject(meshes[k]); meshes[k] = null; }
    for (const m of mats) { m.dispose(); live.materials--; }
    mats.length = 0;
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    live.scenes--;
  }
  function handleScreen() {
    if (!meshes.handle || !handleGroup.visible || !cam) return null;
    const v = meshes.handle.position.clone().project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }
  function state() {
    return {
      handleScreen: handleScreen(),
      az: cam && cam.az, el: cam && cam.el, dist: cam && cam.dist, stretch, ghostOn, sliceOn, keepSign,
      line: line && { ...line }, triangles: model ? model.top.triangleCount + model.walls.triangleCount : 0,
      info: { geometries: renderer.info.memory.geometries, programs: renderer.info.programs ? renderer.info.programs.length : 0, calls: renderer.info.render.calls },
      homeDist: home && home.dist,
    };
  }
  /* A harness-only way to move the camera exactly (orbit / zoom by pixel amounts, as a person's drag would). */
  function drive({ orbit = null, pan = null, zoom = null } = {}) {
    if (orbit) cam = orbitBy(cam, orbit[0], orbit[1], bounds);
    if (pan) cam = panBy(cam, pan[0], pan[1], host.clientHeight || 1, bounds);
    if (zoom) cam = zoomBy(cam, zoom, bounds);
    requestRender();
  }
  return { setModel, setStretch, setGhost, setSlice, getLine, resetView, resize, dispose, state, drive, requestRender, renderNow: render };
}
