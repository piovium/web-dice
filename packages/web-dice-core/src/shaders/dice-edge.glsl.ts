export const diceEdgeVertexShader = /* glsl */ `
  attribute vec3 aBarycentric;
  attribute vec3 aIsPole;
  varying vec3 vBarycentric;
  varying vec3 vIsPole;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vBarycentric = aBarycentric;
    vIsPole = aIsPole;
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const diceEdgeFragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uGoldColor;
  uniform float uEdgeWidth;
  uniform float uEdgeIntensity;
  uniform vec3 uEmissiveColor;
  uniform float uEmissiveIntensity;
  uniform sampler2D uMap;
  uniform sampler2D uEmissiveMap;
  uniform float uVertexWidth;
  uniform float uBrightness;

  varying vec3 vBarycentric;
  varying vec3 vIsPole;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    // 边：到任意一条边的距离（重心坐标最小值）小于阈值即金色，step 保证硬边无渐变
    // 边一直延伸到顶点，两极自然由两条金边交汇，不裁切
    float edgeFactor = min(min(vBarycentric.x, vBarycentric.y), vBarycentric.z);
    float edge = step(edgeFactor, uEdgeWidth);

    // 实心金字塔型顶点帽：只在非极点（赤道顶点）画实心三角帽，极点无帽。
    // vIsPole 为插值值（极点面内 = 顶点重心坐标），帽区域内 ≥ 0.7，
    // 用硬阈值整体关断；原 (1 - vIsPole) 渐变式抑制会在极点周围留下淡金残影
    float cap0 = step(vIsPole.x, 0.5) * step(1.0 - vBarycentric.x, uVertexWidth);
    float cap1 = step(vIsPole.y, 0.5) * step(1.0 - vBarycentric.y, uVertexWidth);
    float cap2 = step(vIsPole.z, 0.5) * step(1.0 - vBarycentric.z, uVertexWidth);
    float vertex = max(max(cap0, cap1), cap2);

    float goldFactor = clamp(max(edge, vertex) * uEdgeIntensity, 0.0, 1.0);

    vec4 texColor = texture2D(uMap, vUv);
    vec4 emTexColor = texture2D(uEmissiveMap, vUv);

    vec3 base = uBaseColor * texColor.rgb * uBrightness;

    vec3 lightDir = normalize(vec3(2.0, 13.0, 4.0));
    float diff = dot(vWorldNormal, lightDir) * 0.5 + 0.5;
    diff = diff * 0.6 + 0.4;

    // 金边/金顶点帽用 mix 替换底色，金属硬边、无渐变模糊
    vec3 litBase = mix(base, uGoldColor, goldFactor) * diff;
    vec3 emissive = uEmissiveColor * emTexColor.rgb * uEmissiveIntensity;

    gl_FragColor = vec4(litBase + emissive, 1.0);
  }
`;
