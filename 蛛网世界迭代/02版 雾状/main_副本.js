import * as THREE from 'three';
import { WebLayer } from './WebLayer.js';

// --- 初始化场景、相机与渲染器 ---
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement); // 关键修复：把渲染器自带的画布添加到网页中

const scene = new THREE.Scene();
// 调整雾效浓度，完美融合黑色背景，越远的蛛网越暗淡，形成多层景深
scene.fog = new THREE.FogExp2(0x020203, 0.025); 

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 150);
camera.position.set(0, 0, 20);

// --- 构建无限层级蛛网结构 ---
const layersCount = 12; // 层数越多，深度感越强
const layerSpacing = 18; // 每层的 Z 轴间距
const webLayers = [];

for (let i = 0; i < layersCount; i++) {
    // 依次向屏幕深处排列
    const layer = new WebLayer(-i * layerSpacing);
    scene.add(layer);
    webLayers.push(layer);
}

// --- 交互与导航控制 ---
let targetCameraZ = camera.position.z;
const mouse = new THREE.Vector2(-999, -999);
const mouseWorldPos = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

// 使用鼠标滚轮前后穿梭
window.addEventListener('wheel', (event) => {
    // 限制单次滚动的速度
    const scrollDelta = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * 0.02, 1.5);
    targetCameraZ += scrollDelta;
});

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

    // 1. 平滑推进相机
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCameraZ, 0.04);

    // 2. 计算鼠标在 3D 空间中的坐标 (投射到相机前方 10 单位处)
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.at(10, mouseWorldPos); 

    // 3. 更新所有层，并处理无限循环滚动逻辑
    webLayers.forEach(layer => {
        layer.update(elapsedTime, mouseWorldPos);

        const cycleDistance = layersCount * layerSpacing;
        
        // 当相机向前穿过这一层后，将这一层搬运到最深处继续充当背景
        if (camera.position.z < layer.position.z - 10) {
            layer.position.z -= cycleDistance;
            // 每次循环稍微改变一下角度，避免重复感
            layer.rotation.z += 1.0; 
        }
        // 当相机向后退离这一层过远时，将最深处的层搬运回镜头前方
        else if (camera.position.z > layer.position.z + cycleDistance - 10) {
            layer.position.z += cycleDistance;
            layer.rotation.z -= 1.0;
        }
    });

    renderer.render(scene, camera);
}

animate();