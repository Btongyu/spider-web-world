import * as THREE from 'three';

// ── 丝线点云 shader（v02：高斯雾感，微微呼吸） ──────────────────────────────
const threadVertexShader = `
    uniform float uTime;
    attribute vec3  aRandom;
    attribute float aSize;

    void main() {
        vec3 pos = position;
        pos.x += sin(uTime * 0.38 + aRandom.x * 6.28) * 0.07;
        pos.y += cos(uTime * 0.31 + aRandom.y * 6.28) * 0.07;
        pos.z += sin(uTime * 0.22 + aRandom.z * 4.00) * 0.04;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position  = projectionMatrix * mvPosition;
        gl_PointSize = aSize * (17.0 / -mvPosition.z);
    }
`;

const threadFragmentShader = `
    void main() {
        vec2  uv = gl_PointCoord - vec2(0.5);
        float d  = length(uv);
        if (d > 0.5) discard;

        // 高斯衰减 — 整合版 alpha 降至 0.20，避免与硬线叠加过亮
        float alpha = exp(-d * d * 9.0) * 0.20;
        vec3  color = mix(vec3(0.85, 0.88, 1.0), vec3(0.45, 0.55, 0.75), d * 1.8);
        gl_FragColor = vec4(color, alpha);
    }
`;

// ── 鼠标交互粒子 shader（v02：hover 飞散） ─────────────────────────────────
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
export class WebLayer extends THREE.Group {
    constructor(zOffset) {
        super();
        this.position.z = zOffset;
        this.rotation.z = Math.random() * Math.PI * 2;
        this.generateOrganicWeb();
    }

    generateOrganicWeb() {
        const vertices = [];

        // 每层随机 2-4 个密集中心，铺满画面（两版共用）
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

        // ── 连接算法：同时产出 v01 硬线 + v02 点云 ──────────────────────────
        const dimLinePos    = [];   // v01 暗丝
        const brightLinePos = [];   // v01 亮丝
        const threadPos     = [];   // v02 点云位置
        const threadRandom  = [];
        const threadSize    = [];
        const interactVerts = [];   // 节点交互粒子

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

                        // v01：每条连接都生成硬线（暗丝 72% / 亮丝 28%）
                        if (Math.random() < 0.28) {
                            brightLinePos.push(ax, ay, az, bx, by, bz);
                        } else {
                            dimLinePos.push(ax, ay, az, bx, by, bz);
                        }

                        // v02：65% 的连接额外生成点云粒子（控制密度，避免过亮）
                        if (Math.random() < 0.65) {
                            const numSamples = Math.max(2, Math.floor(dist * 1.9));
                            for (let t = 0; t <= numSamples; t++) {
                                const ratio  = t / numSamples;
                                const scatter = Math.random() * 0.20;
                                const sAngle  = Math.random() * Math.PI * 2;
                                threadPos.push(
                                    ax + (bx - ax) * ratio + Math.cos(sAngle) * scatter,
                                    ay + (by - ay) * ratio + Math.sin(sAngle) * scatter,
                                    az + (bz - az) * ratio + (Math.random() - 0.5) * 0.16
                                );
                                threadRandom.push(
                                    Math.random() * 2 - 1,
                                    Math.random() * 2 - 1,
                                    Math.random() * 2 - 1
                                );
                                // 10% 较亮点 + 90% 极细点，产生毛茸茸质感
                                threadSize.push(Math.random() < 0.10
                                    ? Math.random() * 0.65 + 0.35
                                    : Math.random() * 0.28 + 0.06
                                );
                            }
                        }

                        connections++;
                        isConnected = true;
                    }
                }
            }
            if (isConnected) interactVerts.push(vertices[i]);
        }

        // ── v01：暗丝（整合版 opacity 略降至 0.12，避免与点云叠加过亮） ──────
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

        // ── v01：亮丝（整合版 opacity 略降至 0.36） ──────────────────────────
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

        // ── v02：丝线点云（高斯雾感，微微呼吸抖动） ────────────────────────────
        if (threadPos.length > 0) {
            const threadGeo = new THREE.BufferGeometry();
            threadGeo.setAttribute('position', new THREE.Float32BufferAttribute(threadPos, 3));
            threadGeo.setAttribute('aRandom',  new THREE.BufferAttribute(new Float32Array(threadRandom), 3));
            threadGeo.setAttribute('aSize',    new THREE.BufferAttribute(new Float32Array(threadSize), 1));

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

        // ── v02：节点交互粒子（hover 飞散） ─────────────────────────────────
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
