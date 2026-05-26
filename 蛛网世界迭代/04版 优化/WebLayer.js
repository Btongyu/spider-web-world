import * as THREE from 'three';

// ── 丝线点云 shader（含边缘亮度属性 aBrightness） ───────────────────────────
const threadVertexShader = `
    uniform float uTime;
    attribute vec3  aRandom;
    attribute float aSize;
    attribute float aBrightness;

    varying float vBrightness;

    void main() {
        vec3 pos = position;
        pos.x += sin(uTime * 0.38 + aRandom.x * 6.28) * 0.08;
        pos.y += cos(uTime * 0.31 + aRandom.y * 6.28) * 0.08;
        pos.z += sin(uTime * 0.22 + aRandom.z * 4.00) * 0.05;

        vBrightness = aBrightness;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position  = projectionMatrix * mvPosition;
        gl_PointSize = aSize * (18.0 / -mvPosition.z);
    }
`;

const threadFragmentShader = `
    varying float vBrightness;

    void main() {
        vec2  uv = gl_PointCoord - vec2(0.5);
        float d  = length(uv);
        if (d > 0.5) discard;

        // 高斯衰减 × 每粒子亮度系数（边缘粒子最高 2.5×）
        float alpha = exp(-d * d * 8.0) * 0.24 * vBrightness;
        // 中心暖白 → 边缘冷蓝，营造景深层次
        vec3  color = mix(vec3(0.88, 0.90, 1.00), vec3(0.42, 0.52, 0.78), d * 1.8);
        gl_FragColor = vec4(color, alpha);
    }
`;

// ── 鼠标交互粒子 shader ──────────────────────────────────────────────────────
const interactVertexShader = `
    uniform float uTime;
    uniform vec3  uMouse;

    attribute vec3  aRandom;
    attribute float aSize;

    varying float vHoverMix;

    void main() {
        vec3 pos = position;

        vec4  worldPos    = modelMatrix * vec4(pos, 1.0);
        float distToMouse = distance(worldPos.xyz, uMouse);

        float hoverRadius = 5.0;
        float influence   = 1.0 - smoothstep(0.0, hoverRadius, distToMouse);
        vHoverMix = influence;

        if (influence > 0.0) {
            vec3 dir = normalize(worldPos.xyz - uMouse + aRandom * 0.5);
            pos += dir * influence * (1.2 + sin(uTime * 5.0 + aRandom.x * 10.0) * 0.4);
        } else {
            pos.x += sin(uTime * 0.3 + aRandom.x * 5.0) * 0.08;
            pos.y += cos(uTime * 0.4 + aRandom.y * 5.0) * 0.08;
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position  = projectionMatrix * mvPosition;
        gl_PointSize = (aSize * (1.0 + influence * 3.0)) * (18.0 / -mvPosition.z);
    }
`;

const interactFragmentShader = `
    varying float vHoverMix;

    void main() {
        vec2  center = gl_PointCoord - vec2(0.5);
        float dist   = length(center);
        if (dist > 0.5) discard;

        vec3 baseColor  = vec3(0.55, 0.60, 0.70);
        vec3 hoverColor = vec3(1.00, 0.95, 1.00);
        vec3 finalColor = mix(baseColor, hoverColor, vHoverMix);

        float alpha = (0.5 - dist) * 2.0;
        gl_FragColor = vec4(finalColor, alpha * (0.5 + vHoverMix * 0.5));
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// 计算一个点的"边缘系数"（0=画面中心，1=画面外围）
// 参考半径 ~16 单位（约等于 FOV70°、z=20 时的可视半径）
function edgeFactor(x, y) {
    return Math.min(Math.sqrt(x * x + y * y) / 16.0, 1.0);
}

export class WebLayer extends THREE.Group {
    constructor(zOffset) {
        super();
        this.position.z = zOffset;
        this.rotation.z = Math.random() * Math.PI * 2;
        this.generateOrganicWeb();
    }

    generateOrganicWeb() {
        const vertices = [];

        // 每层随机 2-4 个密集中心
        const numCenters = Math.floor(Math.random() * 3) + 2;
        const centers = [];
        for (let c = 0; c < numCenters; c++) {
            centers.push(new THREE.Vector3(
                (Math.random() - 0.5) * 24,
                (Math.random() - 0.5) * 18,
                0
            ));
        }

        const numTentaclesPerCenter = Math.floor(Math.random() * 8) + 14;
        const nodesPerTentacle = 28;
        const tentacleNodes = [];

        for (const center of centers) {
            for (let i = 0; i < numTentaclesPerCenter; i++) {
                let angle = (i / numTentaclesPerCenter) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
                let currentPos = center.clone();

                for (let j = 0; j < nodesPerTentacle; j++) {
                    const stepRadius = 0.65 + j * 0.07;
                    angle += (Math.random() - 0.5) * 0.6;
                    currentPos.x += Math.cos(angle) * stepRadius;
                    currentPos.y += Math.sin(angle) * stepRadius;
                    currentPos.z += (Math.random() - 0.5) * 0.8;
                    const node = currentPos.clone();
                    tentacleNodes.push(node);
                    vertices.push(node);
                }
            }
        }

        const numScatter = 1200;
        for (let i = 0; i < numScatter; i++) {
            const baseNode = tentacleNodes[Math.floor(Math.random() * tentacleNodes.length)];
            const spread = 1.8 + baseNode.length() * 0.1;
            vertices.push(baseNode.clone().add(new THREE.Vector3(
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * 1.5
            )));
        }

        // ── 连接算法：硬线 + 边缘感知点云 ──────────────────────────────────
        const dimLinePos    = [];
        const brightLinePos = [];
        const threadPos        = [];
        const threadRandomArr  = [];
        const threadSizeArr    = [];
        const threadBrightArr  = [];   // ← 新增：每粒子亮度
        const interactVerts = [];

        for (let i = 0; i < vertices.length; i++) {
            let connections = 0;
            let isConnected = false;

            for (let j = i + 1; j < vertices.length; j++) {
                const dist = vertices[i].distanceTo(vertices[j]);
                const threshold = 2.5 + vertices[i].length() * 0.04;

                if (dist < threshold && connections < 6) {
                    if (Math.random() > 0.15) {
                        const ax = vertices[i].x, ay = vertices[i].y, az = vertices[i].z;
                        const bx = vertices[j].x, by = vertices[j].y, bz = vertices[j].z;

                        // 硬线（暗 72% / 亮 28%）
                        if (Math.random() < 0.28) {
                            brightLinePos.push(ax, ay, az, bx, by, bz);
                        } else {
                            dimLinePos.push(ax, ay, az, bx, by, bz);
                        }

                        // 点云：覆盖率提升至 85%
                        if (Math.random() < 0.85) {
                            const numSamples = Math.max(3, Math.floor(dist * 2.2));

                            // 线段中点用于计算边缘系数
                            const midX = (ax + bx) * 0.5;
                            const midY = (ay + by) * 0.5;
                            const ef   = edgeFactor(midX, midY);
                            // 离中心越远亮度越高（1.0 → 2.5）
                            const brightness = 1.0 + ef * 1.5;

                            for (let t = 0; t <= numSamples; t++) {
                                const ratio   = t / numSamples;
                                const scatter = Math.random() * 0.22;
                                const sAngle  = Math.random() * Math.PI * 2;
                                threadPos.push(
                                    ax + (bx - ax) * ratio + Math.cos(sAngle) * scatter,
                                    ay + (by - ay) * ratio + Math.sin(sAngle) * scatter,
                                    az + (bz - az) * ratio + (Math.random() - 0.5) * 0.18
                                );
                                threadRandomArr.push(
                                    Math.random() * 2 - 1,
                                    Math.random() * 2 - 1,
                                    Math.random() * 2 - 1
                                );
                                // 16% 较亮锚点 + 84% 极细毛茸点
                                threadSizeArr.push(Math.random() < 0.16
                                    ? Math.random() * 0.72 + 0.38
                                    : Math.random() * 0.30 + 0.07
                                );
                                threadBrightArr.push(brightness);
                            }
                        }

                        connections++;
                        isConnected = true;
                    }
                }
            }
            if (isConnected) interactVerts.push(vertices[i]);
        }

        // ── 额外边缘环境云（弥补触须天然无法覆盖的画面外围） ────────────────
        // 分布在半径 13-24 单位的环形区域，产生均匀的边缘雾感
        const numEdge = 1200;
        for (let i = 0; i < numEdge; i++) {
            const angle  = Math.random() * Math.PI * 2;
            const radius = 13 + Math.random() * 11;          // 13~24 单位
            const ex = Math.cos(angle) * radius;
            const ey = Math.sin(angle) * radius * 0.72;      // 略压扁以适配宽屏比例
            const ef = edgeFactor(ex, ey);

            threadPos.push(
                ex + (Math.random() - 0.5) * 2.0,
                ey + (Math.random() - 0.5) * 2.0,
                (Math.random() - 0.5) * 3.0
            );
            threadRandomArr.push(
                Math.random() * 2 - 1,
                Math.random() * 2 - 1,
                Math.random() * 2 - 1
            );
            // 边缘云粒子稍大，保证可见
            threadSizeArr.push(Math.random() * 0.55 + 0.18);
            threadBrightArr.push(0.9 + ef * 1.4);            // 外围更亮
        }

        // ── 构建几何体 ────────────────────────────────────────────────────────

        // 暗丝
        if (dimLinePos.length > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(dimLinePos, 3));
            this.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
                color: 0x556677,
                transparent: true,
                opacity: 0.12,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })));
        }

        // 亮丝
        if (brightLinePos.length > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(brightLinePos, 3));
            this.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
                color: 0x99aedd,
                transparent: true,
                opacity: 0.36,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })));
        }

        // 点云（含边缘环境云，统一使用带 aBrightness 的 shader）
        if (threadPos.length > 0) {
            const threadGeo = new THREE.BufferGeometry();
            threadGeo.setAttribute('position',    new THREE.Float32BufferAttribute(threadPos, 3));
            threadGeo.setAttribute('aRandom',     new THREE.BufferAttribute(new Float32Array(threadRandomArr), 3));
            threadGeo.setAttribute('aSize',       new THREE.BufferAttribute(new Float32Array(threadSizeArr), 1));
            threadGeo.setAttribute('aBrightness', new THREE.BufferAttribute(new Float32Array(threadBrightArr), 1));

            this.threadMaterial = new THREE.ShaderMaterial({
                vertexShader:   threadVertexShader,
                fragmentShader: threadFragmentShader,
                uniforms: { uTime: { value: 0 } },
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            this.add(new THREE.Points(threadGeo, this.threadMaterial));
        }

        // 节点交互粒子
        if (interactVerts.length > 0) {
            const particleGeo = new THREE.BufferGeometry().setFromPoints(interactVerts);
            const randoms = new Float32Array(interactVerts.length * 3);
            const sizes   = new Float32Array(interactVerts.length);

            for (let i = 0; i < interactVerts.length; i++) {
                randoms[i * 3]     = Math.random() * 2 - 1;
                randoms[i * 3 + 1] = Math.random() * 2 - 1;
                randoms[i * 3 + 2] = Math.random() * 2 - 1;
                sizes[i] = Math.random() * 1.5 + 0.5;
            }

            particleGeo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 3));
            particleGeo.setAttribute('aSize',   new THREE.BufferAttribute(sizes, 1));

            this.particleMaterial = new THREE.ShaderMaterial({
                vertexShader:   interactVertexShader,
                fragmentShader: interactFragmentShader,
                uniforms: {
                    uTime:  { value: 0 },
                    uMouse: { value: new THREE.Vector3(999, 999, 999) }
                },
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            this.add(new THREE.Points(particleGeo, this.particleMaterial));
        }
    }

    update(time, mouseWorldPos) {
        if (this.threadMaterial) {
            this.threadMaterial.uniforms.uTime.value = time;
        }
        if (this.particleMaterial) {
            this.particleMaterial.uniforms.uTime.value = time;
            if (Math.abs(mouseWorldPos.z - this.position.z) < 12) {
                this.particleMaterial.uniforms.uMouse.value.copy(mouseWorldPos);
            } else {
                this.particleMaterial.uniforms.uMouse.value.set(999, 999, 999);
            }
        }
    }
}
