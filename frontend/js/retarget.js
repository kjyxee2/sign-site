import * as THREE from 'three';

// Camera-space -> VRM 1 coordinates: proper rotation about X, not a mirror.
export const sourcePoint = p => new THREE.Vector3(p[0], -p[1], -p[2]);
const worldQ = node => node.getWorldQuaternion(new THREE.Quaternion());
const worldP = node => node.getWorldPosition(new THREE.Vector3());
const safeUnit = v => {
  if(!Number.isFinite(v.lengthSq()) || v.lengthSq()<1e-12)throw Error('Degenerate joint direction');
  return v.normalize();
};
function palmFrame(wrist, middle, index, little){
  const x=safeUnit(middle.clone().sub(wrist));
  const y=index.clone().sub(little);y.addScaledVector(x,-y.dot(x));safeUnit(y);
  const z=safeUnit(new THREE.Vector3().crossVectors(x,y));
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}

export class Retargeter{
  constructor(vrm){
    this.vrm=vrm;this.bind=new Map();this.links=[];this.hands=[];this.targets=[];
    const bone=name=>{
      const n=vrm.humanoid.getRawBoneNode(name);
      if(!n)throw Error(`Missing Humanoid bone: ${name}`);
      if(!this.bind.has(n))this.bind.set(n,n.quaternion.clone());
      return n;
    };
    const add=(name,childName,part,a,b)=>{
      const node=bone(name),child=bone(childName);
      // Express actual bind child direction in the bone's local coordinates.
      const localDir=safeUnit(worldP(child).sub(worldP(node)).applyQuaternion(worldQ(node).invert()));
      this.links.push({name,node,child,part,a,b,localDir,bind:node.quaternion.clone()});
    };
    for(const [side,part,ids] of [['left','hand_l',[5,6,7]],['right','hand_r',[2,3,4]]]){
      add(side+'UpperArm',side+'LowerArm','pose',ids[0],ids[1]);
      add(side+'LowerArm',side+'Hand','pose',ids[1],ids[2]);
      const node=bone(side+'Hand');
      const frame=palmFrame(worldP(node),worldP(bone(side+'MiddleProximal')),
        worldP(bone(side+'IndexProximal')),worldP(bone(side+'LittleProximal')));
      this.hands.push({name:side+'Hand',node,part,bindPalm:frame,bindWorld:worldQ(node)});
      for(const [finger,start,names] of [
        ['Thumb',1,['Metacarpal','Proximal','Distal']],
        ['Index',5,['Proximal','Intermediate','Distal']],
        ['Middle',9,['Proximal','Intermediate','Distal']],
        ['Ring',13,['Proximal','Intermediate','Distal']],
        ['Little',17,['Proximal','Intermediate','Distal']]]){
        add(side+finger+names[0],side+finger+names[1],part,start,start+1);
        add(side+finger+names[1],side+finger+names[2],part,start+1,start+2);
        // Distal remains at bind pose: this VRM has no tip node to calibrate.
      }
    }
    this.driven=[...this.links.map(l=>l.node),...this.hands.map(h=>h.node)];
    this.mapping=this.links.map(({name,child,part,a,b})=>({bone:name,raw:bone(name).name,child:child.name,part,source:[a,b]}));
  }
  reset(){
    for(const [n,q]of this.bind)n.quaternion.copy(q);
    this.targets=[];for(const hand of this.hands)delete hand.targetWorld;
    this.vrm.scene.updateMatrixWorld(true);
  }
  apply(frame){
    this.vrm.humanoid.autoUpdateHumanBones=false;
    this.targets=[];
    const solve=link=>{
      const {node,part,a,b}=link;
      const target=safeUnit(sourcePoint(frame[part][b]).sub(sourcePoint(frame[part][a])));
      const parentInv=worldQ(node.parent).invert();
      const localTarget=target.clone().applyQuaternion(parentInv);
      const bindDir=link.localDir.clone().applyQuaternion(link.bind);
      node.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(bindDir,localTarget).multiply(link.bind));
      node.updateWorldMatrix(false,true);
      this.targets.push({link,target});
    };
    // Parent first: arms, wrist orientation, then finger chains.
    for(const l of this.links.filter(l=>l.part==='pose'))solve(l);
    for(const hand of this.hands){
      const p=frame[hand.part].map(sourcePoint);
      const target=palmFrame(p[0],p[9],p[5],p[17]);
      const desired=target.multiply(hand.bindPalm.clone().invert()).multiply(hand.bindWorld);
      hand.targetWorld=desired.clone();
      hand.node.quaternion.copy(worldQ(hand.node.parent).invert().multiply(desired));
      hand.node.updateWorldMatrix(false,true);
    }
    for(const l of this.links.filter(l=>l.part!=='pose'))solve(l);
    this.vrm.scene.updateMatrixWorld(true);
  }
  diagnostics(){
    const errors=this.targets.map(({link,target})=>{
      const actual=safeUnit(worldP(link.child).sub(worldP(link.node)));
      return {bone:link.name,degrees:actual.angleTo(target)*180/Math.PI};
    });
    return {maxDirectionErrorDegrees:Math.max(0,...errors.map(x=>x.degrees)),directionErrors:errors,
      maxPalmErrorDegrees:Math.max(0,...this.hands.filter(h=>h.targetWorld).map(h=>worldQ(h.node).angleTo(h.targetWorld)*180/Math.PI)),
      hasMotionTargets:this.targets.length>0,drivenRawBones:this.driven.length,
      maxRawAngle:Math.max(...this.driven.map(n=>this.bind.get(n).angleTo(n.quaternion))),
      nonFinite:this.driven.some(n=>n.quaternion.toArray().some(x=>!Number.isFinite(x)))};
  }
}

export function interpolate(frames,time,fps){
  const f=Math.min(frames.length-1,Math.max(0,time*fps));const i=Math.floor(f),j=Math.min(i+1,frames.length-1),a=f-i;
  const out={frame_index:f,time_sec:time};
  for(const part of ['pose','hand_l','hand_r'])out[part]=frames[i][part].map((p,k)=>p.map((x,c)=>x+(frames[j][part][k][c]-x)*a));
  return out;
}

export function sourceSkeleton(scene,frames,metadata,hipHeight,avatarShoulderWidth){
  const scale=avatarShoulderWidth/metadata.checks.median_shoulder_width_source_units;
  const origin=sourcePoint(frames[0].pose[8]);
  const base=new THREE.Vector3(-.75,hipHeight,0);
  const objects=[];
  const bodyEdges=[[0,1],[1,2],[2,3],[3,4],[1,5],[5,6],[6,7],[1,8],[8,9],[9,10],[10,11],[8,12],[12,13],[13,14]];
  const handEdges=[];
  for(const start of [1,5,9,13,17]){handEdges.push([0,start]);for(let j=start;j<start+3;j++)handEdges.push([j,j+1]);}
  for(const [part,count,edges,color]of [['pose',25,bodyEdges,0x79bce7],['hand_l',21,handEdges,0xffc36b],['hand_r',21,handEdges,0x88e0ba]]){
    const points=new THREE.BufferGeometry();points.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));
    const lines=new THREE.BufferGeometry();lines.setAttribute('position',new THREE.BufferAttribute(new Float32Array(edges.length*6),3));
    const dots=new THREE.Points(points,new THREE.PointsMaterial({color,size:.015}));scene.add(dots);
    const wire=new THREE.LineSegments(lines,new THREE.LineBasicMaterial({color}));scene.add(wire);
    objects.push({part,edges,points,lines});
  }
  return frame=>{
    for(const o of objects){
      const p=frame[o.part].map(v=>sourcePoint(v).sub(origin).multiplyScalar(scale).add(base));
      p.forEach((v,i)=>v.toArray(o.points.attributes.position.array,i*3));
      o.edges.forEach(([a,b],i)=>{p[a].toArray(o.lines.attributes.position.array,i*6);p[b].toArray(o.lines.attributes.position.array,i*6+3);});
      for(const geom of [o.points,o.lines]){geom.attributes.position.needsUpdate=true;geom.computeBoundingSphere();}
    }
  };
}
