import * as THREE from 'three';

// ── 丝线点云 shader（含边缘亮度 + 模型悬停溶解） ─────────────────────────────
const threadVertexShader = `
    uniform float uTime;
    uniform vec3  uModelHoverPos;
    uniform float uModelHoverActive;
    attribute vec3  aRandom;
    attribute float aSize;
    attribute float aBrightness;
    varying float vBrightness;

    void main() {
        vec3 pos = position;
        // 呼吸抖动
        pos.x += sin(uTime * 0.38 + aRandom.x * 6.28) * 0.08;
        pos.y += cos(uTime * 0.31 + aRandom.y * 6.28) * 0.08;
        pos.z += sin(uTime * 0.22 + aRandom.z * 4.00) * 0.05;

        // 悬停物体时，周边线溶解成点云
        if (uModelHoverActive > 0.5) {
            vec4 worldPos4 = modelMatrix * vec4(pos, 1.0);
            float dModel   = distance(worldPos4.xyz, uModelHoverPos);
            float dissolve = (1.0 - smoothstep(0.0, 7.0, dModel)) * uModelHoverActive;
            if (dissolve > 0.001) {
                vec3 dir = normalize(worldPos4.xyz - uModelHoverPos + aRandom * 0.8);
                pos += dir * dissolve * 4.5 * (0.8 + sin(uTime * 2.5 + aRandom.x * 8.0) * 0.5);
            }
        }

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
        float alpha = exp(-d * d * 8.0) * 0.24 * vBrightness;
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
        const numCenters = Math.floor(Math.random() * 3) + 2;
        const centers = [];
        for (let c = 0; c < numCenters; c++) {
            centers.push(new THREE.Vector3(
                (Math.random() - 0.5) * 24,
                (Math.random() - 0.5) * 18, 0
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
                    tentacleNodes.push(node); vertices.push(node);
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

        const dimLinePos = [], brightLinePos = [];
        const threadPos = [], threadRandomArr = [], threadSizeArr = [], threadBrightArr = [];
        const interactVerts = [];

        for (let i = 0; i < vertices.length; i++) {
            let connections = 0, isConnected = false;
            for (let j = i + 1; j < vertices.length; j++) {
                const dist = vertices[i].distanceTo(vertices[j]);
                const threshold = 2.5 + vertices[i].length() * 0.04;
                if (dist < threshold && connections < 6) {
                    if (Math.random() > 0.15) {
                        const ax = vertices[i].x, ay = vertices[i].y, az = vertices[i].z;
                        const bx = vertices[j].x, by = vertices[j].y, bz = vertices[j].z;
                        if (Math.random() < 0.28) brightLinePos.push(ax, ay, az, bx, by, bz);
                        else dimLinePos.push(ax, ay, az, bx, by, bz);
                        if (Math.random() < 0.85) {
                            const numSamples = Math.max(3, Math.floor(dist * 2.2));
                            const midX = (ax + bx) * 0.5, midY = (ay + by) * 0.5;
                            const ef = edgeFactor(midX, midY);
                            const brightness = 1.0 + ef * 1.5;
                            for (let t = 0; t <= numSamples; t++) {
                                const ratio = t / numSamples;
                                const scatter = Math.random() * 0.22;
                                const sAngle = Math.random() * Math.PI * 2;
                                threadPos.push(
                                    ax + (bx - ax) * ratio + Math.cos(sAngle) * scatter,
                                    ay + (by - ay) * ratio + Math.sin(sAngle) * scatter,
                                    az + (bz - az) * ratio + (Math.random() - 0.5) * 0.18
                                );
                                threadRandomArr.push(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
                                threadSizeArr.push(Math.random() < 0.16 ? Math.random() * 0.72 + 0.38 : Math.random() * 0.30 + 0.07);
                                threadBrightArr.push(brightness);
                            }
                        }
                        connections++; isConnected = true;
                    }
                }
            }
            if (isConnected) interactVerts.push(vertices[i]);
        }

        const numEdge = 1200;
        for (let i = 0; i < numEdge; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 13 + Math.random() * 11;
            const ex = Math.cos(angle) * radius, ey = Math.sin(angle) * radius * 0.72;
            const ef = edgeFactor(ex, ey);
            threadPos.push(ex + (Math.random() - 0.5) * 2, ey + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
            threadRandomArr.push(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
            threadSizeArr.push(Math.random() * 0.55 + 0.18);
            threadBrightArr.push(0.9 + ef * 1.4);
        }

        if (dimLinePos.length > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(dimLinePos, 3));
            this.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x556677, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })));
        }
        if (brightLinePos.length > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(brightLinePos, 3));
            this.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x99aedd, transparent: true, opacity: 0.36, blending: THREE.AdditiveBlending, depthWrite: false })));
        }
        if (threadPos.length > 0) {
            const threadGeo = new THREE.BufferGeometry();
            threadGeo.setAttribute('position',    new THREE.Float32BufferAttribute(threadPos, 3));
            threadGeo.setAttribute('aRandom',     new THREE.BufferAttribute(new Float32Array(threadRandomArr), 3));
            threadGeo.setAttribute('aSize',       new THREE.BufferAttribute(new Float32Array(threadSizeArr), 1));
            threadGeo.setAttribute('aBrightness', new THREE.BufferAttribute(new Float32Array(threadBrightArr), 1));
            this.threadMaterial = new THREE.ShaderMaterial({
                vertexShader: threadVertexShader,
                fragmentShader: threadFragmentShader,
                uniforms: {
                    uTime:             { value: 0 },
                    uModelHoverPos:    { value: new THREE.Vector3(9999, 9999, 9999) },
                    uModelHoverActive: { value: 0.0 }
                },
                transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
            });
            this.add(new THREE.Points(threadGeo, this.threadMaterial));
        }
        if (interactVerts.length > 0) {
            const particleGeo = new THREE.BufferGeometry().setFromPoints(interactVerts);
            const randoms = new Float32Array(interactVerts.length * 3);
            const sizes   = new Float32Array(interactVerts.length);
            for (let i = 0; i < interactVerts.length; i++) {
                randoms[i * 3] = Math.random() * 2 - 1;
                randoms[i * 3 + 1] = Math.random() * 2 - 1;
                randoms[i * 3 + 2] = Math.random() * 2 - 1;
                sizes[i] = Math.random() * 1.5 + 0.5;
            }
            particleGeo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 3));
            particleGeo.setAttribute('aSize',   new THREE.BufferAttribute(sizes, 1));
            this.particleMaterial = new THREE.ShaderMaterial({
                vertexShader: interactVertexShader,
                fragmentShader: interactFragmentShader,
                uniforms: { uTime: { value: 0 }, uMouse: { value: new THREE.Vector3(999, 999, 999) } },
                transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
            });
            this.add(new THREE.Points(particleGeo, this.particleMaterial));
        }
    }

    // modelHoverPos: THREE.Vector3 | null
    update(time, mouseWorldPos, modelHoverPos) {
        if (this.threadMaterial) {
            this.threadMaterial.uniforms.uTime.value = time;
            if (modelHoverPos) {
                this.threadMaterial.uniforms.uModelHoverPos.value.copy(modelHoverPos);
                this.threadMaterial.uniforms.uModelHoverActive.value = 1.0;
            } else {
                this.threadMaterial.uniforms.uModelHoverActive.value = 0.0;
            }
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
