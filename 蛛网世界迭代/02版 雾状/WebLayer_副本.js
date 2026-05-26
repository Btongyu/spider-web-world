import * as THREE from 'three';

// 丝线点云 shader — 柔软高斯衰减，产生雾感
const threadVertexShader = `
    uniform float uTime;
    attribute vec3 aRandom;
    attribute float aSize;

    void main() {
        vec3 pos = position;
        // 轻微呼吸抖动
        pos.x += sin(uTime * 0.38 + aRandom.x * 6.28) * 0.07;
        pos.y += cos(uTime * 0.31 + aRandom.y * 6.28) * 0.07;
        pos.z += sin(uTime * 0.22 + aRandom.z * 4.0)  * 0.04;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position    = projectionMatrix * mvPosition;
        gl_PointSize   = aSize * (17.0 / -mvPosition.z);
    }
`;

const threadFragmentShader = `
    void main() {
        vec2  uv   = gl_PointCoord - vec2(0.5);
        float d    = length(uv);
        if (d > 0.5) discard;

        // 高斯软衰减 — 核心雾感来源
        float alpha = exp(-d * d * 9.0) * 0.28;
        // 中心偏暖白，边缘偏冷蓝，营造层次感
        vec3 color = mix(vec3(0.85, 0.88, 1.0), vec3(0.45, 0.55, 0.75), d * 1.8);
        gl_FragColor = vec4(color, alpha);
    }
`;

// 鼠标交互粒子 shader
const interactVertexShader = `
    uniform float uTime;
    uniform vec3  uMouse;

    attribute vec3  aRandom;
    attribute float aSize;

    varying float vHoverMix;

    void main() {
        vec3 pos = position;

        vec4  worldPos   = modelMatrix * vec4(pos, 1.0);
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
        // 非 hover 时粒子很小，hover 时放大 3× 变可见
        gl_PointSize = (aSize * (1.0 + influence * 3.0)) * (18.0 / -mvPosition.z);
    }
`;

const interactFragmentShader = `
    varying float vHoverMix;

    void main() {
        vec2  center = gl_PointCoord - vec2(0.5);
        float dist   = length(center);
        if (dist > 0.5) discard;

        vec3 baseColor  = vec3(0.55, 0.6, 0.7);
        vec3 hoverColor = vec3(1.0, 0.95, 1.0);
        vec3 finalColor = mix(baseColor, hoverColor, vHoverMix);

        float alpha = (0.5 - dist) * 2.0;
        gl_FragColor = vec4(finalColor, alpha * (0.5 + vHoverMix * 0.5));
    }
`;

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

        // 连线 + 沿线采样点云
        const backbonePos   = [];   // 极少量骨架线
        const threadPos     = [];   // 沿线点云（雾感主体）
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

                        // 约 12% 保留为极淡骨架线
                        if (Math.random() < 0.12) {
                            backbonePos.push(ax, ay, az, bx, by, bz);
                        }

                        // 沿线段采样点云粒子
                        const numSamples = Math.max(3, Math.floor(dist * 2.2));
                        for (let t = 0; t <= numSamples; t++) {
                            const ratio   = t / numSamples;
                            const scatter = Math.random() * 0.22;
                            const sAngle  = Math.random() * Math.PI * 2;
                            threadPos.push(
                                ax + (bx - ax) * ratio + Math.cos(sAngle) * scatter,
                                ay + (by - ay) * ratio + Math.sin(sAngle) * scatter,
                                az + (bz - az) * ratio + (Math.random() - 0.5) * 0.18
                            );
                            threadRandom.push(
                                Math.random() * 2 - 1,
                                Math.random() * 2 - 1,
                                Math.random() * 2 - 1
                            );
                            // 大小混合：少量较亮的点，多数极小
                            threadSize.push(Math.random() < 0.12
                                ? Math.random() * 0.7 + 0.4   // 较亮点
                                : Math.random() * 0.35 + 0.08  // 极细点
                            );
                        }

                        connections++;
                        isConnected = true;
                    }
                }
            }
            if (isConnected) interactVerts.push(vertices[i]);
        }

        // --- 1. 极淡骨架线（仅作结构参考） ---
        if (backbonePos.length > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(backbonePos, 3));
            this.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
                color: 0x6677aa,
                transparent: true,
                opacity: 0.06,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })));
        }

        // --- 2. 丝线点云（雾感主体，微微抖动） ---
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

        // --- 3. 节点交互粒子（鼠标飞散） ---
        if (interactVerts.length > 0) {
            const particleGeo = new THREE.BufferGeometry().setFromPoints(interactVerts);
            const randoms = new Float32Array(interactVerts.length * 3);
            const sizes   = new Float32Array(interactVerts.length);

            for (let i = 0; i < interactVerts.length; i++) {
                randoms[i * 3]     = Math.random() * 2 - 1;
                randoms[i * 3 + 1] = Math.random() * 2 - 1;
                randoms[i * 3 + 2] = Math.random() * 2 - 1;
                sizes[i] = Math.random() * 1.5 + 0.5; // hover 时才明显
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
