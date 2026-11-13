import type { Point, Transform } from './model.ts';
export type Matrix=[number,number,number,number,number,number];
export function matrixOf(t:Transform):Matrix{const angle=t.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),k=Math.tan((t.skewX||0)*Math.PI/180);return [c*t.scaleX,s*t.scaleX,(c*k-s)*t.scaleY,(s*k+c)*t.scaleY,t.x,t.y];}
export function multiply(a:Matrix,b:Matrix):Matrix{return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
export function inverse(m:Matrix):Matrix{const det=m[0]*m[3]-m[1]*m[2];if(Math.abs(det)<1e-12)throw new Error('The transform cannot have zero scale.');return [m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det];}
export function transformPoint(p:Point,m:Matrix):Point{return {...p,x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]};}
export function transformOf(m:Matrix):Transform{const scaleX=Math.hypot(m[0],m[1]),det=m[0]*m[3]-m[1]*m[2],scaleY=det/scaleX;if(scaleX<1e-8||Math.abs(scaleY)<1e-8)throw new Error('The transform cannot have zero scale.');return {x:m[4],y:m[5],scaleX,scaleY,rotation:Math.atan2(m[1],m[0])*180/Math.PI,skewX:Math.atan((m[0]*m[2]+m[1]*m[3])/(scaleX*scaleY))*180/Math.PI};}
export function around(point:Point,m:Matrix):Matrix{return multiply([1,0,0,1,point.x,point.y],multiply(m,[1,0,0,1,-point.x,-point.y]));}
