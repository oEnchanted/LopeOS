import { BLEND_MODES, type BlendMode } from './model.ts';
import type { Canvas } from './render.ts';

/** Straight-alpha, ping-pong WebGL2 compositor. Groups/adjustments use the Canvas reference path. */
export class WebGLCompositor {
  readonly canvas: Canvas;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private textures: WebGLTexture[] = [];
  private framebuffers: WebGLFramebuffer[] = [];
  private vao: WebGLVertexArrayObject;
  private width = 0;
  private height = 0;
  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1,1) : document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is unavailable.'); this.gl = gl;
    const shader = (type: number, source: string) => { const s = gl.createShader(type)!; gl.shaderSource(s,source); gl.compileShader(s); if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'WebGL shader failed.'); return s; };
    const v = shader(gl.VERTEX_SHADER,`#version 300 es
      out vec2 uv;
      void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
    const f = shader(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float; in vec2 uv; uniform sampler2D back; uniform sampler2D front; uniform float opacity; uniform int mode; out vec4 result;
      float lum(vec3 c){return dot(c,vec3(.3,.59,.11));}
      float sat(vec3 c){return max(max(c.r,c.g),c.b)-min(min(c.r,c.g),c.b);}
      vec3 clipColor(vec3 c){float l=lum(c);float n=min(min(c.r,c.g),c.b);float x=max(max(c.r,c.g),c.b);if(n<0.)c=l+(c-l)*l/(l-n);if(x>1.)c=l+(c-l)*(1.-l)/(x-l);return c;}
      vec3 setLum(vec3 c,float l){return clipColor(c+(l-lum(c)));}
      vec3 setSat(vec3 c,float s){float n=min(min(c.r,c.g),c.b);float x=max(max(c.r,c.g),c.b);return x>n?(c-n)*s/(x-n):vec3(0.);}
      float dodge(float b,float s){return b==0.?0.:s==1.?1.:min(1.,b/(1.-s));}
      float burn(float b,float s){return b==1.?1.:s==0.?0.:1.-min(1.,(1.-b)/s);}
      float vivid(float b,float s){return s<.5?burn(b,2.*s):dodge(b,2.*s-1.);}
      float divide(float b,float s){return s==0.?1.:min(1.,b/s);}
      float soft(float b,float s){return s<=.5?b-(1.-2.*s)*b*(1.-b):b+(2.*s-1.)*((b<=.25?((16.*b-12.)*b+4.)*b:sqrt(b))-b);}
      vec3 blend(vec3 b,vec3 s){if(mode==1)return b*s;if(mode==2)return b+s-b*s;if(mode==3)return mix(2.*b*s,1.-2.*(1.-b)*(1.-s),step(vec3(.500001),b));if(mode==4)return min(b,s);if(mode==5)return max(b,s);if(mode==6)return abs(b-s);if(mode==7)return setLum(setSat(s,sat(b)),lum(b));if(mode==8)return setLum(setSat(b,sat(s)),lum(b));if(mode==9)return setLum(s,lum(b));if(mode==10)return setLum(b,lum(s));if(mode==11)return vec3(dodge(b.r,s.r),dodge(b.g,s.g),dodge(b.b,s.b));if(mode==12)return vec3(burn(b.r,s.r),burn(b.g,s.g),burn(b.b,s.b));if(mode==13)return mix(2.*b*s,1.-2.*(1.-b)*(1.-s),step(vec3(.500001),s));if(mode==14)return vec3(soft(b.r,s.r),soft(b.g,s.g),soft(b.b,s.b));if(mode==15)return b+s-2.*b*s;
        if(mode==16)return max(vec3(0.),b+s-1.);if(mode==17)return min(vec3(1.),b+s);
        if(mode==18||mode==19){float totalB=dot(round(b*255.),vec3(1.)),totalS=dot(round(s*255.),vec3(1.));return (mode==18?totalS<totalB:totalS>totalB)?s:b;}
        if(mode==20)return vec3(vivid(b.r,s.r),vivid(b.g,s.g),vivid(b.b,s.b));if(mode==21)return clamp(b+2.*s-1.,0.,1.);if(mode==22)return mix(min(b,2.*s),max(b,2.*s-1.),step(vec3(.5),s));if(mode==23)return step(vec3(1.),b+s);if(mode==24)return max(vec3(0.),b-s);if(mode==25)return vec3(divide(b.r,s.r),divide(b.g,s.g),divide(b.b,s.b));return s;}
      void main(){vec4 b=texture(back,uv);vec4 s=texture(front,vec2(uv.x,1.-uv.y));s.a*=opacity;float a=s.a+b.a*(1.-s.a);vec3 c=(1.-s.a)*b.a*b.rgb+(1.-b.a)*s.a*s.rgb+b.a*s.a*blend(b.rgb,s.rgb);result=a>0.?vec4(c/a,a):vec4(0.);}`);
    const program = gl.createProgram()!; gl.attachShader(program,v); gl.attachShader(program,f); gl.linkProgram(program); gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL program failed.'); this.program = program;
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    for (let i=0;i<3;i++) { const texture=gl.createTexture()!; this.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D,texture); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); if(i<2)this.framebuffers.push(gl.createFramebuffer()!); }
  }
  get available() { return !this.gl.isContextLost(); }
  render(width: number, height: number, layers: { canvas: () => Canvas; opacity: number; blend: BlendMode }[]) {
    const gl=this.gl;if(gl.isContextLost())throw new Error('WebGL context was lost.');
    if(width*height>4096*4096||width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||height>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('Document exceeds the GPU texture memory budget.');
    if(width!==this.width||height!==this.height){this.canvas.width=width;this.canvas.height=height;this.width=width;this.height=height;
      for(let i=0;i<2;i++){gl.bindTexture(gl.TEXTURE_2D,this.textures[i]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffers[i]);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.textures[i],0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('GPU framebuffer is incomplete.');}}
    gl.viewport(0,0,width,height);gl.bindVertexArray(this.vao);gl.useProgram(this.program);gl.disable(gl.BLEND);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffers[0]);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);let read=0;
    for(const item of layers){const write=1-read;gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffers[write]);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[read]);gl.uniform1i(gl.getUniformLocation(this.program,'back'),0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[2]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,item.canvas());gl.uniform1i(gl.getUniformLocation(this.program,'front'),1);gl.uniform1f(gl.getUniformLocation(this.program,'opacity'),item.opacity);gl.uniform1i(gl.getUniformLocation(this.program,'mode'),Math.max(0,BLEND_MODES.indexOf(item.blend)));gl.drawArrays(gl.TRIANGLES,0,3);read=write;}
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.framebuffers[read]);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('GPU compositing failed.');return this.canvas;
  }
  dispose(){const gl=this.gl;this.textures.forEach(t=>gl.deleteTexture(t));this.framebuffers.forEach(f=>gl.deleteFramebuffer(f));gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);this.canvas.width=0;this.canvas.height=0;}
}
