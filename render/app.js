// Renderer v3: ONE fixed orthographic camera for the whole map. Shots move only the view
// frustum, in whole pixels, so every shot is pixel-registered with every other (tiny.london method).
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TileCompressionPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

window.start = (o) => {
  const S = o.shot;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(S, S); renderer.setClearColor(0xff00ff); // magenta = mesh hole
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 3));

  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: o.key, autoRefreshToken: true }));
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: new DRACOLoader().setDecoderPath('./draco/') }));
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.errorTarget = o.errorTarget;
  tiles.maxDepth = Infinity;
  tiles.lruCache.minSize = 20000; tiles.lruCache.maxSize = 40000;
  tiles.lruCache.maxBytesSize = 6e9; tiles.lruCache.minBytesSize = 4e9;
  tiles.downloadQueue.maxJobs = 24; tiles.parseQueue.maxJobs = 4;

  // Local ENU frame at the anchor: x = east, y = north, z = up.
  const enu = new THREE.Matrix4();
  tiles.ellipsoid.getEastNorthUpFrame(o.lat * Math.PI / 180, o.lon * Math.PI / 180, o.groundH, enu);
  tiles.group.matrixAutoUpdate = false;
  tiles.group.matrix.copy(enu).invert(); tiles.group.updateMatrixWorld(true);
  scene.add(tiles.group);

  // Fixed camera. View direction F: azimuth `heading` (clockwise from north), tilted down by `tilt`.
  const h = o.heading * Math.PI / 180, t = o.tilt * Math.PI / 180, D = 5000;
  const F = new THREE.Vector3(Math.sin(h) * Math.cos(t), Math.cos(h) * Math.cos(t), -Math.sin(t));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  cam.position.copy(F).multiplyScalar(-D); cam.up.set(0, 0, 1); cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();

  // Canvas pixel (u, v): u to the right, v down, (0, 0) = anchor. A shot covers [u0, u0+S) x [v0, v0+S).
  window.setShot = (u0, v0) => {
    const m = o.mpp;
    cam.left = u0 * m; cam.right = (u0 + S) * m;
    cam.top = -v0 * m; cam.bottom = -(v0 + S) * m;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    window.__st.frames = 0;
  };
  // Height pass: world height (ENU z, metres above the anchor ground) encoded in 24 bits RGB,
  // rendered without MSAA into its own target so edge pixels never mix two heights.
  const H0 = o.h0 ?? -60, H1 = o.h1 ?? 260;   // metres relative to the anchor ground; lower h0 for the airport (~75 m)
  const heightMat = new THREE.ShaderMaterial({
    vertexShader: 'varying float vH; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vH = w.z; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying float vH; void main(){ float t = clamp((vH - (${H0.toFixed(1)})) / (${(H1 - H0).toFixed(1)}), 0.0, 1.0);
      float v = floor(t * 16777214.0) + 1.0; float r = floor(v / 65536.0); float g = floor((v - r * 65536.0) / 256.0); float b = v - r * 65536.0 - g * 256.0;
      gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0); }`,
    side: THREE.DoubleSide,
  });
  const hTarget = new THREE.WebGLRenderTarget(S, S, { samples: 0, type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace });
  window.captureHeight = () => {
    scene.overrideMaterial = heightMat;
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 1);          // 0 = no data
    renderer.setRenderTarget(hTarget); renderer.render(scene, cam);
    const px = new Uint8Array(S * S * 4); renderer.readRenderTargetPixels(hTarget, 0, 0, S, S, px);
    renderer.setRenderTarget(null); scene.overrideMaterial = null; renderer.setClearColor(cc, ca);
    const c2 = document.createElement('canvas'); c2.width = S; c2.height = S;
    const g = c2.getContext('2d'), img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);  // flip: GL rows are bottom-up
    g.putImageData(img, 0, 0);
    return c2.toDataURL('image/png');
  };
  window.__heightRange = [H0, H1];
  window.__st = { frames: 0 };
  window.setShot(-S / 2, -S / 2);
  tiles.setCamera(cam); tiles.setResolutionFromRenderer(cam, renderer);

  function loop() {
    tiles.update(); renderer.render(scene, cam);
    const s = tiles.stats;
    window.__st = { frames: window.__st.frames + 1, progress: tiles.loadProgress, downloading: s.downloading, parsing: s.parsing, loaded: s.loaded, visible: tiles.visibleTiles.size };
    requestAnimationFrame(loop);
  }
  loop();
};
