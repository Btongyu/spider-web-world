import * as THREE from 'three';

const vertexShader = `
    uniform float uTime;
    uniform vec3 uMouse;

    attribute vec3 aRandom;
    attribute float aSize;

    varying float vDistance;
    varying float vHoverMix;

    void main() {
        vec3 pos = position;

        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        float distToMouse = distance(worldPosition.xyz, uMouse);
        vDistance = distToMouse;

        float hoverRadius = 5.0;
        float influence = 1.0 - smoothstep(0.0, hoverRadius, distToMouse);
        vHoverMix = influence;

        if (influence > 0.0) {
            vec3 direction = normalize(worldPosition.xyz - uMouse + aRandom * 0.5);
            pos += direction * influence * (0.8 + sin(uTime * 5.0 + aRandom.x * 10.0) * 0.4);
        } else {
            pos.x += sin(uTime * 0.3 + aRandom.x * 5.0) * 0.1;
            pos.y += cos(uTime * 0.4 + aRandom.y * 5.0) * 0.1;
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // 粒子基础尺寸缩小，hover 增幅也减小
        gl_PointSize = (aSize * (1.0 + influence * 1.8)) * (11.0 / -mvPosition.z);
    }
`;

const fragmentShader = `
    varying float vDistance;
    varying float vHoverMix;

    void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;

        vec3 baseColor = vec3(0.5, 0.55, 0.6);
        vec3 hoverColor = vec3(1.0, 0.95, 1.0);

        vec3 finalColor = mix(baseColor, hoverColor, vHoverMix);
        float alpha = (0.5 - dist) * 2.0;

        gl_FragColor = vec4(finalColor, alpha * (0.4 + vHoverMix * 0.6));
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

        // 每层随机 2-4 个密集中心，铺满画面
        const numCenters = Math.floor(Math.random() * 3) + 2;
        const centers = [];
        for (let c = 0; c < numCenters; c++) {
            centers.push(new THREE.Vector3(
                (Math.random() - 0.5) * 24,
                (Math.random() - 0.5) * 18,
                0
            ));
        }

        // 每个中心生成触须，数量随机更多
        const numTentaclesPerCenter = Math.floor(Math.random() * 8) + 14; // 14-22 per center
        const nodesPerTentacle = 28;
        const tentacleNodes = [];

        for (const center of centers) {
            for (let i = 0; i < numTentaclesPerCenter; i++) {
                let angle = (i / numTentaclesPerCenter) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
                let currentPos = center.clone();

                for (let j = 0; j < nodesPerTentacle; j++) {
                    const stepRadius = 0.65 + (j * 0.07);
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

        // 散布网丝节点
        const numScatter = 1200;
        for (let i = 0; i < numScatter; i++) {
            const baseNode = tentacleNodes[Math.floor(Math.random() * tentacleNodes.length)];
            const spread = 1.8 + (baseNode.length() * 0.1);
            const offset = new THREE.Vector3(
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * 1.5
            );
            vertices.push(baseNode.clone().add(offset));
        }

        // 距离算法连线，分为暗丝和亮丝两组
        const dimLinePositions = [];
        const brightLinePositions = [];
        const validParticleVertices = [];

        for (let i = 0; i < vertices.length; i++) {
            let connections = 0;
            let isConnected = false;

            for (let j = i + 1; j < vertices.length; j++) {
                const dist = vertices[i].distanceTo(vertices[j]);
                const centerDist = vertices[i].length();
                const threshold = 2.5 + (centerDist * 0.04);

                if (dist < threshold && connections < 6) {
                    if (Math.random() > 0.15) {
                        // 约 28% 的丝线更亮
                        if (Math.random() < 0.28) {
                            brightLinePositions.push(
                                vertices[i].x, vertices[i].y, vertices[i].z,
                                vertices[j].x, vertices[j].y, vertices[j].z
                            );
                        } else {
                            dimLinePositions.push(
                                vertices[i].x, vertices[i].y, vertices[i].z,
                                vertices[j].x, vertices[j].y, vertices[j].z
                            );
                        }
                        connections++;
                        isConnected = true;
                    }
                }
            }
            if (isConnected) {
                validParticleVertices.push(vertices[i]);
            }
        }

        // 暗丝（基础网格）
        const dimLineGeo = new THREE.BufferGeometry();
        dimLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(dimLinePositions, 3));
        const dimLineMat = new THREE.LineBasicMaterial({
            color: 0x556677,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.add(new THREE.LineSegments(dimLineGeo, dimLineMat));

        // 亮丝（高光网格）
        const brightLineGeo = new THREE.BufferGeometry();
        brightLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(brightLinePositions, 3));
        const brightLineMat = new THREE.LineBasicMaterial({
            color: 0x99aedd,
            transparent: true,
            opacity: 0.42,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.add(new THREE.LineSegments(brightLineGeo, brightLineMat));

        // 粒子系统（更小的粒子）
        const particleGeo = new THREE.BufferGeometry().setFromPoints(validParticleVertices);
        const randoms = new Float32Array(validParticleVertices.length * 3);
        const sizes = new Float32Array(validParticleVertices.length);

        for (let i = 0; i < validParticleVertices.length; i++) {
            randoms[i * 3]     = Math.random() * 2 - 1;
            randoms[i * 3 + 1] = Math.random() * 2 - 1;
            randoms[i * 3 + 2] = Math.random() * 2 - 1;
            // 粒子更小（原来是 2.0 + 0.5）
            sizes[i] = Math.random() * 0.9 + 0.15;
        }

        particleGeo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 3));
        particleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        this.particleMaterial = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uMouse: { value: new THREE.Vector3(999, 999, 999) }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const particles = new THREE.Points(particleGeo, this.particleMaterial);
        this.add(particles);
    }

    update(time, mouseWorldPos) {
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
