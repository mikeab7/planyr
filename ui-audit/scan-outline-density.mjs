/* scan-outline-density.mjs — NEW-1/NEW-2 (Tennessee 95-county sweep): lot count in EVERY 512-px Leaflet cell of a source's county at a zoom, by returnCountOnly, to find cells over the server's
 * record cap (the outline layer does not page, so such a cell draws short). Writes nothing; its numbers are committed in test/fixtures/tnOutlineDensity.json and pinned by test/tnOutlineDensity.test.js.
 *   node ui-audit/scan-outline-density.mjs [shelby|hamilton|hickman|montgomery] [16,17]
 * Slow on purpose (thousands of count queries): run it when a source is added or moved, not in CI. */
const SRC={
 hamilton:{u:"https://planyr.io/gis-proxy/mapsdev.hamiltontn.gov/hcwa03/rest/services/Live_Parcels/MapServer/0/query",box:[34.98,35.46,-85.55,-84.95],cap:1000},
 hickman:{u:"https://planyr.io/gis-proxy/maps.capturecama.com/arcgis/rest/services/Hickman/HickmanTN05182023/MapServer/9/query",box:[35.62,36.05,-87.80,-87.20],cap:1000},
 montgomery:{u:"https://services6.arcgis.com/H9ihyy27OU16MQR3/arcgis/rest/services/Parcels_Test/FeatureServer/0/query",box:[36.35,36.72,-87.65,-87.1],cap:1000},
 shelby:{u:"https://planyr.io/gis-proxy/scgis.shelbycountytn.gov/serverhigh/rest/services/Parcel/CERTParcel/MapServer/0/query",box:[34.98,35.32,-90.15,-89.62],cap:1000},
};
const only=process.argv[2]; const ZS=(process.argv[3]||"16,17").split(",").map(Number);
const N=(z)=>256*2**z;
const px=(lng,z)=>(lng+180)/360*N(z);
const py=(lat,z)=>{const r=lat*Math.PI/180;return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*N(z)};
const lng=(x,z)=>x/N(z)*360-180;
const lat=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/N(z))))*180/Math.PI;
async function count(u,b){const p=new URLSearchParams({f:"json",returnCountOnly:"true",geometry:JSON.stringify({xmin:b[0],ymin:b[1],xmax:b[2],ymax:b[3],spatialReference:{wkid:4326}}),geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects"});for(let t=0;t<3;t++){try{const r=await fetch(u+"?"+p);const j=await r.json();if(j.count!=null)return j.count}catch(e){}await new Promise(r=>setTimeout(r,500))}return -1}
for (const [k,s] of Object.entries(SRC)){ if(only&&only!==k)continue;
 for (const z of ZS){
  const cx0=Math.floor(px(s.box[2],z)/512),cx1=Math.floor(px(s.box[3],z)/512),cy0=Math.floor(py(s.box[1],z)/512),cy1=Math.floor(py(s.box[0],z)/512);
  const cells=[];for(let cx=cx0;cx<=cx1;cx++)for(let cy=cy0;cy<=cy1;cy++)cells.push([lng(cx*512,z),lat((cy+1)*512,z),lng((cx+1)*512,z),lat(cy*512,z)]);
  const res=[];let i=0;async function w(){while(i<cells.length){const c=cells[i++];res.push([await count(s.u,c),c])}}
  await Promise.all(Array.from({length:8},w));
  res.sort((a,b)=>b[0]-a[0]);
  console.log(k,"z"+z,"cells",cells.length,"top",res.slice(0,5).map(r=>r[0]).join(","),"cap",s.cap,"errors",res.filter(r=>r[0]<0).length,"over",res.filter(r=>r[0]>=s.cap).length, "at", res[0][1].map(v=>v.toFixed(4)).join(","));
 }}
