import * as THREE from 'three';
import { WebLayer } from './WebLayer.js';

// --- 基础场景初始化 ---
const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020203, 0.04); // 洞穴深度感雾效

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 15);

// --- 蛛网层级管理 (对象池模式优化性能) ---
const layersCount = 8;
const layerSpacing = 10;
const webLayers = [];

for (let i = 0; i < layersCount; i++) {
    const layer = new WebLayer(-i * layerSpacing);
    scene.add(layer);
    webLayers.push(layer);
}

// --- 交互与导航控制 ---
let targetCameraZ = camera.position.z;
const mouse = new THREE.Vector2(-999, -999);
const mouseWorldPos = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

// 鼠标移动监听：记录屏幕坐标
window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

// 鼠标滚轮监听：前后穿梭，禁用侧向移动
window.addEventListener('wheel', (event) => {
    // 放大 deltaY 的影响范围，限制单次滚动的最大值
    const scrollDelta = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * 0.05, 2.0);
    targetCameraZ += scrollDelta;
});

// 窗口尺寸自适应
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 渲染循环 ---
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();

    // 1. 平滑相机移动 (Lerp)
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCameraZ, 0.05);

    // 2. 将鼠标屏幕坐标投影到相机前方的特定深度平面上，用于传递给着色器
    raycaster.setFromCamera(mouse, camera);
    // 假设交互深度在相机正前方 8 个单位处
    raycaster.ray.at(8, mouseWorldPos); 

    // 3. 更新每一层的动画并实现无限延伸逻辑
    webLayers.forEach(layer => {
        layer.update(elapsedTime, mouseWorldPos);

        // 如果相机穿过该层，将其移动到最深处 (对象回收重用)
        if (camera.position.z < layer.position.z - 5) {
            layer.position.z -= (layersCount * layerSpacing);
        }
        // 反向滚动逻辑
        else if (camera.position.z > layer.position.z + (layersCount * layerSpacing) - 5) {
            layer.position.z += (layersCount * layerSpacing);
        }
    });

    renderer.render(scene, camera);
}

animate();