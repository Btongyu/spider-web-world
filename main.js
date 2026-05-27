import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WebLayer } from './WebLayer.js';

// ══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
const LAYER_COUNT    = 12;
const LAYER_SPACING  = 18;
const MOVE_SPEED     = 10;
const ZOOM_IN_SPEED  = 2.0;
const ZOOM_OUT_SPEED = 1.5;
const NORMAL_FOV     = 70;
const DETAIL_FOV     = 36;       // telephoto zoom
const DETAIL_DIST    = 4.0;      // camera offset from model in detail view
const DISPERSE_RATE  = 0.11;     // progress per second → ~9s full dispersion
const RESPAWN_BEHIND = 42;       // recycle model when this far behind camera
const RELEASE_BASE   = './';

const MODEL_DEFS = [
    { name: 'Bottle',   file: 'bottle.glb',    targetSize: 1.6, color: 0xF0FF0A },
    { name: 'Crocs',    file: 'crocs.glb',     targetSize: 1.8, color: 0xf88bb1 },
    { name: 'Headset',  file: 'headset.glb',   targetSize: 1.6, color: 0xFBFDFD },
    { name: 'Medicine', file: 'medicine.glb',  targetSize: 1.5, color: 0xA4FF4F },
    { name: 'Tire',     file: 'tire.glb',      targetSize: 2.0, color: 0x00FFFF },
    { name: 'Lunchbox', file: 'lunchbox.gz',   targetSize: 1.6, color: 0xEF72EC, compressed: true },
];

// ══════════════════════════════════════════════════════════════════════════════
//  PERLIN NOISE GLSL (used in dispersion vertex shader)
// ══════════════════════════════════════════════════════════════════════════════
const NOISE_GLSL = `
vec3 _m289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 _m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 _perm(vec4 x){return _m289(((x*34.)+1.)*x);}
vec4 _tiSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=_m289(i);
  vec4 p=_perm(_perm(_perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;
  vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=_tiSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
  m*=m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

// ══════════════════════════════════════════════════════════════════════════════
//  RENDERER / SCENE / CAMERA
// ══════════════════════════════════════════════════════════════════════════════
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020203, 0.021);

const camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 20);
let targetFOV = NORMAL_FOV;

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(8, 12, 10);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8899cc, 0.4);
fill.position.set(-8, -5, -5);
scene.add(fill);

// ══════════════════════════════════════════════════════════════════════════════
//  WEB LAYERS
// ══════════════════════════════════════════════════════════════════════════════
const webLayers = [];
for (let i = 0; i < LAYER_COUNT; i++) {
    const layer = new WebLayer(-i * LAYER_SPACING);
    scene.add(layer);
    webLayers.push(layer);
}

// ══════════════════════════════════════════════════════════════════════════════
//  MODEL LOADING WITH INLINE DISPERSION SHADER
// ══════════════════════════════════════════════════════════════════════════════
const modelObjects = [];
const loader = new GLTFLoader();

function buildModelAt(def, xPos, yPos, zPos) {
    const url     = RELEASE_BASE + def.file;
    const onError = e => console.error(`Failed to load ${def.file}`, e);

    const onLoad = (gltf) => {
        // Normalize size and center
        const rawBox = new THREE.Box3().setFromObject(gltf.scene);
        const rawSize = rawBox.getSize(new THREE.Vector3()).length();
        const rawCenter = rawBox.getCenter(new THREE.Vector3());
        const s = def.targetSize / rawSize;
        gltf.scene.scale.setScalar(s);
        gltf.scene.position.sub(rawCenter.multiplyScalar(s));

        // Per-model uniforms shared across all meshes + dust
        const gu = {
            uProgress:        { value: 0.0 },
            uMaxProgressSeen: { value: 0.0 },
            uTime:            { value: 0.0 },
            uGlowColor:       { value: new THREE.Color(def.color) },
            uFade:            { value: 1.0 }
        };

        const dustPos = [], dustRnd = [], dustDir = [], dustSz = [];

        gltf.scene.traverse(child => {
            if (!child.isMesh) return;
            if (child.geometry.index) child.geometry = child.geometry.toNonIndexed();
            child.geometry.computeBoundingBox();
            child.geometry.computeBoundingSphere();

            const pa = child.geometry.attributes.position;
            const cnt = pa.count;
            const centroids  = new Float32Array(cnt * 3);
            const randoms    = new Float32Array(cnt);
            const permanents = new Float32Array(cnt);

            for (let i = 0; i < cnt; i += 3) {
                const cx = (pa.getX(i) + pa.getX(i+1) + pa.getX(i+2)) / 3;
                const cy = (pa.getY(i) + pa.getY(i+1) + pa.getY(i+2)) / 3;
                const cz = (pa.getZ(i) + pa.getZ(i+1) + pa.getZ(i+2)) / 3;
                const r  = Math.random();
                const ip = Math.random() < 0.05 ? 1.0 : 0.0;
                for (let j = 0; j < 3; j++) {
                    centroids[(i+j)*3]   = cx;
                    centroids[(i+j)*3+1] = cy;
                    centroids[(i+j)*3+2] = cz;
                    randoms[i+j]    = r;
                    permanents[i+j] = ip;
                }
                if (Math.random() < 0.38) {
                    dustPos.push(cx+(Math.random()-.5)*.2, cy+(Math.random()-.5)*.2, cz+(Math.random()-.5)*.2);
                    dustRnd.push(r);
                    const d = new THREE.Vector3(Math.random()-.5, Math.random()-.5, Math.random()-.5)
                        .normalize().multiplyScalar(Math.random() * 0.55 + 0.18); // SLOW drift
                    dustDir.push(d.x, d.y, d.z);
                    dustSz.push(Math.random() * 0.5 + 0.18);
                }
            }

            child.geometry.setAttribute('aCentroid',    new THREE.BufferAttribute(centroids, 3));
            child.geometry.setAttribute('aRandom',      new THREE.BufferAttribute(randoms, 1));
            child.geometry.setAttribute('aIsPermanent', new THREE.BufferAttribute(permanents, 1));

            const mat = child.material.clone();
            mat.transparent = true;
            mat.side = THREE.DoubleSide;
            mat.blending = THREE.AdditiveBlending;
            mat.depthWrite = false;
            mat.customProgramCacheKey = () => `disp_${def.name}`;

            mat.onBeforeCompile = shader => {
                shader.uniforms.uProgress        = gu.uProgress;
                shader.uniforms.uMaxProgressSeen = gu.uMaxProgressSeen;
                shader.uniforms.uTime            = gu.uTime;
                shader.uniforms.uGlowColor       = gu.uGlowColor;
                shader.uniforms.uFade            = gu.uFade;

                shader.vertexShader = `
                    uniform float uProgress;
                    uniform float uMaxProgressSeen;
                    uniform float uTime;
                    attribute vec3  aCentroid;
                    attribute float aRandom;
                    attribute float aIsPermanent;
                    varying float   vDisp;
                    ${NOISE_GLSL}
                ` + shader.vertexShader;

                shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
                    #include <begin_vertex>
                    float dynP  = clamp((uProgress - aRandom*.3)/.7, 0., 1.);
                    float dynE  = dynP*dynP*(3.-2.*dynP);
                    float lckP  = clamp((uMaxProgressSeen - aRandom*.3)/.7, 0., 1.);
                    float lckE  = lckP*lckP*(3.-2.*lckP);
                    float mixE  = mix(dynE, max(dynE,lckE), aIsPermanent);
                    vDisp       = mixE;
                    transformed = aCentroid + (transformed - aCentroid)*mix(1.,0.05,mixE);
                    float t  = uTime * 0.09;
                    vec3  np = aCentroid * 1.4;
                    vec3  nv = vec3(snoise(np+vec3(t,0.,0.)), snoise(np+vec3(0.,t,0.)), snoise(np+vec3(0.,0.,t)));
                    transformed += (nv*.7 + vec3(0.,.5,0.)) * mixE * 1.6;
                `);

                shader.fragmentShader = `
                    varying float vDisp;
                    uniform vec3  uGlowColor;
                    uniform float uFade;
                ` + shader.fragmentShader;

                shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
                    #include <dithering_fragment>
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, uGlowColor*3., vDisp);
                    gl_FragColor.a  *= (1. - vDisp*.5) * uFade;
                `);
            };
            child.material = mat;
        });

        // Dust particle system
        if (dustPos.length > 0) {
            const dg = new THREE.BufferGeometry();
            dg.setAttribute('position',   new THREE.Float32BufferAttribute(dustPos, 3));
            dg.setAttribute('aRandom',    new THREE.Float32BufferAttribute(dustRnd, 1));
            dg.setAttribute('aDirection', new THREE.Float32BufferAttribute(dustDir, 3));
            dg.setAttribute('aSize',      new THREE.Float32BufferAttribute(dustSz,  1));

            const dm = new THREE.ShaderMaterial({
                uniforms: {
                    uProgress:        gu.uProgress,
                    uMaxProgressSeen: gu.uMaxProgressSeen,
                    uTime:            gu.uTime,
                    uColor:           { value: new THREE.Color(def.color) },
                    uFade:            gu.uFade
                },
                vertexShader: `
                    uniform float uProgress, uMaxProgressSeen, uTime, uFade;
                    attribute float aRandom; attribute vec3 aDirection; attribute float aSize;
                    varying float vA;
                    ${NOISE_GLSL}
                    void main(){
                        float lp   = clamp((uMaxProgressSeen-aRandom*.3)/.7,0.,1.);
                        float ease = lp*lp*(3.-2.*lp);
                        float t    = uTime*.025;                  // SLOW
                        vec3  np   = position*.7;
                        vec3  mn   = vec3(snoise(np+vec3(t,0.,0.)),snoise(np+vec3(0.,t,0.)),snoise(np+vec3(0.,0.,t)))*1.0; // SLOW
                        vec3  fp   = position+(aDirection*.45+mn)*ease;    // SLOW
                        vec4  mv   = modelViewMatrix*vec4(fp,1.);
                        gl_PointSize = aSize*(5.0/-mv.z);
                        gl_Position  = projectionMatrix*mv;
                        float br = sin(uTime*.55+position.x*18.+position.y*9.);
                        vA = ease*(0.12+0.28*br)*uFade;
                    }`,
                fragmentShader: `
                    uniform vec3 uColor; varying float vA;
                    void main(){
                        vec2 c=gl_PointCoord-vec2(.5);
                        if(abs(c.x)+abs(c.y)>.5) discard;
                        gl_FragColor=vec4(uColor*2.,vA);
                    }`,
                transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
            });

            gltf.scene.add(new THREE.Points(dg, dm));
        }

        const meshes = [];
        gltf.scene.traverse(c => { if (c.isMesh) meshes.push(c); });

        const wrapper = new THREE.Group();
        wrapper.position.set(xPos, yPos, zPos);
        wrapper.rotation.y = Math.random() * Math.PI * 2;
        wrapper.add(gltf.scene);
        scene.add(wrapper);

        modelObjects.push({
            group: wrapper, def,
            worldPos: new THREE.Vector3(xPos, yPos, zPos),
            meshes, gu,
            disperseProgress: 0,
            disperseFired: false,   // setTimeout guard
            dispersed: false
        });
    };   // end onLoad

    if (def.compressed) {
        // Fetch WGLB (gzip wrapped), decompress with browser-native DecompressionStream
        fetch(url)
            .then(r => r.arrayBuffer())
            .then(ab => {
                return new Response(
                    new Blob([new Uint8Array(ab)]).stream().pipeThrough(new DecompressionStream('gzip'))
                ).arrayBuffer();
            })
            .then(buf => loader.parse(buf, '', onLoad, onError))
            .catch(onError);
    } else {
        loader.load(url, onLoad, undefined, onError);
    }
}

// Initial placement: distributed across early layers
MODEL_DEFS.forEach((def, i) => {
    const zPos = -(i + 0.6) * (LAYER_SPACING * LAYER_COUNT / MODEL_DEFS.length);
    buildModelAt(def, (Math.random()-.5)*14, (Math.random()-.5)*7, zPos);
});

// ══════════════════════════════════════════════════════════════════════════════
//  STATE + DOM REFS
// ══════════════════════════════════════════════════════════════════════════════
// appState: 'explore' | 'zoomIn' | 'detail' | 'disperse' | 'zoomOut'
let appState     = 'explore';
let hoveredModel = null;
let activeModel  = null;

let tgtX = 0, tgtZ = camera.position.z;
const savedCamPos = new THREE.Vector3();
const zoomTarget  = new THREE.Vector3();

// Track dispersal completion
let dispersedCount = 0;

const $hint    = document.getElementById('hint');
const $click   = document.getElementById('click-hint');
const $label   = document.getElementById('obj-label');
const $wHint   = document.getElementById('w-hint');
const $disping = document.getElementById('disperse-status');
const $fadeOverlay = document.getElementById('fade-overlay');

// ══════════════════════════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════════════════════════
const keys = {};
const mouse      = new THREE.Vector2(-999, -999);
const mouseWorld = new THREE.Vector3();
const raycaster  = new THREE.Raycaster();

window.addEventListener('keydown', e => {
    // W in detail view → start dispersion (not movement)
    if (e.code === 'KeyW' && appState === 'detail') {
        startDisperse();
        return;
    }
    keys[e.code] = true;
});
window.addEventListener('keyup',   e => { keys[e.code] = false; });
window.addEventListener('mousemove', e => {
    mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
window.addEventListener('wheel', e => {
    if (appState !== 'explore') return;
    tgtZ += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * 0.02, 1.5);
});
window.addEventListener('click', () => {
    if (appState === 'explore' && hoveredModel) enterDetail(hoveredModel);
});
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ══════════════════════════════════════════════════════════════════════════════
//  STATE TRANSITIONS
// ══════════════════════════════════════════════════════════════════════════════
function enterDetail(mo) {
    appState = 'zoomIn';
    activeModel = mo;
    savedCamPos.copy(camera.position);
    zoomTarget.set(mo.worldPos.x, mo.worldPos.y, mo.worldPos.z + DETAIL_DIST);
    targetFOV = DETAIL_FOV;
    $label.textContent = mo.def.name;
    $label.classList.add('visible');
    $hint.style.opacity = '0';
    $click.classList.remove('visible');
}

function startDisperse() {
    if (!activeModel || appState !== 'detail') return;
    appState = 'disperse';
    $wHint.classList.remove('visible');
    $disping.classList.add('visible');
}

function createPermanentParticleField(hexColor) {
    const n = 500;
    const pos = new Float32Array(n * 3);
    const totalZ = LAYER_COUNT * LAYER_SPACING; // 12 * 18 = 216
    for (let i = 0; i < n; i++) {
        pos[i*3]   = (Math.random() - 0.5) * 80;
        pos[i*3+1] = (Math.random() - 0.5) * 60;
        pos[i*3+2] = 20 - Math.random() * (totalZ + 40);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
        color: new THREE.Color(hexColor),
        size: 0.32,
        transparent: true, opacity: 0.72,
        blending: THREE.AdditiveBlending, depthWrite: false,
        sizeAttenuation: true
    });
    scene.add(new THREE.Points(geo, mat));
}

function finishDisperse() {
    if (activeModel.disperseFired) return;
    activeModel.disperseFired = true;
    activeModel.dispersed = true;

    // Permanent color particle field spread throughout all space
    createPermanentParticleField(activeModel.def.color);

    dispersedCount++;
    if (dispersedCount >= MODEL_DEFS.length) {
        // All 6 dispersed — fade to black after a short pause
        setTimeout(() => { $fadeOverlay.classList.add('active'); }, 3000);
    }

    setTimeout(() => {
        appState = 'zoomOut';
        targetFOV = NORMAL_FOV;
        $label.classList.remove('visible');
        $disping.classList.remove('visible');
    }, 2000);
}

function respawnModel(mo) {
    // Put it far ahead of the camera (most negative Z among all models − extra gap)
    const minZ = modelObjects.reduce((m, o) => Math.min(m, o.worldPos.z), 0);
    const newZ = minZ - LAYER_SPACING * (1.8 + Math.random() * 2.5);
    const newX = (Math.random() - 0.5) * 14;
    const newY = (Math.random() - 0.5) * 7;
    mo.group.position.set(newX, newY, newZ);
    mo.group.rotation.y = Math.random() * Math.PI * 2;
    mo.worldPos.set(newX, newY, newZ);
    // Reset dispersion fully
    mo.gu.uProgress.value        = 0;
    mo.gu.uMaxProgressSeen.value = 0;
    mo.gu.uFade.value            = 1;
    mo.disperseProgress = 0;
    mo.disperseFired    = false;
    mo.dispersed        = false;
    mo.group.visible    = true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  RENDER LOOP
// ══════════════════════════════════════════════════════════════════════════════
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const dt      = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    // ── Advance model time uniforms
    modelObjects.forEach(mo => { mo.gu.uTime.value += dt; });

    // ── WASD (explore only)
    if (appState === 'explore') {
        const spd = MOVE_SPEED * dt;
        if (keys['KeyW'] || keys['ArrowUp'])    tgtZ -= spd;
        if (keys['KeyS'] || keys['ArrowDown'])  tgtZ += spd;
        if (keys['KeyA'] || keys['ArrowLeft'])  tgtX -= spd;
        if (keys['KeyD'] || keys['ArrowRight']) tgtX += spd;
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, tgtX, 0.06);
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, tgtZ, 0.04);
    }

    // ── Zoom in toward model
    if (appState === 'zoomIn') {
        camera.position.lerp(zoomTarget, ZOOM_IN_SPEED * dt);
        if (camera.position.distanceTo(zoomTarget) < 0.3) {
            camera.position.copy(zoomTarget);
            appState = 'detail';
            $wHint.classList.add('visible');
        }
    }

    // ── Return to explore
    if (appState === 'zoomOut') {
        camera.position.lerp(savedCamPos, ZOOM_OUT_SPEED * dt);
        if (camera.position.distanceTo(savedCamPos) < 0.5) {
            camera.position.copy(savedCamPos);
            tgtX = savedCamPos.x;
            tgtZ = savedCamPos.z;
            appState  = 'explore';
            activeModel = null;
            $hint.style.opacity = '1';
        }
    }

    // ── FOV animation
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.055);
    camera.updateProjectionMatrix();

    // ── Detail / disperse slow rotation
    if ((appState === 'detail' || appState === 'disperse') && activeModel) {
        activeModel.group.rotation.y += dt * 0.42;
    }

    // ── Dispersion progress (linear, slow)
    if (appState === 'disperse' && activeModel && !activeModel.dispersed) {
        activeModel.disperseProgress = Math.min(activeModel.disperseProgress + DISPERSE_RATE * dt, 1.0);
        activeModel.gu.uProgress.value = activeModel.disperseProgress;
        if (activeModel.disperseProgress > activeModel.gu.uMaxProgressSeen.value)
            activeModel.gu.uMaxProgressSeen.value = activeModel.disperseProgress;
        if (activeModel.disperseProgress >= 1.0) finishDisperse();
    }

    // ── Fade out fully dispersed models
    modelObjects.forEach(mo => {
        if (mo.dispersed && mo.gu.uFade.value > 0) {
            mo.gu.uFade.value = Math.max(0, mo.gu.uFade.value - dt * 0.6);
            if (mo.gu.uFade.value <= 0) mo.group.visible = false;
        }
    });

    // ── Hover detection (explore mode only)
    let hoverWorldPos = null;
    if (appState === 'explore') {
        raycaster.setFromCamera(mouse, camera);
        raycaster.ray.at(10, mouseWorld);

        const targets = [];
        modelObjects.forEach(mo => { if (!mo.dispersed) targets.push(...mo.meshes); });
        const hits = raycaster.intersectObjects(targets, false);

        hoveredModel = null;
        if (hits.length > 0) {
            const hitMesh = hits[0].object;
            for (const mo of modelObjects) {
                if (mo.meshes.includes(hitMesh)) { hoveredModel = mo; break; }
            }
        }
        hoverWorldPos = hoveredModel ? hoveredModel.worldPos : null;
        $click.classList.toggle('visible', !!hoveredModel);

        // Hover spin
        modelObjects.forEach(mo => {
            if (mo === hoveredModel) mo.group.rotation.y += dt * 1.8;
        });
    } else {
        hoveredModel = null;
        $click.classList.remove('visible');
    }

    // Web dissolve around active model (detail/disperse) or hovered model
    const dissolvePos = (activeModel && appState !== 'explore') ? activeModel.worldPos : hoverWorldPos;

    // ── Web layer update + recycle + color injection
    webLayers.forEach(layer => {
        layer.update(elapsed, mouseWorld, dissolvePos);
        const cycle = LAYER_COUNT * LAYER_SPACING;

        if (camera.position.z < layer.position.z - 10) {
            layer.position.z -= cycle;
            layer.rotation.z += 1.0;
        } else if (camera.position.z > layer.position.z + cycle - 10) {
            layer.position.z += cycle;
            layer.rotation.z -= 1.0;
        }
    });

    // ── Model respawn (too far behind camera)
    modelObjects.forEach(mo => {
        if (mo === activeModel) return;
        if (mo.worldPos.z > camera.position.z + RESPAWN_BEHIND) respawnModel(mo);
    });

    renderer.render(scene, camera);
}

animate();
