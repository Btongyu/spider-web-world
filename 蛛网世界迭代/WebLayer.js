import * as THREE from 'three';

// 自定义顶点着色器：处理粒子的微小扰动、鼠标排斥和大小衰减
const vertexShader = `
    uniform float uTime;
    uniform vec3 uMouse;
    
    attribute vec3 aRandom;
    attribute float aSize;
    
    varying float vDistance;
    varying float vHoverMix;

    void main() {
        vec3 pos = position;
        
        // 计算当前粒子与鼠标在世界坐标系中的距离
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        float distToMouse = distance(worldPosition.xyz, uMouse);
        vDistance = distToMouse;

        // 交互逻辑：靠近鼠标时，粒子散开
        float hoverRadius = 4.0;
        float influence = 1.0 - smoothstep(0.0, hoverRadius, distToMouse);
        vHoverMix = influence;
        
        if (influence > 0.0) {
            // 根据随机属性和时间，产生向外的轻微排斥和颤动
            vec3 direction = normalize(worldPosition.xyz - uMouse + aRandom * 0.5);
            pos += direction * influence * (0.5 + sin(uTime * 3.0 + aRandom.x * 10.0) * 0.2);
        } else {
            // 默认的微弱环境颤动
            pos.x += sin(uTime * 0.5 + aRandom.x) * 0.05;
            pos.y += cos(uTime * 0.6 + aRandom.y) * 0.05;
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // 距离相机越近，粒子越大；靠近鼠标时粒子变大
        gl_PointSize = (aSize * (1.0 + influence * 2.0)) * (15.0 / -mvPosition.z);
    }
`;

// 自定义片段着色器：渲染冷调银白/微紫色的发光点
const fragmentShader = `
    varying float vDistance;
    varying float vHoverMix;

    void main() {
        // 画圆
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;

        // 颜色插值：基础色为银灰，靠近鼠标时变为亮白色/微紫色
        vec3 baseColor = vec3(0.6, 0.65, 0.7); 
        vec3 hoverColor = vec3(0.9, 0.9, 1.0); // 荧光白带点微光
        
        vec3 finalColor = mix(baseColor, hoverColor, vHoverMix);
        
        // 边缘羽化
        float alpha = (0.5 - dist) * 2.0;
        
        // 靠近鼠标时整体提亮
        alpha += vHoverMix * 0.5;

        gl_FragColor = vec4(finalColor, alpha * 0.8);
    }
`;

export class WebLayer extends THREE.Group {
    constructor(zOffset) {
        super();
        this.position.z = zOffset;
        
        this.generateWeb();
    }

    // 简易噪声函数模拟
    noise(x, y) {
        return Math.sin(x * 0.2) + Math.cos(y * 0.2) + Math.sin(x * 0.5 + y * 0.5) * 0.5;
    }

    generateWeb() {
        const size = 30;
        const segments = 60;
        // 使用平面几何体作为基础
        const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
        const positionAttribute = geometry.attributes.position;
        
        const validVertices = [];
        
        // 扭曲顶点并创造孔洞
        for (let i = 0; i < positionAttribute.count; i++) {
            const x = positionAttribute.getX(i);
            const y = positionAttribute.getY(i);
            
            // 变形
            const zDistortion = this.noise(x + this.position.z, y - this.position.z) * 2.0;
            positionAttribute.setZ(i, zDistortion);
            
            // 阈值剔除，创造有机孔洞
            const density = Math.sin(x * 0.3) * Math.cos(y * 0.3) + Math.sin(x * 0.8 + y * 0.8) * 0.5;
            if (density > -0.2) {
                validVertices.push(new THREE.Vector3(
                    x + (Math.random() - 0.5) * 0.5, 
                    y + (Math.random() - 0.5) * 0.5, 
                    zDistortion
                ));
            }
        }

        // 1. 构建连线 (蛛丝的半透明线)
        const lineGeo = new THREE.BufferGeometry().setFromPoints(validVertices);
        // 使用非常细且暗的材质
        const lineMat = new THREE.LineBasicMaterial({ 
            color: 0x444455, 
            transparent: true, 
            opacity: 0.15,
            blending: THREE.AdditiveBlending
        });
        const lines = new THREE.LineSegments(lineGeo, lineMat);
        this.add(lines);

        // 2. 构建粒子系统 (节点)
        const particleGeo = new THREE.BufferGeometry().setFromPoints(validVertices);
        const randoms = new Float32Array(validVertices.length * 3);
        const sizes = new Float32Array(validVertices.length);

        for (let i = 0; i < validVertices.length; i++) {
            randoms[i * 3] = Math.random() * 2 - 1;
            randoms[i * 3 + 1] = Math.random() * 2 - 1;
            randoms[i * 3 + 2] = Math.random() * 2 - 1;
            sizes[i] = Math.random() * 1.5 + 0.5;
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
            // 只有当鼠标位于当前层的附近时，才应用鼠标坐标，增强空间深度感
            if (Math.abs(mouseWorldPos.z - this.position.z) < 10) {
                 this.particleMaterial.uniforms.uMouse.value.copy(mouseWorldPos);
            } else {
                 this.particleMaterial.uniforms.uMouse.value.set(999,999,999);
            }
        }
    }
}