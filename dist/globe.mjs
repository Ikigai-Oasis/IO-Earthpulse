export function createGlobe(canvas){
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true});
  if(!gl)return null;
  const program=gl.createProgram();
  const compile=(type,source)=>{
    const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);
  };
  compile(gl.VERTEX_SHADER,'attribute vec2 vertex; varying vec2 uv; void main(){uv=vertex;gl_Position=vec4(vertex,0.,1.);}');
  compile(gl.FRAGMENT_SHADER,`
    precision highp float;
    varying vec2 uv;
    uniform sampler2D earth;
    uniform vec2 scale;
    uniform vec3 east,north,front;
    uniform float loaded;
    void main(){
      vec2 p=uv/scale;
      float r=length(p);
      if(r>1.){
        float halo=exp(-(r-1.)*25.)*.56;
        gl_FragColor=vec4(.19,.63,1.,halo);return;
      }
      float z=sqrt(max(0.,1.-dot(p,p)));
      vec3 n=p.x*east+p.y*north+z*front;
      vec2 tex=vec2(.5+atan(n.z,n.x)/6.2831853,.5-asin(clamp(n.y,-1.,1.))/3.1415926);
      vec3 color=mix(vec3(.035,.16,.26),texture2D(earth,tex).rgb,loaded);
      float light=.5+.55*max(0.,dot(vec3(p,z),normalize(vec3(-.55,.65,1.))));
      color=color*light+vec3(.09,.36,.62)*pow(1.-z,3.)*.65;
      gl_FragColor=vec4(color,1.);
    }`);
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const vertex=gl.getAttribLocation(program,'vertex');
  gl.enableVertexAttribArray(vertex);gl.vertexAttribPointer(vertex,2,gl.FLOAT,false,0,0);
  const texture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const [key,value] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,value);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
  const uniforms=Object.fromEntries(['scale','east','north','front','loaded'].map(key=>[key,gl.getUniformLocation(program,key)]));
  let loaded=false, basis, dimensions;
  function draw(lon,lat,zoom){
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const l=lon*Math.PI/180,b=lat*Math.PI/180;
    const east=[-Math.sin(l),0,Math.cos(l)],north=[-Math.sin(b)*Math.cos(l),Math.cos(b),-Math.sin(b)*Math.sin(l)],front=[Math.cos(b)*Math.cos(l),Math.sin(b),Math.cos(b)*Math.sin(l)];
    const radius=Math.min(w,h)*.405*zoom;
    basis=[east,north,front];dimensions={w,h,radius};
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.uniform2f(uniforms.scale,2*radius/w,2*radius/h);
    basis.forEach((v,i)=>gl.uniform3fv(uniforms[['east','north','front'][i]],v));
    gl.uniform1f(uniforms.loaded,Number(loaded));
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  return {
    maxSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),
    draw,
    upload(image){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);loaded=true;},
    project(lon,lat){
      if(!basis)return null;
      const a=lon*Math.PI/180,b=lat*Math.PI/180;
      const normal=[Math.cos(b)*Math.cos(a),Math.sin(b),Math.cos(b)*Math.sin(a)];
      const [x,y,z]=basis.map(axis=>axis.reduce((sum,value,i)=>sum+value*normal[i],0));
      const {w,h,radius}=dimensions;
      return z>.03?{x:w/2+x*radius,y:h/2-y*radius}:null;
    }
  };
}
