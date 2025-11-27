/*********************************************************
  - マウスやスクロール操作を削除
  - 時間経過 (frameCount) によりトルネード状に広がる
  - フェードアウトは無し（アルファ固定1.0）
  - x+z座標での3色グラデーション（シェーダ内の uniform uColor1→uColor2→uColor3）
    と PLY元色を乗算し、明るさも1.5倍に
  - タップ（クリック・タッチ）により、グラデーションの色が
    4パターン（例：春、夏、秋、冬）で徐々に切り替わる
*********************************************************/

// ▼ PLYファイル
const url = "https://raw.githubusercontent.com/cansik/p5js-pointcloud/master/data/forest-blk360_centered.ply";

// ▼ 点の大きさ
const pointSize = 2.0;

// ▼ 輝度係数（固定）
const brightnessFactor = 1.5;

// シェーダ関連
let program, renderer;

// 点群データ
let vertices = [];
let colors = [];

// x,z の最小/最大値 (グラデーション計算に使用)
let minX = Infinity, maxX = -Infinity;
let minZ = Infinity, maxZ = -Infinity;

/* ---------------------------
   カラーパレットの設定
   各パレットは { c1, c2, c3 } として定義（各色はRGB正規化値）
   例として、春（ピンク）、夏（青）、秋（オレンジ）、冬（青白い）を設定
--------------------------- */
let palettes = [
  { // パレット0：春（ピンク系）
    c1: [1.0, 0.8, 0.9],
    c2: [1.0, 0.8, 0.9],
    c3: [1.0, 0.8, 0.9]
  },
  { // パレット1：夏（青系）
    c1: [0.4, 0.6, 1.0],
    c2: [0.4, 0.7, 1.0],
    c3: [0.4, 0.7, 1.0]
  },
  { // パレット2：秋（オレンジ系）
    c1: [1.0, 0.9, 0.6],
    c2: [1.0, 0.9, 0.6],
    c3: [1.0, 0.9, 0.6]
  },
  { // パレット3：冬（青白い系）
    c1: [0.8, 0.9, 1.0],
    c2: [0.8, 0.9, 1.0],
    c3: [0.8, 0.9, 1.0]
  }
];
let currentPaletteIndex = 0;
let targetPaletteIndex = 0;
let transitionProgress = 1;  // 0～1の値、1なら完全に切替済み
let startPalette = palettes[0];

// 補間用のユーティリティ
function lerpArray(a, b, t) {
  return a.map((v, i) => lerp(v, b[i], t));
}

function setup() {
  renderer = createCanvas(windowWidth, windowHeight, WEBGL);

  // ▼ 頂点シェーダ
  const vert = `
  attribute vec3 aPosition;
  attribute vec3 aColor;

  uniform mat4 uModelViewMatrix;
  uniform mat4 uProjectionMatrix;

  // x,z の最小/最大 (グラデーション計算用)
  uniform float uMinX;
  uniform float uMaxX;
  uniform float uMinZ;
  uniform float uMaxZ;

  // 時間経過 (frameCount) を受け取る
  uniform float uTime;

  // フラグメントシェーダへ渡す
  varying vec4 vColor;  // PLY元色
  varying float vT;     // 0.0 ~ 1.0 (x+z 正規化)

  void main() {
    // 1) まず元の位置 p を取得
    vec3 p = aPosition;

    // 2) (x+z) による0~1のグラデーションパラメータを算出
    float rangeX = uMaxX - uMinX;
    float rangeZ = uMaxZ - uMinZ;
    float denom = rangeX + rangeZ;
    float dist = (p.x - uMinX) + (p.z - uMinZ);
    float t = dist / denom;
    t = clamp(t, 0.0, 1.0);
    vT = t;

    // 3) トルネード状の回転
    float swirlFactor = 0.02;            // y軸に基づく回転の強さ
    float swirlAngle  = p.y * swirlFactor + uTime * 0.005;

    float radius     = length(vec2(p.x, p.z));
    float baseAngle  = atan(p.z, p.x);
    float finalAngle = baseAngle + swirlAngle;
    p.x = cos(finalAngle) * radius;
    p.z = sin(finalAngle) * radius;

    // 4) シェーダ最終位置
    gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(p, 1.0);
    gl_PointSize = ${pointSize}.0;

    // 5) PLYファイルの元色をそのまま渡す
    vColor = vec4(aColor, 1.0);
  }
  `;

  // ▼ フラグメントシェーダ（グラデーションの色は uniform で受け取る）
  const frag = `
  #ifdef GL_ES
  precision highp float;
  #endif

  varying vec4  vColor;  // PLY元色
  varying float vT;      // 0.0 ~ 1.0

  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;

  const float brightness = ${brightnessFactor};

  void main(){
    vec3 gradColor;
    if(vT < 0.5){
      float t2 = vT / 0.5;
      gradColor = mix(uColor1, uColor2, t2);
    } else {
      float t2 = (vT - 0.5) / 0.5;
      gradColor = mix(uColor2, uColor3, t2);
    }

    vec3 finalColor = vColor.rgb * gradColor;
    finalColor *= brightness;
    gl_FragColor = vec4(finalColor, 1.0);
  }
  `;

  // ▼ シェーダコンパイル & リンク
  let vs = drawingContext.createShader(drawingContext.VERTEX_SHADER);
  drawingContext.shaderSource(vs, vert);
  drawingContext.compileShader(vs);

  let fs = drawingContext.createShader(drawingContext.FRAGMENT_SHADER);
  drawingContext.shaderSource(fs, frag);
  drawingContext.compileShader(fs);

  program = drawingContext.createProgram();
  drawingContext.attachShader(program, vs);
  drawingContext.attachShader(program, fs);
  drawingContext.linkProgram(program);

  // ▼ エラーチェック
  if (!drawingContext.getShaderParameter(vs, drawingContext.COMPILE_STATUS)) {
    console.error(drawingContext.getShaderInfoLog(vs));
  }
  if (!drawingContext.getShaderParameter(fs, drawingContext.COMPILE_STATUS)) {
    console.error(drawingContext.getShaderInfoLog(fs));
  }
  if (!drawingContext.getProgramParameter(program, drawingContext.LINK_STATUS)) {
    console.error(drawingContext.getProgramInfoLog(program));
  }

  // ▼ シェーダ使用 & uniform/attribute のロケーション取得
  drawingContext.useProgram(program);
  program.uModelViewMatrix = drawingContext.getUniformLocation(program, "uModelViewMatrix");
  program.uProjectionMatrix = drawingContext.getUniformLocation(program, "uProjectionMatrix");

  program.uMinX = drawingContext.getUniformLocation(program, "uMinX");
  program.uMaxX = drawingContext.getUniformLocation(program, "uMaxX");
  program.uMinZ = drawingContext.getUniformLocation(program, "uMinZ");
  program.uMaxZ = drawingContext.getUniformLocation(program, "uMaxZ");

  program.uTime = drawingContext.getUniformLocation(program, "uTime");

  // 新たに追加したグラデーション用の uniform
  program.uColor1 = drawingContext.getUniformLocation(program, "uColor1");
  program.uColor2 = drawingContext.getUniformLocation(program, "uColor2");
  program.uColor3 = drawingContext.getUniformLocation(program, "uColor3");

  program.aPosition = drawingContext.getAttribLocation(program, "aPosition");
  drawingContext.enableVertexAttribArray(program.aPosition);

  program.aColor = drawingContext.getAttribLocation(program, "aColor");
  drawingContext.enableVertexAttribArray(program.aColor);

  // ▼ PLY 読み込み
  httpGet(url, "text", false, (response) => {
    parsePointCloud(response, 2500, 0, 500, 0);
    console.log("data loaded: " + (vertices.length / 3) + " points");

    // 頂点バッファ
    program.positionBuffer = drawingContext.createBuffer();
    drawingContext.bindBuffer(drawingContext.ARRAY_BUFFER, program.positionBuffer);
    drawingContext.bufferData(drawingContext.ARRAY_BUFFER, new Float32Array(vertices), drawingContext.STATIC_DRAW);

    // 色バッファ
    program.colorBuffer = drawingContext.createBuffer();
    drawingContext.bindBuffer(drawingContext.ARRAY_BUFFER, program.colorBuffer);
    drawingContext.bufferData(drawingContext.ARRAY_BUFFER, new Float32Array(colors), drawingContext.STATIC_DRAW);

    // x,z の最小・最大値をシェーダへ送る
    drawingContext.useProgram(program);
    drawingContext.uniform1f(program.uMinX, minX);
    drawingContext.uniform1f(program.uMaxX, maxX);
    drawingContext.uniform1f(program.uMinZ, minZ);
    drawingContext.uniform1f(program.uMaxZ, maxZ);
  });
}

function draw() {
  background(10);

  // シェーダを使用
  drawingContext.useProgram(program);

  // ▼ 頂点バッファを有効化
  drawingContext.bindBuffer(drawingContext.ARRAY_BUFFER, program.positionBuffer);
  drawingContext.vertexAttribPointer(program.aPosition, 3, drawingContext.FLOAT, false, 0, 0);

  // ▼ 色バッファを有効化
  drawingContext.bindBuffer(drawingContext.ARRAY_BUFFER, program.colorBuffer);
  drawingContext.vertexAttribPointer(program.aColor, 3, drawingContext.FLOAT, false, 0, 0);

  // ▼ 行列と時間をシェーダに渡す
  drawingContext.uniformMatrix4fv(program.uModelViewMatrix, false, renderer.uMVMatrix.mat4);
  drawingContext.uniformMatrix4fv(program.uProjectionMatrix, false, renderer.uPMatrix.mat4);
  drawingContext.uniform1f(program.uTime, frameCount);

  // ▼ パレットの補間（タップ後に徐々に変化）
  if (transitionProgress < 1) {
    transitionProgress += 0.01;
    if (transitionProgress >= 1) {
      transitionProgress = 1;
      currentPaletteIndex = targetPaletteIndex;
    }
  }
  let cp = {
    c1: lerpArray(startPalette.c1, palettes[targetPaletteIndex].c1, transitionProgress),
    c2: lerpArray(startPalette.c2, palettes[targetPaletteIndex].c2, transitionProgress),
    c3: lerpArray(startPalette.c3, palettes[targetPaletteIndex].c3, transitionProgress)
  };
  drawingContext.uniform3fv(program.uColor1, cp.c1);
  drawingContext.uniform3fv(program.uColor2, cp.c2);
  drawingContext.uniform3fv(program.uColor3, cp.c3);

  // ▼ 点群がロードされていなければ描画せず終了
  if (vertices.length === 0) return;

  drawingContext.drawArrays(drawingContext.POINTS, 0, vertices.length / 3);
}

// ウィンドウリサイズ時
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// タップ・クリック（またはタッチ）でパレットを切り替え
function mousePressed() {
  if (transitionProgress >= 1) {
    startPalette = palettes[currentPaletteIndex];
    targetPaletteIndex = (currentPaletteIndex + 1) % palettes.length;
    transitionProgress = 0;
  }
  return false;
}
function touchStarted() {
  mousePressed();
  return false;
}

//-----------------------------------
// PLY のパース + x,z の最小・最大値算出
//-----------------------------------
function parsePointCloud(data, scale, xAdd, yAdd, zAdd) {
  let lines = data.split("\n");
  let header = true;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes("end_header")) {
      header = false;
      continue;
    }
    if (!header) {
      let temp = lines[i].split(" ");
      let x = parseFloat(temp[0]);
      let y = -parseFloat(temp[1]);
      let z = parseFloat(temp[2]);

      let r = parseFloat(temp[3]) / 255.0;
      let g = parseFloat(temp[4]) / 255.0;
      let b = parseFloat(temp[5]) / 255.0;

      if (isNaN(x) || isNaN(y) || isNaN(z)) continue;

      // スケール & オフセット
      x = x * scale + xAdd;
      y = y * scale + yAdd;
      z = z * scale + zAdd;

      // 配列に追加
      vertices.push(x, y, z);
      colors.push(r, g, b);

      // x,z の min / max 更新
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
}