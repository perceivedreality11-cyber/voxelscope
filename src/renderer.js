/** Dependency-free WebGL point renderer, with a Canvas2D fallback. */
export class VolumeRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.yaw = -0.65; this.pitch = 0.36; this.zoom = 1; this.auto = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.vertices = new Float32Array(); this.extent = [1.3, 1.3, 1.65]; this.visible = true;
    try { this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true }); if (this.gl) this.setup(); } catch { this.gl = null; }
    if (!this.gl) this.ctx = canvas.getContext('2d');
    let dragging = false, last;
    canvas.addEventListener('pointerdown', e => { dragging = true; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      this.yaw += (e.clientX - last[0]) * 0.008;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - last[1]) * 0.008));
      last = [e.clientX, e.clientY];
    });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoom = Math.max(0.5, Math.min(2.3, this.zoom * Math.exp(-e.deltaY * 0.001))); }, { passive: false });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.setup(); this.update(this.vertices, this.extent); this.lost = false; });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    this.resize();
    let previous = 0;
    const tick = now => {
      if (this.auto && this.visible && !dragging && this.vertices.length) this.yaw += Math.min(now - previous, 40) * 0.00012;
      previous = now;
      if (this.visible && !document.hidden && !this.lost) this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  setup() {
    const gl = this.gl;
    const shader = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s;
    };
    const vertex = shader(gl.VERTEX_SHADER, `attribute vec4 a; uniform vec4 transform; uniform float aspect; uniform float dotSize; varying float v; varying float depth;
      void main(){float cy=cos(transform.x),sy=sin(transform.x),cp=cos(transform.y),sp=sin(transform.y); vec3 p=vec3(a.x*cy-a.y*sy,a.x*sy+a.y*cy,a.z); vec3 r=vec3(p.x,p.y*sp+p.z*cp,p.y*cp-p.z*sp); float scale=transform.z/(2.7-r.z*.35); gl_Position=vec4(r.x*scale/aspect,r.y*scale,r.z*.15,1.);gl_PointSize=dotSize*(1.+r.z*.12);v=a.w;depth=r.z;}`);
    const fragment = shader(gl.FRAGMENT_SHADER, `precision mediump float; varying float v; varying float depth; uniform float lines;
      void main(){if(lines>.5){gl_FragColor=vec4(.26,.45,.56,.48);return;} vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;vec3 c=mix(vec3(.30,.89,.77),vec3(.64,.53,.97),smoothstep(.10,.70,v));c=mix(c,vec3(1.,.78,.55),smoothstep(.72,1.,v));float light=.52+.48*sqrt(1.-r);gl_FragColor=vec4(c*light*(.86+depth*.08),.95);}`);
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program; gl.useProgram(program);
    this.location = gl.getAttribLocation(program, 'a');
    this.uniforms = Object.fromEntries(['transform', 'aspect', 'dotSize', 'lines'].map(k => [k, gl.getUniformLocation(program, k)]));
    this.buffer = gl.createBuffer(); this.boxBuffer = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio)); this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }
  update(vertices, extent) {
    this.vertices = vertices; this.extent = extent;
    if (!this.gl) return;
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const points = [];
    const corners = Array.from({ length: 8 }, (_, i) => extent.map((v, a) => (i & (1 << a) ? 1 : -1) * v / 2));
    for (let i = 0; i < 8; i++) for (let a = 0; a < 3; a++) { const j = i ^ (1 << a); if (j > i) points.push(...corners[i], 0, ...corners[j], 0); }
    this.boxCount = points.length / 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.boxBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
  }
  reset() { this.yaw = -0.65; this.pitch = 0.36; this.zoom = 1; }
  clear() { this.update(new Float32Array(), this.extent); }
  draw() {
    const { canvas, gl } = this;
    if (!canvas.width || !canvas.height) return;
    if (!gl) { this.drawFallback(); return; }
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program); gl.uniform4f(this.uniforms.transform, this.yaw, this.pitch, this.zoom * 2.5, 0);
    gl.uniform1f(this.uniforms.aspect, canvas.width / canvas.height);
    gl.uniform1f(this.uniforms.dotSize, Math.max(2.2, canvas.height / 140));
    gl.enableVertexAttribArray(this.location);
    const bind = buffer => { gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.vertexAttribPointer(this.location, 4, gl.FLOAT, false, 0, 0); };
    if (this.boxCount) { bind(this.boxBuffer); gl.uniform1f(this.uniforms.lines, 1); gl.drawArrays(gl.LINES, 0, this.boxCount); }
    bind(this.buffer); gl.uniform1f(this.uniforms.lines, 0); gl.drawArrays(gl.POINTS, 0, this.vertices.length / 4);
  }
  drawFallback() {
    const { ctx, canvas, vertices: v } = this; if (!ctx) return;
    const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const stride = Math.max(1, Math.ceil(v.length / 4 / 18_000)) * 4;
    for (let i = 0; i < v.length; i += stride) {
      const x = v[i] * cy - v[i + 1] * sy, y = v[i] * sy + v[i + 1] * cy;
      const rY = y * sp + v[i + 2] * cp, depth = y * cp - v[i + 2] * sp;
      const scale = this.zoom * 2.5 / (2.7 - depth * 0.35) * h / 2;
      ctx.fillStyle = v[i + 3] > 0.8 ? '#e4ba9e' : v[i + 3] > 0.4 ? '#a796f3' : '#66e4c5';
      ctx.fillRect(w / 2 + x * scale, h / 2 - rY * scale, Math.max(1, h / 170), Math.max(1, h / 170));
    }
  }
}
