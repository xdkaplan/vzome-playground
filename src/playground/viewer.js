// Minimal wireframe viewer for the output mesh. Renders `edges` as 3D line
// segments with orbit controls and an auto-fitting camera. Works on any mesh
// with numeric `vertices` + `edges` — toy engine today, real golden-field mesh
// later, unchanged.
//
// This is intentionally a wireframe. A vZome-quality view (solid colored
// struts, balls, lighting) is the separate vzome-viewer component and is out of
// scope here.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('rgb(149, 194, 231)');

  const camera = new THREE.PerspectiveCamera(50, 1, 0.001, 10000);
  camera.position.set(3, 3, 3);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  scene.add(new THREE.AxesHelper(0.4));

  let lines = null;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    resize();
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function fitCamera(geometry) {
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere) return;
    const r = Math.max(sphere.radius, 0.001);
    controls.target.copy(sphere.center);
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    camera.position.copy(sphere.center).addScaledVector(dir, r * 3);
    camera.near = r / 100;
    camera.far = r * 100;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function render(mesh) {
    if (lines) {
      scene.remove(lines);
      lines.geometry.dispose();
      lines.material.dispose();
      lines = null;
    }
    if (!mesh || !mesh.edges || !mesh.edges.length) return;

    const verts = mesh.vertices;
    const positions = [];
    for (const [a, b] of mesh.edges) {
      positions.push(verts[a][0], verts[a][1], verts[a][2]);
      positions.push(verts[b][0], verts[b][1], verts[b][2]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x0b2545 });
    lines = new THREE.LineSegments(geometry, material);
    scene.add(lines);
    fitCamera(geometry);
  }

  return { render };
}
